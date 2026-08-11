import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertItems } from "../src/state/db.js";
import { enrichWithTriage } from "../src/enrich.js";
import { renderReport } from "../src/report.js";

// RED — a kapu-lehúzás (data_backed=false → FONTOS/KIEMELT ⇒ FIGYELENDO) LÁTHATÓSÁGA.
//
// A 08-10-i futás mérése: 8 lehúzott tétel közül a report jelenlegi felületén (Sajtószemle,
// per-forrás cap 25) MINDÖSSZE 1 renderel — a FIGYELENDO a sig-rendezés alján, a cap épp a
// lehúzott farkat vágja le. A lehúzás így a DB-ben ott van (triage_json: reason +
// significance_raw), de a levélből DB-túrás nélkül láthatatlan. A kapu-döntés feltétele (a
// reason EGYÜTT megy ki a kapuval) csak akkor teljesül, ha a lehúzás egy CAP-FÜGGETLEN,
// dedikált szekcióban látszik.
//
// A szűrő RÉSE (verifikálva a 08-10-i DB-n): a significance_raw NEM minden látható tételen
// van meg. A 8 lehúzás MIND korábbi futásból való (first_seen≠ma) → a significance_raw csak
// a triage_json-ben van, az in-memory tételen NINCS. Egy „csak a friss verdikteket felszínre
// hozó" fix 0-t mutatna a 8 helyett. Ráadásul 746 látható FIGYELENDO tétel a
// significance_raw bevezetése (2026-08-06) ELŐTTI triázsból való — ezeknél a lehúzás NEM
// megállapítható, és a szekció ezt KÜLÖN, darabszámmal mutassa (ne állítsa, hogy 8, ha 8+N).
//
// Három ág, mindet guardoljuk:
//   (1) friss lehúzás (enrich felszínre hozza a significance_raw-t) — valós lánc, temp-DB;
//   (2) korábbi futás lehúzása (significance_raw CSAK a triage_json-ben) — a report onnan olvas;
//   (3) legacy (nincs significance_raw sehol) — külön „nem megállapítható" darabszám.

