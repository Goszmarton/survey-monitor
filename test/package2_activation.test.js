import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));

// 2026-08-31 forrás-bővítés, 2. CSOMAG: további HAZAI kutató/think-tank feedek. Alacsony napi
// volumen (ritkán publikálnak) → TPM-barát; magas relevancia. Mind A-kaszt RSS, kind=intezet.
//   egyensuly (Egyensúly Intézet), xxiszazad (XXI. Század Intézet), mertek (Mérték médiakutató),
//   krtkvgi (KRTK Világgazdasági Intézet), habitat (Habitat lakhatás-politika).
test("2. csomag: hazai kutató-feedek aktívak, feed-alapúak, kind=intezet, A-kaszt", () => {
  const byId = Object.fromEntries(selectActiveSources(sources).map((s) => [s.id, s]));
  for (const id of ["egyensuly", "xxiszazad", "mertek", "krtkvgi", "habitat"]) {
    const s = byId[id];
    assert.ok(s, `${id} a kiválasztott aktív források közt`);
    assert.equal(s.kind, "intezet", `${id} kind=intezet`);
    assert.equal(s.kaszt, "A", `${id} A-kaszt`);
    assert.ok(s.feed && /^https:\/\//.test(s.feed), `${id} https feed-URL`);
  }
});
