// Triázs (F2). Kétlépcsős: (1) olcsó kód-előszűrő zajra (Eurostat katalógus
// dataset-kód churn + sajtó exclude-minták), (2) LLM-ítélet a maradékon:
// relevancia (spec 1.), jelentőség (spec 15.), kind — batch-elt JSON-hívásban.
// A séma a szerződés; a complete() validálja és a láncon fallbacköl.
//
// Robusztusság (F2 hibajavítás):
// - EGY bukott batch NEM dönti el az egész triázst: tételei „hiányzó ítélet"-et
//   kapnak, a többi batch fut tovább; degraded csak ha EGYETLEN batch sem sikerült.
// - Prioritás + cap: hivatalos (KSH/MNB) + friss tételek előre → a cap sosem
//   vágja le a fontosat; a maradék a következő futásra halasztódik (logolva).

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

const DATASET_CODE = /^[A-Z][A-Z0-9_]{2,}\b.*\bDataset\b/i; // pl. 'EI_ISBR_M - "Dataset: updated data"'
const DEFAULT_MAX_ITEMS = 600; // cap = 40 batch × 15 (backstop; a prioritás védi a fontosat)

/** @returns {"DROP"|"LLM"} — DROP: kódból eldöntött irreleváns (nincs LLM-hívás). */
export function prefilter(item, cfg) {
  const title = (item.title ?? "").toLowerCase();

  // Eurostat katalógus dataset-kód churn ("CODE - Dataset: updated data") → DROP:
  // nincs konkrét magyar érték (spec 25.: ne váljon adattemetővé). Az euro-indicators
  // news headline-ok nem matchelnek a regexre → LLM-ítéletre mennek.
  if (item.source_id === "eurostat" && DATASET_CODE.test(item.title ?? "")) return "DROP";

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
    "ADATTEMETŐ-SZŰRÉS (spec 25. pont): egy puszta katalógus/dataset-frissítés konkrét magyar érték vagy szám nélkül (pl. 'X - Dataset: updated data') NEM érdemi tétel — alapesetben relevant=false, legfeljebb FIGYELENDO. Ezzel szemben egy VALÓDI statisztikai közlés konkrét adattal/számmal (KSH-gyorstájékoztató, Eurostat news release konkrét értékkel) legalább FONTOS, ha releváns.",
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

// Prioritás: hivatalos (KSH/MNB) előre, azon belül a frissebb előre.
function priority(it) {
  const official = it.kind === "hivatalos_adat" ? 0 : 1;
  const fresh = it.freshness === "UJ_24H" ? 0 : it.freshness === "H24_48" ? 1 : 2;
  return official * 3 + fresh;
}

const missingVerdict = (it, reason) => ({ relevant: true, significance: null, kind: it.kind, reason });

/**
 * @param {Array} items
 * @param {object} opts
 * @param {function} opts.completeFn  (role, prompt, {schema, log}) → {data}|null
 * @param {object} opts.prefilterCfg
 * @param {Array}  [opts.log]
 * @param {number} [opts.batchSize]
 * @param {number} [opts.maxItems]    cap az LLM-nek küldött tételekre
 * @returns {Promise<{verdicts:Map<string,object>, degraded:boolean}>}
 */
export async function triageItems(items, { completeFn, prefilterCfg, log = [], batchSize = 15, maxItems = DEFAULT_MAX_ITEMS }) {
  const verdicts = new Map();
  const llmItems = [];

  for (const it of items) {
    if (prefilter(it, prefilterCfg) === "DROP") {
      verdicts.set(it.canonical_key, { relevant: false, significance: null, kind: it.kind, reason: "prefilter: kódból irreleváns (zajszűrés)" });
    } else {
      llmItems.push(it);
    }
  }

  // Prioritás + cap: a fontos (hivatalos + friss) tételek biztosan beleférnek.
  llmItems.sort((a, b) => priority(a) - priority(b));
  const toTriage = llmItems.slice(0, maxItems);
  const deferred = llmItems.length - toTriage.length;
  if (deferred > 0) {
    log.push({ role: "triage", status: "DEFERRED", detail: `${deferred} tétel a következő futásra (cap ${maxItems})` });
  }

  let okBatches = 0;
  let llmBatches = 0;
  for (const batch of chunk(toTriage, batchSize)) {
    llmBatches++;
    const res = await completeFn("triage", buildPrompt(batch), { schema: TRIAGE_SCHEMA, log });

    if (res == null) {
      // Bukott batch: a tételek megmaradnak, ítélet nélkül — a többi batch fut tovább.
      for (const it of batch) verdicts.set(it.canonical_key, missingVerdict(it, "triázs: hiányzó ítélet (batch kihagyva)"));
      continue;
    }

    okBatches++;
    const byId = new Map(res.data.map((r) => [r.id, r]));
    batch.forEach((it, i) => {
      const r = byId.get(i + 1);
      if (r) {
        verdicts.set(it.canonical_key, {
          relevant: r.relevant, significance: r.relevant ? r.significance : null,
          kind: r.kind ?? it.kind, reason: r.reason ?? "", triage_provider: res.provider, triage_model: res.model,
        });
      } else {
        verdicts.set(it.canonical_key, missingVerdict(it, "triázs: hiányzó ítélet"));
      }
    });
  }

  // Degradált CSAK akkor, ha volt LLM-tétel, de EGYETLEN batch sem sikerült.
  const degraded = llmBatches > 0 && okBatches === 0;
  return { verdicts, degraded };
}
