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

// 3a — AUDITÁLHATÓSÁG (CLAUDE.md 2): a kapu csak LEFELÉ ír (data_backed=false →
// KIEMELT/FONTOS => FIGYELENDO). A kapu ELŐTTI significance-t menteni kell, különben a
// lehúzás visszafejthetetlen: egy FIGYELENDO&data_backed=false tételről nem tudható, a
// modell FIGYELENDO-t vagy egy lehúzott KIEMELT-et mondott — minden futás egy napnyi
// auditálhatatlan (offline A/B-re alkalmatlan) adatot termelne. A significance_raw a
// data_backed-plafon ELŐTTI érték (a relevancia-null és a null→FIGYELENDO már benne),
// így raw≠significance PONTOSAN a data_backed-lehúzást jelzi, nem a null-normalizálást.
test("3a: kapu-lehúzáskor a nyers érték MEGVAN és KÜLÖNBÖZIK (data_backed=false KIEMELT)", async () => {
  const v = await triageOne({ relevant: true, significance: "KIEMELT", data_backed: false, kind: "sajto" });
  assert.equal(v.significance, "FIGYELENDO");           // kapuzott (report ezt látja)
  assert.equal(v.significance_raw, "KIEMELT");           // nyers, kapu előtti
  assert.notEqual(v.significance, v.significance_raw);   // a lehúzás láthatóvá válik
});

test("3a: FONTOS lehúzásnál is megvan mindkettő és különbözik (data_backed=false)", async () => {
  const v = await triageOne({ relevant: true, significance: "FONTOS", data_backed: false, kind: "sajto" });
  assert.equal(v.significance, "FIGYELENDO");
  assert.equal(v.significance_raw, "FONTOS");
  assert.notEqual(v.significance, v.significance_raw);
});

test("3a: kapu NEM húz le (data_backed=true) → raw == kapuzott, nincs hamis eltérés", async () => {
  const v = await triageOne({ relevant: true, significance: "KIEMELT", data_backed: true, kind: "kutatas" });
  assert.equal(v.significance, "KIEMELT");
  assert.equal(v.significance_raw, "KIEMELT");
  assert.equal(v.significance, v.significance_raw);
});
