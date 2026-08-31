import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));

// 2026-08-31 forrás-bővítés, 1. CSOMAG (user: „először az egyes, utána sorban mindet"):
// Tárki + TK ELTE Szociológia + TK ELTE Politikatudomány. Mind A-kaszt RSS/WordPress feed
// (a generikus rss.js út kezeli, 0 új parser), kind=intezet (→ item kind=kutatas). Hazai kutatók.
// PIROS a config-bővítés ELŐTT (a három id nincs a sources.json-ban), ZÖLD utána.
test("1. csomag: Tárki + TK ELTE (szoc.+politikatud.) aktív, feed-alapú, kind=intezet, A-kaszt", () => {
  const active = selectActiveSources(sources);
  const byId = Object.fromEntries(active.map((s) => [s.id, s]));
  for (const id of ["tarki", "tk_szoc", "tk_pol"]) {
    const s = byId[id];
    assert.ok(s, `${id} a kiválasztott aktív források közt`);
    assert.equal(s.kind, "intezet", `${id} kind=intezet`);
    assert.equal(s.kaszt, "A", `${id} A-kaszt (generikus feed-út)`);
    assert.ok(s.feed && /^https:\/\//.test(s.feed), `${id} verifikált https feed-URL`);
  }
});

// A Hazai/Nemzetközi bontásban (report.js) mindhárom HAZAI (kind=intezet, nem nemzetkozi, nincs
// a NEMZ_EXTRA_IDS-ben) — ne szivárogjanak a Nemzetközi altáblába.
test("1. csomag: mindhárom HAZAI besorolású (kind=intezet, nem nemzetközi)", () => {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  for (const id of ["tarki", "tk_szoc", "tk_pol"]) {
    assert.equal(byId[id].kind, "intezet");
    assert.notEqual(byId[id].kind, "nemzetkozi");
  }
});
