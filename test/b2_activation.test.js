import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectActiveSources, isActiveSource, channelsOf } from "../src/collect.js";
import * as eurobarometer from "../src/sources/eurobarometer.js";

// B2 AKTIVÁLÁS (levél-ható változás): az eurobarometer determinista B-kaszt forrás bekötése,
// az E2 (europeelects) mintáját követve. Két lépés EGYÜTT teszi aktívvá:
//   (1) collect.js ADAPTERS registry: eurobarometer felvétele → channelsOf a dedikált adapterre routol;
//   (2) sources.json flip: adapter=eurobarometer + status OK (+ list_url a megjelenítéshez).
// PIROS a flip/registry-bővítés ELŐTT (kaszt B, NEM_AKTIVALT, nincs az ADAPTERS-ben); ZÖLD utána.
//
// A lánc élő smoke-teszttel igazolt (2026-08-22, lakossági IP): fetchNew → OK_UJ, hullám 105.3
// (fieldwork 2026-05-04), 30 HU-tétel. A fetch-lánc (resolveVolumeA) BELSŐ (API_BASE/HUB_BASE),
// nem a source.list_url-ből fetch-el — a list_url csak a check/item megjelenítés-URL-je.
//
// LEVÉL-BIZTONSÁG: a `since` globális (getLastRunStartedAt, ~előző futás), a filterSinceDay a
// fieldwork-véget (2026-05-04) hasonlítja a since-naphoz → egy régi hullám mind kiszűrve →
// OK_NINCS_UJ, 0 tétel. Tételek CSAK egy új hullámnál (fieldwork ≥ előző futás) jönnek → nincs burst.

const { sources } = JSON.parse(readFileSync(fileURLToPath(new URL("../config/sources.json", import.meta.url)), "utf8"));

test("B2: az eurobarometer AKTÍV forrás (adapter=eurobarometer + status OK) — a collect felveszi", () => {
  const active = selectActiveSources(sources);
  const eb = active.find((s) => s.id === "eurobarometer");
  assert.ok(eb, "eurobarometer a kiválasztott aktív források közt");
  assert.equal(eb.adapter, "eurobarometer", "dedikált adapter-mező");
  assert.equal(eb.status, "OK", "status OK (fail-closed guard átengedi)");
  assert.ok(typeof eb.list_url === "string" && eb.list_url.length > 0, "van megjelenítés-URL (check/item url)");
});

test("B2: az aktivált eurobarometer a dedikált adapterre routol (REAL ADAPTERS, nem generikus)", () => {
  const eb = selectActiveSources(sources).find((s) => s.id === "eurobarometer");
  const ch = channelsOf(eb);
  assert.equal(ch.length, 1, "pontosan egy csatorna");
  assert.equal(ch[0].fetcher, eurobarometer, "a dedikált eurobarometer adapter viszi");
});

test("B2: FAIL-CLOSED — adapter status OK NÉLKÜL NEM aktivál", () => {
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer", status: "NEM_AKTIVALT" }), false, "adapter + nem-OK → inaktív");
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer" }), false, "status hiánya → inaktív");
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer", status: "OK" }), true, "adapter + OK → aktív");
});

test("B2: regresszió — a többi NEM_AKTIVALT B-forrás MARAD inaktív", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  for (const id of ["politico_pop", "idea", "zavecz"]) {
    assert.ok(!activeIds.has(id), `${id} NEM aktív (nincs adapter+OK)`);
  }
});

test("B2: regresszió — az E2 (europeelects) továbbra is aktív, a két adapter nem üti egymást", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  assert.ok(activeIds.has("europeelects"), "europeelects marad aktív");
  assert.ok(activeIds.has("eurobarometer"), "eurobarometer is aktív");
});
