import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyTitleFilter, matchesTitleFilter, selectActiveSources } from "../src/collect.js";
import { parseFeed } from "../src/lib/feedparse.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const fx = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

// A pew title_filter (forrás-szintű, NEM a triage.json globális kulcsszavai közt).
const PEW_KW = ["hungary", "hungarian", "magyar", "orbán", "orban", "budapest", "central europe", "visegrad", "eastern europe"];

// ILLESZTÉSI SZERZŐDÉS: RÉSZSZÓ (includes), kisbetűsítve, a cím ÉS a leírás (summary) egyesített
// szövegén. Ez a döntés: a "magyar" részszóként ILLESZKEDIK a "Magyarország"/"magyarok"-ra
// (szó-határnál ezek KIMARADNÁNAK); a "hungary" részszóként lefedi a "hungarian"-t (redundáns,
// de bent hagyva). A leírás is számít, hogy a cím nélküli releváns tétel se essen ki.
test("cím-szűrő: RÉSZSZÓ-illesztés — 'magyar'→'Magyarország'/'magyarok', 'hungary'→'hungarian', leírásban is", () => {
  assert.ok(matchesTitleFilter({ title: "Új felmérés Magyarországon", summary: null }, PEW_KW), "'Magyarország' tartalmazza a 'magyar' részszót");
  assert.ok(matchesTitleFilter({ title: "A magyarok többsége szerint", summary: null }, PEW_KW), "'magyarok' tartalmazza a 'magyar'-t");
  assert.ok(matchesTitleFilter({ title: "Views of Hungary in 2026", summary: null }, PEW_KW), "'Hungary' átmegy");
  assert.ok(matchesTitleFilter({ title: "Hungarian politics today", summary: null }, PEW_KW), "'Hungarian' átmegy (a 'hungary' részszóként lefedi)");
  assert.ok(matchesTitleFilter({ title: "Regional attitudes", summary: "A focus on Central Europe and the Visegrad group" }, PEW_KW), "a LEÍRÁS (summary) is illeszthető");
  // tipikus amerikai cím NEM megy át
  assert.ok(!matchesTitleFilter({ title: "Americans' views of the economy", summary: "A national U.S. survey of adults" }, PEW_KW), "tiszta amerikai cím kimarad");
});

// A mai mentett pew-feed a szerződés: a 100 tételből HÁNY megy át. Ma 0 (a Pew ritkán ír
// KIFEJEZETTEN Magyarországról / Közép-Európáról) — ez VÁRT viselkedés, nem hiba.
test("cím-szűrő: a pew fixture 100 tételéből 0 megy át (mai szerződés, VÁRT)", () => {
  const { items } = parseFeed(fx("pew_feed.xml"), "application/rss+xml; charset=UTF-8");
  assert.equal(items.length, 100, "a mentett feed 100 tétele");
  assert.equal(applyTitleFilter(items, PEW_KW).length, 0, "0 tétel ma (a szűrő szűk, ez a cél)");
});

// Egy SZÁNDÉKOSAN beszúrt magyar-releváns tétel átmegy a valós korpuszon (a szűrő ÉL, nem vak).
test("cím-szűrő: beszúrt 'Hungary' ÉS 'magyar' cím átmegy a 100 amerikai tétel közül", () => {
  const { items } = parseFeed(fx("pew_feed.xml"), "application/rss+xml; charset=UTF-8");
  const spiked = [
    ...items,
    { title: "Views of Hungary and Orbán in Central Europe", summary: null, url: "x", publishedAt: "2026-08-08T00:00:00Z" },
    { title: "A magyarok bizalma az intézményekben", summary: null, url: "y", publishedAt: "2026-08-08T00:00:00Z" },
  ];
  const passed = applyTitleFilter(spiked, PEW_KW);
  assert.equal(passed.length, 2, "a 2 beszúrt magyar-releváns tétel megy át, a 100 amerikai nem");
  assert.ok(passed.some((i) => /Hungary/.test(i.title)) && passed.some((i) => /magyarok/.test(i.title)));
});

// A mező OPCIONÁLIS és ÁLTALÁNOS: üres/hiányzó lista → nincs szűrés (más forrás érintetlen).
test("cím-szűrő: üres/hiányzó lista → nincs szűrés (a mechanizmus általános, opcionális)", () => {
  const items = [{ title: "x", summary: null }, { title: "y", summary: null }];
  assert.equal(applyTitleFilter(items, []).length, 2, "üres lista → érintetlen");
  assert.equal(applyTitleFilter(items, undefined).length, 2, "hiányzó lista → érintetlen");
});

test("cím-szűrő: a pew regiszter-bejegyzés aktív (kaszt A + feed) és van title_filter-e 'magyar'-ral", () => {
  const s = selectActiveSources(sources).find((x) => x.id === "pew");
  assert.ok(s, "pew aktív forrás (kaszt B→A + feed)");
  assert.equal(s.feed, "https://www.pewresearch.org/feed/");
  assert.ok(Array.isArray(s.title_filter) && s.title_filter.includes("magyar"), "van title_filter, benne 'magyar'");
});
