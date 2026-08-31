import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));

// 2026-08-31 forrás-bővítés, 5. CSOMAG: Magyar Hang (közéleti lap, sajto) + a TK ELTE 11 további
// akadémiai alfeedje (user: „mégiscsak szeretném bekötni, hátha"). A TK-feedek jórészt akadémiai
// publikációk (sok angol) → a relevancia-szűrő nagy részüket kidobja; a hazai-releváns átmegy.
const MAGHANG = "maghang";
const TK11 = ["tk_jog", "tk_kisebbseg", "tk_klima", "tk_recens", "tk_gyerek", "tk_mokk", "tk_ess", "tk_kdk", "tk_milab", "tk_csalad", "tk_intersections"];

test("5. csomag: Magyar Hang aktív (kind=sajto), a TK ELTE 11 alfeed aktív (kind=intezet), mind A-kaszt feed", () => {
  const byId = Object.fromEntries(selectActiveSources(sources).map((s) => [s.id, s]));
  const mh = byId[MAGHANG];
  assert.ok(mh, "Magyar Hang aktív");
  assert.equal(mh.kind, "sajto", "Magyar Hang kind=sajto");
  assert.ok(mh.feed && /^https:\/\//.test(mh.feed), "Magyar Hang https feed");
  for (const id of TK11) {
    const s = byId[id];
    assert.ok(s, `${id} aktív`);
    assert.equal(s.kind, "intezet", `${id} kind=intezet`);
    assert.equal(s.kaszt, "A", `${id} A-kaszt`);
    assert.ok(s.feed && /^https:\/\//.test(s.feed), `${id} https feed`);
  }
});
