// A-kaszt HTML-listaoldal fetcher — best-effort (spec 5., „célzott HTML-lekérés").
// Eurostat euro-indicators list_url-jéhez: nincs verifikált RSS a hírfolyamra,
// ezért a listaoldal <a> headline-linkjeit nyerjük ki heurisztikusan.
// Publikációs időt nem talál — a frissesség a first_seen_at-re támaszkodik.

import { httpGet, describeError, noNewItemsDetail, DEFAULT_TIMEOUT_MS } from "./http.js";

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

// Opinio (europion.hu) — post-sitemap.xml: 149 <url><loc>+<lastmod>, CÍM NÉLKÜL. NEM kérjük le
// mind a 149-et: a <lastmod> alapján ELŐSZÖR since-szűrünk (dateOnly nap-szint — a lastmod valós
// időbélyeg, de a since NAPJÁHOZ hasonlítunk, hogy a futás-határ előtt módosított post ne vesszen
// el, a 21kutato-csapda rokona), és a fetchNew CSAK a friss URL-eket kéri le a headline-ért
// (needsTitle → title-backfill, napi 0-2 lekérés). Identitás = permalink (loc). Lastmod nélküli
// <url> kimarad (nincs megbízható frissesség).
function extractOpinio(xml, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<url>\s*<loc>\s*([^<\s]+)\s*<\/loc>\s*<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = absolutize(m[1], baseUrl);
    const t = Date.parse(m[2]);
    if (!url || seen.has(url) || Number.isNaN(t)) continue;
    seen.add(url);
    out.push({ guid: url, url, title: null, publishedAt: new Date(t).toISOString(), dateOnly: true, needsTitle: true, summary: null });
  }
  return out;
}

// A backfillelt oldal címe: <h1> > og:title > <title>, a záró oldal-suffix (" - Opinio",
// " – Europion", " | …") levágva. Rövid intézeti headline (pl. "Energiaválság") megengedett
// (nem a generikus MIN_TITLE_LEN alá esik) — csak a teljesen üres/csonka címet ejtjük.
function extractPageTitle(html) {
  const clean = (s) => (s ? s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().replace(/\s*[-–|]\s*(Opinio|Europion)\s*$/i, "").trim() : "");
  const h1 = clean((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? [])[1]);
  const og = clean((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ?? [])[1]);
  const tt = clean((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1]);
  const title = h1 || og || tt;
  return title.length >= 3 ? title : null;
}

