// A-kaszt HTML-listaoldal fetcher — best-effort (spec 5., „célzott HTML-lekérés").
// Eurostat euro-indicators list_url-jéhez: nincs verifikált RSS a hírfolyamra,
// ezért a listaoldal <a> headline-linkjeit nyerjük ki heurisztikusan.
// Publikációs időt nem talál — a frissesség a first_seen_at-re támaszkodik.

import { httpGet, describeError, DEFAULT_TIMEOUT_MS } from "./http.js";

const MIN_TITLE_LEN = 20; // a rövid nav-/lábléclinkek kiszűréséhez

function absolutize(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/** <a href>szöveg</a> párok kinyerése, HTML-tagek nélküli címszöveggel. */
function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < MIN_TITLE_LEN) continue;
    if (/^(#|mailto:|javascript:)/i.test(href)) continue;
    const url = absolutize(href, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ guid: url, title: text, url, publishedAt: null, summary: null });
  }
  return out;
}

// 21 Kutatóközpont: dátumozott Bootstrap-collapse accordion. A tételek NEM <a>-tagek,
// hanem <div ... class="... question" href="#faqNN">ÉÉÉÉ.HH.NN. – Cím< — a dátum a címhez
// fűzve, a link in-page anchor. Identitás a CÍM (guid), mert a #faqNN renumberálódhat.
function extract21kutato(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<div\b([^>]*\bclass="[^"]*\bquestion\b[^"]*"[^>]*)>\s*(\d{4})\.(\d{2})\.(\d{2})\.?\s*[–-]\s*([^<]+?)\s*</gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const [, , y, mo, d] = m; // m[2..4] = év/hó/nap
    const title = m[5].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (title.length < MIN_TITLE_LEN || seen.has(title)) continue;
    seen.add(title);
    const href = (attrs.match(/href=["']([^"']+)["']/) ?? [])[1];
    const url = href ? absolutize(href, baseUrl) : baseUrl;
    // dateOnly: a dátum NAP-granularitású (00:00Z csak jelölés, nem valós időpont) — a
    // since-szűrés ezt nap-szinten hasonlítja, különben az előző futás napján publikált
    // tétel a ~03:54Z since alatt véglegesen elveszne (lásd filterSince).
    out.push({ guid: title, title, url, publishedAt: `${y}-${mo}-${d}T00:00:00.000Z`, dateOnly: true, summary: null });
  }
  return out;
}

// since-szűrés (opts.since ms), granularitás-tudatosan. Három eset:
//  - valós időbélyeg (nem dateOnly/monthOnly): pontos since — mint az rss-ben;
//  - dateOnly (NAP-granularitás): a since NAPJÁNAK 00:00 UTC-jéhez hasonlítunk — a since az
//    előző futás kezdete (~03:54Z), a publishedAt 00:00Z, így a naiv publishedAt>=since az
//    előző futás NAPJÁN megjelent tételt kivágná, és holnap a since még későbbi → VÉGLEG
//    elveszne (néma adatvesztés, CLAUDE.md 2);
//  - monthOnly (HÓNAP-granularitás, pl. Minerva ÉÉÉÉHH): a since HÓNAPJÁNAK 1-jéhez hasonlítunk
//    — a homepage NAPOT nem ad, a publishedAt a hó 1-je; nap-szintű összevetés a hó közepén
//    publikált tárgyhavi kutatást a megjelenés napján kivágná (01 < since-nap), ugyanaz a néma
//    adatvesztés hónapos léptékben. A DB canonical_key-dedupja miatt a hó folyamán ismételten
//    visszaadott (már látott) tétel nem duplázódik — csak az első megjelenés lesz „új".
// publishedAt nélküli tétel marad (Eurostat euro-indicators lista érintetlen).
function filterSince(items, since) {
  const sinceMs = Number(since) || 0;
  if (!sinceMs) return items;
  const s = new Date(sinceMs);
  const sinceDayMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const sinceMonthMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  return items.filter((it) => {
    if (!it.publishedAt) return true;
    const t = Date.parse(it.publishedAt);
    if (Number.isNaN(t)) return true;
    const threshold = it.monthOnly ? sinceMonthMs : (it.dateOnly ? sinceDayMs : sinceMs);
    return t >= threshold;
  });
}

