// Europe Elects (ASAPOP HU-widget) — determinista B-forrás (§7 (b)-döntés). A magyar
// pártpreferencia-aggregátum tiszta HTML-<table>-ként érhető el a GCS-widgetről; a SZÁMOK
// bájtról bájtra a forrástáblából, kód-oldali parse-szal jönnek — LLM-et SOSEM érintenek
// (ugyanaz a garancia, amit a pew-nél grounding-verifikációval építünk, itt ingyen). Az
// LLM CSAK a MÁR RÖGZÍTETT számokra ad jelentőség-címkét (E2), a beemelés determinista.
//
// FAIL-CLOSED validáció: a beemelés CSAK akkor enged tételt, ha MINDEN guard teljesül;
// bármelyik bukása → a forrás az adott futásban KIMARAD, látható naplósorral
// (SKIPPED_VALIDATION) — nem néma rossz adat, nem néma eldobás (CLAUDE.md 1./2.).
//
// STÁTUSZ (E1): a parser + validátor + adapter KÉSZ, de a forrás MÉG NEM aktív (sources.json:
// europeelects kaszt=B, NEM_AKTIVALT). Az aktiválás (E2) külön, levél-ható lépés.

import { httpGet, describeError, noNewItemsDetail, DEFAULT_TIMEOUT_MS } from "./http.js";

const EXPECTED_HEAD = ["Fieldwork Period", "Polling Firm", "Commissioner(s)", "Sample Size"];
const FIXED_COLS = EXPECTED_HEAD.length; // az első 4 fix oszlop; utána a párt-oszlopok
const PCT_SUM_MIN = 90, PCT_SUM_MAX = 110;   // ~100, tűrve a kerekítést + egyéb/bizonytalan
const PCT_MIN = 0, PCT_MAX = 100;
const SAMPLE_MIN = 300, SAMPLE_MAX = 5000;
const DATE_MIN_YEAR = 2000;
const FUTURE_SLACK_MS = 30 * 24 * 3600 * 1000; // a fieldwork-vég legfeljebb ~1 hónap a jövőben

const stripTags = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const cells = (rowHtml) => [...rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => stripTags(m[1]));

