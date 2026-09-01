// Egyszeri, idempotens migráció: a korábbi (2026-09-01 előtti) hibából RELATÍV url-lel tárolt
// tételek url-jét abszolúttá teszi a forrás feed-jéhez oldva. KÉZI migráció — a commitolt
// state/monitor.db-t csak jóváhagyással érinti (CLAUDE.md 3+6).
//
// Gyökér-ok: sok feed (pl. TK ELTE szoc/jog/kisebbség) RELATÍV <link>-et ad ("/hirek/…"),
// amit a régi parseFeed nyersen tárolt; a jelentést más hostról (github.io / napihir tükör)
// szolgáljuk ki → a relatív url oda oldódik fel → 404. A KÓDFIX (rss.js absolutizeUrl) az ÚJ
// tételeket már abszolútként tárolja; ez a script a MÁR benne lévő relatív sorokat rendezi.
//
// FONTOS: CSAK az url-t módosítja; a canonical_key (guid ?? url alapú) VÁLTOZATLAN → nincs
// dedup-elcsúszás. CSAK a root-relatív ("/…") url-t; a tel:/mailto:/egyéb sémát NEM (az külön hiba).
//
// Használat:  node scripts/absolutize-relative-urls.mjs [db-útvonal]
//   alap db-útvonal: state/monitor.db

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const dbPath = process.argv[2] ?? "state/monitor.db";
const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const feedById = Object.fromEntries(sources.map((s) => [s.id, s.feed || s.list_url || null]));

const db = new DatabaseSync(dbPath);

const rows = db.prepare("SELECT id, source_id, url, canonical_key FROM items WHERE url LIKE '/%'").all();
const upd = db.prepare("UPDATE items SET url = ? WHERE id = ? AND url = ?");

let changed = 0, skipped = 0;
const bySrc = {};
for (const r of rows) {
  const base = feedById[r.source_id];
  if (!base) { console.log(`⚠️  ${r.source_id}: nincs feed/base a configban — KIHAGYVA (${r.url})`); skipped++; continue; }
  let abs;
  try { abs = new URL(r.url, base).href; } catch { console.log(`⚠️  ${r.source_id}: URL-hiba, kihagyva (${r.url})`); skipped++; continue; }
  if (abs === r.url) continue; // idempotens: már abszolút
  const res = upd.run(abs, r.id, r.url);
  changed += res.changes;
  bySrc[r.source_id] = (bySrc[r.source_id] || 0) + res.changes;
}

const remaining = db.prepare("SELECT COUNT(*) n FROM items WHERE url LIKE '/%'").get().n;
db.close();

console.log(`Jelölt (relatív, url LIKE '/%'): ${rows.length}`);
console.log(`Abszolúttá téve: ${changed}  ${JSON.stringify(bySrc)}`);
if (skipped) console.log(`Kihagyva (nincs base / URL-hiba): ${skipped}`);
console.log(`Maradó relatív url a migráció után: ${remaining} (idempotens → 0 várt, ha volt base mindhez)`);
