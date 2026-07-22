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

test("renderReport: valid HTML, cím és fázis", () => {
  const html = renderReport(RUN);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /F1 — A-kaszt mag/);
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