// "69%" → 69 ; "5.9%" → 5.9 ; "—"/"-"/"–"/"" → null (HIÁNYZÓ, nem 0). Érvénytelen token → NaN
// (a range-guard elkapja) — így egy formátumváltozás nem csúszik be némán 0-ként.
function parsePct(raw) {
  const s = String(raw).replace("%", "").trim();
  if (s === "" || s === "—" || s === "-" || s === "–") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** ASAPOP HTML-tábla → { header: string[], polls: Poll[] }. Tisztán determinista, LLM nélkül. */
export function parseEuropeElects(html) {
  const thead = (html.match(/<thead>([\s\S]*?)<\/thead>/i) ?? [])[1] ?? "";
  const headerRow = (thead.match(/<tr>([\s\S]*?)<\/tr>/i) ?? [])[1] ?? "";
  const header = cells(headerRow);
  const partyNames = header.slice(FIXED_COLS);

  const tbody = (html.match(/<tbody>([\s\S]*?)<\/tbody>/i) ?? [])[1] ?? "";
  const polls = [];
  for (const m of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const c = cells(m[1]);
    if (c.length === 0) continue;
    const [raw, pollingFirm, commissioner, sampleRaw, ...partyCells] = c;
    // A fieldwork "start – end": en-dash (U+2013) az elválasztó; az ISO-dátumok ASCII '-'-ei
    // érintetlenek, ezért az en-dash-en darabolunk, nem a hyphenen. EGYDÁTUMOS fieldwork (nincs
    // en-dash, pl. Europion "2026-08-11" egynapos poll) LEGITIM → end := start (08-21 éles eset:
    // a korábbi end=null a date-guardon az EGÉSZ forrást eldobta, pont az egyetlen friss pollt).
    const [start, endRaw] = raw.split("–").map((s) => s.trim());
    const end = endRaw ?? start;
    const sampleSize = /^\d+$/.test(sampleRaw) ? Number(sampleRaw) : NaN;
    const parties = partyNames.map((name, i) => ({ name, pct: partyCells[i] === undefined ? null : parsePct(partyCells[i]) }));
    polls.push({
      fieldwork: { start: start ?? null, end: end ?? null, raw },
      pollingFirm,
      commissioner: commissioner === "—" ? null : commissioner,
      sampleSize, parties,
    });
  }
  return { header, polls };
}

const fail = (guard, detail) => ({ ok: false, guard, detail });

/**
 * FAIL-CLOSED determinista validátor (§7 (b) 6 guardja). A guardok sorrendje rögzített:
 * fejléc → sor-sanity → poll-onként (mintaméret → dátum → tartomány → %-összeg).
 * @returns {{ok:true}|{ok:false, guard:string, detail:string}}
 */
export function validateEuropeElects({ header, polls }, { now = Date.now() } = {}) {
  // 1. fejléc/oszlop-assert: a 4 fix oszlop pontos neve+pozíciója + legalább 1 párt-oszlop.
  for (let i = 0; i < FIXED_COLS; i++) {
    if (header[i] !== EXPECTED_HEAD[i]) return fail("header", `várt "${EXPECTED_HEAD[i]}" a(z) ${i}. oszlopban, kapott "${header[i] ?? ""}"`);
  }
  if (header.length <= FIXED_COLS) return fail("header", "nincs párt-oszlop a fejlécben");

  // 2. sor-sanity: ≥1 poll (nem üres/megváltozott shell).
  if (polls.length < 1) return fail("rows", "nincs poll-sor a táblában");

  const futureLimit = now + FUTURE_SLACK_MS;
  for (const p of polls) {
    // 3. mintaméret-plauzibilitás (elkapja az oszlop-eltolást).
    if (!Number.isFinite(p.sampleSize) || p.sampleSize < SAMPLE_MIN || p.sampleSize > SAMPLE_MAX)
      return fail("sample_size", `${p.pollingFirm}: mintaméret ${p.sampleSize} a [${SAMPLE_MIN},${SAMPLE_MAX}] sávon kívül`);

    // 4. dátum-plauzibilitás: a fieldwork vége parse-olható és józan ablakban (nem 1900, nem messze jövő).
    const t = Date.parse(p.fieldwork.end);
    if (Number.isNaN(t) || new Date(t).getUTCFullYear() < DATE_MIN_YEAR || t > futureLimit)
      return fail("date", `${p.pollingFirm}: implauzibilis fieldwork-vég "${p.fieldwork.end}"`);

    // 5. érték-tartomány: minden JELEN LÉVŐ párt-% ∈ [0,100] (a null=hiányzó kimarad).
    for (const pt of p.parties) {
      if (pt.pct == null) continue;
      if (!Number.isFinite(pt.pct) || pt.pct < PCT_MIN || pt.pct > PCT_MAX)
        return fail("range", `${p.pollingFirm}: ${pt.name}=${pt.pct} a [${PCT_MIN},${PCT_MAX}] tartományon kívül`);
    }

    // 6. %-összeg sanity (~100). Elkapja az oszlop-eltolást, tizedes-hibát (0.61 vs 61), rossz párthoz kötést.
    const sum = p.parties.reduce((a, pt) => a + (pt.pct ?? 0), 0);
    if (sum < PCT_SUM_MIN || sum > PCT_SUM_MAX)
      return fail("pct_sum", `${p.pollingFirm}: párt-%-összeg ${sum.toFixed(1)} a [${PCT_SUM_MIN},${PCT_SUM_MAX}] sávon kívül`);
  }
  return { ok: true };
}

// Egy poll → gyűjtött tétel. A strukturált poll a tételen marad (poll), a data_backed eleve true
// (determinista beemelés — E2-ben a triázs ezt nem bírálja felül, csak jelentőséget címkéz).
function pollToItem(poll, source) {
  const named = poll.parties.filter((p) => p.pct != null);
  const summary = named.map((p) => `${p.name} ${p.pct}%`).join(", ");
  return {
    guid: `europeelects:${poll.pollingFirm}:${poll.fieldwork.start}:${poll.fieldwork.end}`,
    title: `Europe Elects – ${poll.pollingFirm} pártpreferencia (${poll.fieldwork.raw}): ${summary}`,
    url: source.list_url,
    publishedAt: `${poll.fieldwork.end}T00:00:00.000Z`,
    dateOnly: true, // NAP-granularitás — a fieldwork vége nap-pontos
    summary,
    dataBacked: true,
    poll,
  };
}

// since-szűrés a fieldwork vége szerint, NAP-granularitással (dateOnly — mint a htmllist-nél):
// az előző futás napján lezárult kutatás nem eshet ki a ~perces since-eltolás miatt.
function filterSince(items, since) {
  const sinceMs = Number(since) || 0;
  if (!sinceMs) return items;
  const s = new Date(sinceMs);
  const sinceDayMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return items.filter((it) => {
    const t = Date.parse(it.publishedAt);
    return Number.isNaN(t) ? true : t >= sinceDayMs;
  });
}

/**
 * @param {{id:string,name?:string,list_url:string}} source
 * @param {{since?:number, fetchImpl?:function, timeoutMs?:number, now?:number}} opts
 * @returns {Promise<{items:Array, check:{status:string, detail:string, url:string}}>}
 */
export async function fetchNew(source, { since = 0, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now() } = {}) {
  const url = source.list_url;
  try {
    const res = await httpGet(url, { fetchImpl, timeoutMs });
    if (!res.ok) return { items: [], check: { status: "HIBA", detail: `HTTP ${res.status}`, url } };
    const html = await res.text();
    const parsed = parseEuropeElects(html);
    const v = validateEuropeElects(parsed, { now });
    if (!v.ok) {
      return { items: [], check: { status: "SKIPPED_VALIDATION", detail: `${v.guard}: ${v.detail}`, url } };
    }
    const items = parsed.polls.map((p) => pollToItem(p, source));
    const fresh = filterSince(items, since);
    if (fresh.length === 0) return { items: [], check: { status: "OK_NINCS_UJ", detail: noNewItemsDetail(items), url } };
    return { items: fresh, check: { status: "OK_UJ", detail: `ASAPOP-tábla: ${fresh.length} friss poll (${items.length} a táblában)`, url } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url } };
  }
}
