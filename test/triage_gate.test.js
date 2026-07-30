import { test } from "node:test";
import assert from "node:assert/strict";
import { triageItems } from "../src/triage.js";

const PF = { keywords: ["párt"], exclude_patterns: [] };

// A #4 kétkapus relevancia: a KIEMELT/FONTOS CSAK data_backed tételre adható.
// Adat nélküli (data_backed=false) releváns hír → legfeljebb FIGYELENDO, KIEMELT SOHA.
async function triageOne(modelVerdict) {
  const items = [{ canonical_key: "x", source_id: "telex", kind: "sajto", title: "párthír" }];
  const completeFn = async () => ({ data: [{ id: 1, ...modelVerdict }], provider: "gemini", model: "m" });
  const { verdicts } = await triageItems(items, { completeFn, prefilterCfg: PF, log: [], batchSize: 1 });
  return verdicts.get("x");
}

test("triázs-kapu: adat nélküli politikai hír KIEMELT-je → FIGYELENDO (KIEMELT soha) (#4)", async () => {
  const v = await triageOne({ relevant: true, significance: "KIEMELT", data_backed: false, kind: "sajto" });
  assert.equal(v.significance, "FIGYELENDO");
});

test("triázs-kapu: adat nélküli FONTOS is FIGYELENDO-ra esik (#4)", async () => {
  const v = await triageOne({ relevant: true, significance: "FONTOS", data_backed: false, kind: "sajto" });
  assert.equal(v.significance, "FIGYELENDO");
});

test("triázs-kapu: data_backed=true KIEMELT megmarad (valódi kutatás/adatközlés) (#4)", async () => {
  const v = await triageOne({ relevant: true, significance: "KIEMELT", data_backed: true, kind: "kutatas" });
  assert.equal(v.significance, "KIEMELT");
});

test("triázs-kapu: hiányzó data_backed → konzervatív, mintha false (nem lehet KIEMELT) (#4)", async () => {
  const v = await triageOne({ relevant: true, significance: "KIEMELT", kind: "sajto" }); // data_backed nincs megadva
  assert.equal(v.significance, "FIGYELENDO");
});

test("triázs-kapu: relevant=false → significance null (a modell null-ja is elmegy) (#4/#5)", async () => {
  const v = await triageOne({ relevant: false, significance: null, kind: "sajto" });
  assert.equal(v.relevant, false);
  assert.equal(v.significance, null);
});
