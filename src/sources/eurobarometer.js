// Eurobarometer — determinista B-forrás (§7, B1). A magyar minta strukturált XLSX-ben érhető el,
// PDF-parse és LLM NÉLKÜL. A lánc (mind csupasz GET, Actions-elérhető, 08-16 4/4 ASN-próba):
//   survey/get/latest → survey/get/one?id=X → openDataPublicationUrl (data.europa.eu)
//   → Piveau api/hub/search/datasets/{id} → distributions[] → volumeA.xlsx (webgate) → V oszlop = HU.
// A letöltő-key futásidőben a hub-API-ból jön (nem drótozható). A számok bájtról bájtra a
// XLSX-ből, kód-oldali parse-szal — LLM-et sosem érintenek (grounding ingyen, §2).
//
// STÁTUSZ (B1): a fetch-lánc + XLSX-parser KÉSZ, a forrás MÉG NEM aktív (sources.json:
// eurobarometer NEM_AKTIVALT). Az aktiválás (B2) külön, esemény-vezérelt, levél-ható nap.
//
// XLSX-olvasás saját ZIP+inflate-tel (nincs xlsx-lib a projektben): az XLSX egy ZIP deflate-
// entrykkel, amit a node:zlib inflateRawSync bont; a ZIP-konténert a központi könyvtárból
// (EOCD → central directory) járjuk be — a lokális fejlécek streaming-flagje megbízhatatlan.

import zlib from "node:zlib";
import { httpGet, describeError, DEFAULT_TIMEOUT_MS } from "./http.js";

const API_BASE = "https://europa.eu/eurobarometer/api";
const HUB_BASE = "https://data.europa.eu/api/hub/search";

// ---- 1. lánc-feloldás (tiszta függvények) ----

/** A survey/get/latest lista legfrissebb (első) eleme. */
export function pickLatestSurvey(latestJson) {
  const list = Array.isArray(latestJson) ? latestJson : (latestJson?.result ?? []);
  const s = list[0];
  if (!s) throw new Error("survey/get/latest: üres lista");
  return { id: s.id, reference: s.reference, titleEN: s.titleEN };
}

export function openDataUrlOf(oneJson) {
  const url = oneJson?.openDataPublicationUrl;
  if (!url) throw new Error("survey/get/one: nincs openDataPublicationUrl (survey-függő mező)");
  return url;
}

/** A Piveau dataset-id az openDataPublicationUrl utolsó path-szegmense, kisbetűsítve. */
export function datasetIdFromOpenDataUrl(url) {
  const seg = String(url).replace(/\/+$/, "").split("/").pop() ?? "";
  return seg.toLowerCase();
}

/** A 'volumeA.xlsx' disztribúció letöltő URL-je (access_url) — pontosan a volumeA, nem AA/AP/BP/B/C. */
export function volumeADownloadUrl(datasetJson) {
  const res = datasetJson?.result ?? datasetJson;
  const dists = res?.distributions ?? [];
  for (const d of dists) {
    const title = (d?.title && typeof d.title === "object" ? d.title.en : d?.title) ?? "";
    // A '_volumeA.xlsx' végződés kizárja az AA/AP/AAP/BP variánsokat (azok más suffixszel végződnek).
    if (/_volumeA\.xlsx$/i.test(title)) {
      const au = d.access_url ?? d.download_url;
      const url = Array.isArray(au) ? au[0] : au;
      if (url) return url;
    }
  }
  throw new Error("nincs volumeA.xlsx disztribúció access_url-lel");
}

// ---- 2. orchesztrátor: a teljes lánc (injektálható fetchImpl) ----

async function getJson(url, { fetchImpl, timeoutMs }) {
  const res = await httpGet(url, { fetchImpl, timeoutMs });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return JSON.parse(await res.text());
}

/**
 * Végigjárja a láncot és a volumeA.xlsx bufferét adja.
 * @returns {Promise<{survey:object, datasetId:string, xlsxUrl:string, buffer:Buffer}>}
 */
export async function resolveVolumeA({ fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, apiBase = API_BASE, hubBase = HUB_BASE } = {}) {
  const latest = await getJson(`${apiBase}/survey/get/latest?nb=5`, { fetchImpl, timeoutMs });
  const survey = pickLatestSurvey(latest);
  const one = await getJson(`${apiBase}/survey/get/one?id=${survey.id}`, { fetchImpl, timeoutMs });
  const datasetId = datasetIdFromOpenDataUrl(openDataUrlOf(one));
  const dataset = await getJson(`${hubBase}/datasets/${datasetId}`, { fetchImpl, timeoutMs });
  const xlsxUrl = volumeADownloadUrl(dataset);
  const res = await httpGet(xlsxUrl, { fetchImpl, timeoutMs });
  if (!res.ok) throw Object.assign(new Error(`volumeA letöltés HTTP ${res.status}`), { status: res.status });
  const buffer = await res.bytes();
  return { survey, datasetId, xlsxUrl, buffer };
}

