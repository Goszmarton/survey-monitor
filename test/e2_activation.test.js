import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectActiveSources, isActiveSource, channelsOf } from "../src/collect.js";
import * as europeelects from "../src/sources/europeelects.js";

// E2 AKTIVÁLÁS (a levél-ható változás): az europeelects determinista B-kaszt forrás bekötése.
// A sources.json flip (adapter=europeelects + list_url GCS-widget + status OK) ÉS a
// selectActiveSources bővítése (adapter+OK ág) EGYÜTT teszik aktívvá. PIROS a flip/bővítés
// ELŐTT (kaszt B, nincs feed/list_url az A-ágon → nem választódik ki); ZÖLD utána.

const { sources } = JSON.parse(readFileSync(fileURLToPath(new URL("../config/sources.json", import.meta.url)), "utf8"));

test("E2: az europeelects AKTÍV forrás (adapter=europeelects + status OK) — a collect felveszi", () => {
  const active = selectActiveSources(sources);
  const ee = active.find((s) => s.id === "europeelects");
  assert.ok(ee, "europeelects a kiválasztott aktív források közt");
  assert.equal(ee.adapter, "europeelects", "dedikált adapter-mező");
  assert.equal(ee.status, "OK", "status OK (fail-closed guard átengedi)");
  assert.match(ee.list_url, /^https:\/\/storage\.googleapis\.com\//, "a GCS-widget list_url-je (verifikált csatorna)");
});

test("E2: az aktivált europeelects a dedikált adapterre routol (nem generikus htmllist)", () => {
  const ee = selectActiveSources(sources).find((s) => s.id === "europeelects");
  const ch = channelsOf(ee);
  assert.equal(ch.length, 1, "pontosan egy csatorna");
  assert.equal(ch[0].fetcher, europeelects, "a dedikált europeelects adapter viszi");
});

test("E2: FAIL-CLOSED — adapter status OK NÉLKÜL NEM aktivál (pl. eurobarometer később)", () => {
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer", status: "NEM_AKTIVALT" }), false, "adapter + nem-OK status → inaktív");
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer", list_url: "https://x/y" }), false, "status hiánya (undefined) → inaktív");
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "europeelects", status: "OK" }), true, "adapter + OK → aktív");
});

test("E2: regresszió — a többi B-kaszt/adapter nélküli forrás MARAD inaktív", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  // eurobarometer 2026-08-24-től PARKOLVA (a B2-aktiválás incidens miatt visszavonva) →
  // visszakerült e listába; ld. b2_activation.test.js (parkolt-őrző).
  for (const id of ["politico_pop", "idea", "zavecz", "eurobarometer"]) {
    assert.ok(!activeIds.has(id), `${id} NEM aktív (nincs adapter+OK, se A-kaszt feed/list_url)`);
  }
});

test("E2: regresszió — a kaszt-A források kiválasztása változatlan (status-független ág)", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  // MEGSZUNT/HIBA_TARTOS A-források bekötve MARADNAK (nem status-szűrt az A-ág)
  for (const id of ["telex", "median", "szabadeu", "21kutato", "pew"]) {
    assert.ok(activeIds.has(id), `${id} továbbra is aktív (A-kaszt feed/list_url, status-független)`);
  }
});
