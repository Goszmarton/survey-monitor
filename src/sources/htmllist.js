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

// since-szűrés (opts.since ms). A dateOnly (nap-granularitású) tételnél a since NAPJÁNAK
// 00:00 UTC-jéhez hasonlítunk, NEM a since időpontjához: a since az előző futás kezdete
// (~03:54Z), a dateOnly publishedAt 00:00Z → naiv publishedAt>=since kivágná az előző futás
// NAPJÁN megjelent tételt, és holnap a since még későbbi → VÉGLEG elveszne (néma adatvesztés,
// CLAUDE.md 2). Valós időbélyegű (nem-dateOnly) tételnél pontos since — mint az rss-ben.
// publishedAt nélküli tétel marad (Eurostat euro-indicators lista érintetlen).
function filterSince(items, since) {
  const sinceMs = Number(since) || 0;
  if (!sinceMs) return items;
  const s = new Date(sinceMs);
  const sinceDayMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return items.filter((it) => {
    if (!it.publishedAt) return true;
    const t = Date.parse(it.publishedAt);
    if (Number.isNaN(t)) return true;
    return t >= (it.dateOnly ? sinceDayMs : sinceMs);
  });
}

// Per-source parserek: az intézeti listaoldalak eltérő markupja miatt (a generikus <a>-
// extractor csak a szabványos headline-linkes oldalakra elég). Kulcs = source.id; ismeretlen
// forrásnál a generikus extractLinks (visszafelé kompatibilis, pl. Eurostat euro-indicators).
const PARSERS = { "21kutato": extract21kutato };

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
