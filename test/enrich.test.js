import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertItems, applyTriage } from "../src/state/db.js";
import { enrichWithTriage } from "../src/enrich.js";

const PF = { keywords: ["párt", "infláció"], exclude_patterns: ["sport"] };

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-enrich-"));
  return { db: openDb(join(dir, "monitor.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// report-tétel alak (finalizeFreshness kimenete): mezők snake_case-ben
function reportItems() {
  return [
    { canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "Új pártpreferencia-kutatás", freshness: "UJ_24H", triage_json: null, significance: null, relevant: null },
    { canonical_key: "eurostat:1", source_id: "eurostat", kind: "hivatalos_adat", title: "APRO_MK - Dataset: updated data", freshness: "UJ_24H", triage_json: null, significance: null, relevant: null },
    { canonical_key: "telex:2", source_id: "telex", kind: "sajto", title: "Sport: focimeccs", freshness: "UJ_24H", triage_json: null, significance: null, relevant: null },
  ];
}

test("enrich: triázs + prefilter + szintézis + KIEMELT-szám (nem degradált)", async () => {
  const { db, cleanup } = tempDb();
  try {
    upsertItems(db, reportItems().map((i) => ({ canonicalKey: i.canonical_key, sourceId: i.source_id, kind: i.kind, title: i.title, url: "u", publishedAt: null })), { seenAt: "2026-07-22T06:00:00Z" });

    const completeFn = async (role, prompt, { log }) => {
      log?.push({ role, provider: "gemini", status: "OK" });
      if (role === "triage") {
        // csak a telex:1 megy LLM-be (eurostat DROP kódból, telex:2 sport DROP)
        assert.match(prompt, /pártpreferencia/);
        assert.ok(!prompt.includes("APRO_MK") && !prompt.includes("focimeccs"));
        return { data: [{ id: 1, relevant: true, significance: "KIEMELT", kind: "kutatas", reason: "friss kutatás" }], provider: "gemini", model: "gemini-2.5-flash" };
      }
      return { text: "Ma friss pártpreferencia-kutatás jelent meg.", provider: "anthropic", model: "claude-sonnet-5" };
    };

    const providersUsed = [];
    const items = reportItems();
    const r = await enrichWithTriage({ db, items, completeFn, prefilterCfg: PF, providersUsed });

    assert.equal(r.triageDegraded, false);
    assert.equal(r.kiemeltCount, 1);
    assert.match(r.synthesisText, /pártpreferencia/);

    const byKey = Object.fromEntries(r.items.map((i) => [i.canonical_key, i]));
    assert.equal(byKey["telex:1"].relevant, 1);
    assert.equal(byKey["telex:1"].significance, "KIEMELT");
    assert.equal(byKey["eurostat:1"].relevant, 0); // prefilter DROP
    assert.equal(byKey["telex:2"].relevant, 0); // prefilter DROP

    // DB-be is beíródott
    const dbRow = db.prepare("SELECT significance, relevant FROM items WHERE canonical_key='telex:1'").get();
    assert.equal(dbRow.significance, "KIEMELT");
    assert.equal(dbRow.relevant, 1);

    // providers_used naplózva
    assert.ok(providersUsed.some((e) => e.status === "OK"));
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("enrich: minden provider kiesik → degraded, nincs szintézis, tételek megmaradnak", async () => {
  const { db, cleanup } = tempDb();
  try {
    upsertItems(db, [{ canonicalKey: "telex:1", sourceId: "telex", kind: "sajto", title: "pártvita", url: "u", publishedAt: null }], { seenAt: "2026-07-22T06:00:00Z" });
    const completeFn = async () => null;
    const providersUsed = [];
    const r = await enrichWithTriage({
      db,
      items: [{ canonical_key: "telex:1", source_id: "telex", kind: "sajto", title: "pártvita", freshness: "UJ_24H", triage_json: null, significance: null, relevant: null }],
      completeFn, prefilterCfg: PF, providersUsed,
    });
    assert.equal(r.triageDegraded, true);
    assert.equal(r.synthesisText, null);
    assert.equal(r.items.length, 1); // adat nem vész el
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("enrich: örökölt FONTOS-os eurostat dataset-tétel felülíródik relevant=0-ra (kód-DROP autoritatív)", async () => {
  const { db, cleanup } = tempDb();
  try {
    // korábbi (fix előtti) futás: a tétel triázsolt, FONTOS-t kapott
    upsertItems(db, [{ canonicalKey: "eurostat:ei", sourceId: "eurostat", kind: "hivatalos_adat", title: 'EI_ISBR_M - "Dataset: updated data"', url: "u", publishedAt: null }], { seenAt: "2026-07-22T09:38:00Z" });
    applyTriage(db, new Map([["eurostat:ei", { relevant: true, significance: "FONTOS", kind: "hivatalos_adat", reason: "régi LLM-ítélet (magyar adatot hallucinált)" }]]));

    // a report-tétel a stale állapotot tükrözi (triage_json set → NEM untriázolt jelölt)
    const items = [{ canonical_key: "eurostat:ei", source_id: "eurostat", kind: "hivatalos_adat", title: 'EI_ISBR_M - "Dataset: updated data"', freshness: "UJ_24H", triage_json: '{"relevant":true,"significance":"FONTOS"}', significance: "FONTOS", relevant: 1 }];

    let called = false;
    const completeFn = async () => { called = true; return null; };
    const r = await enrichWithTriage({ db, items, completeFn, prefilterCfg: PF, providersUsed: [] });

    assert.equal(called, false, "nincs új LLM-hívás (nem untriázolt jelölt)");
    // memóriában felülírva
    assert.equal(r.items[0].relevant, 0);
    assert.equal(r.items[0].significance, null);
    // DB-be perzisztálva
    const dbRow = db.prepare("SELECT relevant, significance FROM items WHERE canonical_key='eurostat:ei'").get();
    assert.equal(dbRow.relevant, 0);
    assert.equal(dbRow.significance, null);
    // nem számít KIEMELT-nek
    assert.equal(r.kiemeltCount, 0);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});
