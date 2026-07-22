import { test } from "node:test";
import assert from "node:assert/strict";
import { prefilter, triageItems } from "../src/triage.js";

const PF = {
  keywords: ["párt", "infláció", "ksh"],
  exclude_patterns: ["sport", "foci"],
  eurostat_allow_prefixes: ["prc_", "une_"],
};

test("prefilter: Eurostat dataset-kód nem-engedélyezett doménben → DROP", () => {
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "APRO_MK_COLA - Dataset: updated data" }, PF), "DROP");
});

test("prefilter: Eurostat engedélyezett prefix → LLM", () => {
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "prc_hicp_midx - Dataset: updated data" }, PF), "LLM");
});

test("prefilter: Eurostat hír-headline (nem dataset-kód) → LLM", () => {
  assert.equal(prefilter({ source_id: "eurostat", kind: "hivatalos_adat", title: "Annual inflation down to 2.1% in the euro area" }, PF), "LLM");
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
      { id: 1, relevant: true, significance: "KIEMELT", kind: "kutatas" },
      { id: 2, relevant: true, significance: "FONTOS", kind: "hivatalos_adat" },
    ], provider: "gemini", model: "gemini-2.5-flash" };
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
  assert.equal(v.get("eurostat:1").relevant, false);
  assert.match(v.get("eurostat:1").reason, /prefilter/i);
  assert.equal(v.get("telex:1").significance, "KIEMELT");
  assert.equal(v.get("ksh:1").significance, "FONTOS");
});

test("triageItems: minden provider kiesik → degraded, üres verdikt", async () => {
  const items = [{ canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "pártvita" }];
  const completeFn = async () => null; // teljes kiesés
  const r = await triageItems(items, { completeFn, prefilterCfg: PF, log: [] });
  assert.equal(r.degraded, true);
});
