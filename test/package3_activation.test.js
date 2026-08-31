import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));

// 2026-08-31 forrás-bővítés, 3. CSOMAG: ÜZLETI SAJTÓ (user prioritás). Napi több tétel, de érdemi
// gazdasági/üzleti tartalom. Mind A-kaszt RSS, kind=sajto (→ Sajtószemle, nem a kutató-táblák).
//   forbes (Forbes), penzcentrum (Pénzcentrum, a VALÓDI feed: /rss/all.xml), bankmonitor (Bankmonitor).
test("3. csomag: üzleti sajtó aktív, feed-alapú, kind=sajto, A-kaszt", () => {
  const byId = Object.fromEntries(selectActiveSources(sources).map((s) => [s.id, s]));
  for (const id of ["forbes", "penzcentrum", "bankmonitor"]) {
    const s = byId[id];
    assert.ok(s, `${id} a kiválasztott aktív források közt`);
    assert.equal(s.kind, "sajto", `${id} kind=sajto (Sajtószemle)`);
    assert.equal(s.kaszt, "A", `${id} A-kaszt`);
    assert.ok(s.feed && /^https:\/\//.test(s.feed), `${id} https feed-URL`);
  }
});
