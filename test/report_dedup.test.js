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

// --- Ítélet nélküli tétel: PER-SOR megjelölve, nem csendes ---
// A „Ellenőrzési napló" összegző sora (⏳ N tétel ítélet nélkül maradt) 2026-08-27-én
// KIKERÜLT a nézetből; a per-tétel jel (sigLabel „⏳ ítélet nélkül") a táblázat SORÁBAN
// MEGMARAD → a tétel továbbra sem tűnik el csendben (CLAUDE.md 2), csak az összegzés nélkül.
test("report: triage_missing tétel PER-SOR megjelölve (nem csendes) (#2)", () => {
  const items = [
    { canonical_key: "telex:m", source_id: "telex", kind: "sajto", title: "Ítélet nélküli hír", relevant: 1, significance: null, triage_missing: true, freshness: "UJ_24H", first_seen_at: NOW },
  ];
  const html = renderReport(makeRun(items, { dedupCfg: cfg, institutes }));
  assert.match(html, /Ítélet nélküli hír/, "a tétel megjelenik (nem esik ki)");
  assert.match(html, /ítélet nélkül/i, "a per-sor jel (sigLabel) megvan");
  assert.ok(!/tétel ítélet nélkül maradt/.test(html), "az összegző napló-sor eltűnt (nézet-tisztítás)");
});

// --- 3a undefined-safety: a RÉGI sorokban nincs significance_raw (csak mától kerül be).
// Az olvasó/report oldal a kapuzott `significance` oszlopból dolgozik, a nyers kulcsot
// SEHOL nem olvassa — egy significance_raw NÉLKÜLI tételen sem szabad eldőlnie. ---
test("3a: report + KIEMELT-levél significance_raw NÉLKÜLI tételen is rendereldik (régi sorok)", () => {
  const items = [
    { canonical_key: "telex:o", source_id: "telex", kind: "sajto", title: "Régi sor, nincs nyers kulcs", url: "t", relevant: 1, significance: "KIEMELT", freshness: "UJ_24H", first_seen_at: NOW },
  ];
  assert.ok(!("significance_raw" in items[0]), "a fixture tudatosan nem tartalmazza a kulcsot");
  const run = makeRun(items, { dedupCfg: cfg, institutes });
  let report, kiemelt;
  assert.doesNotThrow(() => { report = renderReport(run); }, "a report nem dől el a hiányzó significance_raw-tól");
  assert.doesNotThrow(() => { kiemelt = renderKiemelt(run); }, "a KIEMELT-levél sem");
  assert.match(report, /🔴 KIEMELT/, "a kapuzott jelentőség jelenik meg, változatlanul");
  assert.match(kiemelt, /Régi sor, nincs nyers kulcs/);
});
