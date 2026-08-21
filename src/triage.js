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
      // relevant=false esetén a modellek null-t adnak — engedjük meg (nem bukhat séma).
      significance: { type: ["string", "null"], enum: ["KIEMELT", "FONTOS", "FIGYELENDO", null] },
      // Kétkapus relevancia (a) kapuja: a tétel MAGA konkrét kutatás/felmérés/
      // hivatalos adatközlés-e konkrét számmal. Nem kötelező (régi/más modell
      // kihagyhatja) → hiány = false = konzervatív (nem lehet KIEMELT).
      data_backed: { type: "boolean" },
      kind: { type: "string" },
      reason: { type: "string" },
    },
  },
};

const DATASET_CODE = /^[A-Z][A-Z0-9_]{2,}\b.*\bDataset\b/i; // pl. 'EI_ISBR_M - "Dataset: updated data"'
const DEFAULT_MAX_ITEMS = 600; // cap = 40 batch × 15 (backstop; a prioritás védi a fontosat)

// P0 — TPM-tudatos batch-szünet (§5.2). A kötő korlát KETTŐS: a napi TPD bő, DE a perces
// TPM (groq openai/gpt-oss-120b: MÉRT 8000 tok/perc, ~133,3 tok/s utántöltés) a per-run
// burst-plafon. Több forrás → hosszabb futás → a batch-löket a TPM-limithez közelít. Ezért a
// batchek KÖZT kényszerített minimum-szünet: a mért token/batch ÷ TPM_TOKENS_PER_S (=÷133,3,
// a break-even, ahol a vödör nem ürül tartósan), egy 25s padlóval (a 2616 tok/batch-es baseline
// ≈19,6s break-even fölé, tartalékkal). Levél-semleges: a szünet csak a futás sebességét
// változtatja, a verdikteket nem (kimenet bájtazonos).
// TÖRTÉNET: az EREDETI kalibráció llama-3.3-70b / 12000 TPM / ÷200 / 15s padló volt; a modell
// 08-16-i leállása óta a groq-limits-probe (2026-08-17) MÉRTE a 8000-et → a fenti 133,3/25s az
// ÉRVÉNYES. A képlet ADAPTÍV: a tényleges token/batch a usage-ből → ha a gpt-oss-120b (reasoning)
// többet fogyaszt (mért 08-21: átlag ~3860 tok/batch → ~29s szünet, a padló FÖLÉ), a szünet
// automatikusan nő (a TPM-et így akkor is védi, ha a tok/batch a padló fölé viszi).
const GROQ_TPM_LIMIT = 8000;                     // MÉRT free-tier TPM (openai/gpt-oss-120b), §5.3
const TPM_TOKENS_PER_S = GROQ_TPM_LIMIT / 60;    // ~133,3 tok/s utántöltés
const MIN_BATCH_PAUSE_MS = 25000;                // padló a break-even (19,6s) fölé, tartalékkal
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A batch tényleges token-fogyása a completeFn által a logba fűzött `usage.total_tokens`-ekből
// (a batch alatt keletkezett bejegyzések, `from`-tól). Összegzés: egy esetleges séma-retry
// külön hívás → külön usage; a burst szempontjából a SUMMA a mérvadó. Usage híján 0 → padló.
function batchTokens(log, from) {
  let sum = 0;
  for (let i = from; i < log.length; i++) {
    const t = log[i]?.usage?.total_tokens;
    if (typeof t === "number") sum += t;
  }
  return sum;
}

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
    "Minden tételhez add meg: relevant (true/false), significance (KIEMELT | FONTOS | FIGYELENDO | null), data_backed (true/false), kind (kutatas | hivatalos_adat | sajto | nemzetkozi), rövid reason.",
    "KÉTKAPUS RELEVANCIA — a jelentőség KÉT független feltételtől függ, MINDKETTŐ kell:",
    "  (a) TÉTEL-TÍPUS (data_backed): a tétel MAGA konkrét kutatás, közvélemény-kutatás, felmérés vagy hivatalos adatközlés-e, KONKRÉT SZÁMMAL/ARÁNNYAL/mérési eredménnyel? Ha igen → data_backed=true. Ha csak politikai/közéleti HÍR, esemény, bejelentés, nyilatkozat, botrány, kinevezés, jogszabály konkrét kutatási adat NÉLKÜL → data_backed=false, még ha szerepel is benne pénzösszeg vagy szám (pl. egy szerződés értéke, egy beruházás kerete NEM kutatási adat).",
    "  (b) TÉMA: a fenti relevancia-témák valamelyike.",
    "JELENTŐSÉG (spec 15. pont) — CSAK data_backed=true tételre adható KIEMELT vagy FONTOS:",
    "- KIEMELT — CSAK ha data_backed ÉS: trendforduló, rendkívüli/történelmi érték, EU-s/nemzetközi szélső pozíció, nagy pártpreferencia-változás, vagy jelentős inflációs/szegénységi/demográfiai/GDP-/bér-/foglalkoztatási/lakhatási változás, vagy váratlan mérési eredmény. Rutinszerű új kutatás vagy havi adat ÖNMAGÁBAN NEM KIEMELT.",
    "- FONTOS — data_backed, érdemi új országos adat rendkívüli változás nélkül.",
    "- FIGYELENDO — releváns, de háttérjellegű, VAGY adat nélküli releváns politikai hír (data_backed=false). PUSZTA POLITIKAI HÍR ADAT NÉLKÜL: legfeljebb FIGYELENDO, KIEMELT SOHA.",
    "ADATTEMETŐ-SZŰRÉS (spec 25. pont): egy puszta katalógus/dataset-frissítés konkrét magyar érték vagy szám nélkül (pl. 'X - Dataset: updated data') NEM érdemi tétel — relevant=false vagy data_backed=false. Ezzel szemben egy VALÓDI statisztikai közlés konkrét adattal/számmal (KSH-gyorstájékoztató, Eurostat news release konkrét értékkel) data_backed=true, legalább FONTOS, ha releváns.",
    "Válaszolj KIZÁRÓLAG egy JSON-tömbbel, elemenként {id, relevant, significance, data_backed, kind, reason}. Az id a lenti sorszám.",
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

