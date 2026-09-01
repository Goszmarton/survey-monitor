import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));

// 2026-08-31 forrás-bővítés, 4. CSOMAG: NEMZETKÖZI kutató/adat-feedek. A magyar-relevanciát a
// triázs szűri per-tétel; a globális-nagyvolumenűekre (ECFR/WHO/ING) EXTRA `title_filter` (Pew-minta)
// hogy ne öntsék el a triázst irreleváns világhírrel. Mind A-kaszt RSS, kind=nemzetkozi.
// ingthink 2026-09-01 NYUGDÍJAZVA (user: nem kell) → revisit:"never", kizárva a gyűjtésből.
test("4. csomag: nemzetközi feedek aktívak, feed-alapúak, kind=nemzetkozi, A-kaszt", () => {
  const byId = Object.fromEntries(selectActiveSources(sources).map((s) => [s.id, s]));
  for (const id of ["ecfr", "eige", "who"]) {
    const s = byId[id];
    assert.ok(s, `${id} a kiválasztott aktív források közt`);
    assert.equal(s.kind, "nemzetkozi", `${id} kind=nemzetkozi`);
    assert.equal(s.kaszt, "A", `${id} A-kaszt`);
    assert.ok(s.feed && /^https:\/\//.test(s.feed), `${id} https feed-URL`);
  }
  assert.ok(!byId.ingthink, "ingthink NYUGDÍJAZVA (revisit:never) → nincs az aktív források közt");
});

test("4. csomag: a globális-nagyvolumenűek HU-relevancia title_filter-t kapnak (Pew-minta)", () => {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  for (const id of ["ecfr", "who"]) {
    const tf = byId[id].title_filter;
    assert.ok(Array.isArray(tf) && tf.includes("hungary") && tf.includes("magyar"), `${id} HU title_filter`);
  }
});
