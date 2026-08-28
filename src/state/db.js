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
  report_url     TEXT,
  email_status   TEXT
);
-- Megj.: a cost_estimate oszlop kikerült (token-számlálás nélkül üresen maradna;
-- ARCHITEKTURA.md 7. már nem ígéri). A régi, commitolt DB-ben fizikailag még ott
-- lehet egy inert cost_estimate oszlop — a kód nem írja/olvassa; eldobása külön,
-- destruktív migráció (VACUUM/rebuild) lenne, nem F2.

-- Append-only futásnapló. A runs.run_id a dátum (PK) → egy aznapi újrafutás
-- felülírja az előző providers_used-et; napi egy futásnál ez rendben, de
-- fejlesztés/pótfutás közben bizonyítékot törölne. A run_attempts MINDEN futást
-- megőriz, autoincrement kulccsal — a runs marad a napi „legutolsó állapot"
-- összegzés (getLastRunStartedAt is erre épül). A startRun beszúr (finished_at
-- NULL), a finishRun UPDATE-el id szerint: egy elhasalt futás finished_at=NULL
-- sort hagy — ez maga a jelzés. (cost_estimate szándékosan NINCS itt: token-
-- számlálás nélkül üres maradna, lásd ARCHITEKTURA.md 7. — nem visszük tovább a hiányt.)
CREATE TABLE IF NOT EXISTS run_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT,
  providers_used TEXT,
  report_url     TEXT,
  email_status   TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_run ON run_attempts(run_id);
