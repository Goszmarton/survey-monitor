import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupStories, deriveInstitutes } from "../../src/lib/storygroup.js";

// PROCEDURAL-HUB TOKEN GUARD (2026-09-03, mérés-vezérelt). A `name_hub_tokens` (személynevek)
// mintájára: a GENERIKUS JOGI-ELJÁRÁSI kifejezések ("hűtlen kezelés", "nyomoz a rendőrség",
// "hivatali visszaélés", "házkutatás", "feljelentés") a containment-élen KÜLÖNBÖZŐ korrupciós/
// nyomozati ügyeket hidalnak egyetlen mega-blobbá. Mért éles korpusz (2026-09-02 ablak): egyetlen
// 26-tagú blob fűzte össze az Eximbank + Paks-2-tőkeemelés + "nyuszimotor" + Orbán Győző–Mészáros
// + Covid-lélegeztetőgép ügyeket, egy "Lázár által elengedett milliárd" reprezentáns ALÁ temetve
// (a fontos, különálló ügyek elrejtve — ARCHITEKTURA 2–3., CLAUDE.md 5). A javított eszköz: curated
// eljárási-token lista a `procedural_hub_tokens` config-kulcsban, amit a storygroup a story-grouping
// stop-halmazba mergel → az ügyek a SAJÁT entitásukon (eximbank/paks/nyuszimotor) csoportosulnak, a
// generikus eljárási hídon NEM. A valódi, UGYANAZON ügyről szóló parafrázisok (közös entitás/dice)
// érintetlenek.

const cfg = JSON.parse(readFileSync(new URL("../../config/dedup.json", import.meta.url), "utf8"));
const { sources } = JSON.parse(readFileSync(new URL("../../config/sources.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);

// A mért lista (a valós blobot hidaló eljárási tokenek, slug-alak, pre-stem illeszt).
const PROC = ["hutlen", "kezeles", "nyomoz", "nyomozas", "nyomoznak", "rendorseg", "hivatali",
              "visszaeles", "hazkutatas", "hazkutatast", "gyanuja", "gyanujaval", "vadjaval",
              "feljelentes", "feljelentest"];

const D = "2026-09-02T09:00:00Z";
const mk = (k, title) => ({ canonical_key: k, source_id: k.split(":")[0], kind: "sajto", title, first_seen_at: D, significance: "FIGYELENDO", freshness: "UJ_24H" });

// Valós címekből desztillált fixture: 3 KÜLÖNBÖZŐ ügy, csak az eljárási kifejezések hidalják;
// + 1 UGYANAZON ügyről szóló parafrázis-pár (Eximbank), aminek EGYBEN kell maradnia.
function fixture() {
  return [
    // Eximbank-pár: NEAR-IDENTICAL parafrázis (magas dice + közös 'eximbank' salient) → a proc-token
    // eltávolítás UTÁN is együtt marad a dice-ágon (nem a generikus eljárási hídtól függ).
    mk("444:ex1", "Nyomoz a rendőrség az Eximbank ügyében hivatali visszaélés és hűtlen kezelés miatt"),
    mk("portfolio:ex2", "Nyomoz a rendőrség az Eximbank ügyében hivatali visszaélés és hűtlen kezelés gyanújával"),
    // KÜLÖNBÖZŐ ügyek: csak a generikus eljárási kifejezések (nyomoz/rendőrség/hűtlen kezelés) hidalják
    // az Eximbank-párhoz — a saját entitásukon (paks / nyuszimotor) NINCS közös salient token.
    mk("telex:paks", "Nyomoz a rendőrség a Paks II. 80 milliárdos tőkeemelése miatt hűtlen kezelés gyanúja"),
    mk("444:motor", "Hűtlen kezelés miatt nyomoz a rendőrség a fideszes nyuszimotoroknál"),
  ];
}

const groups = (items, proc) => {
  const c = { ...cfg, procedural_hub_tokens: proc ?? [] };
  return groupStories(items, { cfg: c, institutes }).representatives.map(
    (r) => new Set([r.canonical_key, ...(r._pressUrls ?? []).map((p) => p.canonical_key)]));
};
const sameGroup = (gs, a, b) => gs.some((g) => g.has(a) && g.has(b));

test("procedural-hub: a curated lista SZÉTVÁGJA az eljárási kifejezésen hidalt KÜLÖNBÖZŐ ügyeket", () => {
  const base = groups(fixture(), []);
  assert.ok(sameGroup(base, "444:ex1", "telex:paks"), "BÁZIS: Eximbank és Paks-2 egy blobban (a hiba, amit javítunk)");
  assert.ok(sameGroup(base, "444:ex1", "444:motor"), "BÁZIS: Eximbank és nyuszimotor egy blobban");

  const gs = groups(fixture(), PROC);
  assert.ok(!sameGroup(gs, "444:ex1", "telex:paks"), "proc-token UTÁN: Eximbank és Paks-2 KÜLÖN ügy");
  assert.ok(!sameGroup(gs, "444:ex1", "444:motor"), "proc-token UTÁN: Eximbank és nyuszimotor KÜLÖN ügy");
  assert.ok(!sameGroup(gs, "telex:paks", "444:motor"), "proc-token UTÁN: Paks-2 és nyuszimotor KÜLÖN ügy");
});

test("procedural-hub: a VALÓDI (ugyanazon ügyről szóló) parafrázis EGYBEN marad (regresszió)", () => {
  const gs = groups(fixture(), PROC);
  assert.ok(sameGroup(gs, "444:ex1", "portfolio:ex2"), "a két Eximbank-tétel egy sztori (közös entitás: eximbank)");
});

test("procedural-hub: a SHIPPELT config AKTÍV (procedural_hub_tokens feltöltve) — a produkciós út olvassa", () => {
  assert.ok(Array.isArray(cfg.procedural_hub_tokens) && cfg.procedural_hub_tokens.length > 0,
    "a shippelt config procedural_hub_tokens-e nem üres (a fix él)");
  const shipped = groupStories(fixture(), { cfg, institutes }).representatives.map(
    (r) => new Set([r.canonical_key, ...(r._pressUrls ?? []).map((p) => p.canonical_key)]));
  assert.ok(!shipped.some((g) => g.has("444:ex1") && g.has("telex:paks")),
    "a shippelt configgal az Eximbank/Paks-2 blob SZÉTVÁGVA — a produkciós út olvassa a kulcsot");
  assert.ok(shipped.some((g) => g.has("444:ex1") && g.has("portfolio:ex2")),
    "a valódi Eximbank-parafrázis a shippelt configgal is egyben (nem túlbontás)");
});
