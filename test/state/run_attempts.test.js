import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, startRun, finishRun } from "../../src/state/db.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-runs-"));
  return { db: openDb(join(dir, "monitor.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("run_attempts: két aznapi futás → runs 1 sor, run_attempts 2 sor, az első providers_used megmarad (#6)", () => {
  const { db, cleanup } = tempDb();
  try {
    const id1 = startRun(db, { runId: "2026-07-30", startedAt: "2026-07-30T01:00:00Z" });
    finishRun(db, { runId: "2026-07-30", attemptId: id1, finishedAt: "2026-07-30T01:04:00Z", providersUsed: [{ role: "triage", provider: "gemini", status: "OK", tag: "első" }], reportUrl: "r1", emailStatus: "sent" });

    const id2 = startRun(db, { runId: "2026-07-30", startedAt: "2026-07-30T02:00:00Z" });
    finishRun(db, { runId: "2026-07-30", attemptId: id2, finishedAt: "2026-07-30T02:04:00Z", providersUsed: [{ role: "triage", provider: "anthropic", status: "OK", tag: "második" }], reportUrl: "r2", emailStatus: "sent" });

    assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE run_id='2026-07-30'").get().n, 1, "runs: napi 1 sor");
    const attempts = db.prepare("SELECT id, started_at, providers_used FROM run_attempts WHERE run_id='2026-07-30' ORDER BY id").all();
    assert.equal(attempts.length, 2, "run_attempts: 2 sor (aznapi újrafutás)");
    // az ELSŐ futás providers_used-je nem íródott felül
    assert.match(attempts[0].providers_used, /első/);
    assert.match(attempts[1].providers_used, /második/);
    // a started_at közvetlen (nem a runs-ból, amit a 2. startRun felülírt)
    assert.equal(attempts[0].started_at, "2026-07-30T01:00:00Z");
    assert.equal(attempts[1].started_at, "2026-07-30T02:00:00Z");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("run_attempts: startRun finishRun nélkül → a sor finished_at = NULL (elhasalt futás jelzése) (#6)", () => {
  const { db, cleanup } = tempDb();
  try {
    startRun(db, { runId: "2026-07-29", startedAt: "2026-07-29T01:00:00Z" });
    const row = db.prepare("SELECT finished_at, providers_used FROM run_attempts WHERE run_id='2026-07-29'").get();
    assert.equal(row.finished_at, null, "befejezetlen futás: finished_at NULL");
    assert.equal(row.providers_used, null);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("run_attempts: finishRun attemptId NÉLKÜL → WARN a providers_used-be (nem csendes fallback) (#6)", () => {
  const { db, cleanup } = tempDb();
  try {
    startRun(db, { runId: "2026-07-28", startedAt: "2026-07-28T01:00:00Z" });
    const providersUsed = [{ role: "triage", status: "OK" }];
    finishRun(db, { runId: "2026-07-28", finishedAt: "2026-07-28T01:04:00Z", providersUsed, reportUrl: "r", emailStatus: "sent" });

    // WARN a memóriabeli naplóban
    assert.ok(providersUsed.some((e) => e.status === "WARN"), "WARN a providers_used tömbben");
    // ÉS a perzisztált run_attempts.providers_used-ben (a stringify a fallback UTÁN fut)
    const row = db.prepare("SELECT finished_at, providers_used FROM run_attempts WHERE run_id='2026-07-28'").get();
    assert.equal(row.finished_at, "2026-07-28T01:04:00Z", "a nyitott sor lezárva");
    assert.match(row.providers_used, /WARN/);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});
