// Kapu-A/B kísérlet-futtató (docs/KAPU-AB-KISERLET.md + zajpadló-kiegészítés).
// Három sorozat: B = tárolt produkciós significance_raw (referencia); B' = ugyanaz a
// prompt újrafuttatva (zajpadló); A = a 67–70. sor data_backed-előfeltétele NÉLKÜL.
// A batch-összetétel BIT-AZONOS a produkcióssal (a run kezdetén gyűjtött 154 tétel,
// stabil priority-sort, chunk(15) = 11 batch — külön verifikálva).
//
// A prod DB-t NEM írja; kimenet: state/experiments/kapu-ab-<runId>.json.
// Futtatás (kulcsok kellenek — ebben a repóban a workflow-secretek):
//   GEMINI_API_KEY=… GROQ_API_KEY=… ANTHROPIC_API_KEY=… node scripts/kapu-ab-experiment.mjs
//   DRY_RUN=1 node scripts/kapu-ab-experiment.mjs   # csak a batch-rekonstrukció + B-ref, hívás nélkül

import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { complete } from "../src/llm/complete.js";

const RUN_ID = process.argv[2] ?? "2026-08-07";
const DB_PATH = "state/monitor.db";
const BATCH = 15, CAP = 600, WINDOW_DAYS = 14;
const DRY = process.env.DRY_RUN === "1";

const TRIAGE_SCHEMA = {
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    required: ["id", "relevant", "significance"],
    properties: {
      id: { type: "integer" }, relevant: { type: "boolean" },
      significance: { type: ["string", "null"], enum: ["KIEMELT", "FONTOS", "FIGYELENDO", null] },
      data_backed: { type: "boolean" }, kind: { type: "string" }, reason: { type: "string" },
    },
  },
};

