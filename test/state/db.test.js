import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  upsertItems,
  recordSourceCheck,
  getSourceChecks,
  startRun,
  finishRun,
  getLastRunStartedAt,
  finalizeFreshness,
  countNewInRun,
} from "../../src/state/db.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-db-"));
  const db = openDb(join(dir, "monitor.db"));
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test("upsert: új tétel isNew=true, ismételt kulcs isNew=false, first_seen stabil", () => {
  const { db, cleanup } = tempDb();
  try {
    const item = {
      canonicalKey: "telex:cikk-1", sourceId: "telex", kind: "sajto",
      title: "Cím", url: "https://telex.hu/1", publishedAt: iso(Date.parse("2026-07-22T05:00:00Z")),
    };
    const r1 = upsertItems(db, [item], { seenAt: "2026-07-22T06:00:00Z" });
    assert.equal(r1[0].isNew, true);

    // ugyanaz a kulcs, más cím/first_seen — nem szúr be újat, first_seen marad
    const r2 = upsertItems(db, [{ ...item, title: "Módosított" }], { seenAt: "2026-07-23T06:00:00Z" });
    assert.equal(r2[0].isNew, false);

    const rows = db.prepare("SELECT canonical_key, first_seen_at, title FROM items").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_seen_at, "2026-07-22T06:00:00Z");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("source_checks: rögzítés és visszaolvasás futásonként", () => {
  const { db, cleanup } = tempDb();
  try {
    recordSourceCheck(db, { runId: "2026-07-22", sourceId: "ksh", status: "OK_UJ", detail: "3 tétel", checkedAt: "2026-07-22T06:00:00Z" });
    recordSourceCheck(db, { runId: "2026-07-22", sourceId: "szabadeu", status: "RESZLEGES", detail: "üres feed", checkedAt: "2026-07-22T06:00:01Z" });
    const rows = getSourceChecks(db, "2026-07-22");
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.source_id === "szabadeu").status, "RESZLEGES");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("runs: startRun/finishRun és az előző futás kezdete (aktuális kizárva)", () => {
  const { db, cleanup } = tempDb();
  try {
    assert.equal(getLastRunStartedAt(db, { excludeRunId: "x" }), null);
    startRun(db, { runId: "2026-07-20", startedAt: "2026-07-20T03:43:00Z" });
    finishRun(db, { runId: "2026-07-20", finishedAt: "2026-07-20T03:50:00Z" });
    startRun(db, { runId: "2026-07-22", startedAt: "2026-07-22T03:43:00Z" });
    const last = getLastRunStartedAt(db, { excludeRunId: "2026-07-22" });
    assert.equal(last, Date.parse("2026-07-20T03:43:00Z"));
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("finalizeFreshness + countNewInRun: frissesség és 'új ebben a futásban'", () => {
  const { db, cleanup } = tempDb();
  try {
    const now = Date.parse("2026-07-22T06:00:00Z");
    const runStart = iso(now - 0.1 * H);
    const items = [
      { canonicalKey: "a:friss", sourceId: "telex", kind: "sajto", title: "Friss", url: "u1", publishedAt: iso(now - 5 * H) },
      { canonicalKey: "a:regi-most", sourceId: "ksh", kind: "hivatalos", title: "Régi, most látott", url: "u2", publishedAt: iso(now - 120 * H) },
    ];
    upsertItems(db, items, { seenAt: runStart });

    const report = finalizeFreshness(db, { now, runStartedAt: runStart, windowStart: now - 14 * 24 * H });
    const byKey = Object.fromEntries(report.map((r) => [r.canonical_key, r.freshness]));
    assert.equal(byKey["a:friss"], "UJ_24H");
    assert.equal(byKey["a:regi-most"], "KIHAGYOTT_MOST");

    // a tárolt oszlop is frissült
    const stored = db.prepare("SELECT freshness FROM items WHERE canonical_key='a:friss'").get();
    assert.equal(stored.freshness, "UJ_24H");

    assert.equal(countNewInRun(db, { runStartedAt: runStart }), 2);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});