`;

/** Oszlop hozzáadása, ha még nincs (idempotens migráció commitolt DB-hez). */
function ensureColumn(db, table, name, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
}

/** DB megnyitása/létrehozása; a séma idempotensen alkalmazva. */
export function openDb(path) {
  const db = new DatabaseSync(path);
  // A DB a repóba commitolódik → egyetlen fájl kell, WAL-sidecar (-wal/-shm) nélkül.
  // Egyíró, napi futás: a DELETE journal bőven elég, és tiszta artefaktumot hagy.
  // Kompaktságért később megfontolható időnkénti `db.exec("VACUUM")` (nem F1).
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // F2 migráció: a triázs relevancia-jelzője (0/1). A significance/triage_json már a sémában van.
  ensureColumn(db, "items", "relevant", "INTEGER");
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
  // A run_id a DÁTUM, a source_checks append-only → egy aznapi újrafutás (kézi dispatch +
  // ütemezett, vagy bukott+újra) forrásonként több sort ír. Forrásonként a LEGUTÓBBI beírást
  // adjuk (MAX(rowid) = utolsó rögzítés) → „az adott nap állapota", nincs duplikált forrás-sor
  // a jelentésben. (A korábbi append-sorok megmaradnak: audit-nyom, nincs adatvesztés.)
  return db.prepare(
    `SELECT * FROM source_checks
       WHERE rowid IN (SELECT MAX(rowid) FROM source_checks WHERE run_id = ? GROUP BY source_id)
       ORDER BY source_id`,
  ).all(runId);
}

/**
 * Futás indítása. Frissíti a runs napi összegzőt, ÉS beszúr egy append-only
 * run_attempts sort (finished_at NULL). Visszaadja az attempt id-t, amit a
 * finishRun UPDATE-hez használ — így a started_at nem a runs-ból olvasódik
 * vissza (amit egy második startRun felülírhat), hanem közvetlen.
 * @returns {number} attemptId
 */
export function startRun(db, { runId, startedAt }) {
  db.prepare(
    "INSERT INTO runs (run_id, started_at) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET started_at = excluded.started_at",
  ).run(runId, startedAt);
  const res = db.prepare("INSERT INTO run_attempts (run_id, started_at) VALUES (?, ?)").run(runId, startedAt);
  return Number(res.lastInsertRowid);
}

export function finishRun(db, { runId, attemptId, finishedAt, providersUsed, reportUrl, emailStatus }) {
  // Az append-only sor azonosítása ELŐBB: attemptId híján (régi hívó) hangos
  // fallback + WARN a naplóba — hogy a WARN belekerüljön a lentebb serializált
  // providers_used-be (mindkét UPDATE ugyanazt a naplót írja). A stringify ezért a
  // fallback UTÁN történik; különben a WARN elpárologna (CLAUDE.md 2.). NORMÁL
  // futásban ez az ág nem fut (run.js átadja az attemptId-t), épp ezért hangos.
  let id = attemptId;
  if (id == null) {
    console.warn("finishRun: hiányzó attemptId — a runId legutolsó nyitott run_attempts sorát zárom (fallback). Ellenőrizd a hívót.");
    if (Array.isArray(providersUsed)) providersUsed.push({ role: "run", status: "WARN", detail: "finishRun attemptId nélkül hívva (fallback)" });
    id = db.prepare(
      "SELECT id FROM run_attempts WHERE run_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1",
    ).get(runId)?.id;
  }

  const providersJson = providersUsed == null ? null : JSON.stringify(providersUsed);
  db.prepare(`
    UPDATE runs SET finished_at = ?, providers_used = ?, report_url = ?, email_status = ?
    WHERE run_id = ?
  `).run(finishedAt ?? null, providersJson, reportUrl ?? null, emailStatus ?? null, runId);

  if (id != null) {
    db.prepare(
      "UPDATE run_attempts SET finished_at = ?, providers_used = ?, report_url = ?, email_status = ? WHERE id = ?",
    ).run(finishedAt ?? null, providersJson, reportUrl ?? null, emailStatus ?? null, id);
  }
}

/**
 * Idempotencia-őr jele: LEZÁRULT-e MÁR a mai futás (finished_at kitöltve)?
 * A napi trigger duplázódás ellen (szerver-curl PRIMARY + GitHub-cron BACKUP): ha ma már
 * volt sikeres, lezárt futás, a második invokáció no-opol (nincs dupla levél — CLAUDE.md 2).
 * FONTOS: a workflow a commit-lépésben CSAK sikeres run.js UTÁN commitolja a DB-t, így a
 * commitolt DB-ben egy mai sor MINDIG lezárt (finished_at≠NULL); egy elhasalt primary nem
 * commitol → nincs mai sor → a backup dolgozik. A finished_at-re (nem a puszta sor-létre)
 * szűrünk, hogy egy startRun-olt-de-le-nem-zárt sor NE blokkolja a backupot.
 */
export function hasCompletedRun(db, runId) {
  const row = db.prepare("SELECT 1 FROM runs WHERE run_id = ? AND finished_at IS NOT NULL").get(runId);
  return row != null;
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

/**
 * Egyszeri, idempotens tisztítás: a korábbi hibából „hiányzó ítélet"-tel beragadt
 * tételeknél nullázza a triage_json/significance/relevant mezőket, hogy a normál
 * folyam (enrich: !it.triage_json) újra triázsra küldje őket. A reason-szöveg
 * ("hiányzó ítélet") azonosítja őket. Idempotens: nullázás után a LIKE 0 sort
 * talál, ismételt futtatás no-op. NEM az openDb auto-útján fut — külön, kézzel
 * indított migráció (scripts/reset-stuck-verdicts.mjs), a commitolt DB-t csak
 * jóváhagyással érinti.
 * @returns {number} az érintett (visszaállított) tételek száma
 */
export function resetStuckMissingVerdicts(db) {
  const res = db
    .prepare("UPDATE items SET triage_json = NULL, significance = NULL, relevant = NULL WHERE triage_json LIKE '%hiányzó ítélet%'")
    .run();
  return res.changes;
}

/** Triázs-verdiktek visszaírása (F2): significance, relevant, triage_json.
 * Hiányzó ítéletet (v.missing — bukott batch) NEM perzisztálunk: a sor érintetlen
 * marad (triage_json NULL), így a következő futás újra triázsra küldi. Így a komment
 * eredeti szándéka (újrapróbálás) tényleg teljesül, nem ragad be a tétel. */
export function applyTriage(db, verdicts) {
  const stmt = db.prepare("UPDATE items SET significance = ?, relevant = ?, triage_json = ? WHERE canonical_key = ?");
  for (const [key, v] of verdicts) {
    if (v.missing) continue; // hiányzó ítélet → ne írjuk felül, maradjon újrapróbálható
    stmt.run(v.significance ?? null, v.relevant ? 1 : 0, JSON.stringify(v), key);
  }
}