// ---- 3. XLSX (ZIP + worksheet-parse) ----

const EOCD_SIG = 0x06054b50, CDH_SIG = 0x02014b50;

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557); // max ZIP-comment (65535) + EOCD (22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("ZIP: EOCD nem található (nem valós xlsx?)");
}

/** Minimál ZIP-kibontó: name → kibontott Buffer. Deflate (8) és stored (0) entryket kezel. */
export function unzipXlsx(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  const eocd = findEOCD(buf);
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  const out = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== CDH_SIG) throw new Error("ZIP: sérült central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + fnLen);
    // A tényleges adat a lokális fejléc mögött (annak fn/extra hossza külön lehet a CDH-étól).
    const lfnLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lfnLen + lextraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let content;
    if (method === 0) content = Buffer.from(comp);
    else if (method === 8) content = zlib.inflateRawSync(comp);
    else throw new Error(`ZIP: ismeretlen tömörítés (${method}) — ${name}`);
    out.set(name, content);
    p += 46 + fnLen + extraLen + commentLen;
  }
  return out;
}

/** munkalap-név → worksheet-fájl útvonal (workbook.xml sheet-listája + a rels r:id-térkép). */
export function sheetFileMap(workbookXml, relsXml) {
  const rid2target = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/gi)) {
    rid2target.set(m[1], m[2]);
  }
  // A Target attribútum a rels-ben a másik sorrendben is állhat (Target előbb, Id utóbb).
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/gi)) {
    if (!rid2target.has(m[2])) rid2target.set(m[2], m[1]);
  }
  const norm = (t) => "xl/" + t.replace(/^\/xl\//, "").replace(/^\//, "").replace(/^xl\//, "");
  const map = new Map();
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/gi)) {
    const target = rid2target.get(m[2]);
    if (target) map.set(decodeEntities(m[1]), norm(target));
  }
  return map;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Egy worksheet XML → Map<cellRef, érték>. Numerikus cella → number; inline/str → dekódolt szöveg. */
