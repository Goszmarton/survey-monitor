import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDigest, renderKiemelt, digestSubject } from "../src/report.js";

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
