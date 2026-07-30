// Egyszeri, idempotens tisztítás: a korábbi hibából „hiányzó ítélet"-tel beragadt
// tételek triage_json/significance/relevant mezőit nullázza, hogy a normál folyam
// (enrich: !it.triage_json) újra triázsra küldje őket. KÉZI migráció — a commitolt
// state/monitor.db-t csak jóváhagyással érinti.
//
// Használat:  node scripts/reset-stuck-verdicts.mjs [db-útvonal]
//   alap db-útvonal: state/monitor.db
//
// FONTOS (időzítés): a visszaállított tételeket a finalizeFreshness 14 napos ablaka
// tartja triázs-jelöltként. Ha a migráció után NEM fut hamarosan egy valódi futás,
// a régi keltezésű tételek kicsúsznak az ablakból, és nullázva, de újratriázs nélkül
// maradnak (halott sorok). Ezért a migráció UTÁN futtass egy valódi futást (npm run run,
// megfelelő API-kulcsokkal), vagy indíts egy workflow_dispatch-ot.

import { openDb, resetStuckMissingVerdicts } from "../src/state/db.js";

const dbPath = process.argv[2] ?? "state/monitor.db";
const db = openDb(dbPath);

// Diagnosztika a nullázás ELŐTT: hány ragadt, és mennyi esik a 14 napos ablakba.
const WINDOW_DAYS = 14;
const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
const stuck = db.prepare("SELECT COUNT(*) n FROM items WHERE triage_json LIKE '%hiányzó ítélet%'").get().n;
const inWindow = db.prepare(
  "SELECT COUNT(*) n FROM items WHERE triage_json LIKE '%hiányzó ítélet%' AND (first_seen_at >= ? OR published_at >= ?)",
).get(windowStart, windowStart).n;

const changed = resetStuckMissingVerdicts(db);
db.close();

console.log(`Ragadt tétel a nullázás előtt: ${stuck}`);
console.log(`Visszaállítva (triage_json/significance/relevant = NULL): ${changed}`);
console.log(`Ebből a 14 napos ablakon BELÜL (tényleges újratriázs a köv. futásban): ${inWindow}`);
console.log(`Ablakon KÍVÜL (a köv. futás előtt kicsúszhat): ${changed - inWindow}`);
if (changed > 0) console.log("⚠️  Futtass egy valódi futást hamarosan, különben az ablakon kívüliek nem triázsolódnak újra.");
