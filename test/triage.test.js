import { test } from "node:test";
import assert from "node:assert/strict";
import { prefilter, triageItems } from "../src/triage.js";

const PF = {
  keywords: ["párt", "infláció", "ksh"],
  exclude_patterns: ["sport", "foci"],
};

test("prefilter: Eurostat dataset-kód churn → DROP (pontos éles title-ek)", () => {
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "APRO_MK_COLA - Dataset: updated data" }, PF), "DROP");
  // a 14:29-es futásban átcsúszott (örökölt) pontos érték idézőjelekkel:
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: 'EI_ISBR_M - "Dataset: updated data"' }, PF), "DROP");
  // a másik éles variáns: "updated structure and data"
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: 'EI_ISBR_M - "Dataset: updated structure and data"' }, PF), "DROP");
  // az allowlist megszűnt: a 'prc_' churn is DROP (spec 25: ne váljon adattemetővé)
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "prc_hicp_midx - Dataset: updated data" }, PF), "DROP");
});

test("prefilter: Eurostat euro-indicators news headline (nem dataset-kód) → LLM", () => {
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "Annual inflation down to 2.1% in the euro area" }, PF), "LLM");
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "GDP up by 0.3% in the euro area in Q2 2026" }, PF), "LLM");
});

test("prefilter: sajtó sport-cím kulcsszó nélkül → DROP", () => {
  assert.equal(prefilter({ source_id: "telex", kind: "sajto", title: "Sport: a foci-bajnokság eredményei" }, PF), "DROP");
});

test("prefilter: sajtó sport-cím DE releváns kulcsszóval → LLM", () => {
  assert.equal(prefilter({ source_id: "telex", kind: "sajto", title: "Sportköltségvetés: pártvita az inflációról" }, PF), "LLM");
});

test("prefilter: hivatalos KSH mindig LLM", () => {
  assert.equal(prefilter({ source_id: "ksh", kind: "hivatalos_adat", title: "Bármi" }, PF), "LLM");
});

test("triageItems: DROP-ok nem mennek LLM-hez, a maradékot az LLM ítéli", async () => {
  const items = [
    { canonical_key: "eurostat:1", source_id: "eurostat", kind: "hivatalos_adat", title: "APRO_MK - Dataset: updated data" }, // DROP
    { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "Új pártpreferencia-kutatás" }, // LLM
    { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "Infláció adatok" }, // LLM
  ];
  const calls = [];
  const completeFn = async (role, prompt, { log }) => {
    calls.push(prompt);
    log?.push({ role, provider: "gemini", status: "OK" });
    return { data: [
      { id: 1, relevant: true, significance: "FONTOS", kind: "hivatalos_adat" },
      { id: 2, relevant: true, significance: "FONTOS", kind: "hivatalos_adat" },
    ], provider: "gemini", model: "gemini-flash-latest" };
  };
  const log = [];
  const r = await triageItems(items, { completeFn, prefilterCfg: PF, log, batchSize: 15 });

  assert.equal(r.degraded, false);
  assert.equal(calls.length, 1, "egy batch-hívás a 2 LLM-tételre");
  // az LLM-be küldött prompt csak a 2 nem-DROP tételt tartalmazza
  assert.match(calls[0], /pártpreferencia/);
  assert.match(calls[0], /Infláció/);
  assert.ok(!calls[0].includes("APRO_MK"), "a DROP-tétel nincs a promptban");

  const v = r.verdicts;
  assert.equal(v.get("eurostat:1").relevant, false); // prefilter DROP
  assert.match(v.get("eurostat:1").reason, /prefilter/i);
  // a 2 LLM-tétel ítéletet kapott (a sorrend prioritás-függő, ezért érték-független az assert)
  assert.equal(v.get("telex:1").relevant, true);
  assert.ok(["KIEMELT", "FONTOS", "FIGYELENDO"].includes(v.get("telex:1").significance));
  assert.equal(v.get("ksh:1").relevant, true);
  assert.ok(["KIEMELT", "FONTOS", "FIGYELENDO"].includes(v.get("ksh:1").significance));
});

test("triageItems: minden provider kiesik → degraded, üres verdikt", async () => {
  const items = [{ canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "pártvita" }];
  const completeFn = async () => null; // teljes kiesés
  const r = await triageItems(items, { completeFn, prefilterCfg: PF, log: [] });
  assert.equal(r.degraded, true);
});

test("triageItems: részleges batch-hiba → NEM degraded, a sikeres verdiktek megmaradnak", async () => {
  // 3 batch (batchSize 1): 1. OK, 2. OK, 3. null (bukott)
  const items = [
    { canonical_key: "a", source_id: "telex", kind: "sajto", title: "pártA" },
    { canonical_key: "b", source_id: "telex", kind: "sajto", title: "pártB" },
    { canonical_key: "c", source_id: "telex", kind: "sajto", title: "pártC" },
  ];
  let n = 0;
  const completeFn = async () => {
    n++;
    if (n === 3) return null; // az utolsó batch elbukik
    return { data: [{ id: 1, relevant: true, significance: "FONTOS", kind: "sajto" }], provider: "gemini", model: "m" };
  };
  const r = await triageItems(items, { completeFn, prefilterCfg: PF, log: [], batchSize: 1 });

  assert.equal(r.degraded, false, "van sikeres batch → nem degradált");
  assert.equal(r.verdicts.get("a").significance, "FONTOS");
  assert.equal(r.verdicts.get("b").significance, "FONTOS");
  // a bukott batch tétele: megmarad, de ítélet nélkül (relevant true, significance null)
  assert.equal(r.verdicts.get("c").relevant, true);
  assert.equal(r.verdicts.get("c").significance, null);
  assert.match(r.verdicts.get("c").reason, /hiányzó ítélet|batch/i);
});

test("triageItems: cap + prioritás — hivatalos és UJ_24H előre, a többi halasztva", async () => {
  const items = [];
  // 4 régi sajtó (KORABBI) + 2 hivatalos (UJ_24H) — a cap 2 tétel (maxItems)
  for (let i = 0; i < 4; i++) items.push({ canonical_key: `s${i}`, source_id: "telex", kind: "sajto", title: `párthír ${i}`, freshness: "KORABBI" });
  items.push({ canonical_key: "ksh1", source_id: "ksh", kind: "hivatalos_adat", title: "KSH infláció", freshness: "UJ_24H" });
  items.push({ canonical_key: "mnb1", source_id: "mnb", kind: "hivatalos_adat", title: "MNB kamat", freshness: "UJ_24H" });

  const seen = [];
  const completeFn = async (role, prompt) => {
    seen.push(prompt);
    return { data: [{ id: 1, relevant: true, significance: "FONTOS", kind: "hivatalos_adat" }], provider: "gemini", model: "m" };
  };
  const log = [];
  const r = await triageItems(items, { completeFn, prefilterCfg: PF, log, batchSize: 1, maxItems: 2 });

  // a 2 hivatalos UJ_24H tétel triázsra ment (prioritás), a 4 régi sajtó nem
  const promptText = seen.join("\n");
  assert.match(promptText, /KSH infláció/);
  assert.match(promptText, /MNB kamat/);
  assert.ok(!/párthír/.test(promptText), "a régi sajtó a cap fölött halasztva");
  assert.ok(log.some((e) => e.status === "DEFERRED"), "a halasztás naplózva");
});
