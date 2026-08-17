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
import { httpGet, DEFAULT_TIMEOUT_MS } from "./http.js";

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