// Minerva: homepage "research-card" lista, HAVI ÉÉÉÉHH.html statikus permalinkkel. A homepage
// háromféle research-card-ot kever — (1) havi kutatás anchored ÉÉÉÉHH.html permalinkkel, EZT
// akarjuk; (2) tematikus tanulmány NEM-ÉÉÉÉHH permalinkkel (korfugges_…); (3) sajtóemlítés
// KÜLSŐ linkkel — plusz külön business-magyarázó blokk (más osztály). A megbízható horgony a
// HAVI permalink: csak a havi kutatásnak van anchored `href="ÉÉÉÉHH.html"` linkje. A h3↔permalink
// kötés a kártya-chunkon belül dől el (nem laza szomszédság): a research-card határon darabolunk,
// minden chunk EGY kártya, az első h3 + első anchored permalink a sajátja. A dátum a FÁJLNÉVBŐL
// (a homepage napot nem ad) → HAVI granularitás (monthOnly, lásd filterSince). Identitás=permalink.
function extractMinerva(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const chunks = html.split(/<div\s+class="research-card">/i).slice(1);
  for (const chunk of chunks) {
    const perma = chunk.match(/href="(\d{6})\.html"/i); // anchored ÉÉÉÉHH.html (korfugges_/külső URL kizárva)
    if (!perma) continue;
    const ym = perma[1];
    const url = absolutize(`${ym}.html`, baseUrl);
    if (!url || seen.has(url)) continue;
    const month = ((chunk.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) ?? [])[1] ?? "")
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    // téma: az első <p> szövege az első <br>/<a>/</p>-ig (a "Bővebben" link + a %-sor nélkül)
    const tema = ((chunk.match(/<p\b[^>]*>([\s\S]*?)(?:<br|<a\b|<\/p>)/i) ?? [])[1] ?? "")
      .replace(/<[^>]*>/g, " ").replace(/^\s*Téma:\s*/i, "").replace(/\s+/g, " ").trim();
    const title = `Minerva – ${month}${tema ? " – " + tema : ""}`.trim();
    if (title.length < MIN_TITLE_LEN) continue;
    seen.add(url);
    out.push({ guid: url, title, url, publishedAt: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01T00:00:00.000Z`, monthOnly: true, summary: null });
  }
  return out;
}

// Magyar rövidített hónapnevek → hónapszám (a Republikon <span id="date">-jéhez).
const HU_MONTHS = { jan: 1, feb: 2, márc: 3, marc: 3, ápr: 4, apr: 4, máj: 5, maj: 5, jún: 6, jun: 6, júl: 7, jul: 7, aug: 8, szept: 9, szep: 9, okt: 10, nov: 11, dec: 12 };

// Republikon /elemzesek,-kutatasok.aspx: a FŐ-lista tétele
// <span id="date">ÉV.<br>hó.<br>NAP.</span><h2><a href="permalink">Cím</a> — a <h2> különbözteti
// meg a sidebar „Legfrissebb postok" csonka linkjeitől. A dátum magyar rövidített hónappal,
// NAP-granularitás (dateOnly). A permalink valós URL (identitás), a vessző megőrizve (new URL).
function extractRepublikon(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<span id="date">\s*(\d{4})\.\s*<br\s*\/?>\s*([A-Za-zÁ-űá-ű]+)\.?\s*<br\s*\/?>\s*(\d{1,2})\.?\s*<\/span>\s*<h2>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const mo = HU_MONTHS[m[2].toLowerCase().replace(/\.$/, "")];
    if (!mo) continue; // ismeretlen hónap-rövidítés → nincs megbízható dátum, kihagyjuk
    const title = m[5].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (title.length < MIN_TITLE_LEN) continue;
    const url = absolutize(m[4], baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const publishedAt = `${m[1]}-${String(mo).padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00.000Z`;
    out.push({ guid: url, title, url, publishedAt, dateOnly: true, summary: null });
  }
  return out;
}

// Per-source parserek: az intézeti listaoldalak eltérő markupja miatt (a generikus <a>-
// extractor csak a szabványos headline-linkes oldalakra elég). Kulcs = source.id; ismeretlen
// forrásnál a generikus extractLinks (visszafelé kompatibilis, pl. Eurostat euro-indicators).
const PARSERS = { "21kutato": extract21kutato, republikon: extractRepublikon, minerva: extractMinerva };

/**
 * @param {{id:string,name?:string,list_url:string}} source
 * @param {{since?:number, fetchImpl?:function, timeoutMs?:number}} opts
 */
export async function fetchNew(source, { since = 0, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = source.list_url;
  try {
    const res = await httpGet(url, { fetchImpl, timeoutMs });
    if (!res.ok) {
      return { items: [], check: { status: "HIBA", detail: `HTTP ${res.status}`, url } };
    }
    const html = await res.text();
    const extract = PARSERS[source.id] ?? extractLinks;
    const items = extract(html, url);
    if (items.length === 0) {
      return { items: [], check: { status: "RESZLEGES", detail: "HTML-parse: nincs kinyerhető cikk-link", url } };
    }
    // since-szűrés (nap-granularitás-tudatos, lásd filterSince). A dátumtalan lista-tételek
    // maradnak (Eurostat érintetlen); a dateOnly tételek az előző futás napjától frissek.
    const fresh = filterSince(items, since);
    if (fresh.length === 0) {
      return { items: [], check: { status: "OK_NINCS_UJ", detail: `${items.length} tétel, egyik sem újabb`, url } };
    }
    return { items: fresh, check: { status: "OK_UJ", detail: `HTML-parse: ${fresh.length} friss (${items.length} a listában)`, url } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url } };
  }
}