// Publicus (publicus.hu/blog/category/blog/) — Newspaper (tagDiv) WP-téma. A FEED nem
// reprezentálja a forrást (a júliusi kutatások egyikben sincsenek), ezért a blog-lista kell.
// Minden cikk: <h3 class="entry-title td-module-title"><a href title>. VEGYES granularitás:
// a fő-listás modulok pontos <time class="td-module-date" datetime="ÉÉÉÉ-HH-NN"> dátumot adnak
// (dateOnly); a lap tetején lévő "td-big-grid" KIEMELTEK viszont dátum NÉLKÜLIEK a markupban —
// köztük a 3 legfrissebb kutatás, ami CSAK itt szerepel (nincs dátumos párja). Ezekhez az
// egyetlen in-page jel a kép-útvonal /wp-content/uploads/ÉÉÉÉ/HH/ → HAVI dátum (monthOnly),
// ami egyezik a címbeli hónappal. Így egy lekéréssel, cikkoldal-backfill nélkül sem vész el a
// primer tartalom, és a hetes kiemelt júliusi tétel a monthOnly miatt NEM kap hamis UJ_24H-t
// augusztusban (sinceMonth-szűrés). Identitás = permalink. Dedup URL-re, pontosabb dátum nyer.
function extractPublicus(html, baseUrl) {
  const seen = new Map(); // url → { item, rank } ; rank: 2=dateOnly, 1=monthOnly, 0=dátumtalan
  const re = /<h3 class="entry-title td-module-title">\s*<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) marks.push({ href: m[1], inner: m[2], index: m.index, end: re.lastIndex });
  for (let k = 0; k < marks.length; k++) {
    const mk = marks[k];
    const url = absolutize(mk.href, baseUrl);
    // csak valódi blog-cikk (nem kategória/tag/szerző/lapozó)
    if (!url || !/\/blog\/(?!category\/|tag\/|author\/|page\/)[^/]+\/?$/i.test(new URL(url).pathname)) continue;
    const title = mk.inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (title.length < MIN_TITLE_LEN) continue;

    // dátum: a cím UTÁN, a következő címig (fő-listás modulok pontos időbélyege)
    const seg = html.slice(mk.end, k + 1 < marks.length ? marks[k + 1].index : html.length);
    const dm = seg.match(/td-module-date[^>]*datetime="(\d{4})-(\d{2})-(\d{2})/i);
    let publishedAt = null, dateOnly = false, monthOnly = false, rank = 0;
    if (dm) {
      publishedAt = `${dm[1]}-${dm[2]}-${dm[3]}T00:00:00.000Z`; dateOnly = true; rank = 2;
    } else {
      // KIEMELT (big-grid): a cím ELŐTTI kép-útvonal /uploads/ÉÉÉÉ/HH/ → havi dátum
      const before = html.slice(Math.max(0, mk.index - 1500), mk.index);
      const um = [...before.matchAll(/\/uploads\/(\d{4})\/(\d{2})\//g)].pop();
      if (um) { publishedAt = `${um[1]}-${um[2]}-01T00:00:00.000Z`; monthOnly = true; rank = 1; }
    }
    const prev = seen.get(url);
    if (!prev || rank > prev.rank) {
      seen.set(url, { rank, item: { guid: url, title, url, publishedAt, dateOnly, monthOnly, summary: null } });
    }
  }
  return [...seen.values()].map((v) => v.item);
}

// Nézőpont Intézet (nezopont.hu/hu/tevekenysegeink/osszes-kozlemeny) — Joomla/Gantry. NINCS
// feed (mind az 5 ?format=feed út soft-404), ezért a HTML-lista kell. Minden közlemény egy
// g-array-item kártya: a megbízható horgony a <h2 class="g-item-title"><a href="permalink">Cím
// (az image- és category-link ugyanarra/máshova mutat, a h2 a cikké). A dátum a kártyán a cím
// ELŐTT: <span class="g-array-item-date"> … ÉÉÉÉ.HH.NN. — NAP-granularitás (dateOnly, lásd
// filterSince). A kiemelt widget a fő-grid néhány cikkét megismétli → URL-dedup (első nyer, a
// dátum kártyánként azonos). A dátumot a KÁRTYÁN belül kötjük: az előző cím-horgonytól eddig a
// horgonyig terjedő szegmens UTOLSÓ g-array-item-date tokenje a sajátja (a szegmens elején a
// megelőző kártya farka dátum nélküli, így nincs átszivárgás). Identitás = permalink.
function extractNezopont(html, baseUrl) {
  const re = /<h2 class="g-item-title">\s*<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) marks.push({ href: m[1], inner: m[2], index: m.index, end: re.lastIndex });
  const seen = new Map();
  for (let k = 0; k < marks.length; k++) {
    const mk = marks[k];
    const url = absolutize(mk.href, baseUrl);
    // csak cikk: /hu/tevekenysegeink/{kategória}/{slug} (a puszta kategória-oldal kimarad)
    if (!url || !/\/tevekenysegeink\/[^/]+\/[^/]+/.test(new URL(url).pathname)) continue;
    const title = mk.inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (title.length < MIN_TITLE_LEN || seen.has(url)) continue;
    const seg = html.slice(k > 0 ? marks[k - 1].end : 0, mk.index);
    const dates = [...seg.matchAll(/g-array-item-date[\s\S]*?(\d{4})\.(\d{2})\.(\d{2})\./g)];
    const dm = dates.length ? dates[dates.length - 1] : null;
    const publishedAt = dm ? `${dm[1]}-${dm[2]}-${dm[3]}T00:00:00.000Z` : null;
    seen.set(url, { guid: url, title, url, publishedAt, dateOnly: Boolean(dm), summary: null });
  }
  return [...seen.values()];
}

// Political Capital: news-lista (nincs RSS). Tétel-szerkezet (2026-08-31 verifikált):
//   <div class="pages"><div class="news_date">ÉÉÉÉ-HH-NN</div>
//     <a href="hirek.php?...article_id=N"><H3>CÍM</H3><p class='news_box'>kategória</p></a></div>
// A H3 a CÍM (a `news_box` kategória-címke NEM része — a generikus <a>-extractor „…Elemzés"-t
// ragasztana a címhez). A news_date NAP-granularitású (dateOnly). Identitás=URL (article_id stabil).
function extractPolCapital(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<div\b[^>]*class="news_date"[^>]*>\s*(\d{4})-(\d{2})-(\d{2})\s*<\/div>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, y, mo, d, href] = m;
    const title = m[5].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const url = absolutize(href, baseUrl);
    if (!url || title.length < MIN_TITLE_LEN || seen.has(url)) continue;
    seen.add(url);
    out.push({ guid: url, title, url, publishedAt: `${y}-${mo}-${d}T00:00:00.000Z`, dateOnly: true, summary: null });
  }
  return out;
}

