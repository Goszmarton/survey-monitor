// A-kaszt RSS/Atom fetcher — egységes interfész (spec 5., „A-kaszt").
// fetchNew(source, opts) → { items: RawItem[], check: {status, detail} }
// A dedup NEM itt történik (az az állapotréteg dolga); itt a since-szűrés
// bound-olja a mennyiséget, és a check a transzport+parse tényleges eredménye.

import { parseFeed } from "../lib/feedparse.js";
import { httpGet, describeError, noNewItemsDetail, DEFAULT_TIMEOUT_MS } from "./http.js";

// A tétel-URL abszolúttá tétele a feed URL-jéhez oldva. Sok feed (pl. TK ELTE szoc/jog/kisebbség)
// RELATÍV <link>-et ad ("/hirek/…"), amit a jelentés más hostról (github.io / napihir tükör)
// szolgál ki → kattintva 404. A feed spec szerint a relatív link a feed-dokumentumhoz értendő,
// ezért a source.feed a base. FONTOS: CSAK az url-t oldjuk fel; a guid-ot NEM (a canonicalKey
// alapja `guid ?? url` — ha a guid abszolúttá válna, a kulcs elcsúszna és duplikátum keletkezne).
// Hibás / már abszolút / nem-http sémájú (tel:, mailto:) URL változatlan marad.
function absolutizeUrl(rawUrl, base) {
  if (!rawUrl) return rawUrl;
  try {
    return new URL(rawUrl, base).href;
  } catch {
    return rawUrl;
  }
}

/**
 * @param {{id:string,name?:string,feed:string}} source
 * @param {{since?:number, now?:number, fetchImpl?:function, timeoutMs?:number}} opts
 */
export async function fetchNew(source, { since = 0, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, attempts, retryDelayMs } = {}) {
  const url = source.feed;
  try {
    const res = await httpGet(url, { fetchImpl, timeoutMs, attempts, retryDelayMs });
    if (!res.ok) {
      return { items: [], check: { status: "HIBA", detail: `HTTP ${res.status}`, url } };
    }
    const bytes = await res.bytes();
    const { format, items: parsed } = parseFeed(bytes, res.contentType);
    // A relatív <link>-ek abszolúttá tétele a feed URL-jéhez oldva (különben a más hostról
    // szolgált jelentésben 404). A guid VÁLTOZATLAN → a dedup-kulcs stabil marad.
    const items = parsed.map((it) => ({ ...it, url: absolutizeUrl(it.url, url) }));

    if (format === "unknown") {
      return { items: [], check: { status: "HIBA", detail: "nem RSS/Atom válasz (soft-404?)", url } };
    }
    if (items.length === 0) {
      // Valid feed, de egyetlen tétel sincs benne — üres/inaktív forrás.
      return { items: [], check: { status: "RESZLEGES", detail: "üres feed — 0 tétel", url } };
    }

    // since-szűrés: dátum nélküli tételt megtartunk (a dedup majd kiszűri, ha ismert).
    const sinceMs = Number(since) || 0;
    const fresh = items.filter((it) => {
      if (!it.publishedAt) return true;
      return Date.parse(it.publishedAt) >= sinceMs;
    });

    if (fresh.length === 0) {
      return { items: [], check: { status: "OK_NINCS_UJ", detail: noNewItemsDetail(items), url } };
    }
    return { items: fresh, check: { status: "OK_UJ", detail: `${fresh.length} friss tétel (${items.length} a feedben)`, url } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url } };
  }
}
