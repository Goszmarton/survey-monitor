import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report.js";

const RUN = {
  runId: "2026-07-22",
  generatedAt: "2026. 07. 22. 6:00",
  phase: "F1 — A-kaszt mag",
  runStartedAt: "2026-07-22T04:00:00.000Z",
  sinceIso: "2026-07-21T04:00:00.000Z",
  sourceNames: { ksh: "KSH", telex: "Telex", szabadeu: "Szabad Európa", eurostat: "Eurostat" },
  items: [
    { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "KSH közlés & <b>", url: "https://ksh.hu/1", published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H" },
    { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "Telex cikk", url: "https://telex.hu/1", published_at: "2026-07-20T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "KIHAGYOTT_MOST" },
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

test("hivatalos és sajtó külön táblában", () => {
  const html = renderReport(RUN);
  const hivIdx = html.indexOf("Hivatalos");
  const sajtoIdx = html.search(/Sajtó/i);
  assert.ok(hivIdx > 0 && sajtoIdx > 0);
});

test("frissességi címkék", () => {
  const html = renderReport(RUN);
  assert.match(html, /ÚJ/); // UJ_24H
  assert.match(html, /korábban kihagyott/i); // KIHAGYOTT_MOST
});

test("ellenőrzési napló a source_checks-ből, státuszokkal", () => {
  const html = renderReport(RUN);
  assert.match(html, /részleges/i);
  assert.match(html, /üres feed/);
  assert.match(html, /KSH/);
});

test("'mi változott': az új tételek száma", () => {
  const html = renderReport(RUN);
  assert.match(html, /2/);
  assert.match(html, /változott/i);
});

test("forrásonkénti megjelenítési cap: max 25 sor/forrás + 'további' jelzés", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    canonical_key: `eurostat:${i}`, source_id: "eurostat", kind: "hivatalos_adat",
    title: `EU dataset ${i}`, url: `https://ec.europa.eu/${i}`,
    published_at: "2026-07-22T03:00:00.000Z", first_seen_at: "2026-07-22T04:00:00.000Z", freshness: "UJ_24H",
  }));
  const html = renderReport({ ...RUN, items: many, newCount: 30 });
  // csak a táblázatsorok adnak <a href="https://ec.europa.eu/...">; a változáslista/fejléc sima szöveg
  const tableLinks = (html.match(/href="https:\/\/ec\.europa\.eu\//g) || []).length;
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
