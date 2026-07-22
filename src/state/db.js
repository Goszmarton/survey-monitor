// Állapotréteg — SQLite (beépített node:sqlite, Node 24+). A DB a repóba
// visszacommitolva él (state/monitor.db). Ezen a méreten (pár száz tétel/hét)
// nincs szükség külső adatbázisra.
//
// Determinisztikus, ami determinisztikus lehet: dedup (kanonikus kulcs),
// first_seen_at, frissesség — mind kódban, nem a modell önbevallásában.

import { DatabaseSync } from "node:sqlite";
import { computeFreshness } from "../lib/freshness.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY,
  canonical_key  TEXT UNIQUE NOT NULL,
  source_id      TEXT NOT NULL,
  kind           TEXT,
  title          TEXT,
  url            TEXT,
  press_urls     TEXT,
  published_at   TEXT,
  fieldwork_period TEXT,
  first_seen_at  TEXT NOT NULL,
  freshness      TEXT,
  significance   TEXT,
  triage_json    TEXT,
  audit_json     TEXT,
  revision_of    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_first_seen ON items(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at);

CREATE TABLE IF NOT EXISTS source_checks (
  run_id     TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  status     TEXT NOT NULL,
  detail     TEXT,
  checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_run ON source_checks(run_id);

CREATE TABLE IF NOT EXISTS runs (
  run_id         TEXT PRIMARY KEY,
  started_at     TEXT,
  finished_at    TEXT,
  providers_used TEXT,
  cost_estimate  REAL,
  report_url     TEXT,
  email_status   TEXT
);
`;

/** DB megnyitása/létrehozása; a séma idempotensen alkalmazva. */
export function openDb(path) {
  const db = new DatabaseSync(path);
  // A DB a repóba commitolódik → egyetlen fájl kell, WAL-sidecar (-wal/-shm) nélkül.
  // Egyíró, napi futás: a DELETE journal bőven elég, és tiszta artefaktumot hagy.
  // Kompaktságért később megfontolható időnkénti `db.exec("VACUUM")` (nem F1).
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

/**
 * Tételek beszúrása dedup-pal. Kulcsütközésnél nem ír felül (first_seen stabil).
 * @returns {Array<{canonicalKey:string, isNew:boolean}>}
 */
export function upsertItems(db, items, { seenAt } = {}) {
  const stmt = db.prepare(`
    INSERT INTO items (canonical_key, source_id, kind, title, url, published_at, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO NOTHING
  `);
  const out = [];
  for (const it of items) {
    if (!it.canonicalKey) continue;
    const res = stmt.run(
      it.canonicalKey,
      it.sourceId,
      it.kind ?? null,
      it.title ?? null,
      it.url ?? null,
      it.publishedAt ?? null,
      seenAt,
    );
    out.push({ canonicalKey: it.canonicalKey, isNew: res.changes === 1 });
  }
  return out;
}

export function recordSourceCheck(db, { runId, sourceId, status, detail, checkedAt }) {
  db.prepare(
    "INSERT INTO source_checks (run_id, source_id, status, detail, checked_at) VALUES (?, ?, ?, ?, ?)",
  ).run(runId, sourceId, status, detail ?? null, checkedAt ?? null);
}

export function getSourceChecks(db, runId) {
  return db.prepare("SELECT * FROM source_checks WHERE run_id = ? ORDER BY source_id").all(runId);
}

export function startRun(db, { runId, startedAt }) {
  db.prepare(
    "INSERT INTO runs (run_id, started_at) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET started_at = excluded.started_at",
  ).run(runId, startedAt);
}

export function finishRun(db, { runId, finishedAt, providersUsed, costEstimate, reportUrl, emailStatus }) {
  db.prepare(`
    UPDATE runs SET finished_at = ?, providers_used = ?, cost_estimate = ?, report_url = ?, email_status = ?
    WHERE run_id = ?
  `).run(
    finishedAt ?? null,
    providersUsed == null ? null : JSON.stringify(providersUsed),
    costEstimate ?? null,
    reportUrl ?? null,
    emailStatus ?? null,
    runId,
  );
}

/** A legutóbbi futás kezdete ms-ben (az aktuálisat kizárva), vagy null. */
export function getLastRunStartedAt(db, { excludeRunId } = {}) {
  const row = db
    .prepare("SELECT started_at FROM runs WHERE run_id != ? AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1")
    .get(excludeRunId ?? "");
  return row ? Date.parse(row.started_at) : null;
}

/**
 * Frissesség kiszámítása a futás pillanatában és visszaírása az items.freshness-be,
 * a jelentés-ablakban lévő tételekre. A számított sorokat visszaadja a riporthoz.
 */
export function finalizeFreshness(db, { now, runStartedAt, windowStart }) {
  const rows = db
    .prepare("SELECT * FROM items WHERE first_seen_at >= ? OR published_at >= ? ORDER BY COALESCE(published_at, first_seen_at) DESC")
    .all(new Date(windowStart).toISOString(), new Date(windowStart).toISOString());
  const upd = db.prepare("UPDATE items SET freshness = ? WHERE canonical_key = ?");
  const out = [];
  for (const r of rows) {
    const freshness = computeFreshness({
      publishedAt: r.published_at,
      firstSeenAt: r.first_seen_at,
      now,
      runStartedAt,
    });
    upd.run(freshness, r.canonical_key);
    out.push({ ...r, freshness });
  }
  return out;
}

/** Ebben a futásban először látott tételek száma (first_seen_at == runStart). */
export function countNewInRun(db, { runStartedAt }) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM items WHERE first_seen_at = ?").get(runStartedAt);
  return row.n;
}