// Hiányzó ítélet (bukott/hiányos batch): NEM végleges verdikt, csak jelzés.
// A `missing` flag miatt az applyTriage NEM ír triage_json-t → a tétel a
// következő futásban újra bekerül a triázs-jelöltek közé (enrich: !it.triage_json).
const missingVerdict = (it, reason) => ({ relevant: true, significance: null, kind: it.kind, reason, missing: true });

/**
 * Kapu ELŐTTI (nem-kapuzott) jelentőség: a relevancia-nullázás és a null→FIGYELENDO
 * normalizálás alkalmazva, de a data_backed-plafon MÉG NEM. Ez a modell szándéka,
 * amit a data_backed-kapu felülírhat — külön mentve (significance_raw), hogy a kapu
 * hatása auditálható és offline A/B-zhető legyen (CLAUDE.md 2: ne tűnjön el csendben).
 * @returns {"KIEMELT"|"FONTOS"|"FIGYELENDO"|null}
 */
function ungatedSignificance(r) {
  if (!r.relevant) return null;
  return r.significance ?? "FIGYELENDO";
}

/**
 * Determinisztikus kétkapus kapu (spec 1./15.): a KIEMELT/FONTOS csak data_backed
 * tételre adható. Adat nélküli (data_backed=false) releváns tétel — puszta politikai
 * hír — legfeljebb FIGYELENDO, KIEMELT SOHA. A modell (a) kapu-válaszát (data_backed)
 * a kód érvényesíti, nem csak a prompt reményli. relevant=false → null. A lehúzás
 * (raw≠kapuzott) így PONTOSAN a data_backed-plafon, nem a null-normalizálás.
 * @returns {"KIEMELT"|"FONTOS"|"FIGYELENDO"|null}
 */
function gatedSignificance(r) {
  const sig = ungatedSignificance(r);
  if (r.data_backed !== true && (sig === "KIEMELT" || sig === "FONTOS")) return "FIGYELENDO";
  return sig;
}

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
export async function triageItems(items, { completeFn, prefilterCfg, log = [], batchSize = 15, maxItems = DEFAULT_MAX_ITEMS, sleepFn = defaultSleep }) {
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
  const batches = chunk(toTriage, batchSize);
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    llmBatches++;
    const logStart = log.length;
    const res = await completeFn("triage", buildPrompt(batch), { schema: TRIAGE_SCHEMA, log });

    if (res == null) {
      // Bukott batch: a tételek megmaradnak, ítélet nélkül — a többi batch fut tovább.
      for (const it of batch) verdicts.set(it.canonical_key, missingVerdict(it, "triázs: hiányzó ítélet (batch kihagyva)"));
    } else {
      okBatches++;
      const byId = new Map(res.data.map((r) => [r.id, r]));
      batch.forEach((it, i) => {
        const r = byId.get(i + 1);
        if (r) {
          verdicts.set(it.canonical_key, {
            relevant: r.relevant, significance: gatedSignificance(r),
            significance_raw: ungatedSignificance(r), // kapu ELŐTTI érték — auditálhatóság (3a, CLAUDE.md 2)
            data_backed: r.data_backed === true,
            kind: r.kind ?? it.kind, reason: r.reason ?? "", triage_provider: res.provider, triage_model: res.model,
          });
        } else {
          verdicts.set(it.canonical_key, missingVerdict(it, "triázs: hiányzó ítélet"));
        }
      });
    }

    // P0 (§5.2): TPM-tudatos szünet a KÖVETKEZŐ batch előtt (az utolsó UTÁN nem, bukott batch
    // után is — ott is fogyott rate). A szünet = max(padló, mért token/batch ÷ TPM_TOKENS_PER_S),
    // azaz ÷ 133,3 (=8000 TPM / 60s) — az imént lezárt batch TÉNYLEGES usage-én (batchTokens),
    // nem becslésen: ez adja a ≤8000 TPM konstrukciós garanciát. A `continue`-t szándékosan
    // kerüljük, hogy a bukott batch se ugorja át a szünetet.
    if (bi < batches.length - 1) {
      const pauseMs = Math.max(MIN_BATCH_PAUSE_MS, Math.ceil(batchTokens(log, logStart) / TPM_TOKENS_PER_S) * 1000);
      await sleepFn(pauseMs);
    }
  }

  // Degradált CSAK akkor, ha volt LLM-tétel, de EGYETLEN batch sem sikerült.
  const degraded = llmBatches > 0 && okBatches === 0;
  return { verdicts, degraded };
}
