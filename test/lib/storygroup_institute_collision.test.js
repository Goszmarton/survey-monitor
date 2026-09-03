import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveInstitutes, instituteKeysOf } from "../../src/lib/storygroup.js";

// INTÉZET-TOKEN KOLLÍZIÓ FIX (2026-09-03, defense-in-depth). A "21 Kutatóközpont" egyetlen
// megkülönböztető tokene a szám ("21"); a "Real-PR 93"-é a "93". Ha ezek ÖNÁLLÓ intézet-matcherek,
// illeszkednek BÁRMELY cím párt-százalékára / évszámára ("Fidesz–KDNP 21 százalék") → a tétel
// HAMISAN felveszi a 21kutato intézet-kulcsot, ami a KEMÉNY intézet-guardot félrevezetheti (hamis
// összevonás v. hamis szétválasztás; a false-merge a drágább, ARCHITEKTURA 2–3.). Fix: a pusztán
// numerikus token SOHA nem önálló matcher — a számmal kezdődő intézetet BIGRAM azonosítja
// ("21" + "kutatóközpont" SZOMSZÉDOS pár), így a "21 Kutatóközpont" felismerhető, a "Fidesz 21%" nem.

const institutes = deriveInstitutes(
  [
    { id: "21kutato", kind: "intezet", name: "21 Kutatóközpont" },
    { id: "realpr93", kind: "intezet", name: "Real-PR 93" },
    { id: "median", kind: "intezet", name: "Medián" },
  ],
  { institute_generic_tokens: ["kutatokozpont", "kozpont"] },
);

test("intézet-kollízió: párt-% cím NEM veszi fel a 21kutato kulcsot a bare '21'-en (a javított hiba)", () => {
  const keys = instituteKeysOf({ source_id: "telex", title: "Medián: Fidesz–KDNP 21 százalékon áll" }, institutes);
  assert.ok(!keys.has("21kutato"), "a puszta '21' szám NEM jelent 21 Kutatóközpontot");
  assert.ok(keys.has("median"), "a valódi intézet (Medián) viszont illeszkedik");
});

test("intézet-kollízió: évszám/‰ cím NEM veszi fel a realpr93 kulcsot a bare '93'-on", () => {
  const keys = instituteKeysOf({ source_id: "hvg", title: "Az 1993-as népszavazás óta nem volt ilyen" }, institutes);
  assert.ok(!keys.has("realpr93"), "a '93' szám önmagában NEM jelent Real-PR 93-at");
});

test("intézet-kollízió: a valódi '21 Kutatóközpont' említés BIGRAMON felismerhető marad", () => {
  const keys = instituteKeysOf({ source_id: "hvg", title: "21 Kutatóközpont: a Tisza vezet a legfrissebb mérésen" }, institutes);
  assert.ok(keys.has("21kutato"), "a '21' + 'kutatóközpont' szomszédos pár → 21kutato (bigram)");
});

test("intézet-kollízió: a saját forrásból jövő tétel (source_id) továbbra is felismerhető", () => {
  const keys = instituteKeysOf({ source_id: "21kutato", title: "Baka Zsolt: kampányzárás előtti mérés" }, institutes);
  assert.ok(keys.has("21kutato"), "a source_id='21kutato' token azonosítja a saját tételt");
});
