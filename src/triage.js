// Triázs (F2). Kétlépcsős: (1) olcsó kód-előszűrő zajra (Eurostat dataset-kód
// allowlist + sajtó exclude-minták), (2) LLM-ítélet a maradékon: releváns-e
// (spec 1. pont: magyar közélet/gazdaság/társadalom/kutatás), jelentőség
// (KIEMELT/FONTOS/FIGYELENDO), kind-pontosítás — batch-elt JSON-hívásban.
// A séma a szerződés; a complete() validálja és a láncon fallbacköl.
// Minden provider kiesésekor degraded=true → a hívó F1-módban rendereli.

const TRIAGE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "relevant", "significance"],
    properties: {
      id: { type: "integer" },
      relevant: { type: "boolean" },
      significance: { type: "string", enum: ["KIEMELT", "FONTOS", "FIGYELENDO"] },
      kind: { type: "string" },
      reason: { type: "string" },
    },
  },
};

const DATASET_CODE = /^[A-Z][A-Z0-9_]{2,}\b.*\bDataset\b/i; // pl. "APRO_MK_COLA - Dataset: updated data"

/** @returns {"DROP"|"LLM"} — DROP: kódból eldöntött irreleváns (nincs LLM-hívás). */
export function prefilter(item, cfg) {
  const title = (item.title ?? "").toLowerCase();

  // Eurostat katalógus dataset-kódok: csak engedélyezett domének mennek tovább.
  if (item.source_id === "eurostat" && DATASET_CODE.test(item.title ?? "")) {
    const code = (item.title ?? "").trim().toLowerCase();
    const allowed = (cfg.eurostat_allow_prefixes ?? []).some((p) => code.startsWith(p.toLowerCase()));
    return allowed ? "LLM" : "DROP";
  }

  // Sajtó: kizáró rovatminták — de releváns kulcsszó felülírja.
  if (item.kind === "sajto") {
    const hasKeyword = (cfg.keywords ?? []).some((k) => title.includes(k.toLowerCase()));
    const excluded = (cfg.exclude_patterns ?? []).some((p) => title.includes(p.toLowerCase()));
    if (excluded && !hasKeyword) return "DROP";
  }

  // Hivatalos adat és minden más → LLM-ítélet.
  return "LLM";
}

function buildPrompt(batch) {
  const lines = batch.map((it, i) =>
    `${i + 1}. [${it.source_id}] ${it.title ?? ""}${it.summary ? " — " + String(it.summary).replace(/\s+/g, " ").slice(0, 200) : ""}`,
  );
  return [
    "Magyar közéleti/gazdasági/társadalmi kutatás- és adatmonitor triázsa vagy.",
    "RELEVANCIA (spec 1. pont) — RELEVÁNS-e a magyar közélet szempontjából: magyar belpolitika, pártpreferencia, választások, közvélemény, társadalmi attitűdök; gazdaság, megélhetés, szegénység, jövedelmek, foglalkoztatás, lakhatás; egészségügy, oktatás, demográfia. Rejtett magyar adat: egy NEMZETKÖZI kutatás is releváns, ha külön magyar minta/adat szerepel benne.",
    "Minden tételhez add meg: relevant (true/false), significance (KIEMELT | FONTOS | FIGYELENDO), kind (kutatas | hivatalos_adat | sajto | nemzetkozi), rövid reason.",
    "JELENTŐSÉG (spec 15. pont):",
    "- KIEMELT — CSAK ha: trendforduló, rendkívüli/történelmi érték, EU-s/nemzetközi szélső pozíció, nagy pártpreferencia-változás, vagy jelentős inflációs/szegénységi/demográfiai/GDP-/bér-/foglalkoztatási/lakhatási változás, vagy váratlan eredmény. Rutinszerű új kutatás vagy havi adat ÖNMAGÁBAN NEM KIEMELT.",
    "- FONTOS — érdemi új országos adat rendkívüli változás nélkül.",
    "- FIGYELENDO — releváns, de háttérjellegű.",
    "Válaszolj KIZÁRÓLAG egy JSON-tömbbel, elemenként {id, relevant, significance, kind, reason}. Az id a lenti sorszám.",
    "",
    ...lines,
  ].join("\n");
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * @param {Array} items  DB-tételek (canonical_key, source_id, kind, title, summary?)
 * @param {object} opts
 * @param {function} opts.completeFn  (role, prompt, {schema, log}) → {data}|null
 * @param {object} opts.prefilterCfg
 * @param {Array}  [opts.log]
 * @param {number} [opts.batchSize]
 * @returns {Promise<{verdicts:Map<string,object>, degraded:boolean}>}
 */
export async function triageItems(items, { completeFn, prefilterCfg, log = [], batchSize = 15 }) {
  const verdicts = new Map();
  const llmItems = [];

  for (const it of items) {
    if (prefilter(it, prefilterCfg) === "DROP") {
      verdicts.set(it.canonical_key, { relevant: false, significance: null, kind: it.kind, reason: "prefilter: kódból irreleváns (zajszűrés)" });
    } else {
      llmItems.push(it);
    }
  }

  let degraded = false;
  for (const batch of chunk(llmItems, batchSize)) {
    const res = await completeFn("triage", buildPrompt(batch), { schema: TRIAGE_SCHEMA, log });
    if (res == null) {
      degraded = true;
      break; // ha egy batch teljesen kiesik, a többi is várhatóan → F1-fallback
    }
    const byId = new Map(res.data.map((r) => [r.id, r]));
    batch.forEach((it, i) => {
      const r = byId.get(i + 1);
      if (r) {
        verdicts.set(it.canonical_key, {
          relevant: r.relevant, significance: r.relevant ? r.significance : null,
          kind: r.kind ?? it.kind, reason: r.reason ?? "", triage_provider: res.provider, triage_model: res.model,
        });
      } else {
        // az LLM kihagyta ezt az id-t → óvatosan releváns-ismeretlen (megtartjuk)
        verdicts.set(it.canonical_key, { relevant: true, significance: "FIGYELENDO", kind: it.kind, reason: "triázs: hiányzó ítélet" });
      }
    });
  }

  return { verdicts, degraded };
}
