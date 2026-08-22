import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDigest, renderKiemelt, digestSubject, PAGES_BASE } from "../src/report.js";

const RUN = {
  runId: "2026-07-22",
  generatedAt: "2026. 07. 22. 6:00",
  runStartedAt: "2026-07-22T04:00:00.000Z",
  sourceNames: { median: "Medián", ksh: "KSH", telex: "Telex" },
  synthesisText: "Ma új pártpreferencia-kutatás és friss KSH-adat jelent meg.",
  kiemeltCount: 1,
  triageDegraded: false,
  items: [
    { canonical_key: "median:1", source_id: "median", title: "Pártpreferenciák — nagy fordulat", url: "https://median.hu/1", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
    { canonical_key: "ksh:1", source_id: "ksh", title: "Havi infláció", url: "https://ksh.hu/1", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    { canonical_key: "telex:9", source_id: "telex", title: "Sporthír", url: "https://telex.hu/9", freshness: "UJ_24H", relevant: 0, significance: null },
    { canonical_key: "ksh:old", source_id: "ksh", title: "Régi adat", url: "https://ksh.hu/o", freshness: "KORABBI", relevant: 1, significance: "FONTOS" },
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

// A digest linkje a Pages-site GYÖKERÉRE mutat (mindig a legfrissebb jelentés).
// Empíria (2026-08-12, élő curl): a deploy-pages NEM additív — a dist/ minden futáskor
// TELJES site-ként publikálódik, csak {index.html, a mai archív}-val, ezért a tegnapi
// ÉÉÉÉ/HH/NN.html archív MÁSNAP 404. Ezért mutat a link a gyökérre, nem a napi archívra.
// A link SZÖVEGE ezért „Legfrissebb jelentés →" — nem ígéri, hogy pont EZT a jelentést nyitja.

test("renderDigest: beállított pagesUrl → kattintható GYÖKÉR-link, a fallback eltűnik", () => {
  const withUrl = { ...RUN, pagesUrl: PAGES_BASE };
  const html = renderDigest(withUrl);
  assert.match(html, /<a href="https:\/\/goszmarton\.github\.io\/survey-monitor\/">Legfrissebb jelentés →<\/a>/);
  assert.ok(!html.includes("Teljes jelentés →")); // a régi, túlígérő szöveg NINCS
  assert.ok(!html.includes("A teljes jelentés a GitHub Pages-archívumban."));
});

test("renderDigest: a link a gyökérre mutat, NEM napi archívra (ÉÉÉÉ/HH/NN.html)", () => {
  const html = renderDigest({ ...RUN, pagesUrl: PAGES_BASE });
  // a href pontosan a gyökér
  assert.match(html, /href="https:\/\/goszmarton\.github\.io\/survey-monitor\/"/);
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
  assert.match(html, /<a href="https:\/\/goszmarton\.github\.io\/survey-monitor\/">Legfrissebb jelentés →<\/a>/);
  assert.ok(!html.includes("A teljes jelentés a GitHub Pages-archívumban."));
});

test("renderKiemelt guard: unset pagesUrl → fallback-szöveg, nem törik (a levél sose bukjon egy linken)", () => {
  const html = renderKiemelt(RUN); // RUN-on nincs pagesUrl
  assert.ok(html.includes("A teljes jelentés a GitHub Pages-archívumban."));
  assert.ok(!html.includes("Legfrissebb jelentés →"));
  assert.ok(!html.includes("Teljes jelentés →"));
});
