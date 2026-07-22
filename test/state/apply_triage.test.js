import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertItems, applyTriage } from "../../src/state/db.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-triage-"));
  return { db: openDb(join(dir, "monitor.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("relevant oszlop létezik (migráció) és applyTriage frissít", () => {
  const { db, cleanup } = tempDb();
  try {
    const cols = db.prepare("PRAGMA table_info(items)").all().map((c) => c.name);
    assert.ok(cols.includes("relevant"), "relevant oszlop migrálva");

    upsertItems(db, [
      { canonicalKey: "telex:1", sourceId: "telex", kind: "sajto", title: "A", url: "u1", publishedAt: null },
      { canonicalKey: "telex:2", sourceId: "telex", kind: "sajto", title: "B", url: "u2", publishedAt: null },
    ], { seenAt: "2026-07-22T06:00:00Z" });

    const verdicts = new Map([
      ["telex:1", { relevant: true, significance: "KIEMELT", kind: "kutatas", reason: "friss kutatás" }],
      ["telex:2", { relevant: false, significance: null, kind: "sajto", reason: "prefilter" }],
    ]);
    applyTriage(db, verdicts);

    const rows = Object.fromEntries(
      db.prepare("SELECT canonical_key, significance, relevant, triage_json FROM items").all().map((r) => [r.canonical_key, r]),
    );
    assert.equal(rows["telex:1"].significance, "KIEMELT");
    assert.equal(rows["telex:1"].relevant, 1);
    assert.match(rows["telex:1"].triage_json, /friss kutatás/);
    assert.equal(rows["telex:2"].significance, null);
    assert.equal(rows["telex:2"].relevant, 0);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});
