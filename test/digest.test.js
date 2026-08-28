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

test("digestSubject: 24 órás kép a tárgyban", () => {
  // UJ_24H + releváns tételek: median:1, ksh:1 → 2 új; ebből 1 KIEMELT
  assert.equal(digestSubject(RUN), "Survey Monitor — 2 új (24h), ebből 1 kiemelt");
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
  assert.match(html, /<a href="https:\/\/napihir\.duckdns\.org\/">Legfrissebb jelentés →<\/a>/);
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
  assert.match(html, /<a href="https:\/\/napihir\.duckdns\.org\/">Legfrissebb jelentés →<\/a>/);
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
  // a Pages-link (helper) is egyszer szerepel — nem duplikálva a két ágból
  assert.equal((html.match(/Legfrissebb jelentés →/g) || []).length, 1, "egy jelentés-link");
});

test("renderCombined: KIEMELT szekció FELÜL, alatta a teljes digest (narratíva + kapuzott)", () => {
  const html = renderCombined(RUN);
  const kiemeltSectionIdx = html.indexOf("🔴 KIEMELT tételek");
  const narrativaIdx = html.indexOf("📰 Napi narratíva (utolsó 24 óra)");
  const kapuzottIdx = html.indexOf("📊 Adatjelentőség szerint, kapuzott");
  assert.ok(kiemeltSectionIdx > 0, "van KIEMELT szekció");
  assert.ok(kiemeltSectionIdx < narrativaIdx, "a KIEMELT szekció a narratíva ELŐTT (felül)");
  assert.ok(narrativaIdx < kapuzottIdx, "a digest szekciók a megszokott sorrendben");
  // a KIEMELT tétel a szekcióban; a nem-KIEMELT (Havi infláció) csak a digest-listában
  assert.match(html, /nagy fordulat/);
  assert.match(html, /Havi infláció/);
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

test("combinedSubject: 🔴 előtag CSAK ha van KIEMELT szekció", () => {
  assert.match(combinedSubject(RUN), /^🔴 Survey Monitor — /); // RUN-ban van KIEMELT
  const noKiemelt = { ...RUN, items: [{ canonical_key: "ksh:1", source_id: "ksh", title: "Havi infláció", url: "https://ksh.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" }] };
  assert.ok(!combinedSubject(noKiemelt).startsWith("🔴"), "kiemelt nélkül nincs előtag");
  assert.match(combinedSubject(noKiemelt), /^Survey Monitor — /);
});

test("renderCombined: a Pages-link a helperből jön (gyökér, nem napi archív)", () => {
  const html = renderCombined({ ...RUN, pagesUrl: PAGES_BASE });
  assert.match(html, /href="https:\/\/napihir\.duckdns\.org\/"/);
  assert.ok(!/\/\d{4}\/\d{2}\/\d{2}\.html/.test(html), "nincs napi archív-URL");
});