// A prompt KÉT változata: gated=true a produkciós; gated=false az A-kar (67–70. sor kapu nélkül).
function buildPrompt(batch, gated) {
  const lines = batch.map((it, i) =>
    `${i + 1}. [${it.source_id}] ${it.title ?? ""}${it.summary ? " — " + String(it.summary).replace(/\s+/g, " ").slice(0, 200) : ""}`);
  const sig = gated
    ? [
        "JELENTŐSÉG (spec 15. pont) — CSAK data_backed=true tételre adható KIEMELT vagy FONTOS:",
        "- KIEMELT — CSAK ha data_backed ÉS: trendforduló, rendkívüli/történelmi érték, EU-s/nemzetközi szélső pozíció, nagy pártpreferencia-változás, vagy jelentős inflációs/szegénységi/demográfiai/GDP-/bér-/foglalkoztatási/lakhatási változás, vagy váratlan mérési eredmény. Rutinszerű új kutatás vagy havi adat ÖNMAGÁBAN NEM KIEMELT.",
        "- FONTOS — data_backed, érdemi új országos adat rendkívüli változás nélkül.",
        "- FIGYELENDO — releváns, de háttérjellegű, VAGY adat nélküli releváns politikai hír (data_backed=false). PUSZTA POLITIKAI HÍR ADAT NÉLKÜL: legfeljebb FIGYELENDO, KIEMELT SOHA.",
      ]
    : [
        // A-kar: a data_backed-ELŐFELTÉTEL kivéve; a jelentőség-kritériumok MARADNAK.
        "JELENTŐSÉG (spec 15. pont) — a tétel érdemi súlya szerint:",
        "- KIEMELT — trendforduló, rendkívüli/történelmi érték, EU-s/nemzetközi szélső pozíció, nagy pártpreferencia-változás, vagy jelentős inflációs/szegénységi/demográfiai/GDP-/bér-/foglalkoztatási/lakhatási változás, vagy váratlan mérési eredmény. Rutinszerű új kutatás vagy havi adat ÖNMAGÁBAN NEM KIEMELT.",
        "- FONTOS — érdemi új országos jelentőségű fejlemény rendkívüli változás nélkül.",
        "- FIGYELENDO — releváns, de háttérjellegű.",
      ];
  return [
    "Magyar közéleti/gazdasági/társadalmi kutatás- és adatmonitor triázsa vagy.",
    "RELEVANCIA (spec 1. pont) — RELEVÁNS-e a magyar közélet szempontjából: magyar belpolitika, pártpreferencia, választások, közvélemény, társadalmi attitűdök; gazdaság, megélhetés, szegénység, jövedelmek, foglalkoztatás, lakhatás; egészségügy, oktatás, demográfia. Rejtett magyar adat: egy NEMZETKÖZI kutatás is releváns, ha külön magyar minta/adat szerepel benne.",
    "Minden tételhez add meg: relevant (true/false), significance (KIEMELT | FONTOS | FIGYELENDO | null), data_backed (true/false), kind (kutatas | hivatalos_adat | sajto | nemzetkozi), rövid reason.",
    "KÉTKAPUS RELEVANCIA — a jelentőség KÉT független feltételtől függ, MINDKETTŐ kell:",
    "  (a) TÉTEL-TÍPUS (data_backed): a tétel MAGA konkrét kutatás, közvélemény-kutatás, felmérés vagy hivatalos adatközlés-e, KONKRÉT SZÁMMAL/ARÁNNYAL/mérési eredménnyel? Ha igen → data_backed=true. Ha csak politikai/közéleti HÍR, esemény, bejelentés, nyilatkozat, botrány, kinevezés, jogszabály konkrét kutatási adat NÉLKÜL → data_backed=false, még ha szerepel is benne pénzösszeg vagy szám (pl. egy szerződés értéke, egy beruházás kerete NEM kutatási adat).",
    "  (b) TÉMA: a fenti relevancia-témák valamelyike.",
    ...sig,
    "ADATTEMETŐ-SZŰRÉS (spec 25. pont): egy puszta katalógus/dataset-frissítés konkrét magyar érték vagy szám nélkül (pl. 'X - Dataset: updated data') NEM érdemi tétel — relevant=false vagy data_backed=false. Ezzel szemben egy VALÓDI statisztikai közlés konkrét adattal/számmal (KSH-gyorstájékoztató, Eurostat news release konkrét értékkel) data_backed=true, legalább FONTOS, ha releváns.",
    "Válaszolj KIZÁRÓLAG egy JSON-tömbbel, elemenként {id, relevant, significance, data_backed, kind, reason}. Az id a lenti sorszám.",
    "", ...lines,
  ].join("\n");
}

const DATASET_CODE = /^[A-Z][A-Z0-9_]{2,}\b.*\bDataset\b/i;
function prefilter(it, cfg) {
  if (it.source_id === "eurostat" && DATASET_CODE.test(it.title ?? "")) return "DROP";
  if (it.kind === "sajto") {
    const t = (it.title ?? "").toLowerCase();
    const kw = (cfg.keywords ?? []).some((k) => t.includes(k.toLowerCase()));
    const ex = (cfg.exclude_patterns ?? []).some((p) => t.includes(p.toLowerCase()));
    if (ex && !kw) return "DROP";
  }
  return "LLM";
}
const priority = (it) => (it.kind === "hivatalos_adat" ? 0 : 1) * 3 + (it.freshness === "UJ_24H" ? 0 : it.freshness === "H24_48" ? 1 : 2);
const ungated = (r) => (!r.relevant ? null : (r.significance ?? "FIGYELENDO"));
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// --- batch-rekonstrukció (BIT-AZONOS a produkcióval) ---
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const runStart = db.prepare("SELECT started_at FROM run_attempts WHERE run_id = ? ORDER BY id DESC LIMIT 1").get(RUN_ID)?.started_at;
if (!runStart) throw new Error(`nincs run_attempts a ${RUN_ID}-hez`);
const ws = new Date(Date.parse(runStart) - WINDOW_DAYS * 864e5).toISOString();
const items = db.prepare("SELECT * FROM items WHERE first_seen_at >= ? OR published_at >= ? ORDER BY COALESCE(published_at, first_seen_at) DESC").all(ws, ws);
// candidate = a run kezdetén ÚJként gyűjtött tétel (first_seen_at == runStart), verifikáltan == a !triage_json halmaz
const cands = items.filter((it) => it.first_seen_at === runStart);
const prefCfg = JSON.parse(readFileSync(new URL("../config/triage.json", import.meta.url), "utf8"));
const llm = cands.filter((it) => prefilter(it, prefCfg) === "LLM");
const sorted = llm.map((it, i) => ({ it, i })).sort((a, b) => (priority(a.it) - priority(b.it)) || (a.i - b.i)).map((x) => x.it);
const toTriage = sorted.slice(0, CAP);
const batches = chunk(toTriage, BATCH);

