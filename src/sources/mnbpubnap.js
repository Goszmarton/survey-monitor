// MNB Statisztika — Publikációs naptár. Az MNB hivatalos statisztikai kiadás-naptára
// (fizetési mérleg, infláció, lakásárindex, kamat- és értékpapír-adatok stb.). A napi-jelentés
// szempontjából a MEGJELENT kiadványok az események: egy statisztikai közlemény akkor „új", ha a
// tényleges megjelenése (lastUpdateDate) az előző futás óta történt.
//
// ADATFORRÁS (kód-mérésből, CLAUDE.md 4): a /pubnap oldal Vue-SPA, a naptárt NEM a szerver-HTML
// hordozza, hanem egy STATIKUS JSON: /sw/content/<MID-utolsó-betű>/<MID>_mnbStatPortalPublicationCalendars.json
// (a portal.js `getStatPortalPublicationCalendar`-ja tölti). A <MID> az oldal `documentMID`-je. Az
// adapter a HTML-ből NYERI KI a MID-et (nem hardcode-olt URL) → egy MID-változás nem töri el némán.
// A számok/címek KÓD-oldali parse-szal, bájtról bájtra a forrásból jönnek — LLM SOSEM érinti őket
// (ugyanaz a garancia, mint az europeelects/eurobarometer adaptereknél); az LLM csak jelentőséget címkéz.
//
// FAIL-CLOSED: a beemelés CSAK ép szerkezetnél enged tételt; bármely guard bukása → a forrás az
// adott futásban SKIPPED_VALIDATION (nem néma rossz adat, nem néma eldobás — CLAUDE.md 1./2.).

import { httpGet, describeError, noNewItemsDetail, DEFAULT_TIMEOUT_MS } from "./http.js";

// A pubnap-oldal `documentMID`-je (a naptár-JSON útját ez azonosítja).
export function extractDocumentMID(html) {
  const m = String(html ?? "").match(/documentMID\s*=\s*['"]([A-Za-z0-9_-]+)['"]/);
  return m ? m[1] : null;
}

// A statikus naptár-JSON útja a MID-ből (a portal.js konstrukciója: az utolsó betű a shard).
export function calendarJsonPath(mid) {
  return `/sw/content/${mid.slice(-1)}/${mid}_mnbStatPortalPublicationCalendars.json`;
}

// "2026.09.07. 08:30" → { day: "2026-09-07", ms }. NAP-granularitás (mint a htmllist/europeelects):
// a since-szűrés napra hasonlít, hogy a ~perces eltolás ne ejtsen ki egy aznap megjelent kiadványt.
// Érvénytelen/hiányzó → null (a guard elkapja) — így egy formátumváltozás nem csúszik be némán.
export function parseMnbDate(raw) {
  const m = String(raw ?? "").match(/^\s*(\d{4})\.(\d{2})\.(\d{2})\./);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(ms) ? null : { day: `${y}-${mo}-${d}`, ms };
}

const dayFloor = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// Egy naptár-bejegyzés → gyűjtött tétel. A megjelenés dátuma a lastUpdateDate (tényleges kiadás).
// A referencePeriod a címbe kerül (megkülönbözteti az ismétlődő — pl. negyedéves — kiadásokat), a
// guid a url+lastUpdateDate (stabil, kiadásonként egyedi → a dedup-kulcs nem ütközik évről évre).
function calendarToItem(c, listUrl) {
  const date = parseMnbDate(c.lastUpdateDate);
  const ref = (c.referencePeriod ?? "").trim();
  return {
    guid: `mnbpubnap:${c.url}#${c.lastUpdateDate}`,
    title: ref ? `${c.title} (${ref})` : c.title,
    url: new URL(c.url, listUrl).href,
    publishedAt: `${date.day}T00:00:00.000Z`,
    dateOnly: true,
    summary: [c.type, c.frequency, ref].filter(Boolean).join(" · "),
    dataBacked: true,
  };
}

/**
 * A naptár-JSON → { items, skipped }. Determinista, LLM nélkül. Egy bejegyzés KIMARAD (skipped),
 * ha: hiányzik a cím/url, nem parse-olható a lastUpdateDate, VAGY a megjelenés a JÖVŐBEN van
 * (nowMs napjánál későbbi — még nem jelent meg, ütemezett; a naptár ilyet is tartalmaz). A jövő-guard
 * FAIL-CLOSED: nem hazudunk „megjelent" statisztikát, ami még nem került ki.
 */
export function calendarsToItems(calendars, { listUrl, nowMs }) {
  const nowDay = dayFloor(nowMs);
  const items = [];
  let skipped = 0;
  for (const c of calendars) {
    const date = parseMnbDate(c?.lastUpdateDate);
    if (!c?.title || !c?.url || !date) { skipped++; continue; }
    if (date.ms > nowDay) { skipped++; continue; } // jövőbeli (ütemezett) kiadás — még nem jelent meg
    items.push(calendarToItem(c, listUrl));
  }
  return { items, skipped };
}

function filterSince(items, since) {
  const sinceMs = Number(since) || 0;
  if (!sinceMs) return items;
  const sinceDay = dayFloor(sinceMs);
  return items.filter((it) => {
    const t = Date.parse(it.publishedAt);
    return Number.isNaN(t) ? true : t >= sinceDay;
  });
}

/**
 * @param {{id:string,name?:string,list_url:string}} source
 * @param {{since?:number, fetchImpl?:function, timeoutMs?:number, now?:number}} opts
 * @returns {Promise<{items:Array, check:{status:string, detail:string, url:string}}>}
 */
export async function fetchNew(source, { since = 0, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now() } = {}) {
  const listUrl = source.list_url;
  try {
    const page = await httpGet(listUrl, { fetchImpl, timeoutMs });
    if (!page.ok) return { items: [], check: { status: "HIBA", detail: `HTTP ${page.status} (pubnap)`, url: listUrl } };
    const mid = extractDocumentMID(await page.text());
    if (!mid) return { items: [], check: { status: "SKIPPED_VALIDATION", detail: "documentMID nem található a pubnap-oldalon", url: listUrl } };

    const jsonUrl = new URL(calendarJsonPath(mid), listUrl).href;
    const res = await httpGet(jsonUrl, { fetchImpl, timeoutMs });
    if (!res.ok) return { items: [], check: { status: "HIBA", detail: `HTTP ${res.status} (naptár-JSON)`, url: jsonUrl } };

    let data;
    try { data = JSON.parse(await res.text()); }
    catch { return { items: [], check: { status: "SKIPPED_VALIDATION", detail: "naptár-JSON nem értelmezhető", url: jsonUrl } }; }
    if (!Array.isArray(data?.calendars) || data.calendars.length === 0)
      return { items: [], check: { status: "SKIPPED_VALIDATION", detail: "hiányzó/üres calendars tömb", url: jsonUrl } };

    const { items: all, skipped } = calendarsToItems(data.calendars, { listUrl, nowMs: now });
    if (all.length === 0)
      return { items: [], check: { status: "SKIPPED_VALIDATION", detail: `0 érvényes kiadvány (${data.calendars.length} bejegyzés, ${skipped} kihagyva)`, url: jsonUrl } };

    const fresh = filterSince(all, since);
    if (fresh.length === 0)
      return { items: [], check: { status: "OK_NINCS_UJ", detail: noNewItemsDetail(all), url: jsonUrl } };
    return { items: fresh, check: { status: "OK_UJ", detail: `${fresh.length} friss kiadvány (${all.length} megjelent a naptárban, ${skipped} kihagyva)`, url: jsonUrl } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url: listUrl } };
  }
}
