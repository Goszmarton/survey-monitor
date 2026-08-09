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
// (szó-határnál ezek KIMARADNÁNAK). FONTOS (empirikusan igazolva): a "hungary" NEM fedi le a
// "hungarian"/"Hungarians"-t ("hungarian".includes("hungary")===false, a 7. betű i≠y) — ezért a
// "hungarian" NEM redundáns, mindkettő kell. A leírás is számít, hogy a cím nélküli releváns
// tétel se essen ki.
test("cím-szűrő: RÉSZSZÓ-illesztés — 'magyar'→'Magyarország'/'magyarok', 'hungarian'→'Hungarian', leírásban is", () => {
  assert.ok(matchesTitleFilter({ title: "Új felmérés Magyarországon", summary: null }, PEW_KW), "'Magyarország' tartalmazza a 'magyar' részszót");
  assert.ok(matchesTitleFilter({ title: "A magyarok többsége szerint", summary: null }, PEW_KW), "'magyarok' tartalmazza a 'magyar'-t");
  assert.ok(matchesTitleFilter({ title: "Views of Hungary in 2026", summary: null }, PEW_KW), "'Hungary' átmegy (a 'hungary' kulcsszó)");
  assert.ok(matchesTitleFilter({ title: "Hungarian politics today", summary: null }, PEW_KW), "'Hungarian' átmegy (a 'hungarian' kulcsszó — a 'hungary' NEM fedné le)");
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

// POZITÍV IGAZOLÁS VALÓS ADATON — a 0/100 önmagában NEM különbözteti meg a „szűk szűrő"-t a
// „vak szűrő"-től. Ezért egy fixture VALÓDI archív Pew Hungary-tétellel (WP REST API-val
// verifikálva, valós linkkel): a szűrőnek ÁT KELL engednie ezeket, a valós amerikai tételeket
// nem. Fontos melléklelet: a „Hungarians" cím CSAK a `hungarian` kulcsszóval illeszkedik — a
// `hungary` NEM fedi le ("hungarians".includes("hungary")===false, mert -ians ≠ -y) → a
// `hungarian` NEM redundáns, load-bearing a többes számra.
test("cím-szűrő: VALÓDI archív Pew Hungary-tételek átmennek, a valós amerikaiak nem (pozitív igazolás)", () => {
  const { items } = parseFeed(fx("pew_hungary_archive.xml"), "application/rss+xml; charset=UTF-8");
  assert.equal(items.length, 4, "2 valós Hungary + 2 valós amerikai tétel");
  const passed = applyTitleFilter(items, PEW_KW);
  assert.equal(passed.length, 2, "csak a 2 valós Hungary-tétel megy át");
  assert.ok(passed.some((i) => /Poles and Hungarians/.test(i.title)), "'Poles and Hungarians…' átmegy");
  assert.ok(passed.some((i) => /refugees in Poland and Hungary/.test(i.title)), "'…refugees in Poland and Hungary' átmegy");
  assert.ok(!passed.some((i) => /election fairness|Scripps/.test(i.title)), "a valós amerikai tételek NEM mennek át");
  // a `hungarian` load-bearing: a többes számú „Hungarians"-t CSAK ez fogja, a `hungary` nem
  const t = { title: "Poles and Hungarians Differ Over Views of Russia and the U.S.", summary: null };
  assert.ok(matchesTitleFilter(t, ["hungarian"]), "'hungarian' fogja a 'Hungarians'-t");
  assert.ok(!matchesTitleFilter(t, ["hungary"]), "'hungary' NEM fogja a 'Hungarians'-t (a 'hungarian' nem redundáns)");
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
