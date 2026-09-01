import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, renderInfoPage } from "../src/report.js";

const RUN = {
  runId: "2026-07-22",
  generatedAt: "2026. 07. 22. 6:00",
  phase: "F1 — A-kaszt mag",
  runStartedAt: "2026-07-22T04:00:00.000Z",
  sinceIso: "2026-07-21T04:00:00.000Z",
  sourceNames: { ksh: "KSH", telex: "Telex", szabadeu: "Szabad Európa", eurostat: "Eurostat" },
  items: [
    { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "KSH közlés & <b>", url: "https://ksh.hu/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H" },
    { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "Telex cikk", url: "https://telex.hu/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H" },
  ],
  sourceChecks: [
    { source_id: "ksh", status: "OK_UJ", detail: "feed: 3 friss — 3 új a DB-be", checked_at: "2026-07-22T04:00:00.000Z" },
    { source_id: "szabadeu", status: "RESZLEGES", detail: "feed: üres feed — 0 tétel", checked_at: "2026-07-22T04:00:01.000Z" },
  ],
  newCount: 2,
  notCovered: ["LLM-triázs és jelentőségi besorolás (F2)"],
  providersUsed: { note: "F1 — LLM-hívás még nincs" },
  durationMs: 1234,
};

test("renderReport: valid HTML, cím — NINCS fázis-badge (eltávolítva a nézetből)", () => {
  const html = renderReport(RUN);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Magyar közéleti kutatás- és adatmonitor/);
  assert.ok(!/class="phase"/.test(html), "a fázis-badge eltűnt a fejlécből");
  assert.ok(!html.includes("F1 — A-kaszt mag"), "a phase szöveg nincs a fejlécben");
});

test("renderReport: UTOLSÓ ÚJ KUTATÁS a legfrissebb kutatás-tételből (bekötve, nem statikus)", () => {
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, median: "Medián" },
    items: [
      { canonical_key: "median:1", source_id: "median", kind: "kutatas", title: "Medián pártpreferencia-kutatás", url: "https://median.hu/1", published_at: "2026-07-22T02:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H" },
      ...RUN.items,
    ],
  };
  const html = renderReport(run);
  assert.match(html, /UTOLSÓ ÚJ KUTATÁS[\s\S]*Medián pártpreferencia-kutatás/, "a legfrissebb kutatás címe a fejlécben");
  assert.ok(!html.includes("intézeti kutatásfigyelés az F3-tól"), "a régi statikus placeholder eltűnt");
});

test("renderReport: az eltávolított nézet-szekciók nincsenek (kapu / napló / nem-lefedett)", () => {
  const html = renderReport(RUN);
  assert.ok(!/Kapu lehúzta/i.test(html), "nincs 'Kapu lehúzta' szekció");
  assert.ok(!html.includes("Ellenőrzési napló"), "nincs 'Ellenőrzési napló' cím");
  assert.ok(!html.includes("Még nem lefedett"), "nincs 'Még nem lefedett' szekció");
  assert.ok(!html.includes("Mi változott az előző jelentéshez képest"), "nincs 'Mi változott' szekció");
  assert.match(html, /Forrás-ellenőrzés/, "a forrás-táblázat megmaradt (új cím alatt)");
});

test("renderReport: élesített szekció-címek (narratíva + kapuzott adatjelentőség)", () => {
  const html = renderReport(RUN);
  // A cél: a cím jelezze, mi a szekció TERMÉSZETE — szerkesztői narratíva vs kapuzott
  // adatjelentőség — ne generikus „mi jelent meg" / „tételek jelentőség szerint".
  assert.match(html, /📰 Napi narratíva \(utolsó 24 óra\)/);
  assert.match(html, /📊 Adatjelentőség szerint, kapuzott/);
  // A régi generikus címek eltűntek (nincs néma kettősség: kód és szándék nem térhet el).
  assert.ok(!html.includes("Mi jelent meg az utolsó 24 órában?"), "régi szintézis-cím eltűnt");
  assert.ok(!html.includes("<h2>Tételek jelentőség szerint</h2>"), "régi táblák-cím eltűnt");
});

test("tételek megjelennek, HTML-escape helyes", () => {
  const html = renderReport(RUN);
  assert.match(html, /KSH közlés &amp; &lt;b&gt;/);
  assert.match(html, /href="https:\/\/ksh\.hu\/1"/);
  assert.match(html, /Telex cikk/);
});

