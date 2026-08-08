import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNew } from "../../src/sources/htmllist.js";

const fx = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

function resp(body, { status = 200, contentType = "text/html; charset=UTF-8" } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("utf8"),
  };
}
const stub = (body, opts) => async () => resp(body, opts);
const src = { id: "eurostat", name: "Eurostat", list_url: "https://ec.europa.eu/eurostat/web/main/news/euro-indicators" };

test("HTML-listából a cikk-headline linkek kinyerve (nav kihagyva)", async () => {
  const r = await fetchNew(src, { fetchImpl: stub(fx("eurostat_list.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2);
  const titles = r.items.map((i) => i.title);
  assert.ok(titles.some((t) => /GDP up by 0\.3%/.test(t)));
  // A relatív URL abszolúttá vált, a rövid nav-linkek ("Help", "Home") kimaradtak.
  assert.match(r.items[0].url, /^https:\/\/ec\.europa\.eu\//);
  assert.ok(!titles.some((t) => /^Help$|^Home$/.test(t)));
  // publikációs idő ismeretlen HTML-listából
  assert.equal(r.items[0].publishedAt, null);
});

test("RESZLEGES: nincs kinyerhető cikk-link", async () => {
  const r = await fetchNew(src, { fetchImpl: stub("<html><body><a href='/x'>rövid</a></body></html>") });
  assert.equal(r.check.status, "RESZLEGES");
  assert.deepEqual(r.items, []);
});

test("HIBA: HTTP 500", async () => {
  const r = await fetchNew(src, { fetchImpl: stub("err", { status: 500 }) });
  assert.equal(r.check.status, "HIBA");
  assert.match(r.check.detail, /500/);
});

// --- 21 Kutatóközpont: dátumozott Bootstrap-collapse accordion (per-source parser) ---
// A tételek NEM <a>-tagek, hanem <div class="... question" href="#faqNN">ÉÉÉÉ.HH.NN. – Cím<,
// ezért a generikus <a>-extractor nem látja őket, és dátumot sem von ki. A per-source parser
// kinyeri a CÍMET, a DÁTUMOT (publishedAt) és a LINKET (base#faqNN). PIROS az implementáció előtt.
const src21 = { id: "21kutato", name: "21 Kutatóközpont", list_url: "https://21kutatokozpont.hu/" };
test("21kutato: accordion-tételek — cím + dátum + link kinyerve", async () => {
  const r = await fetchNew(src21, { fetchImpl: stub(fx("21kutato_accordion.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 3, "3 accordion-tétel (a nav-linkek kimaradnak)");
  const first = r.items[0];
  assert.equal(first.title, "Kétharmados többség Sulyok távozása mellett", "a dátum-prefix levágva a címről");
  assert.equal(first.publishedAt, "2026-05-28T00:00:00.000Z", "a dátum kinyerve publishedAt-ba");
  assert.equal(first.url, "https://21kutatokozpont.hu/#faq76", "a link a base#faqNN anchor");
  // az identitás a CÍM (a #faqNN renumberálódhat) — guid a címből
  assert.equal(first.guid, first.title);
  // mindhárom tételnek van valós dátuma (nem null, mint a generikus HTML-listánál)
  assert.ok(r.items.every((i) => /^\d{4}-\d{2}-\d{2}T/.test(i.publishedAt)));
});

// --- since-szűrés csapda: dátum-granularitás vs. a since IDŐPONTJA ---
// A dateOnly tétel publishedAt-je 00:00Z. A since az ELŐZŐ FUTÁS KEZDETE (~03:54Z).
// Naiv (rss-szerű) publishedAt>=since összehasonlítás az ELŐZŐ FUTÁS NAPJÁN publikált
// tételt kivágná (00:00 < 03:54), és holnap a since még későbbi → VÉGLEG elveszne
// (néma adatvesztés, CLAUDE.md 2). A helyes: dateOnly tételnél NAP-szinten hasonlíts.
const longTitle = (s) => s + " " + "x".repeat(20);
test("21kutato since-szűrés: az előző futás NAPJÁN publikált (dateOnly) tétel BENT marad", async () => {
  const html = `<div class="accordion">
    <div class="question" href="#faq2">2026.08.06. – ${longTitle("Elemzes az elozo futas napjan")}<i></i></div>
    <div class="question" href="#faq1">2026.08.05. – ${longTitle("Korabbi napi elemzes")}<i></i></div>
  </div>`;
  const since = Date.parse("2026-08-06T03:54:00.000Z"); // az előző futás KEZDETE, nem éjfél
  const r = await fetchNew(src21, { fetchImpl: stub(html), since });
  const dates = r.items.map((i) => i.publishedAt);
  assert.ok(dates.includes("2026-08-06T00:00:00.000Z"), "a since NAPJÁN publikált tétel BENT marad (nap-szint, nem 00:00<03:54)");
  assert.ok(!dates.includes("2026-08-05T00:00:00.000Z"), "az egy nappal korábbi tétel kiesik");
  assert.equal(r.items.length, 1);
});

// --- Republikon: <span id="date">ÉV<br>HÓ<br>NAP</span><h2><a> fő-lista (per-source parser) ---
// A dátum magyar rövidített hónappal, <br>-rel tördelve, NAP-granularitás (dateOnly). A fő-
// lista tételeit a <h2> különbözteti meg a sidebar "Legfrissebb postok" csonka linkjeitől.
// A permalink valós URL VESSZŐVEL (/elemzesek,-kutatasok/…) — nem szabad %2C-re kódolódnia.
const srcRep = { id: "republikon", name: "Republikon", list_url: "https://republikon.hu/elemzesek,-kutatasok.aspx" };
test("republikon: fő-lista cím + dátum + permalink; sidebar kihagyva, vessző megőrizve", async () => {
  const r = await fetchNew(srcRep, { fetchImpl: stub(fx("republikon_list.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2, "csak a 2 fő-lista poszt (a sidebar-esemény kimarad)");
  const first = r.items[0];
  assert.equal(first.title, "Elérhető a Republikon legújabb, július végi pártpreferencia kutatása");
  assert.equal(first.publishedAt, "2026-07-30T00:00:00.000Z", "magyar rövidített hónap → ISO dátum");
  assert.equal(first.url, "https://republikon.hu/elemzesek,-kutatasok/260728_kvk.aspx", "valós permalink, a vessző NEM %2C");
  assert.ok(!first.url.includes("%2C"), "a vessző nem kódolódott");
  // NAP-granularitás → dateOnly (a mai since-fix nap-szinten szűri)
  assert.equal(first.dateOnly, true);
  assert.ok(!r.items.some((i) => /M\.I\. a helyzet/.test(i.title)), "a sidebar 'Legfrissebb postok' esemény nincs benne");
});

// --- Minerva: homepage research-card lista, havi ÉÉÉÉHH.html statikus permalink ---
// A homepage háromféle research-card-ot kever: (1) havi kutatás anchored ÉÉÉÉHH.html
// permalinkkel — EZT akarjuk; (2) tematikus tanulmány NEM-ÉÉÉÉHH permalinkkel (korfugges_…);
// (3) sajtóemlítés KÜLSŐ linkkel — plusz külön business-magyarázó blokk. A megbízható kötés
// horgonya az ÉÉÉÉHH.html permalink (csak a havi kutatásnak van ilyen): a chunk h3-ja a hónap,
// a dátum a FÁJLNÉVBŐL (nap nincs a homepage-en → HAVI granularitás, monthOnly). PIROS az
// extractMinerva előtt.
const srcMin = { id: "minerva", name: "Minerva", list_url: "https://minervaintezet.hu/" };
test("minerva: csak a havi ÉÉÉÉHH.html kutatások (tematikus/sajtó/business kizárva)", async () => {
  const r = await fetchNew(srcMin, { fetchImpl: stub(fx("minerva_home.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2, "csak a 2 havi ÉÉÉÉHH.html kutatás");
  const first = r.items[0];
  assert.equal(first.url, "https://minervaintezet.hu/202604.html", "az ÉÉÉÉHH.html permalink abszolutizálva");
  assert.equal(first.guid, first.url, "az identitás a statikus permalink");
  assert.equal(first.publishedAt, "2026-04-01T00:00:00.000Z", "a dátum a FÁJLNÉVBŐL (hónap 1-je)");
  assert.equal(first.monthOnly, true, "havi granularitás → monthOnly (a since-szűrés hónap-szinten kezeli)");
  assert.match(first.title, /2026\. április/, "a cím tartalmazza a hónapot (h3)");
  assert.match(first.title, /Ki nyeri a választást/, "a cím tartalmazza a témát");
  const titles = r.items.map((i) => i.title).join(" | ");
  assert.ok(!/korfügg|korfugg/i.test(titles), "a tematikus (korfugges_) tanulmány kizárva (nem ÉÉÉÉHH.html)");
  assert.ok(!/technológia/i.test(titles), "a business-magyarázó blokk kizárva");
  assert.ok(!/24\.hu/i.test(titles), "a sajtóemlítés (külső link) kizárva");
  assert.equal(r.items[1].url, "https://minervaintezet.hu/202512.html", "a 2. havi kutatás (permalink az első <p>-n belül)");
});

// monthOnly csapda: a homepage nem ad NAPOT, csak hónapot. Ha 1-jére dátumoznánk dateOnly-ként,
// a NAP-szintű since-szűrés a hó közepén publikált friss kutatást a megjelenése napján kivágná
// (01 < since-nap) → a legértékesebb primer tétel némán elveszne (CLAUDE.md 2, a 21kutato-csapda
// hónapos rokona). A helyes: monthOnly tételnél HÓNAP-szinten hasonlíts.
test("minerva since-szűrés: hó közepi since mellett a TÁRGYHAVI kutatás BENT marad (monthOnly)", async () => {
  const html = `<div class="research-scroll">
    <div class="research-card"><h3>2026. augusztus</h3>
      <p>Téma: augusztusi pártpreferencia<br>&#9654; <a href="202608.html">Bővebben</a></p></div>
    <div class="research-card"><h3>2026. július</h3>
      <p>Téma: júliusi pártpreferencia<br>&#9654; <a href="202607.html">Bővebben</a></p></div>
  </div>`;
  const since = Date.parse("2026-08-20T10:00:00.000Z"); // augusztus 20., jóval a hó 1-je után
  const r = await fetchNew(srcMin, { fetchImpl: stub(html), since });
  const urls = r.items.map((i) => i.url);
  assert.ok(urls.some((u) => /202608\.html/.test(u)), "a tárgyhavi (aug) kutatás BENT marad (hó-szint, nem 01 < aug 20)");
  assert.ok(!urls.some((u) => /202607\.html/.test(u)), "az előző havi (júl) kutatás kiesik");
  assert.equal(r.items.length, 1);
});

// --- Opinio (europion.hu): post-sitemap.xml, CÍM NÉLKÜL — kétlépcsős fetch ---
// A sitemap 149 <loc>+<lastmod>, cím nincs. A megoldás: a <lastmod> alapján ELŐSZÖR since-
// szűrünk (dateOnly nap-szint), és CSAK a friss URL-eket kérjük le a headline-ért (<h1>).
// Egy hibás post-lekérés KIMARAD, nem dönti el a futást. PIROS az extractOpinio + backfill előtt.
const srcOp = { id: "opinio", name: "Europion / Opinio", list_url: "https://europion.hu/post-sitemap.xml" };
const POSTS = {
  "https://europion.hu/energiavalsag/": "<html><head><title>Energiaválság - Opinio</title><meta property=\"og:title\" content=\"Energiaválság - Opinio\"></head><body><h1>Energiaválság</h1><p>...</p></body></html>",
  "https://europion.hu/juliusi-partpreferenciak/": "<html><head><title>Júliusi pártpreferenciák - Opinio</title></head><body><h1>Júliusi pártpreferenciák</h1></body></html>",
};
// URL-routing stub, hívásszámlálóval — a sitemap-URL a fixture-t adja, a post-URL-ek a POSTS-ot.
function router(extra = {}) {
  const calls = [];
  const map = { "https://europion.hu/post-sitemap.xml": fx("opinio_sitemap.xml").toString("utf8"), ...POSTS, ...extra };
  const impl = async (url) => {
    calls.push(url);
    if (map[url] === undefined) return resp("not found", { status: 404 });
    if (map[url] instanceof Error) throw map[url];
    if (typeof map[url] === "object" && map[url].status) return resp(map[url].body ?? "", map[url]);
    return resp(map[url]);
  };
  impl.calls = calls;
  return impl;
}

test("opinio: sitemap since-szűrés UTÁN backfill headline — csak a friss URL-eket kéri le", async () => {
  const impl = router();
  // since = 2026-07-01 → a 2 friss (07-14, 08-05) átmegy, a 2 db 2021-es kiesik
  const r = await fetchNew(srcOp, { fetchImpl: impl, since: Date.parse("2026-07-01T00:00:00Z") });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2, "csak a 2 friss post (a 2 db 2021-es lastmod kiesett a since előtt)");
  const byUrl = Object.fromEntries(r.items.map((i) => [i.url, i]));
  assert.equal(byUrl["https://europion.hu/energiavalsag/"].title, "Energiaválság", "a cím a <h1>-ből (a ' - Opinio' suffix levágva)");
  assert.equal(byUrl["https://europion.hu/juliusi-partpreferenciak/"].title, "Júliusi pártpreferenciák");
  assert.equal(byUrl["https://europion.hu/energiavalsag/"].dateOnly, true, "nap-szintű since-kezelés");
  // NEM kérte le mind a 149-et: 1 sitemap + 2 friss post = 3 hívás, a 2021-es URL-eket NEM
  assert.equal(impl.calls.length, 3, "1 sitemap + 2 friss post-lekérés (a régieket NEM kéri le)");
  assert.ok(!impl.calls.includes("https://europion.hu/elindult-az-opinio/"), "a régi (szűrt) URL-t nem kéri le");
});

test("opinio: nincs friss lastmod → OK_NINCS_UJ, EGYETLEN post-lekérés sincs", async () => {
  const impl = router();
  const r = await fetchNew(srcOp, { fetchImpl: impl, since: Date.parse("2026-09-01T00:00:00Z") });
  assert.equal(r.check.status, "OK_NINCS_UJ");
  assert.equal(impl.calls.length, 1, "csak a sitemap; friss URL nincs, post-lekérés nem történik");
});

test("opinio: egy hibás post-lekérés KIMARAD, nem dönti el a futást", async () => {
  // az energiavalsag oldala 500-at ad → az a tétel kimarad, a másik friss (júliusi) megmarad
  const impl = router({ "https://europion.hu/energiavalsag/": { status: 500, body: "err" } });
  const r = await fetchNew(srcOp, { fetchImpl: impl, since: Date.parse("2026-07-01T00:00:00Z") });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 1, "a hibás post kimaradt, a futás megy tovább");
  assert.equal(r.items[0].url, "https://europion.hu/juliusi-partpreferenciak/");
});

test("since-szűrés: publishedAt NÉLKÜLI tétel (generikus HTML-lista, pl. Eurostat) since mellett is marad", async () => {
  // dátum nélküli tétel → nem szűrhető → marad (mint az rss-ben); az Eurostat-lista érintetlen.
  const r = await fetchNew(src, { fetchImpl: stub(fx("eurostat_list.html")), since: Date.parse("2026-08-06T03:54:00.000Z") });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2, "a dátumtalan lista-tételek since mellett is bent maradnak");
});

// Publicus (publicus.hu/blog/category/blog/) — Newspaper WP-téma. A feed NEM reprezentál
// (a júliusi kutatások kimaradnak belőle), a blog-lista kell. VEGYES granularitás: a fő-listás
// modulok pontos <time datetime> (dateOnly), a big-grid KIEMELTEK dátumtalanok → a kép-útvonal
// /uploads/ÉÉÉÉ/HH/ ad HAVI dátumot (monthOnly). A szerződés: 28 tiszta cikk, semmi primer nem vész el.
const srcPub = { id: "publicus", name: "Publicus", list_url: "https://publicus.hu/blog/category/blog/" };
test("publicus: 28 keltezett cikk (25 dateOnly + 3 kiemelt monthOnly), semmi primer nem vész el", async () => {
  const r = await fetchNew(srcPub, { since: 0, fetchImpl: stub(fx("publicus_blog.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 28, "28 egyedi blog-cikk (a kategória/nav-linkek kizárva, a duplikátumok összevonva)");
  const dated = r.items.filter((i) => i.dateOnly);
  const month = r.items.filter((i) => i.monthOnly);
  assert.equal(dated.length, 25, "25 fő-listás cikk pontos <time datetime>-mal (dateOnly)");
  assert.equal(month.length, 3, "3 big-grid KIEMELT, upload-útvonal havi dátummal (monthOnly)");
  assert.equal(r.items.filter((i) => !i.publishedAt).length, 0, "nincs dátumtalan tétel (semmi nem esik ki datálatlanul)");
  const latest = r.items.map((i) => i.publishedAt).filter(Boolean).sort().reverse()[0];
  assert.equal(latest, "2026-07-31T00:00:00.000Z", "legfrissebb 2026-07-31 (fő-listás)");
  // a 3 legfrissebb PRIMER kutatás CSAK a big-gridben van (nincs dátumos párja) — NEM vész el:
  const partok = r.items.find((i) => /Pártok támogatottsága.*2026 július/.test(i.title));
  assert.ok(partok, "a 'Pártok támogatottsága – 2026 július' primer kutatás bent van");
  assert.equal(partok.monthOnly, true, "kiemelt → monthOnly (nincs listás időbélyege)");
  assert.equal(partok.publishedAt, "2026-07-01T00:00:00.000Z", "a havi dátum az /uploads/2026/07/ kép-útvonalból");
  // a kategória-oldal linkje NEM cikk:
  assert.ok(!r.items.some((i) => /\/blog\/category\//.test(i.url)), "a /blog/category/ nem tétel");
});
