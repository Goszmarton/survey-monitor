import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertItems, applyTriage, resetStuckMissingVerdicts } from "../../src/state/db.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-reset-"));
  return { db: openDb(join(dir, "monitor.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const seed = (db) => upsertItems(db, [
  { canonicalKey: "telex:1", sourceId: "telex", kind: "sajto", title: "A", url: "u", publishedAt: null },
  { canonicalKey: "telex:2", sourceId: "telex", kind: "sajto", title: "B", url: "u", publishedAt: null },
  { canonicalKey: "telex:3", sourceId: "telex", kind: "sajto", title: "C", url: "u", publishedAt: null },
], { seenAt: "2026-07-22T06:00:00Z" });

test("applyTriage: hiányzó ítélet (missing) NEM ír triage_json-t → újrapróbálható marad (#2)", () => {
  const { db, cleanup } = tempDb();
  try {
    seed(db);
    applyTriage(db, new Map([
      ["telex:1", { relevant: true, significance: "FONTOS", data_backed: true, kind: "sajto", reason: "ok" }],
      ["telex:2", { relevant: true, significance: null, kind: "sajto", reason: "triázs: hiányzó ítélet (batch kihagyva)", missing: true }],
    ]));
    const rows = Object.fromEntries(db.prepare("SELECT canonical_key, triage_json FROM items").all().map((r) => [r.canonical_key, r]));
    assert.ok(rows["telex:1"].triage_json, "a valós ítélet perzisztálódik");
    assert.equal(rows["telex:2"].triage_json, null, "a hiányzó ítélet NEM perzisztálódik → !triage_json újra jelölt");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("resetStuckMissingVerdicts: a beragadt tételeket nullázza, idempotens, mást nem bánt (#2)", () => {
  const { db, cleanup } = tempDb();
  try {
    seed(db);
    // korábbi (fix előtti) hibás állapot: KÉT reason-variáns létezik a triage.js-ben —
    // a hosszú ("batch kihagyva") ÉS a rövid ("triázs: hiányzó ítélet") — mindkettőt fedni kell.
    db.prepare("UPDATE items SET triage_json = ?, significance = NULL, relevant = 1 WHERE canonical_key='telex:1'")
      .run(JSON.stringify({ relevant: true, significance: null, reason: "triázs: hiányzó ítélet (batch kihagyva)" }));
    db.prepare("UPDATE items SET triage_json = ?, significance = NULL, relevant = 1 WHERE canonical_key='telex:3'")
      .run(JSON.stringify({ relevant: true, significance: null, reason: "triázs: hiányzó ítélet" }));
    // telex:2 rendes ítélet — nem szabad hozzányúlni
    db.prepare("UPDATE items SET triage_json = ?, significance='FONTOS', relevant = 1 WHERE canonical_key='telex:2'")
      .run(JSON.stringify({ relevant: true, significance: "FONTOS", reason: "valós" }));

    const changed = resetStuckMissingVerdicts(db);
    assert.equal(changed, 2, "mindkét reason-variáns (hosszú + rövid) beragadt tétele érintett");

    const r1 = db.prepare("SELECT triage_json, significance, relevant FROM items WHERE canonical_key='telex:1'").get();
    assert.equal(r1.triage_json, null); assert.equal(r1.significance, null); assert.equal(r1.relevant, null);
    const r2 = db.prepare("SELECT triage_json, significance FROM items WHERE canonical_key='telex:2'").get();
    assert.match(r2.triage_json, /valós/); assert.equal(r2.significance, "FONTOS");

    // idempotens: második futtatás 0 sort érint
    assert.equal(resetStuckMissingVerdicts(db), 0, "idempotens — nullázás után nincs mit visszaállítani");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});