const PF = { keywords: ["párt"], exclude_patterns: [] };
const DOWNGRADE_REASON = "Releváns magyar belpolitikai esemény konkrét kutatási adat nélkül.";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-gate-vis-"));
  return { db: openDb(join(dir, "monitor.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function baseRun(items) {
  return {
    runId: "2026-08-10", generatedAt: "2026. 08. 10. 12:00", phase: "F2 — LLM-réteg",
    runStartedAt: "2026-08-10T10:01:15.326Z", sinceIso: "2026-08-09T10:00:00.000Z",
    sourceNames: { telex: "Telex", nepszava: "Népszava" }, items,
    sourceChecks: [], newCount: 0, notCovered: [], providersUsed: [], durationMs: 100,
  };
}

test("(1) friss lehúzás: valós enrich-lánc perzisztálja a reason-t, a szekció mutatja", async () => {
  const { db, cleanup } = tempDb();
  try {
    upsertItems(db, [{
      canonicalKey: "telex:gate1", sourceId: "telex", kind: "sajto",
      title: "Pártközi egyeztetés a költségvetésről", url: "https://telex.hu/gate1", publishedAt: "2026-08-10T05:00:00.000Z",
    }], { seenAt: "2026-08-10T06:00:00.000Z" });

    // A modell FONTOS-t adna, DE data_backed=false → a kapu FIGYELENDO-ra húzza (gatedSignificance).
    const completeFn = async (role, prompt, { log }) => {
      log?.push({ role, provider: "gemini", status: "OK" });
      if (role === "triage") {
        return { data: [{ id: 1, relevant: true, significance: "FONTOS", data_backed: false, kind: "sajto", reason: DOWNGRADE_REASON }], provider: "gemini", model: "gemini-2.5-flash" };
      }
      return { text: "szintézis", provider: "anthropic", model: "claude-sonnet-5" };
    };

    const items = [{
      canonical_key: "telex:gate1", source_id: "telex", kind: "sajto",
      title: "Pártközi egyeztetés a költségvetésről", url: "https://telex.hu/gate1",
      published_at: "2026-08-10T05:00:00.000Z", first_seen_at: "2026-08-10T06:00:00.000Z",
      freshness: "UJ_24H", triage_json: null, significance: null, relevant: null,
    }];
    const r = await enrichWithTriage({ db, items, completeFn, prefilterCfg: PF, providersUsed: [] });

    // perzisztálás (ma is zöld, guard): a nyers érték + reason a DB-ben
    const tj = JSON.parse(db.prepare("SELECT triage_json FROM items WHERE canonical_key='telex:gate1'").get().triage_json);
    assert.equal(tj.significance_raw, "FONTOS");
    assert.equal(tj.reason, DOWNGRADE_REASON);

    // render: dedikált, cap-független szekció, a reason-nel
    const html = renderReport(baseRun(r.items));
    assert.match(html, /kapu lehúzta/i, "van dedikált kapu-lehúzás szekció");
    assert.match(html, /Pártközi egyeztetés a költségvetésről/);
    assert.ok(html.includes(DOWNGRADE_REASON), "a reason látszik");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("(2) korábbi futás lehúzása: a significance_raw CSAK a triage_json-ben van, a szekció onnan olvas", () => {
  // Ahogy a finalizeFreshness egy korábban triázsolt (nem újra-triázsolt) tételt visszaad:
  // significance oszlop = FIGYELENDO, triage_json = a korábbi verdikt (significance_raw-val),
  // de NINCS in-memory significance_raw mező. Ez a 08-10-i 8 lehúzás VALÓDI alakja.
  const items = [{
    canonical_key: "nepszava:prior1", source_id: "nepszava", kind: "sajto",
    title: "Kormányzati bejelentés a nyugdíjakról", url: "https://nepszava.hu/prior1",
    published_at: "2026-08-08T05:00:00.000Z", first_seen_at: "2026-08-08T06:00:00.000Z", freshness: "KORABBI",
    significance: "FIGYELENDO", relevant: 1,
    triage_json: JSON.stringify({ relevant: true, significance: "FIGYELENDO", significance_raw: "FONTOS", data_backed: false, reason: DOWNGRADE_REASON }),
  }];
  const html = renderReport(baseRun(items));
  assert.match(html, /kapu lehúzta/i);
  assert.match(html, /Kormányzati bejelentés a nyugdíjakról/, "a korábbi lehúzás címe megjelenik (nem esik ki némán)");
  assert.ok(html.includes(DOWNGRADE_REASON), "a reason a triage_json-ből");
});

test("(3) legacy (nincs significance_raw): külön 'nem megállapítható' darabszám, NEM a lehúzás-listában", () => {
  const items = [
    // legacy FIGYELENDO: triage_json van, de significance_raw NINCS (2026-08-06 előtti triázs)
    { canonical_key: "telex:legacy1", source_id: "telex", kind: "sajto", title: "Régi triázsú FIGYELENDO hír",
      url: "https://telex.hu/legacy1", published_at: "2026-08-01T05:00:00.000Z", first_seen_at: "2026-08-01T06:00:00.000Z",
      freshness: "KORABBI", significance: "FIGYELENDO", relevant: 1,
      triage_json: JSON.stringify({ relevant: true, significance: "FIGYELENDO", reason: "háttérhír" }) },
    // valódi lehúzás (raw megvan) — hogy a két bucket szét legyen választva
    { canonical_key: "nepszava:prior1", source_id: "nepszava", kind: "sajto", title: "Kormányzati bejelentés a nyugdíjakról",
      url: "https://nepszava.hu/prior1", published_at: "2026-08-08T05:00:00.000Z", first_seen_at: "2026-08-08T06:00:00.000Z",
      freshness: "KORABBI", significance: "FIGYELENDO", relevant: 1,
      triage_json: JSON.stringify({ relevant: true, significance: "FIGYELENDO", significance_raw: "FONTOS", data_backed: false, reason: DOWNGRADE_REASON }) },
  ];
  const html = renderReport(baseRun(items));
  // a legacy tétel NEM kap lehúzás-jelet (nem kerül a ↳-listába)
  assert.doesNotMatch(html, /Régi triázsú FIGYELENDO hír<\/a>\s*<span class="empty">↳/, "a legacy tétel NEM lehúzás-sor");
  // a valódi (raw-hordozó) lehúzás VISZONT a listában van
  assert.match(html, /Kormányzati bejelentés a nyugdíjakról<\/a>\s*<span class="empty">↳/, "a raw-hordozó lehúzás a listában");
  // a 'nem megállapítható' darabszám pontosan a legacy 1 tételt tartalmazza
  assert.match(html, /további 1 FIGYELENDO tétel lehúzása nem megállapítható/i, "külön darabszám a legacy-re");
  assert.match(html, /significance_raw/i, "a hiány oka nevesítve");
});
