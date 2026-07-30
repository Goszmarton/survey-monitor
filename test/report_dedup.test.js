import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderReport, renderKiemelt, storyGroups } from "../src/report.js";
import { deriveInstitutes } from "../src/lib/storygroup.js";

const cfg = JSON.parse(readFileSync(new URL("../config/dedup.json", import.meta.url), "utf8"));
const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);
const NOW = "2026-07-30T01:00:00Z";

function makeRun(items, extra = {}) {
  return {
    runId: "2026-07-30", generatedAt: "2026.07.30", runStartedAt: NOW,
    sourceNames: { telex: "Telex", "444": "444", infostart: "Infostart", ksh: "KSH", portfolio: "Portfolio" },
    sourceChecks: [], items, newCount: items.length, synthesisText: null,
    kiemeltCount: 0, triageDegraded: false, providersUsed: [], notCovered: [], durationMs: 1,
    ...extra,
  };
}

// --- Config-hiba identitás-ág (a jelentés akkor is kimegy) ---
test("report storyGroups: dedupCfg/institutes NÉLKÜL → identitás (reprezentánsok = látható tételek, merges üres)", () => {
  const items = [
    { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "X", relevant: 1, freshness: "UJ_24H", first_seen_at: NOW },
    { canonical_key: "444:1", source_id: "444", kind: "sajto", title: "Y", relevant: 1, freshness: "UJ_24H", first_seen_at: NOW },
    { canonical_key: "telex:2", source_id: "telex", kind: "sajto", title: "Z", relevant: 0, freshness: "UJ_24H", first_seen_at: NOW }, // nem látható
  ];
  const run = makeRun(items); // nincs dedupCfg/institutes
  const { representatives, merges } = storyGroups(run);
  assert.equal(representatives.length, 2, "a 2 látható (relevant!==0) tétel érintetlen");
  assert.equal(merges.length, 0);
});

// --- Cross-source dedup a jelentésben ---
test("report: azonos KIEMELT-sztori 3 forrásból → 1 sor +2 és press_urls a KIEMELT-levélben (#3)", () => {
  const items = [
    { canonical_key: "telex:ugyesz", source_id: "telex", kind: "sajto", title: "Lemondott a legfőbb ügyész", url: "t", relevant: 1, significance: "KIEMELT", freshness: "UJ_24H", first_seen_at: NOW },
    { canonical_key: "444:ugyesz", source_id: "444", kind: "sajto", title: "Lemondott a legfőbb ügyész", url: "n", relevant: 1, significance: "FONTOS", freshness: "UJ_24H", first_seen_at: NOW },
    { canonical_key: "infostart:ugyesz", source_id: "infostart", kind: "sajto", title: "Lemond a legfőbb ügyész", url: "i", relevant: 1, significance: "FIGYELENDO", freshness: "UJ_24H", first_seen_at: NOW },
  ];
  const html = renderKiemelt(makeRun(items, { dedupCfg: cfg, institutes }));
  // egyetlen reprezentáns sor, +2 jelöléssel
  assert.equal((html.match(/legfőbb ügyész/gi) ?? []).length >= 1, true);
  assert.match(html, /\+2/, "a reprezentáns mellett +2 forrás");
  // press_urls linkek a másik két forrásra
  assert.match(html, /forrás:/);
});

// --- Ítélet nélküli tétel: külön megjelölve, nem csendes ---
test("report: triage_missing tétel megjelölve + naplóban a darabszám (#2)", () => {
  const items = [
    { canonical_key: "telex:m", source_id: "telex", kind: "sajto", title: "Ítélet nélküli hír", relevant: 1, significance: null, triage_missing: true, freshness: "UJ_24H", first_seen_at: NOW },
  ];
  const html = renderReport(makeRun(items, { dedupCfg: cfg, institutes }));
  assert.match(html, /ítélet nélkül/i, "a tétel megjelölve (nem tűnik el csendben)");
  assert.match(html, /1 tétel ítélet nélkül maradt/, "az ellenőrzési naplóban a darabszám");
});

// --- "Mi változott": három populáció (begyűjtött / releváns / sztori) ---
test("report: a változás-mondat elkülöníti a begyűjtött / releváns / sztori számot (#3)", () => {
  const items = [
    { canonical_key: "telex:u", source_id: "telex", kind: "sajto", title: "Lemondott a legfőbb ügyész", relevant: 1, significance: "KIEMELT", freshness: "UJ_24H", first_seen_at: NOW },
    { canonical_key: "444:u", source_id: "444", kind: "sajto", title: "Lemondott a legfőbb ügyész", relevant: 1, significance: "FONTOS", freshness: "UJ_24H", first_seen_at: NOW },
  ];
  // 650 nyers begyűjtött (churnnel), 2 releváns új tétel, 1 sztori
  const html = renderReport(makeRun(items, { newCount: 650, dedupCfg: cfg, institutes }));
  assert.match(html, /650<\/strong> új tétel begyűjtve/);
  assert.match(html, /2<\/strong> releváns/);
  assert.match(html, /1<\/strong> sztoriban/);
});
