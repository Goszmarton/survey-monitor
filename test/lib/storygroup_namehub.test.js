import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupStories, deriveInstitutes } from "../../src/lib/storygroup.js";

// ② HUB-TOKEN DOWN-WEIGHT (személynév-hub guard). A 2026-08-19-i előmérés eredménye:
// a SZEMÉLYNÉV-hubok (Vitézy, Mészáros, keresztnevek) a containment-élen KÜLÖNBÖZŐ sztorikat
// hidalnak egyetlen mega-blobbá (mért éles korpusz: 28-Vitézy, 13-Mészáros). A javított eszköz:
// curated névlista a `name_hub_tokens` config-kulcsban, amit a storygroup a story-grouping
// stop-halmazba mergel → a nevek MENTÉN vágja szét a hamis blobot, a valódi parafrázisokat
// (közös témaszó / magas dice) érintetlenül hagyva. A 'magyar' POLISzém (Hungarian ÉS Magyar
// Péter) → SZÁNDÉKOSAN kimarad a listából; kivétele valódi parafrázist törne (lásd lent).

const cfg = JSON.parse(readFileSync(new URL("../../config/dedup.json", import.meta.url), "utf8"));
const { sources } = JSON.parse(readFileSync(new URL("../../config/sources.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);

// A mért (a2) lista — a shippelt config `name_hub_tokens`-e ÜRES (levél-semleges); a teszt
// EXPLICITEN adja meg, hogy a MECHANIZMUST igazolja (a feltöltés a holnapi levél-ható flip).
const A2 = ["peter", "viktor", "david", "lorinc", "janos", "gabor", "andras", "zoltan", "donald",
            "vitezy", "meszaros", "orban", "szijjarto", "tarr", "kubatov", "baka", "lazar"]; // 'magyar' KIMARAD

const D = "2026-08-18T09:00:00Z";
const mk = (k, title) => ({ canonical_key: k, source_id: k.split(":")[0], kind: "sajto", title, first_seen_at: D, significance: "FIGYELENDO", freshness: "UJ_24H" });

// Verifikált fixture (tmp_verify_fixture, 2026-08-19): a gyenge stemmer-viselkedést figyelembe véve.
function fixture() {
  return [
    // Vitézy-trió — 3 KÜLÖNBÖZŐ sztori, csak a {vitezy,david} névpár hidalja (rövid címek → contain>=0.5)
    mk("telex:v1", "Vitézy Dávid a metróbővítésről"),
    mk("444:v2", "Vitézy Dávid a kerékpárutakról"),
    mk("hvg:v3", "Vitézy Dávid a vasútfejlesztésről"),
    // Mészáros-pár — 2 KÜLÖNBÖZŐ sztori, a {meszaros,lorinc} névpár hidalja
    mk("telex:m1", "Mészáros Lőrinc tőzsdei leminősítése"),
    mk("index:m2", "Mészáros Lőrinc előlegvisszafizetése"),
    // Magyar-Péter NEAR-IDENTICAL parafrázis — UGYANAZ a sztori, magas dice + közös témaszó (költségvetés):
    // ROBUSZTUSAN túléli a név-eltávolítást (nem a névtől függ).
    mk("telex:p1", "Magyar Péter bemutatta az új költségvetést"),
    mk("444:p2", "Magyar Péter az új költségvetést bemutatta"),
    // Magyar-Péter POLISZÉMIA-PRÓBA parafrázis — UGYANAZ a sztori (helikopter), de a stemmer nem
    // egyesíti a 'helikopterrel'/'helikopteren'-t → a 'magyar' az EGYETLEN közös salient token,
    // ami a dice-él ≥1-guardját adja. magyar MEGTARTVA → túlél; magyar KIVÉVE → szétesik.
    mk("telex:q1", "Magyar Péter helikopterrel járt"),
    mk("index:q2", "Magyar Péter helikopteren utazott"),
  ];
}

const groups = (items, extraHub) => {
  const c = { ...cfg, name_hub_tokens: extraHub ?? [] };
  return groupStories(items, { cfg: c, institutes }).representatives.map(
    (r) => new Set([r.canonical_key, ...(r._pressUrls ?? []).map((p) => p.canonical_key)]),
  );
};
const sameGroup = (gs, a, b) => gs.some((g) => g.has(a) && g.has(b));

// --- RED a storygroup egysoros változása ELŐTT: name_hub_tokens figyelmen kívül → a Vitézy-trió merge marad. ---
test("name-hub: a curated névlista SZÉTVÁGJA a Vitézy-trió és Mészáros-pár hamis merge-ét (②)", () => {
  const base = groups(fixture(), []);
  assert.ok(sameGroup(base, "telex:v1", "444:v2"), "BÁZIS: a Vitézy-hubok egy blobban (a hiba, amit javítunk)");
  assert.ok(sameGroup(base, "telex:m1", "index:m2"), "BÁZIS: a Mészáros-hubok egy blobban");

  const gs = groups(fixture(), A2);
  assert.ok(!sameGroup(gs, "telex:v1", "444:v2"), "name_hub UTÁN: Vitézy v1–v2 szétvágva");
  assert.ok(!sameGroup(gs, "telex:v1", "hvg:v3"), "name_hub UTÁN: Vitézy v1–v3 szétvágva");
  assert.ok(!sameGroup(gs, "telex:m1", "index:m2"), "name_hub UTÁN: Mészáros szétvágva");
});

test("name-hub: a VALÓDI parafrázisok EGYBEN maradnak (regresszió — nem szedi szét a sztorit) (②)", () => {
  const gs = groups(fixture(), A2);
  assert.ok(sameGroup(gs, "telex:p1", "444:p2"), "near-identical Magyar-Péter parafrázis egyben (közös témaszó/dice)");
  assert.ok(sameGroup(gs, "telex:q1", "index:q2"), "a 'magyar'-guardolt Magyar-Péter parafrázis is egyben (magyar MEGTARTVA)");
});

test("name-hub: POLISZÉMIA-LOCK — a 'magyar' KIVÉTELE valódi parafrázist törne (ezért marad ki) (②)", () => {
  const withMagyar = groups(fixture(), [...A2, "magyar"]);
  // a near-identical pár közös témaszaván (költségvetés) így is túlél…
  assert.ok(sameGroup(withMagyar, "telex:p1", "444:p2"), "a témaszó-hordozó parafrázis túléli");
  // …DE a csak-névvel hidalt parafrázis szétesik → ez a bizonyíték, hogy 'magyar' nem mehet a listába
  assert.ok(!sameGroup(withMagyar, "telex:q1", "index:q2"), "a 'magyar'-t elvéve a valódi helikopter-parafrázis eltörik (poliszémia-kár)");
});

test("name-hub: a SHIPPELT config (üres name_hub_tokens) LEVÉL-SEMLEGES — a csoportosítás változatlan (②)", () => {
  // A repo config name_hub_tokens-e üres → a mechanizmus KI; a Vitézy-blob (a mai állapot) marad.
  assert.deepEqual(cfg.name_hub_tokens, [], "a shippelt lista üres (a feltöltés a holnapi flip)");
  const shipped = groupStories(fixture(), { cfg, institutes }).representatives.map(
    (r) => new Set([r.canonical_key, ...(r._pressUrls ?? []).map((p) => p.canonical_key)]));
  assert.ok(shipped.some((g) => g.has("telex:v1") && g.has("444:v2")), "üres listával a Vitézy-blob merge marad (semmi nem változik ma)");
});
