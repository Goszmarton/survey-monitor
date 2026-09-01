import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDigest, renderKiemelt, renderCombined, combinedSubject, digestSubject, PAGES_BASE } from "../src/report.js";

const RUN = {
  runId: "2026-07-22",
  generatedAt: "2026. 07. 22. 6:00",
  runStartedAt: "2026-07-22T04:00:00.000Z",
  sourceNames: { median: "Medián", ksh: "KSH", telex: "Telex" },
  synthesisText: "Ma új pártpreferencia-kutatás és friss KSH-adat jelent meg.",
  kiemeltCount: 1,
  triageDegraded: false,
  items: [
    { canonical_key: "median:1", source_id: "median", kind: "kutatas", title: "Pártpreferenciák — nagy fordulat", url: "https://median.hu/1", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
    { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "Havi infláció", url: "https://ksh.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    { canonical_key: "telex:9", source_id: "telex", kind: "sajto", title: "Sporthír", url: "https://telex.hu/9", freshness: "UJ_24H", relevant: 0, significance: null },
    { canonical_key: "ksh:old", source_id: "ksh", kind: "hivatalos_adat", title: "Régi adat", url: "https://ksh.hu/o", freshness: "KORABBI", relevant: 1, significance: "FONTOS" },
  ],
};

test("digestSubject: CSAK a 24 órás kép a tárgyban (nincs 14 napos KIEMELT-infó)", () => {
  // UJ_24H + releváns: median:1, ksh:1 → 2 új (24h). A 14 napos „N kiemelt" rész KIKERÜLT
  // (user 2026-09-01: napi jelentés, ne legyen benne az elmúlt 14 napról infó).
  // Rövid gondolatjel (–, U+2013), NEM hosszú (—): magyar tipográfia + user-kérés 2026-08-31.
  assert.equal(digestSubject(RUN), "Survey Monitor – 2 új (24h)");
});

test("digestSubject: a 14 napos (KORABBI) KIEMELT SEM jelenik meg a tárgyban", () => {
  // user 2026-09-01: a napi levél tárgya csak a friss (24h) képet mutatja; a 14 napos ablak
  // KIEMELT-je (KORABBI) sem számít bele — se szám, se „kiemelt (14 nap)" szöveg.
  const run = { ...RUN, items: [
    { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "Friss adat", url: "https://ksh.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    { canonical_key: "telex:k", source_id: "telex", kind: "sajto", title: "Régi kiemelt sztori", url: "https://telex.hu/k", freshness: "KORABBI", relevant: 1, significance: "KIEMELT" },
  ] };
  assert.equal(digestSubject(run), "Survey Monitor – 1 új (24h)");
  assert.ok(!digestSubject(run).includes("kiemelt"), "nincs 'kiemelt' szó a tárgyban");
  assert.ok(!digestSubject(run).includes("14 nap"), "nincs 14 napos infó a tárgyban");
});

test("renderDigest: szintézis felül, majd UJ_24H tételek jelentőség szerint", () => {
  const html = renderDigest(RUN);
  const synthIdx = html.indexOf("pártpreferencia-kutatás és friss KSH");
  const kiemeltIdx = html.indexOf("nagy fordulat");
  assert.ok(synthIdx > 0, "szintézis benne van");
  assert.ok(kiemeltIdx > synthIdx, "a szintézis a tételek előtt");
  // nem-releváns sport és a nem-24h régi adat NINCS a digestben
  assert.ok(!html.includes("Sporthír"));
  assert.ok(!html.includes("Régi adat"));
  // sorrend: KIEMELT a FONTOS előtt
  assert.ok(html.indexOf("nagy fordulat") < html.indexOf("Havi infláció"));
});

test("renderDigest: élesített szekció-címek (narratíva + kapuzott adatjelentőség)", () => {
  const html = renderDigest(RUN);
  // Ugyanaz az élesítés, mint a Pages-riportban — a két felület címei ne térjenek el.
  assert.match(html, /📰 Napi narratíva \(utolsó 24 óra\)/);
  assert.match(html, /📊 Adatjelentőség szerint, kapuzott/);
  assert.ok(!html.includes("Mi jelent meg az utolsó 24 órában?"), "régi szintézis-cím eltűnt");
  assert.ok(!html.includes("Friss tételek jelentőség szerint"), "régi táblák-cím eltűnt");
});

test("kapuzott (digest + combined): két al-csoport — Kutatások és hivatalos adatok / Sajtószemle", () => {
  // A honlappal AZONOS bontás a levélben is: a hivatalos/kutatás/nemzetközi tételek a
  // Kutatások csoportban, a sajtó a Sajtószemlében. Mindkét render-ágon (digest + combined).
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, telex: "Telex" },
    items: [
      { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "Havi infláció", url: "https://ksh.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
      { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "Vezető sajtóhír", url: "https://telex.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    ],
  };
  for (const html of [renderDigest(run), renderCombined(run)]) {
    const kutIdx = html.indexOf("📈 Kutatások és hivatalos adatok");
    const sajtoIdx = html.indexOf("📰 Sajtószemle");
    assert.ok(kutIdx > 0 && sajtoIdx > kutIdx, "két al-cím a kapuzottban, a Kutatások előbb");
    assert.ok(html.indexOf("Havi infláció") > kutIdx && html.indexOf("Havi infláció") < sajtoIdx, "hivatalos tétel a Kutatások csoportban");
    assert.ok(html.indexOf("Vezető sajtóhír") > sajtoIdx, "sajtó tétel a Sajtószemle csoportban");
  }
});

test("Kulcsszámok ma (email): a szám-tartalmú friss címek verbatim, digest + combined", () => {
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, hvg: "HVG" },
    items: [
      { canonical_key: "ksh:w", source_id: "ksh", kind: "hivatalos_adat", title: "A bruttó átlagkereset 754 700 forint volt", url: "https://ksh.hu/w", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
      { canonical_key: "hvg:d", source_id: "hvg", kind: "sajto", title: "3,7-ről 7,5 százalékosra emeli az éves hiánycélt", url: "https://hvg.hu/d", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
    ],
  };
  for (const html of [renderDigest(run), renderCombined(run)]) {
    assert.match(html, /📊 Kulcsszámok ma/, "van Kulcsszámok szekció az emailben");
    const kulcs = html.slice(html.indexOf("📊 Kulcsszámok ma"), html.indexOf("📊 Adatjelentőség"));
    assert.match(kulcs, /754 700 forint/, "verbatim szám-cím");
    assert.match(kulcs, /7,5 százalék/, "verbatim százalék-cím");
  }
});

test("renderKiemelt: csak a KIEMELT tételek", () => {
  const html = renderKiemelt(RUN);
  assert.match(html, /nagy fordulat/);
  assert.ok(!html.includes("Havi infláció"));
});

test("degradált mód: nincs triázs → a 24h tételek relevancia-szűrés nélkül", () => {
  const deg = { ...RUN, triageDegraded: true, synthesisText: null };
  const html = renderDigest(deg);
  assert.match(html, /Sporthír/); // degradáltban minden UJ_24H megjelenik
});

// A digest linkje 2026-08-27-től a FÜGGETLEN tükör (napihir.duckdns.org) GYÖKERÉRE mutat
// (mindig a legfrissebb jelentés), NEM a github.io Pages-re — ld. report.js PAGES_BASE.
// A GYÖKÉR a „Legfrissebb" szemantika: a tükrön a dátumozott archív-URL-ek perzisztensek
// (nem 404-esek), de a link a mindig-friss gyökeret adja. A link SZÖVEGE „Legfrissebb
// jelentés →" — nem ígéri, hogy pont EZT a jelentést nyitja (a tükör ~30 perces sweepje
// miatt a levél megérkezése után rövid ideig a korábbi nap is látszhat a gyökéren).

test("renderDigest: beállított pagesUrl → kattintható GYÖKÉR-link, a fallback eltűnik", () => {
  const withUrl = { ...RUN, pagesUrl: PAGES_BASE };
  const html = renderDigest(withUrl);
  assert.match(html, /<a href="https:\/\/napihir\.duckdns\.org\/"[^>]*>Legfrissebb jelentés →<\/a>/);
  assert.ok(!html.includes("Teljes jelentés →")); // a régi, túlígérő szöveg NINCS
  assert.ok(!html.includes("A teljes jelentés a GitHub Pages-archívumban."));
});

test("renderDigest: a link a gyökérre mutat, NEM napi archívra (ÉÉÉÉ/HH/NN.html)", () => {
  const html = renderDigest({ ...RUN, pagesUrl: PAGES_BASE });
  // a href pontosan a gyökér
  assert.match(html, /href="https:\/\/napihir\.duckdns\.org\/"/);
  // sehol nincs ÉÉÉÉ/HH/NN.html napi archív-URL (az másnap 404 lenne)
  assert.ok(!/\/\d{4}\/\d{2}\/\d{2}\.html/.test(html), "nincs napi archív-URL a digestben");
});

test("renderDigest guard: unset pagesUrl → fallback-szöveg, nem törik (a levél sose bukjon egy linken)", () => {
  const html = renderDigest(RUN); // RUN-on nincs pagesUrl
  assert.ok(html.includes("A teljes jelentés a GitHub Pages-archívumban."));
  assert.ok(!html.includes("Legfrissebb jelentés →"));
  assert.ok(!html.includes("Teljes jelentés →"));
});

// A KIEMELT-levél (renderKiemelt, külön email) UGYANAZT a gyökér-linket kapja, mint a digest.
// A ffed269/5b772a5 csak a renderDigest-et javította; a renderKiemelt-ben egy IKER
// fallback-literál maradt link nélkül (report.js:405), amit a régi teszt nem fogott meg
// (csak renderDigest-re assertáltunk). A levél ígért egy jelentést, de nem adott hozzá utat
// (CLAUDE.md 2). A közös link mindkét levélben ugyanabból a helperből jön.

test("renderKiemelt: beállított pagesUrl → UGYANAZ a kattintható GYÖKÉR-link, a fallback eltűnik", () => {
  const html = renderKiemelt({ ...RUN, pagesUrl: PAGES_BASE });
  assert.match(html, /<a href="https:\/\/napihir\.duckdns\.org\/"[^>]*>Legfrissebb jelentés →<\/a>/);
  assert.ok(!html.includes("A teljes jelentés a GitHub Pages-archívumban."));
});

test("renderKiemelt guard: unset pagesUrl → fallback-szöveg, nem törik (a levél sose bukjon egy linken)", () => {
  const html = renderKiemelt(RUN); // RUN-on nincs pagesUrl
  assert.ok(html.includes("A teljes jelentés a GitHub Pages-archívumban."));
  assert.ok(!html.includes("Legfrissebb jelentés →"));
  assert.ok(!html.includes("Teljes jelentés →"));
});

// ---- EGY összevont levél (2026-08-26 döntés: a digest + KIEMELT egy levélbe) ----
// A user már nem akar KÉT levelet; a KIEMELT szekció a digest TETEJÉRE kerül (ha van
// kiemelt tétel), a digest teljes egészében alatta marad. A tartalom a két korábbi levél
// UNIÓJA, ugyanazokból a helperekből (storyGroups KIEMELT-reprezentánsai + freshRepresentatives
// + digestItemList + pagesLink) — hogy egy jövőbeli render-változásnál ne csússzon szét (CLAUDE.md 2).

test("renderCombined: EGY HTML-dokumentum (nem két <!doctype> egymás után)", () => {
  const html = renderCombined({ ...RUN, pagesUrl: PAGES_BASE });
  assert.equal((html.match(/<!doctype html>/gi) || []).length, 1, "pontosan egy doctype");
  // a felső jelentés-link (helper) egyszer szerepel — nem duplikálva
  assert.equal((html.match(/Teljes napi jelentés a honlapon →/g) || []).length, 1, "egy jelentés-link, felül");
  // a régi, alsó „Legfrissebb jelentés →" link már NINCS a combined levélben (felülre került)
  assert.ok(!html.includes("Legfrissebb jelentés →"), "a régi alsó link kikerült");
});

// 2026-09-01 (user): a napi levélből KIKERÜL a 14 napos KIEMELT visszatekintő szekció (email ÉS
// honlap). A levél sorrendje: felső jelentés-link → narratíva → Kulcsszámok → kapuzott. NINCS
// külön „🔴 KIEMELT tételek" szekció, és nincs „elmúlt 14 nap" szöveg — ez egy napi jelentés.
test("renderCombined: felül a jelentés-link, majd narratíva → Kulcsszámok → kapuzott; NINCS 14 napos KIEMELT szekció", () => {
  const run = {
    ...RUN,
    pagesUrl: PAGES_BASE,
    sourceNames: { ...RUN.sourceNames, hvg: "HVG" },
    items: [
      ...RUN.items,
      { canonical_key: "hvg:n", source_id: "hvg", kind: "sajto", title: "97 000 forintos támogatás jön", url: "https://hvg.hu/n", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    ],
  };
  const html = renderCombined(run);
  const topLinkIdx = html.indexOf("Teljes napi jelentés a honlapon →");
  const narrativaIdx = html.indexOf("📰 Napi narratíva (utolsó 24 óra)");
  const kulcsIdx = html.indexOf("📊 Kulcsszámok ma");
  const kapuzottIdx = html.indexOf("📊 Adatjelentőség szerint, kapuzott");
  assert.ok(topLinkIdx > 0, "van felső jelentés-link");
  assert.ok(topLinkIdx < narrativaIdx, "a jelentés-link a narratíva ELŐTT (email tetején)");
  assert.ok(narrativaIdx < kulcsIdx, "narratíva a Kulcsszámok előtt");
  assert.ok(kulcsIdx > 0 && kulcsIdx < kapuzottIdx, "a Kulcsszámok a kapuzott előtt");
  assert.ok(!html.includes("🔴 KIEMELT tételek"), "NINCS külön 14 napos KIEMELT szekció a levélben");
  assert.ok(!html.includes("elmúlt 14 nap"), "NINCS 14 napos visszatekintés-szöveg a levélben");
  // a friss (24h) tételek a kapuzott listában vannak (a KIEMELT jelentőség jelölése ott maradhat)
  assert.match(html, /nagy fordulat/);
  assert.match(html, /Havi infláció/);
});

// Rövid gondolatjel (–, U+2013) mindenhol; hosszú (—, U+2014) SEHOL — sem a törzsben, sem a
// tárgyban, sem az LLM-narratívában (a záró normalizálás a sablonokat és a szintézist is fedi).
test("renderCombined: nincs hosszú gondolatjel (—) a levélben és a tárgyban, csak rövid (–)", () => {
  const run = { ...RUN, pagesUrl: PAGES_BASE, synthesisText: "Új adat jelent meg — fontos részlettel." };
  const html = renderCombined(run);
  assert.ok(!html.includes("—"), "nincs em-dash a levél HTML-jében (a narratívában sem)");
  assert.ok(!combinedSubject(RUN).includes("—"), "nincs em-dash a tárgyban");
  assert.ok(!digestSubject(RUN).includes("—"), "nincs em-dash a digest-tárgyban");
  assert.ok(digestSubject(RUN).includes("–"), "a rövid gondolatjel (–) a tárgyban megmarad");
});

test("renderCombined: nincs kiemelt → NINCS KIEMELT szekció, de a digest megvan", () => {
  const noKiemelt = {
    ...RUN,
    items: [
      { canonical_key: "ksh:1", source_id: "ksh", title: "Havi infláció", url: "https://ksh.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    ],
  };
  const html = renderCombined(noKiemelt);
  assert.ok(!html.includes("🔴 KIEMELT tételek"), "nincs üres KIEMELT szekció");
  assert.match(html, /📊 Adatjelentőség szerint, kapuzott/);
  assert.match(html, /Havi infláció/);
});

test("combinedSubject: SOHA nincs 🔴 előtag (napi jelentés) — a tárgy = digest-tárgy", () => {
  // user 2026-09-01: a 14 napos KIEMELT-kiemelés kikerült → a 🔴 előtag sincs, akkor sem, ha
  // van KIEMELT tétel. A combined tárgy bájtazonos a digest-tárggyal.
  assert.ok(!combinedSubject(RUN).startsWith("🔴"), "nincs 🔴 előtag akkor sem, ha van KIEMELT");
  assert.match(combinedSubject(RUN), /^Survey Monitor – /);
  assert.equal(combinedSubject(RUN), digestSubject(RUN), "a combined tárgy = digest tárgy");
});

// 2026-09-01 (user): a napi levélből teljesen kikerül a 14 napos KIEMELT visszatekintés. A friss
// (24h) KIEMELT a kapuzott listában attól még megjelenhet, de a KORABBI (14 napos) KIEMELT NEM
// szivároghat be, és nincs se „🔴 KIEMELT tételek" szekció, se „elmúlt 14 nap" szöveg.
test("renderCombined: a 14 napos (KORABBI) KIEMELT NEM jelenik meg a levélben", () => {
  const run = {
    ...RUN,
    sourceNames: { hvg: "HVG", telex: "Telex" },
    items: [
      { canonical_key: "hvg:fk", source_id: "hvg", kind: "sajto", title: "Friss kiemelt", url: "https://hvg.hu/fk", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
      { canonical_key: "telex:rk", source_id: "telex", kind: "sajto", title: "Régi kiemelt", url: "https://telex.hu/rk", freshness: "KORABBI", relevant: 1, significance: "KIEMELT" },
    ],
  };
  const html = renderCombined(run);
  assert.ok(!html.includes("🔴 KIEMELT tételek"), "nincs 14 napos KIEMELT szekció");
  assert.ok(!html.includes("elmúlt 14 nap"), "nincs 14 napos visszatekintés-szöveg");
  assert.ok(!html.includes("Régi kiemelt"), "a KORABBI (14 napos) KIEMELT nem szivárog be a napi levélbe");
});

test("renderCombined: a Pages-link a helperből jön (gyökér, nem napi archív)", () => {
  const html = renderCombined({ ...RUN, pagesUrl: PAGES_BASE });
  assert.match(html, /href="https:\/\/napihir\.duckdns\.org\/"/);
  assert.ok(!/\/\d{4}\/\d{2}\/\d{2}\.html/.test(html), "nincs napi archív-URL");
});
