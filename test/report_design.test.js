// Honlap-redesign (2026-11-28, user-kérés): az „adattár"-minta szerkezete (oldalsáv, felső sáv,
// oldalfejléc állapot-pill-lel, kártyák, stat-sor) a projekt saját szilva-palettájával. CSAK a
// kinézet változik: a megjelenített szövegek/számok, az adatok és a levél (digest/combined/KIEMELT)
// érintetlenek — a levél a régi, email-barát STYLE-t kapja tovább (Gmail nem kezel CSS-változót
// és oldalsávot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, renderInfoPage, renderDigest, renderCombined, renderKiemelt } from "../src/report.js";

const RUN = () => ({
  runId: "2026-11-25",
  generatedAt: "2026. 11. 25. 16:31",
  runStartedAt: "2026-11-25T15:30:00.000Z",
  sourceNames: { ksh: "KSH", telex: "Telex", hiba: "Hibás", oecd: "OECD", median: "Medián" },
  sourceKinds: { ksh: "hivatalos_adat", telex: "sajto", hiba: "kutatas", oecd: "nemzetkozi", median: "kutatas" },
  items: [
    { canonical_key: "ksh:1", source_id: "ksh", kind: "hivatalos_adat", title: "Az infláció 4,3% volt", url: "https://ksh.hu/1", published_at: "2026-11-25T08:00:00.000Z", freshness: "UJ_24H", significance: "FONTOS" },
    { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "Telex cikk", url: "https://telex.hu/1", published_at: "2026-11-25T06:00:00.000Z", freshness: "UJ_24H", significance: "FIGYELENDO" },
  ],
  sourceChecks: [
    { source_id: "ksh", status: "OK_UJ" },
    { source_id: "telex", status: "OK_NINCS_UJ" },
    { source_id: "median", status: "RESZLEGES" },
    { source_id: "oecd", status: "SKIPPED_VALIDATION" },
    { source_id: "hiba", status: "HIBA" },
  ],
  providersUsed: [],
  durationMs: 1000,
  pagesUrl: "https://example.org/",
});

const TOKENS = {
  "--sidebar-bg": "#2A1A2E",
  "--sidebar-fg": "#D3C6D6",
  "--sidebar-section": "#9A889E",
  "--nav-active-bg": "#EBC7D9",
  "--nav-active-fg": "#2A1A2E",
  "--bg": "#F7F5F6",
  "--card": "#FFFFFF",
  "--border": "#E6E1E4",
  "--text": "#1D1A1F",
  "--text-muted": "#6E6872",
  "--accent": "#9C3D6B",
  "--ok": "#2E8B57",
  "--warn": "#D9A21B",
  "--err": "#C8414B",
  "--neutral": "#9A98A0",
};

for (const [name, render] of [["renderReport", () => renderReport(RUN())], ["renderInfoPage", () => renderInfoPage()]]) {
  test(`${name}: a paletta CSS-változóként, EGY :root-blokkban`, () => {
    const html = render();
    const roots = html.match(/:root\{[^}]*\}/g) ?? [];
    assert.equal(roots.length, 1, "pontosan egy :root-definíció");
    for (const [k, v] of Object.entries(TOKENS)) {
      assert.ok(roots[0].includes(`${k}:${v}`), `${k}:${v} a :root-ban`);
    }
  });

  test(`${name}: teljes magasságú oldalsáv logóval, szekciócímekkel, ikonos menüvel`, () => {
    const html = render();
    assert.match(html, /<aside class="sidebar"/);
    assert.match(html, /class="nav-section"/, "van szekciócím");
    const nav = html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf("</aside>"));
    assert.match(nav, /<svg[^>]*class="ico"/, "a menüpontok előtt vonalas ikon");
    assert.match(nav, /aria-current="page"/, "az aktív menüpont jelölve");
    assert.match(nav, /href="info\.html"/, "Az oldalról menüpont");
  });

  test(`${name}: felső sáv breadcrumb-bal`, () => {
    assert.match(render(), /<nav class="crumbs"[\s\S]*Napi jelentés/);
  });
}

test("renderReport: a menü a jelentés szekcióira ugrik, a tétel- és forrásszám badge-ben", () => {
  const html = renderReport(RUN());
  const nav = html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf("</aside>"));
  for (const id of ["fejlec", "24h", "tablak", "forrasok"]) assert.match(nav, new RegExp(`href="#${id}"`));
  assert.match(nav, /href="#tablak"[\s\S]*?<span class="badge">2<\/span>/, "2 friss tétel");
  assert.match(nav, /href="#forrasok"[\s\S]*?<span class="badge">5<\/span>/, "5 ellenőrzött forrás");
});

test("renderReport: a felső sáv jobb oldalán az utolsó frissítés ideje", () => {
  assert.match(renderReport(RUN()), /class="updated"[\s\S]*?Utolsó frissítés: 2026\. 11\. 25\. 16:31/);
});

test("renderReport: állapot-pill a cím fölött (kész / LLM nélküli nyers lista)", () => {
  const ok = renderReport(RUN());
  assert.match(ok, /class="status-pill ok"[\s\S]*NAPI ELEMZÉS KÉSZ[\s\S]*2026-11-25[\s\S]*<h1>/);
  const degraded = renderReport({ ...RUN(), triageDegraded: true });
  assert.match(degraded, /class="status-pill warn"/);
});

test("renderReport: stat-sor a friss tétel- és forrásszámokkal (tabular számjegyek)", () => {
  const html = renderReport(RUN());
  const stats = html.slice(html.indexOf('class="stats"'), html.indexOf('id="24h"'));
  assert.match(stats, /<span class="stat-value">2<\/span>/, "friss tétel 24h");
  assert.match(stats, /<span class="stat-value">1<\/span>/, "kutatás / sajtó");
  assert.match(stats, /<span class="stat-value">5<\/span>/, "forrás");
  assert.match(html, /\.stat-value\{[^}]*tabular-nums/);
});

test("renderReport: a forrás-státusz állapotszínt kap (rendben/figyelmeztetés/hiba/semleges)", () => {
  const html = renderReport(RUN());
  const forras = html.slice(html.indexOf('id="forrasok"'));
  assert.match(forras, /<td class="nowrap"><span class="st st-ok">✅ új – releváns<\/span>/);
  assert.match(forras, /<span class="st st-neutral">☑️ nincs új<\/span>/);
  assert.match(forras, /<span class="st st-warn">⚠️ részleges<\/span>/);
  assert.match(forras, /<span class="st st-err">🚫 validáció elutasította<\/span>/);
  assert.match(forras, /<span class="st st-err">⚠️ jelenleg nem elérhető<\/span>/);
});

test("renderInfoPage: az Az oldalról menüpont aktív", () => {
  const html = renderInfoPage();
  assert.match(html, /<a href="info\.html"[^>]*aria-current="page"/);
});

test("a LEVÉL (digest/combined/KIEMELT) NEM kapja a honlap-dizájnt", () => {
  for (const html of [renderDigest(RUN()), renderCombined(RUN()), renderKiemelt(RUN())]) {
    assert.ok(!html.includes('class="sidebar"'), "nincs oldalsáv a levélben");
    assert.ok(!html.includes("--sidebar-bg"), "nincs honlap-token a levélben");
    assert.ok(html.includes("--paper:#fbfaf7"), "a régi, email-barát stílus marad");
  }
});