test("kapuzott: két tábla — 📈 Kutatások és hivatalos adatok + 📰 Sajtószemle", () => {
  const html = renderReport(RUN);
  // csak a kapuzott (tablak) szekcióra szűkítünk — a fejléc is tartalmaz „KSH közlés"-t
  const tablak = html.slice(html.indexOf('id="tablak"'), html.indexOf('id="forrasok"'));
  const kutIdx = tablak.indexOf("📈 Kutatások és hivatalos adatok");
  const sajtoIdx = tablak.indexOf("📰 Sajtószemle");
  assert.ok(kutIdx >= 0 && sajtoIdx > kutIdx, "a két kapuzott tábla, a Kutatások előbb");
  // KSH (hivatalos_adat) a Kutatások táblában, Telex (sajto) a Sajtószemlében
  assert.ok(tablak.indexOf("KSH közlés") > kutIdx && tablak.indexOf("KSH közlés") < sajtoIdx, "hivatalos tétel a Kutatások táblában");
  assert.ok(tablak.indexOf("Telex cikk") > sajtoIdx, "sajtó tétel a Sajtószemlében");
});

test("kapuzott: kutatás/nemzetközi friss tétel is a 'Kutatások és hivatalos adatok' táblában (nem esik ki némán)", () => {
  // A korábbi bontás (hivatalos_adat + sajto) NÉMÁN eldobta a kutatas/nemzetkozi tételeket
  // (CLAUDE.md 2). Az összevont Kutatások-tábla mindent felvesz, ami nem sajtó.
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, median: "Medián", pew: "Pew" },
    items: [
      { canonical_key: "median:1", source_id: "median", kind: "kutatas", title: "Medián pártpreferencia-kutatás", url: "https://median.hu/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
      { canonical_key: "pew:1", source_id: "pew", kind: "nemzetkozi", title: "Pew globális felmérés", url: "https://pew.org/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "FIGYELENDO" },
    ],
  };
  const html = renderReport(run);
  assert.match(html, /📈 Kutatások és hivatalos adatok/, "az összevont adatközlő-cím");
  assert.match(html, /Medián pártpreferencia-kutatás/, "a kutatás-tétel megjelenik (nem esik ki)");
  assert.match(html, /Pew globális felmérés/, "a nemzetközi tétel is megjelenik");
});

