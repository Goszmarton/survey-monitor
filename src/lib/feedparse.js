// Feed-parse réteg: nyers bájtok → normalizált RawItem[].
// Charset-detektálás (Content-Type → XML-deklaráció → utf-8), majd RSS/Atom parse.
// A hálózati réteg külön (src/sources/*): ez tisztán bájt→tétel, tesztelhető.

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // A CDATA/entitások szövegként; a <link> és <guid> lehet objektum is (attribútummal).
  textNodeName: "#text",
  trimValues: true,
});

/** @typedef {{guid:string|null,title:string,url:string|null,publishedAt:string|null,summary:string|null}} RawItem */

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Egy csomópont szöveggé: sima string, vagy {#text}, vagy null. */
function textOf(node) {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && node["#text"] != null) return String(node["#text"]);
  return null;
}

/** Dátum → ISO, vagy null ha nem értelmezhető. */
function toIso(raw) {
  const s = textOf(raw);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Charset meghatározása: Content-Type header, majd XML-deklaráció, végül utf-8. */
function detectCharset(bytes, contentType) {
  const fromHeader = contentType && /charset=["']?([\w-]+)/i.exec(contentType);
  if (fromHeader) return fromHeader[1].toLowerCase();
  // A deklaráció ASCII-tartományban van, latin1-gyel biztonságosan kiolvasható.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const fromXml = /encoding=["']([\w-]+)["']/i.exec(head);
  return fromXml ? fromXml[1].toLowerCase() : "utf-8";
}

function decode(bytes, charset) {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/** Atom <link> kiválasztása: rel="alternate" előny, különben az első href. */
function atomLink(link) {
  const links = toArray(link);
  const alt = links.find((l) => l && l["@_rel"] === "alternate");
  const chosen = alt || links.find((l) => l && l["@_href"]) || null;
  return chosen ? chosen["@_href"] ?? null : null;
}

/**
 * @param {Uint8Array|Buffer} bytes
 * @param {string} [contentType]
 * @returns {{format:"rss"|"atom"|"unknown", channelTitle:string|null, items:RawItem[]}}
 */
export function parseFeed(bytes, contentType) {
  const buf = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes);
  const xml = decode(buf, detectCharset(buf, contentType));

  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return { format: "unknown", channelTitle: null, items: [] };
  }

  // --- RSS 2.0 ---
  if (doc?.rss?.channel) {
    const ch = doc.rss.channel;
    const items = toArray(ch.item).map((it) => ({
      guid: textOf(it.guid) ?? textOf(it.link),
      title: textOf(it.title) ?? "",
      url: textOf(it.link),
      publishedAt: toIso(it.pubDate ?? it["dc:date"]),
      summary: textOf(it.description) ?? null,
    }));
    return { format: "rss", channelTitle: textOf(ch.title), items };
  }

  // --- RDF/RSS 1.0 ---
  if (doc?.["rdf:RDF"]) {
    const rdf = doc["rdf:RDF"];
    const items = toArray(rdf.item).map((it) => ({
      guid: textOf(it["@_rdf:about"]) ?? textOf(it.link),
      title: textOf(it.title) ?? "",
      url: textOf(it.link),
      publishedAt: toIso(it["dc:date"] ?? it.date),
      summary: textOf(it.description) ?? null,
    }));
    return { format: "rss", channelTitle: textOf(rdf.channel?.title), items };
  }

  // --- Atom ---
  if (doc?.feed) {
    const feed = doc.feed;
    const items = toArray(feed.entry).map((e) => ({
      guid: textOf(e.id) ?? atomLink(e.link),
      title: textOf(e.title) ?? "",
      url: atomLink(e.link),
      publishedAt: toIso(e.published) ?? toIso(e.updated),
      summary: textOf(e.summary) ?? textOf(e.content) ?? null,
    }));
    return { format: "atom", channelTitle: textOf(feed.title), items };
  }

  return { format: "unknown", channelTitle: null, items: [] };
}
