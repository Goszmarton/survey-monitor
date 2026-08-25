import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseLine } from "../../src/lib/phaselog.js";

// TANULSÁG (08-24 néma-beragadás + 08-25 lokalizálhatatlan 22 perc): a run.js NÉMA volt
// a collect-kezdet és a "Jelentés kész" közt, 0 fázis-időbélyeggel → nem volt
// visszakereshető, melyik fázis vitte az időt. A phaseLine egy egységes, parse-olható
// egy soros fázis-jelet ad, hogy a következő lassú futás lokalizálható legyen.

test("phaseLine: ezredmásodpercet másodpercre formáz, 1 tizedessel", () => {
  assert.equal(phaseLine("collect", 12340), '⏱ fázis "collect": 12.3s');
});

test("phaseLine: 0 ms → 0.0s (nem üres, nem NaN)", () => {
  assert.equal(phaseLine("triázs", 0), '⏱ fázis "triázs": 0.0s');
});

test("phaseLine: negatív elapsed (óra-visszaugrás) → 0.0s padlóra vág, nem negatív", () => {
  assert.equal(phaseLine("render", -500), '⏱ fázis "render": 0.0s');
});

test("phaseLine: nagy érték (a 08-25-i 22 perc) helyesen formázódik", () => {
  assert.equal(phaseLine("triázs+szintézis", 1340000), '⏱ fázis "triázs+szintézis": 1340.0s');
});

test("phaseLine: a kimenet gépi-parse-olható (label + másodperc kinyerhető)", () => {
  const m = phaseLine("email", 2100).match(/^⏱ fázis "(.+)": ([\d.]+)s$/);
  assert.ok(m, "a sor illeszkedik a stabil mintára");
  assert.equal(m[1], "email");
  assert.equal(Number(m[2]), 2.1);
});