// B-referencia: a tárolt significance_raw + data_backed + a KISZOLGÁLÓ PROVIDER a triage_json-ból
const bRef = new Map();
for (const it of toTriage) {
  let raw = null, gated = null, db_ = null, prov = null;
  try { const tj = JSON.parse(it.triage_json ?? "{}"); raw = tj.significance_raw ?? null; gated = it.significance ?? null; db_ = tj.data_backed ?? null; prov = tj.triage_provider ?? null; } catch { /* */ }
  bRef.set(it.canonical_key, { raw, gated, data_backed: db_, provider: prov });
}
db.close();

// B provider-mintázata batchenként: egy produkciós batchet EGY completeFn-hívás szolgált ki,
// így a batch tételei ugyanazt a triage_provider-t hordozzák. A leggyakoribb nem-null provider.
function batchProvider(batch) {
  const cnt = new Map();
  for (const it of batch) { const p = bRef.get(it.canonical_key)?.provider; if (p) cnt.set(p, (cnt.get(p) ?? 0) + 1); }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
}
const providerPattern = { B: batches.map(batchProvider), Bprime: [], A: [] };

console.log(`RUN ${RUN_ID} (start ${runStart}) | candidate=${cands.length}, LLM=${llm.length}, batch=${batches.length}, utolsó=${toTriage.length - (batches.length - 1) * BATCH}`);
console.log(`B-ref betöltve: ${[...bRef.values()].filter((b) => b.raw !== null).length}/${toTriage.length} tételnek van significance_raw-ja`);
console.log(`B provider-mintázat (tárolt triage_provider): [${providerPattern.B.join(", ")}]`);
if (DRY) { console.log("DRY_RUN — LLM-hívás kihagyva."); process.exit(0); }

// --- A/B' futtatás: minden batch KÉTSZER (B' = gated prompt, A = ungated prompt) ---
const rows = [];
for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  for (const [arm, gated] of [["Bprime", true], ["A", false]]) {
    const res = await complete("triage", buildPrompt(batch, gated), { schema: TRIAGE_SCHEMA, log: [] });
    if (res == null) { console.error(`batch ${b + 1} ${arm}: NULL válasz (nincs provider/kulcs?) — a kísérlet érvénytelen, állj le.`); process.exit(1); }
    providerPattern[arm][b] = res.provider; // per-kar, per-batch KISZOLGÁLÓ PROVIDER
    const byId = new Map(res.data.map((r) => [r.id, r]));
    batch.forEach((it, i) => {
      const r = byId.get(i + 1);
      const sig = r ? ungated(r) : null;
      let row = rows.find((x) => x.canonical_key === it.canonical_key);
      if (!row) { const ref = bRef.get(it.canonical_key); row = { canonical_key: it.canonical_key, title: it.title, batch: b + 1, B: ref.raw, B_gated: ref.gated, B_data_backed: ref.data_backed, B_provider: ref.provider }; rows.push(row); }
      row[arm] = sig;
      row[arm + "_provider"] = res.provider; // a tételt kiszolgáló provider (karonként)
      if (r) row[arm + "_data_backed"] = r.data_backed === true;
    });
    console.log(`batch ${b + 1}/${batches.length} ${arm}: ${res.provider}/${res.model}`);
  }
}