// Per-source parserek: az intézeti listaoldalak eltérő markupja miatt (a generikus <a>-
// extractor csak a szabványos headline-linkes oldalakra elég). Kulcs = source.id; ismeretlen
// forrásnál a generikus extractLinks (visszafelé kompatibilis, pl. Eurostat euro-indicators).
const PARSERS = { "21kutato": extract21kutato, republikon: extractRepublikon, minerva: extractMinerva, opinio: extractOpinio, publicus: extractPublicus, nezopont: extractNezopont, polcapital: extractPolCapital };

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
    // Joomla soft-404 (CLAUDE.md 2, tegnapi tanulság): a szerver HTTP 200-at ad, de a törzs
    // hibadokumentum (<error><code>404</code>). Ezt NE 0 friss tételként (OK_NINCS_UJ/RESZLEGES)
    // könyveljük — az elrejtené a lekérés meghiúsulását —, hanem HIBA-ként.
    if (/<error>[\s\S]{0,120}?<code>\s*404\b/i.test(html)) {
      return { items: [], check: { status: "HIBA", detail: "soft-404 (HTTP 200 + <error><code>404)", url } };
    }
    const extract = PARSERS[source.id] ?? extractLinks;
    const items = extract(html, url);
    if (items.length === 0) {
      return { items: [], check: { status: "RESZLEGES", detail: "HTML-parse: nincs kinyerhető cikk-link", url } };
    }
    // since-szűrés (nap-granularitás-tudatos, lásd filterSince). A dátumtalan lista-tételek
    // maradnak (Eurostat érintetlen); a dateOnly tételek az előző futás napjától frissek.
    const fresh = filterSince(items, since);
    if (fresh.length === 0) {
      return { items: [], check: { status: "OK_NINCS_UJ", detail: noNewItemsDetail(items), url } };
    }
    // Title-backfill (Opinio-sitemap-eset): a cím nélküli (needsTitle) tételekhez lekérjük az
    // oldalt a headline-ért — CSAK a since UTÁNi friss URL-ekre (napi 0-2, nem mind a 149-et).
    // Egy hibás/cím nélküli lekérés KIMARAD, nem dönti el a futást (best-effort, spec 5.).
    if (fresh.some((it) => it.needsTitle)) {
      const ready = [];
      for (const it of fresh) {
        if (!it.needsTitle) { ready.push(it); continue; }
        try {
          const pres = await httpGet(it.url, { fetchImpl, timeoutMs });
          if (!pres.ok) continue;
          const title = extractPageTitle(await pres.text());
          if (title) ready.push({ ...it, title, needsTitle: undefined });
        } catch { /* egy hibás post-lekérés kimarad, a futás megy tovább */ }
      }
      if (ready.length === 0) {
        return { items: [], check: { status: "RESZLEGES", detail: `${fresh.length} friss URL, de egyik headline sem kérhető le`, url } };
      }
      return { items: ready, check: { status: "OK_UJ", detail: `sitemap: ${ready.length} friss headline-backfill (${items.length} a listában)`, url } };
    }
    return { items: fresh, check: { status: "OK_UJ", detail: `HTML-parse: ${fresh.length} friss (${items.length} a listában)`, url } };
  } catch (err) {
    return { items: [], check: { status: "HIBA", detail: describeError(err, timeoutMs), url } };
  }
}