export function parseWorksheet(xml) {
  const cells = new Map();
  for (const m of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = m[1], inner = m[2];
    const ref = (attrs.match(/\br="([A-Z]+\d+)"/) ?? [])[1];
    if (!ref) continue;
    const t = (attrs.match(/\bt="([^"]+)"/) ?? [])[1];
    let val;
    if (t === "inlineStr") {
      val = decodeEntities([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
    } else {
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (!vm) continue; // üres cella
      if (t === "str") val = decodeEntities(vm[1]);
      else { const num = Number(vm[1]); val = Number.isFinite(num) ? num : decodeEntities(vm[1]); }
    }
    cells.set(ref, val);
  }
  return cells;
}

/** Cellahivatkozás → oszlopbetű ("V13" → "V", "AA10" → "AA"). */
export const columnLetter = (ref) => (String(ref).match(/^[A-Z]+/) ?? [""])[0];

/** A megadott országkódot (alap: "HU") tartalmazó cella oszlopbetűje — a magyar bontás kiválasztása. */
export function findCountryColumn(cells, code = "HU") {
  for (const [ref, val] of cells) {
    if (typeof val === "string" && val.trim() === code) return columnLetter(ref);
  }
  return null;
}

// ---- 4. item-shape + fetchNew (B2) ----
//
// DÖNTÉS (2026-08-20, mérés a valós volumeA.xlsx 78 munkalapján): egy TÉTEL = egy TARTALMI
// attitűd-kérdés HU-eredménye. A hullám ~35 QA* kérdést + demográfiát tartalmaz; az utóbbi
// (D11A kor, D8 iskola, foglalkozás…) mintakompozíció, NEM közvélemény → kimarad. Ez az
// europeelects pollToItem mintája egy szinttel lejjebb: ott EGY poll az összes pártot egy
// tétel summary-jába csomagolja; itt EGY kérdés az összes válaszopcióját. A számok bájtról
// bájtra az XLSX-ből (dataBacked=true), az LLM csak jelentőséget címkéz. Kvartális kadencia +
// since-szűrés → ~36 tétel/hullám, nem árasztás. STÁTUSZ: a forrás MÉG NEM aktív, a
// collect.js ADAPTERS registryjébe NINCS bekötve; az aktiválás (B2) külön, levél-ható nap.

const SUBSTANTIVE_ALLOW = new Set(["D78"]); // EU-imázs: attitűd, nem demográfia
const EB_SAMPLE_MIN = 300, EB_SAMPLE_MAX = 5000;
const PCT_LO = 0, PCT_HI = 1;

/** Content B2 (wave) + B3 fieldwork ("9/4 - 4/5/2026") → { wave, fieldworkEnd:ISO-nap, raw }. */
export function parseFieldwork(content) {
  const wave = content.get("B2") != null ? String(content.get("B2")) : null;
  const raw = content.get("B3") != null ? String(content.get("B3")) : "";
  // A fieldwork VÉGE az utolsó "-" utáni "D/M/YYYY" token (a kezdet év nélküli D/M).
  const tail = raw.split(/[-–]/).pop()?.trim() ?? "";
  const m = tail.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const fieldworkEnd = m ? `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` : null;
  return { wave, fieldworkEnd, raw };
}

/** Content C-oszlopa → Map<sheet-kód, angol kérdésszöveg>. A kód a "KÓD. szöveg" prefix,
 * a Content pontot használ ott, ahol a munkalapnév aláhúzást (QA10.1 ↔ QA10_1). */
export function questionLabelsEN(content, sheetNames) {
  const sheetSet = new Set(sheetNames);
  const byRow = groupByRow(content);
  const labels = new Map();
  for (const r of Object.keys(byRow).map(Number).sort((a, b) => a - b)) {
    const c = byRow[r].C;
    if (typeof c !== "string") continue;
    const idx = c.search(/\.\s/);
    if (idx < 0) continue;
    const code = c.slice(0, idx).replace(/\./g, "_").trim();
    if (!sheetSet.has(code)) continue;
    labels.set(code, c.slice(idx + 1).trim());
  }
  return labels;
}

/** cellák → { row → { col → val } }. */
function groupByRow(cells) {
  const byRow = {};
  for (const [ref, val] of cells) {
    const col = columnLetter(ref);
    const row = Number(ref.slice(col.length));
    (byRow[row] ??= {})[col] = val;
  }
  return byRow;
}

const leftmostText = (row) => {
  for (const col of ["A", "B", "C"]) {
    if (typeof row[col] === "string" && row[col].trim() !== "") return row[col].trim();
  }
  return null;
};

/**
 * Egy kérdés-munkalap → { N, options }. A HU-oszlopban a sorok count/pct PÁROKban állnak:
 * a count-sor egész (>1) francia címkével, a pct-sor tört ∈[0,1] (v. hiányzó "-") ANGOL
 * címkével. Az opció címkéje az ANGOL (pct-sor); a pct a tört; a count a fölötte lévő egész.
 * A "Total 'X'" részösszeg-sorok isSubtotal=true (a summary kihagyja őket). Hiányzó % → null
 * (nem 0 — a formátumváltozás nem csúszhat be némán).
 */
export function parseQuestionSheet(cells) {
  const hu = findCountryColumn(cells, "HU");
  if (!hu) return { N: null, options: [] };
  const byRow = groupByRow(cells);
  const rows = Object.keys(byRow).map(Number).sort((a, b) => a - b);
  const codeRow = rows.find((r) => byRow[r][hu] === "HU");
  if (codeRow == null) return { N: null, options: [] };
  const nVal = byRow[codeRow + 1]?.[hu];
  const N = typeof nVal === "number" && Number.isInteger(nVal) ? nVal : null;

  // A Total-sor (codeRow+1) alatt a válaszsorok count/pct PÁROKban: count-sor (francia címke,
  // egész) majd pct-sor (angol címke, tört v. "-"). POZICIONÁLISAN párosítunk — a value-küszöb
  // törékeny lenne (a count===1 összeütközne a pct=1.0=100%-kal). A címke a pct-sorról (angol).
  // Az ELSŐ "Total 'X'" recap-sortól kezdve minden opció isSubtotal: a recap-blokk (Total
  // Positive / ismételt Neutral / Total Negative) csak aggregátum, nem új bázis-opció.
  const labeled = rows.filter((r) => r > codeRow + 1 && leftmostText(byRow[r]) != null);
  const options = [];
  let recap = false;
  for (let i = 0; i + 1 < labeled.length; i += 2) {
    const label = leftmostText(byRow[labeled[i + 1]]); // pct-sor → angol címke
    const cv = byRow[labeled[i]][hu];   // count-sor értéke
    const pv = byRow[labeled[i + 1]][hu]; // pct-sor értéke
    const count = typeof cv === "number" && Number.isInteger(cv) ? cv : null;
    const pct = typeof pv === "number" && pv >= PCT_LO && pv <= PCT_HI ? pv : null;
    if (/^total\b/i.test(label)) recap = true;
    options.push({ label, pct, count, isSubtotal: recap });
  }
  return { N, options };
}

/** Tartalmi (attitűd) kérdés-e: QA-prefix VAGY az allowlist (alap: D78 EU-imázs). Demográfia (D, SD, C, B) kimarad. */
export function isSubstantiveQuestion(code, allow = SUBSTANTIVE_ALLOW) {
  return /^QA/i.test(code) || allow.has(code);
}

/** FAIL-CLOSED kérdés-validátor: N plauzibilis mintaméret ÉS ≥1 érvényes % ∈[0,1]. */
export function validateQuestion({ N, options }) {
  if (!Number.isFinite(N) || N < EB_SAMPLE_MIN || N > EB_SAMPLE_MAX)
    return { ok: false, guard: "sample_size", detail: `N=${N} a [${EB_SAMPLE_MIN},${EB_SAMPLE_MAX}] sávon kívül` };
  const valid = (options ?? []).some((o) => typeof o.pct === "number" && o.pct >= PCT_LO && o.pct <= PCT_HI);
  if (!valid) return { ok: false, guard: "pct", detail: "nincs érvényes % ∈[0,1] opció" };
  return { ok: true };
}

const fmtPct = (pct) => { const n = Math.round(pct * 1000) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); };

// A nyers EB-kérdésszöveg a levélben olvashatatlan (mért medián 137, max 253): tartalmazza a
// teljes válasz-skálát és a survey-adminisztrációs farkot. A rendszer poll-tétel-normája az
// europeelects (mért med 127, max 147); ide állítjuk be. Determinista rövidítés:
//   (1) MÁTRIX-alkérdés: a "::-"/":-" UTÁNI konkrét állítás a lényeg (a preambulum csak a skála);
//   (2) "(OUR COUNTRY)" → "Magyarország" (HU-monitor: ez szó szerint Magyarország);
//   (3) survey-farok levágása (Firstly?/And then?/(MAX. N ANSWERS)/(MULTIPLE ANSWERS POSSIBLE));
//   (4) hossz-cap szó-határon, ellipszissel.
// Ha a maradék ÜRES (pl. a "b" követő-kérdés csak "And then?"), az NEM önálló tétel → a fetchNew
// kihagyja (látható naplósorral, nem néma eldobás — CLAUDE.md 2).
const ARTIFACT_TAIL = /\s*(\(MAX\.?\s*\d+\s*ANSWERS?\.?\)|\(MULTIPLE ANSWERS POSSIBLE\)|Firstly\?|And then\?)\s*$/i;
const QUESTION_CAP = 70;

export function shortenQuestion(questionEN, cap = QUESTION_CAP) {
  let s = String(questionEN ?? "").trim();
  const mi = s.lastIndexOf(":-");
  if (mi >= 0) s = s.slice(mi + 2).trim();
  s = s.replace(/\(OUR COUNTRY\)/gi, "Magyarország");
  let prev;
  do { prev = s; s = s.replace(ARTIFACT_TAIL, "").trim(); } while (s !== prev);
  if (s.length > cap) s = s.slice(0, cap).replace(/\s+\S*$/, "").trim() + "…";
  return s;
}

/**
 * Egy kérdés → gyűjtött tétel (europeelects pollToItem tükre). A strukturált survey a tételen
 * marad; a summary a BÁZIS-opciókból (részösszeg és hiányzó-% nélkül). data_backed eleve true.
 */
const TITLE_MAX = 150;       // cél-címhossz (europeelects-norma: med 127, max 147)
const SUMMARY_FLOOR = 40;    // a summary MINDIG kap legalább ennyi helyet (≥ a plurális opció)

// A summary a bázis-opciókból, pct szerint CSÖKKENŐ (a mód/plurális elöl — headline-first),
// karakter-budgettel vágva. Mivel a számok CSAK a címben perzisztálnak (a collect enriched
// mapping nem viszi tovább a survey-t), a levágott farok LÁTHATÓ "+K" jelzést kap — nem néma
// eldobás (CLAUDE.md 2). Az ≤6-opciós ordinális skálák (pl. D78) beleférnek. [A teljes
// szám-perzisztálás külön séma-lépés, B2/később — ITT csak megjelenítés.]
function buildSummary(base, cap = Infinity) {
  const parts = [...base].sort((a, b) => b.pct - a.pct).map((o) => `${o.label} ${fmtPct(o.pct)}%`);
  const out = [];
  let len = 0;
  for (const p of parts) {
    const add = (out.length ? 2 : 0) + p.length;
    if (len + add > cap && out.length) break;
    out.push(p); len += add;
  }
  const rest = parts.length - out.length;
  return out.join(", ") + (rest > 0 ? ` … (+${rest})` : "");
}

export function questionToItem({ code, questionEN, N, options }, { wave, fieldworkEnd }, source) {
  const base = (options ?? []).filter((o) => !o.isSubtotal && typeof o.pct === "number");
  const q = questionEN || code;
  const shortQ = shortenQuestion(q) || code; // a cím a rövidített kérdést használja; a teljes a survey-ben marad
  // A summary a címben a MARADÉK helyhez igazodik (TITLE_MAX), hogy az egész cím olvasható
  // maradjon; a tételen a TELJES (vágatlan) summary marad meg.
  const prefix = `Eurobarometer ${wave} – `;
  const budget = Math.max(SUMMARY_FLOOR, TITLE_MAX - prefix.length - shortQ.length - 2);
  const summaryTitle = buildSummary(base, budget);
  const summary = buildSummary(base); // teljes
  return {
    guid: `eurobarometer:${wave}:${code}`,
    title: `${prefix}${shortQ}: ${summaryTitle}`,
    url: source.list_url,
    publishedAt: `${fieldworkEnd}T00:00:00.000Z`,
    dateOnly: true,
    summary,
    dataBacked: true,
    survey: { wave, code, questionEN: q, N, options },
  };
}

// since-szűrés a fieldwork vége szerint, NAP-granularitással (mint az europeelects-nél).
function filterSinceDay(items, since) {
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
 * A teljes eurobarometer-adapter (rss/htmllist-szerződés): fetchNew(source, opts) → {items, check}.
 * @param {{id:string,name?:string,list_url:string}} source
 * @param {{since?:number, fetchImpl?:function, timeoutMs?:number, now?:number, allow?:Set<string>}} opts
 */
export async function fetchNew(source, { since = 0, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, allow = SUBSTANTIVE_ALLOW } = {}) {
  const url = source.list_url;
  try {
    const { buffer } = await resolveVolumeA({ fetchImpl, timeoutMs });
    const files = unzipXlsx(buffer);
    const wb = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
    const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
    const map = sheetFileMap(wb, rels);
    const content = parseWorksheet(files.get(map.get("Content"))?.toString("utf8") ?? "");
    const fw = parseFieldwork(content);
    if (!fw.fieldworkEnd) return { items: [], check: { status: "SKIPPED_VALIDATION", detail: `fieldwork: "${fw.raw}" nem parse-olható`, url } };

    const labels = questionLabelsEN(content, [...map.keys()]);
    const codes = [...map.keys()].filter((c) => isSubstantiveQuestion(c, allow));
    if (codes.length === 0) return { items: [], check: { status: "SKIPPED_VALIDATION", detail: "nincs tartalmi (QA*) kérdés-munkalap", url } };

    const items = [];
    let skipped = 0, orphan = 0;
    for (const code of codes) {
      const questionEN = labels.get(code);
      // orphan követő-kérdés (a rövidített szöveg üres, pl. csak "And then?") → nem önálló tétel
      if (shortenQuestion(questionEN ?? "") === "") { orphan++; continue; }
      const q = parseQuestionSheet(parseWorksheet(files.get(map.get(code)).toString("utf8")));
      const v = validateQuestion(q);
      if (!v.ok) { skipped++; continue; } // egy anomális kérdés kimarad + számolva, nem öli a többit
      items.push(questionToItem({ code, questionEN, N: q.N, options: q.options }, fw, source));
    }
    if (items.length === 0) return { items: [], check: { status: "SKIPPED_VALIDATION", detail: `mind a ${codes.length} tartalmi kérdés elbukott a validáción/orphan`, url } };

    const fresh = filterSinceDay(items, since);
    const dropNote = [skipped && `${skipped} validáció-bukás`, orphan && `${orphan} követő-kérdés`].filter(Boolean).join(" + ");
    const base = `hullám ${fw.wave} (${fw.fieldworkEnd}): ${items.length} tétel${dropNote ? `, ${dropNote} kihagyva` : ""}`;
    if (fresh.length === 0) return { items: [], check: { status: "OK_NINCS_UJ", detail: `${base} — egyik sem újabb`, url } };
    return { items: fresh, check: { status: "OK_UJ", detail: `${base}, ${fresh.length} friss`, url } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url } };
  }
}