mkdirSync("state/experiments", { recursive: true });
const outPath = `state/experiments/kapu-ab-${RUN_ID}.json`;
writeFileSync(outPath, JSON.stringify({ runId: RUN_ID, runStart, nItems: rows.length, nBatches: batches.length, providerPattern, rows }, null, 2));

// --- kiértékelés ---
const diff = (x, y) => x !== y;
const noise = rows.filter((r) => diff(r.Bprime, r.B));
const ab = rows.filter((r) => diff(r.A, r.B));
const demoteK = rows.filter((r) => r.A === "KIEMELT" && r.B === "FIGYELENDO");
const demoteF = rows.filter((r) => r.A === "FONTOS" && r.B === "FIGYELENDO");
console.log(`\n=== EREDMÉNY (${outPath}) ===`);
console.log(`|B'-B| zajpadló: ${noise.length} / ${rows.length}`);
console.log(`|A-B| összes eltérés: ${ab.length} / ${rows.length}`);
console.log(`  ebből A=KIEMELT, B=FIGYELENDO: ${demoteK.length}`);
console.log(`  ebből A=FONTOS,   B=FIGYELENDO: ${demoteF.length}`);
console.log(`\n=== Leszorított tételek (A magasabb, B=FIGYELENDO) — kézi átnézésre ===`);
for (const r of [...demoteK, ...demoteF]) console.log(`  [A=${r.A} → B=FIGYELENDO | data_backed A=${r.A_data_backed} B=${r.B_data_backed} | provider A=${r.A_provider} B=${r.B_provider}] ${r.title}`);

// --- provider-mintázat: a három sorozat egymás mellett + eltérés-figyelmeztetés (KONFOUND) ---
console.log(`\n=== Provider-mintázat batchenként (KONFOUND-ellenőrzés) ===`);
console.log(`batch:  ${batches.map((_, i) => String(i + 1).padStart(3)).join("")}`);
for (const arm of ["B", "Bprime", "A"]) {
  const abbr = (p) => ({ gemini: "gem", groq: "grq", anthropic: "ant" }[p] ?? (p ? p.slice(0, 3) : "  ?"));
  console.log(`${arm.padEnd(7)}${providerPattern[arm].map((p) => abbr(p).padStart(3)).join("")}`);
}
const samePattern = (x, y) => x.length === y.length && x.every((p, i) => p === y[i]);
const bpMatch = samePattern(providerPattern.B, providerPattern.Bprime);
const aMatch = samePattern(providerPattern.B, providerPattern.A);
if (bpMatch && aMatch) {
  console.log(`\nprovider-mintázat: mind a három AZONOS → a mért eltérésekben nincs providerváltás-hatás.`);
} else {
  console.log(`\n⚠️ FIGYELMEZTETÉS — a provider-mintázat NEM azonos:`);
  if (!bpMatch) { const d = providerPattern.B.map((p, i) => p !== providerPattern.Bprime[i] ? i + 1 : null).filter(Boolean); console.log(`   B' ≠ B a(z) ${d.join(", ")}. batchben → a |B'-B| zajpadló RÉSZBEN providerváltás.`); }
  if (!aMatch) { const d = providerPattern.B.map((p, i) => p !== providerPattern.A[i] ? i + 1 : null).filter(Boolean); console.log(`   A ≠ B a(z) ${d.join(", ")}. batchben → a |A-B| eltérésben BENNE van a providerváltás hatása is; a kapu-effektus ettől NEM tisztán elkülönített.`); }
  console.log(`   (Ez naplózás — a nyers számok érvényesek, de a fenti batchekben az értelmezésnél vedd figyelembe.)`);
}
