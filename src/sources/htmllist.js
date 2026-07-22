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

/**
 * @param {{id:string,name?:string,list_url:string}} source
 * @param {{fetchImpl?:function, timeoutMs?:number}} opts
 */
export async function fetchNew(source, { fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = source.list_url;
  try {
    const res = await httpGet(url, { fetchImpl, timeoutMs });
    if (!res.ok) {
      return { items: [], check: { status: "HIBA", detail: `HTTP ${res.status}`, url } };
    }
    const html = await res.text();
    const items = extractLinks(html, url);
    if (items.length === 0) {
      return { items: [], check: { status: "RESZLEGES", detail: "HTML-parse: nincs kinyerhető cikk-link", url } };
    }
    return { items, check: { status: "OK_UJ", detail: `HTML-parse: ${items.length} cikk-link`, url } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url } };
  }
}