test("Forrás-ellenőrzés: két csoport (Kutatások és hivatalos adatok / Sajtószemle), jó csoportban, ABC sorrendben", () => {
  const run = {
    ...RUN,
    items: [], // csak a forrás-szekció source-neveit vizsgáljuk (ne szennyezze a kapuzott tábla)
    sourceNames: { ksh: "KSH", median: "Medián", telex: "Telex", "444": "444", hvg: "HVG" },
    sourceKinds: { ksh: "hivatalos", median: "intezet", telex: "sajto", "444": "sajto", hvg: "sajto" },
    sourceChecks: [
      { source_id: "telex", status: "OK_UJ", detail: "feed: friss", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "ksh", status: "OK_NINCS_UJ", detail: "nincs új", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "hvg", status: "OK_UJ", detail: "feed: friss", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "median", status: "OK_NINCS_UJ", detail: "nincs új", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "444", status: "OK_UJ", detail: "feed: friss", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const forras = renderReport(run).slice(renderReport(run).indexOf("Forrás-ellenőrzés"));
  const kutIdx = forras.indexOf("📈 Kutatások és hivatalos adatok");
  const sajtoIdx = forras.indexOf("📰 Sajtószemle");
  assert.ok(kutIdx > 0 && sajtoIdx > kutIdx, "két csoport-cím a forrás-szekcióban, Kutatások előbb");
  // KSH és Medián (nem sajtó) a Kutatások csoportban (a sajtó-cím előtt)
  assert.ok(forras.indexOf(">KSH<") > kutIdx && forras.indexOf(">KSH<") < sajtoIdx, "KSH a Kutatások csoportban");
  assert.ok(forras.indexOf(">Medián<") > kutIdx && forras.indexOf(">Medián<") < sajtoIdx, "Medián (intézet) a Kutatások csoportban");
  // sajtó források ABC: 444 < HVG < Telex, mind a sajtó-cím után
  const s444 = forras.indexOf(">444<"), hvg = forras.indexOf(">HVG<"), telex = forras.indexOf(">Telex<");
  assert.ok(s444 > sajtoIdx, "444 a Sajtószemle csoportban");
  assert.ok(s444 < hvg && hvg < telex, "sajtó források ABC-ben (444 < HVG < Telex)");
});

test("kapuzott tábla: CSAK az elmúlt 24 óra (UJ_24H) tételei — a KORÁBBI kimarad", () => {
  const run = {
    ...RUN,
    items: [
      ...RUN.items, // ksh + telex mindkettő UJ_24H → a táblában
      { canonical_key: "telex:old", source_id: "telex", kind: "sajto", title: "Korábbi sajtóhír (nem 24h)", url: "https://telex.hu/old", published_at: "2026-07-10T03:00:00.000Z", first_seen_at: "2026-07-11T04:00:00.000Z", freshness: "KORABBI", significance: "KIEMELT", relevant: 1 },
    ],
  };
  const html = renderReport(run);
  // A kapuzott tábla a tablak-szekció; utána közvetlenül a Forrás-ellenőrzés (id="forrasok") jön
  // (2026-09-01: a 14 napos KIEMELT szekció kikerült), ezért a kapuzott tartalmat oda-ig szűkítjük.
  const tablak = html.slice(html.indexOf('id="tablak"'), html.indexOf('id="forrasok"'));
  assert.match(html, /ÚJ/, "a UJ_24H frissesség-címke megjelenik");
  assert.match(tablak, /Telex cikk/, "a 24h-s tétel a kapuzott táblában");
  assert.ok(!tablak.includes("Korábbi sajtóhír (nem 24h)"), "a KORÁBBI tétel NEM a kapuzott táblában (akkor sem, ha KIEMELT)");
});

test("Kulcsszámok ma: szám/százalék-tartalmú címek verbatim, a szám nélküliek kimaradnak", () => {
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, hvg: "HVG", nepszava: "Népszava" },
    items: [
      { canonical_key: "ksh:w", source_id: "ksh", kind: "hivatalos_adat", title: "A bruttó átlagkereset 754 700 forint volt", url: "https://ksh.hu/w", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
      { canonical_key: "hvg:d", source_id: "hvg", kind: "sajto", title: "3,7-ről 7,5 százalékosra emeli az éves hiánycélt", url: "https://hvg.hu/d", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
      { canonical_key: "nepszava:x", source_id: "nepszava", kind: "sajto", title: "Kikerültek az egyetemi pótfelvételi ponthatárok", url: "https://nepszava.hu/x", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    ],
  };
  const html = renderReport(run);
  const kulcs = html.slice(html.indexOf("📊 Kulcsszámok"), html.indexOf("📊 Adatjelentőség"));
  assert.ok(kulcs.length > 0, "van Kulcsszámok szekció a kapuzott előtt");
  assert.match(kulcs, /754 700 forint/, "a szám-tartalmú cím verbatim");
  assert.match(kulcs, /7,5 százalék/, "a százalékos cím is");
  assert.ok(!kulcs.includes("Kikerültek az egyetemi pótfelvételi"), "a szám nélküli cím NINCS a Kulcsszámokban");
});

test("Kulcsszámok ma: nincs szám-tartalmú tétel → nincs (üres) szekció", () => {
  const html = renderReport(RUN); // RUN címei szám nélküliek
  assert.ok(!html.includes("📊 Kulcsszámok"), "szám nélkül a szekció kimarad, nem üres dobozt renderel");
});

test("ellenőrzési napló a source_checks-ből, státuszokkal", () => {
  const html = renderReport(RUN);
  const forras = html.slice(html.indexOf("Forrás-ellenőrzés"));
  assert.match(forras, /részleges/i, "a RESZLEGES státusz olvasható címkével");
  assert.match(forras, /KSH/, "a forrás neve a táblában");
  // 2026-08-31: a nyers RÉSZLET-szöveg SZÁNDÉKOSAN kikerült (a Kutatások táblán link váltja,
  // a Sajtószemlén nincs oszlop) — a status-címke marad, a detail nem.
  assert.ok(!forras.includes("üres feed"), "a nyers detail-szöveg már nem jelenik meg (link/üres váltotta)");
});

test("forrásonkénti megjelenítési cap: max 25 sor/forrás + 'további' jelzés", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    canonical_key: `eurostat:${i}`, source_id: "eurostat", kind: "hivatalos_adat",
    title: `EU dataset ${i}`, url: `https://ec.europa.eu/${i}`,
    published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H",
  }));
  const html = renderReport({ ...RUN, items: many, newCount: 30 });
  // A kapuzott tábla-szekcióra szűkítünk: a fejléc (LEGFRISSEBB HIVATALOS ADAT) 2026-08-31-től
  // szintén linkel egy eurostat-tételt, az nem a per-forrás cap része.
  const tablak = html.slice(html.indexOf('id="tablak"'), html.indexOf('id="forrasok"'));
  const tableLinks = (tablak.match(/href="https:\/\/ec\.europa\.eu\//g) || []).length;
  assert.equal(tableLinks, 25, "csak 25 táblázatsor forrásonként");
  assert.match(html, /\+\s*5 további/); // 30 - 25
  assert.match(html, /DB-ben/); // a többi a DB-ben marad (F2)
});

test("üres futás sem dob (0 tétel, 0 forrás)", () => {
  const html = renderReport({
    ...RUN, items: [], sourceChecks: [], newCount: 0,
  });
  assert.match(html, /nincs/i);
});

// A providers_used WARN-bejegyzései (néma provider-degradáció, MAIL_TO-guard) a
// láblécben LÁTHATÓAN, a részletükkel jelenjenek meg — ne olvadjanak bele a
// "váltás:" listába státusz-címkeként (detail nélkül). Ez teszi a napi 404/fallback
// ellenőrzést a jelentésből leolvashatóvá (nem kell kézzel az Actions-logba nézni).
// E2 előkészítés: a SKIPPED_VALIDATION forrás-státusznak legyen olvasható címkéje az
// ellenőrzési naplóban (ne a nyers enum-string jelenjen meg).
test("ellenőrzési napló: SKIPPED_VALIDATION olvasható címkével (E2)", () => {
  const html = renderReport({
    ...RUN,
    sourceChecks: [
      { source_id: "europeelects", status: "SKIPPED_VALIDATION", detail: "PCT_SUM: 87 nem [90,110]", checked_at: "2026-08-18T04:00:00.000Z" },
    ],
  });
  assert.match(html, /validáció/i, "olvasható 'validáció' címke, nem a nyers SKIPPED_VALIDATION enum");
  assert.ok(!/>SKIPPED_VALIDATION</.test(html), "a nyers enum-string nem szivárog a cellába");
});

test("lábléc: a WARN-bejegyzések a részletükkel, láthatóan jelennek meg", () => {
  const html = renderReport({
    ...RUN,
    providersUsed: [
      { role: "triage", provider: "gemini", model: "gemini-flash-latest", status: "OK" },
      { role: "triage", status: "WARN", detail: "groq 13× HTTP_404 a triázson — modell-deprecation gyanú" },
      { role: "mail", status: "WARN", detail: "MAIL_TO pontosvesszőt tartalmaz" },
    ],
  });
  assert.match(html, /groq 13× HTTP_404/, "a triázs-degradáció részlete megjelenik a láblécben");
  assert.match(html, /MAIL_TO pontosvesszőt tartalmaz/, "a MAIL_TO-guard warning megjelenik");
  assert.match(html, /⚠️/, "WARN-jelzés a láblécben");
});

// ================= 2026-08-31 honlap-kör (user) =================

test("fejléc: UTOLSÓ ÚJ KUTATÁS + LEGFRISSEBB HIVATALOS ADAT kattintható linkek", () => {
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, median: "Medián" },
    items: [
      { canonical_key: "median:1", source_id: "median", kind: "kutatas", title: "Medián kutatás", url: "https://median.hu/x", published_at: "2026-07-22T02:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H" },
      { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "KSH adat", url: "https://ksh.hu/x", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H" },
    ],
  };
  const fejlec = renderReport(run);
  const slice = fejlec.slice(fejlec.indexOf('id="fejlec"'), fejlec.indexOf('id="24h"'));
  assert.match(slice, /UTOLSÓ ÚJ KUTATÁS[\s\S]*<a href="https:\/\/median\.hu\/x"[^>]*>Medián kutatás<\/a>/, "a kutatás-tétel linkelve");
  assert.match(slice, /LEGFRISSEBB HIVATALOS ADAT[\s\S]*<a href="https:\/\/ksh\.hu\/x"[^>]*>KSH adat<\/a>/, "a hivatalos tétel linkelve");
});

test("kapuzott tábla: a publikálva/frissesség cella egy sorban (nowrap)", () => {
  const html = renderReport(RUN);
  assert.match(html, /\.nowrap\{[^}]*white-space:\s*nowrap/i, "van .nowrap stílus");
  // a kapuzott sorok dátum-cellája nowrap
  assert.match(html, /<td class="nowrap">[^<]*\d{4}\. \d{2}\. \d{2}\./, "a publikálva-cella nowrap");
});

// 2026-09-01 (user): a honlapról (renderReport) is kikerül a 14 napos KIEMELT visszatekintő
// szekció — ez egy napi jelentés, nem kell benne az elmúlt 14 napról infó. A friss (24h) KIEMELT
// a kapuzott táblában attól még megjelenhet, de a KORABBI (14 napos) KIEMELT nem szivároghat be,
// és nincs se „🔴 KIEMELT tételek" szekció, se „elmúlt 14 nap" szöveg.
test("honlap: NINCS 14 napos KIEMELT szekció — a KORABBI KIEMELT nem jelenik meg", () => {
  const run = {
    ...RUN,
    sourceNames: { ...RUN.sourceNames, hvg: "HVG" },
    items: [
      { canonical_key: "hvg:k", source_id: "hvg", kind: "sajto", title: "Friss kiemelt hír", url: "https://hvg.hu/k", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
      { canonical_key: "telex:o", source_id: "telex", kind: "sajto", title: "Régi kiemelt hír", url: "https://telex.hu/o", published_at: "2026-07-10T03:00:00.000Z", first_seen_at: "2026-07-11T04:00:00.000Z", freshness: "KORABBI", relevant: 1, significance: "KIEMELT" },
    ],
  };
  const html = renderReport(run);
  assert.ok(!html.includes("🔴 KIEMELT tételek"), "nincs külön 14 napos KIEMELT szekció a honlapon");
  assert.ok(!html.includes("elmúlt 14 nap"), "nincs 14 napos visszatekintés-jelölés");
  assert.ok(!html.includes("Régi kiemelt hír"), "a KORABBI (14 napos) KIEMELT nem szivárog be a napi jelentésbe");
});

// 2026-09-01 (user): a Forrás-ellenőrzés táblák (Hazai/Nemzetközi/Sajtószemle) kapnak egy
// „Gyűjtött link" oszlopot — forrásonként a TÉNYLEGES gyűjtő-URL(ek), kattinthatóan. Ha egy forrás
// több linkről gyűjt (ksh/mnb: feeds_extra; eurostat: feed+lista), MINDEGYIK megjelenik. Az URL-ek
// a run.sourceUrls-ból (id → URL-lista, a sourceEndpoints-ból származtatva a run.js-ben).
test("Forrás-ellenőrzés: Gyűjtött link oszlop a gyűjtő-URL(ek)re; több feed esetén MIND (kattintható)", () => {
  const run = {
    ...RUN, items: [],
    sourceNames: { ksh: "KSH", telex: "Telex" },
    sourceKinds: { ksh: "hivatalos", telex: "sajto" },
    sourceUrls: {
      ksh: ["https://www.ksh.hu/rss/gyorstajekoztatok", "https://www.ksh.hu/rss/hirek"],
      telex: ["https://telex.hu/rss"],
    },
    sourceChecks: [
      { source_id: "ksh", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "telex", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const html = renderReport(run);
  assert.match(html, /Gyűjtött link/, "van Gyűjtött link oszlopfejléc");
  assert.match(html, /<a href="https:\/\/www\.ksh\.hu\/rss\/gyorstajekoztatok"[^>]*>/, "a KSH 1. feedje kattintható");
  assert.match(html, /<a href="https:\/\/www\.ksh\.hu\/rss\/hirek"[^>]*>/, "a KSH 2. feedje (feeds_extra) IS megjelenik");
  assert.match(html, /<a href="https:\/\/telex\.hu\/rss"[^>]*>/, "a sajtó (Sajtószemle) táblán is ott a gyűjtő-link");
  // A link SZÖVEGE rövid címke (nem a teljes URL — helytakarékos): több feed → „Forrás 1"/„Forrás 2",
  // egy feed → „Forrás". A teljes URL a href-ben (és title-tooltipben) marad.
  assert.match(html, /<a href="https:\/\/www\.ksh\.hu\/rss\/gyorstajekoztatok"[^>]*>Forrás 1<\/a>/);
  assert.match(html, /<a href="https:\/\/www\.ksh\.hu\/rss\/hirek"[^>]*>Forrás 2<\/a>/);
  assert.match(html, /<a href="https:\/\/telex\.hu\/rss"[^>]*>Forrás<\/a>/, "egyetlen feed → sima Forrás cimke");
  assert.ok(!html.includes(">https://www.ksh.hu/rss/gyorstajekoztatok<"), "a teljes URL NEM link-szövegként (helytakarékos)");
});

// 2026-09-01 (user): külön „Az oldalról" info-fül — mi ez, hogyan gyűjtünk, hogyan vonjuk össze a
// cikkeket (a „+N" jelölés), és mit látunk a honlapon. A jelentés fejlécéből link mutat rá.
test("renderReport: a fejlécben van link az info-oldalra (info.html)", () => {
  const html = renderReport(RUN);
  assert.match(html, /<a href="info\.html"[^>]*>[^<]*Az oldalról[^<]*<\/a>/, "info-fül link a fejlécben");
});

test("renderInfoPage: valid HTML, visszalink a jelentéshez, és lefedi a fő témákat", () => {
  const html = renderInfoPage();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<a href="index\.html"[^>]*>[^<]*jelentés[^<]*<\/a>/i, "vissza-link a jelentéshez");
  // fő szekciók
  assert.match(html, /Mi ez a felület/);
  assert.match(html, /Honnan gyűjtünk/);
  assert.match(html, /a folyamat|Hogyan dolgozzuk fel/);
  assert.match(html, /Mit látunk a honlapon/);
});

test("renderInfoPage: elmagyarázza a cikk-összevonást és a +N jelölést (user kérése)", () => {
  const html = renderInfoPage();
  assert.match(html, /össze/, "összevonás fogalma");
  assert.match(html, /\+N|„\+N"|\+2/, "a +N jelölés megnevezve");
  assert.match(html, /444 \+2/, "konkrét példa a +N-re (444 +2)");
  assert.match(html, /reprezentáns/, "a megjelenített változat = reprezentáns");
  assert.match(html, /ugyanarról|ugyanazt/, "több forrás ugyanarról a sztoriról");
});

test("renderInfoPage: kifejti az adatgyűjtést az összefoglalóig (folyamat-lépések)", () => {
  const html = renderInfoPage();
  for (const t of ["Triázs", "KIEMELT", "FONTOS", "FIGYELENDŐ", "Kulcsszámok", "Összefoglaló", "RSS"]) {
    assert.ok(html.includes(t), `az info-oldal említi: ${t}`);
  }
});

// 2026-09-01 (user): a Forrás-ellenőrzés alatt legyen JELMAGYARÁZAT — mindenki értse a jelzéseket.
test("Forrás-ellenőrzés: jelmagyarázat a tábla alatt (minden jelzés magyarázata)", () => {
  const run = {
    ...RUN, items: [],
    sourceNames: { ksh: "KSH" }, sourceKinds: { ksh: "hivatalos" }, sourceUrls: { ksh: ["https://ksh.hu"] },
    sourceChecks: [{ source_id: "ksh", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" }],
  };
  const html = renderReport(run);
  const legend = html.slice(html.indexOf("Jelmagyarázat"));
  assert.ok(html.includes("Jelmagyarázat"), "van Jelmagyarázat blokk");
  // a fő jelzések magyarázata jelen van
  assert.match(legend, /új – releváns/);
  assert.match(legend, /új – nem releváns/);
  assert.match(legend, /nincs új/);
  assert.match(legend, /jelenleg nem elérhető/);
  assert.match(legend, /Gyűjtött link/);
  // a jelmagyarázat a forrasok szekción belül, a footer ELŐTT
  assert.ok(html.indexOf("Jelmagyarázat") < html.indexOf("<footer>"), "a jelmagyarázat a footer előtt");
});

// 2026-09-01 (user): a hibás (nem elérhető) források a Forrás-ellenőrzés tábla VÉGÉRE kerüljenek
// (ne az ABC közepén tűnjenek fel), és a státusz BESZÉDESEBB legyen a puszta „hiba" helyett.
test("Forrás-ellenőrzés: a nem elérhető források a tábla VÉGÉRE, beszédes státusszal", () => {
  const run = {
    ...RUN, items: [],
    sourceNames: { aaa: "Aaa Intézet", zzz: "Zzz Intézet" },
    sourceKinds: { aaa: "hivatalos", zzz: "hivatalos" },
    sourceUrls: { aaa: ["https://a"], zzz: ["https://z"] },
    sourceChecks: [
      { source_id: "aaa", status: "HIBA", detail: "lista: HTTP 403", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "zzz", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const html = renderReport(run);
  assert.ok(html.indexOf(">Zzz Intézet<") < html.indexOf(">Aaa Intézet<"),
    "az OK Zzz (ABC-ben későbbi) a HIBA Aaa ELŐTT — a hibás a tábla végén");
  assert.match(html, /jelenleg nem elérhető/, "a HIBA státusz beszédesebb címkét kap");
  assert.ok(!html.includes("❌ hiba"), "a puszta 'hiba' címke eltűnt");
});

test("Forrás-ellenőrzés: a Kutatások tábla 2 altáblára bomlik — Hazai / Nemzetközi", () => {
  const run = {
    ...RUN, items: [],
    sourceNames: { ksh: "KSH", pew: "Pew", median: "Medián", telex: "Telex" },
    sourceKinds: { ksh: "hivatalos", pew: "nemzetkozi", median: "intezet", telex: "sajto" },
    sourceChecks: [
      { source_id: "ksh", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "pew", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "median", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "telex", status: "OK_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const full = renderReport(run);
  const forras = full.slice(full.indexOf("Forrás-ellenőrzés")); // a kapuzott tábla ez ELŐTT van
  const hazaiIdx = forras.indexOf("Hazai");
  const nemzIdx = forras.indexOf("Nemzetközi");
  const sajtoIdx = forras.indexOf("📰 Sajtószemle");
  assert.ok(hazaiIdx > 0 && nemzIdx > hazaiIdx, "Hazai és Nemzetközi alcím, Hazai előbb");
  assert.ok(forras.indexOf(">KSH<") > hazaiIdx && forras.indexOf(">KSH<") < nemzIdx, "KSH a Hazai altáblában");
  assert.ok(forras.indexOf(">Medián<") > hazaiIdx && forras.indexOf(">Medián<") < nemzIdx, "Medián a Hazai altáblában");
  assert.ok(forras.indexOf(">Pew<") > nemzIdx && forras.indexOf(">Pew<") < sajtoIdx, "Pew a Nemzetközi altáblában");
});

test("Forrás-ellenőrzés: Kutatások 'Új tétel' link ha OK_UJ; Sajtószemle NINCS részlet-oszlop", () => {
  const run = {
    ...RUN,
    sourceNames: { median: "Medián", telex: "Telex" },
    sourceKinds: { median: "intezet", telex: "sajto" },
    items: [
      { canonical_key: "median:new", source_id: "median", kind: "kutatas", title: "Medián friss kutatás", url: "https://median.hu/new", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    ],
    sourceChecks: [
      { source_id: "median", status: "OK_UJ", detail: "feed: 1 friss - 1 uj a DB-be", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "telex", status: "OK_UJ", detail: "feed: 30 friss - 30 uj a DB-be", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const html = renderReport(run);
  const forras = html.slice(html.indexOf("Forrás-ellenőrzés")); // a kapuzott tábla ez ELŐTT van
  assert.match(forras, /<a href="https:\/\/median\.hu\/new"[^>]*>Medián friss kutatás<\/a>/, "az új tétel linkje a Kutatások táblában");
  assert.ok(!forras.includes("feed: 1 friss"), "a nyers Kutatások-detail eltűnt (link váltotta)");
  assert.ok(!forras.includes("feed: 30 friss"), "a Sajtószemle részlet-oszlop törölve");
});

// ================= 2026-08-31 honlap-kör #2 (user) =================

test("minden link új tabban nyílik (target=_blank rel=noopener)", () => {
  const run = { ...RUN, sourceNames: { ...RUN.sourceNames, median: "Medián" }, items: [
    { canonical_key: "median:1", source_id: "median", kind: "kutatas", title: "Medián kutatás", url: "https://median.hu/x", published_at: "2026-07-22T02:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "KIEMELT" },
  ] };
  const html = renderReport(run);
  const links = [...html.matchAll(/<a href="[^"]*"([^>]*)>/g)];
  assert.ok(links.length > 0, "van link a jelentésben");
  for (const m of links) assert.match(m[1], /target="_blank"/, "minden <a> target=_blank-kel nyílik");
});

test("Forrás-ellenőrzés: Eurostat és Europion/Opinio a Nemzetközi altáblában (nem Hazai)", () => {
  const run = { ...RUN, items: [],
    sourceNames: { eurostat: "Eurostat", opinio: "Europion / Opinio", ksh: "KSH", pew: "Pew" },
    sourceKinds: { eurostat: "hivatalos", opinio: "intezet", ksh: "hivatalos", pew: "nemzetkozi" },
    sourceChecks: [
      { source_id: "eurostat", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "opinio", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "ksh", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "pew", status: "OK_NINCS_UJ", detail: "x", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const full = renderReport(run);
  const forras = full.slice(full.indexOf("Forrás-ellenőrzés"));
  const hazaiIdx = forras.indexOf("Hazai");
  const nemzIdx = forras.indexOf("Nemzetközi");
  assert.ok(forras.indexOf(">Eurostat<") > nemzIdx, "Eurostat a Nemzetközi altáblában");
  assert.ok(forras.indexOf(">Europion / Opinio<") > nemzIdx, "Europion/Opinio a Nemzetközi altáblában");
  assert.ok(forras.indexOf(">KSH<") > hazaiIdx && forras.indexOf(">KSH<") < nemzIdx, "KSH a Hazai-ban marad");
});

test("Forrás-ellenőrzés: fix oszlop-szélesség (a STÁTUSZ nem tolódik el a táblák közt)", () => {
  const html = renderReport(RUN);
  assert.match(html, /table\.checks\{[^}]*table-layout:\s*fixed/i, "fix table-layout a check-táblákon");
  assert.match(html, /<table class="checks"/, "a check-táblák 'checks' osztályt kapnak");
});

test("Forrás-ellenőrzés: OK_UJ + triázs-szűrt friss tétel → 'Új tétel' cellában JELZÉS (nem néma üres)", () => {
  const run = {
    ...RUN,
    sourceNames: { xxiszazad: "XXI. Század Intézet", ksh: "KSH" },
    sourceKinds: { xxiszazad: "intezet", ksh: "hivatalos" },
    items: [
      { canonical_key: "xxi:1", source_id: "xxiszazad", kind: "kutatas", title: "Múzeumi kiállítás", url: "https://xxi.hu/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 0, significance: null },
      { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "KSH adat", url: "https://ksh.hu/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H", relevant: 1, significance: "FONTOS" },
    ],
    sourceChecks: [
      { source_id: "xxiszazad", status: "OK_UJ", detail: "feed: 1 friss", checked_at: "2026-07-22T04:00:00.000Z" },
      { source_id: "ksh", status: "OK_UJ", detail: "feed: 1 friss", checked_at: "2026-07-22T04:00:00.000Z" },
    ],
  };
  const html = renderReport(run);
  const forras = html.slice(html.indexOf("Forrás-ellenőrzés"));
  // KSH: van megjeleníthető releváns friss tétel → státusz „új – releváns" + link
  assert.match(forras, /<a href="https:\/\/ksh\.hu\/1"[^>]*>KSH adat<\/a>/, "KSH releváns friss tétele linkelve");
  assert.match(forras, /új – releváns/, "a releváns új tétel státusza jelöli a relevanciát");
  // XXI. Század: OK_UJ, de a friss tétel nem-releváns → a STÁTUSZ jelzi (közérthetően, NEM 'triázs'),
  // nincs link, és nincs a néma üres cella az 'új' mellett
  assert.ok(!forras.includes("https://xxi.hu/1"), "a nem-releváns friss tétel NEM linkelt");
  assert.match(forras, /új – nem releváns/, "a nem-releváns új tétel státusza közérthetően jelöli");
  assert.ok(!forras.includes("triázs"), "közérthető szó, NEM a belső 'triázs' szakkifejezés");
});
