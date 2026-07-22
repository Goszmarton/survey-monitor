import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFeed } from "../../src/lib/feedparse.js";

const fx = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

test("RSS 2.0: tételek normalizálva (guid, url, cím, pubDate → ISO)", () => {
  const { format, channelTitle, items } = parseFeed(fx("rss_sample.xml"), "text/xml; charset=UTF-8");
  assert.equal(format, "rss");
  assert.equal(channelTitle, "Telex");
  assert.equal(items.length, 2);
  assert.deepEqual(
    { guid: items[0].guid, url: items[0].url, title: items[0].title },
    { guid: "telex-1", url: "https://telex.hu/cikk/1", title: "Első cikk címe" },
  );
  assert.equal(items[0].publishedAt, new Date("Tue, 22 Jul 2026 05:00:00 +0200").toISOString());
});

test("RSS: CDATA-cím és -leírás dekódolva, entitás feloldva", () => {
  const { items } = parseFeed(fx("rss_sample.xml"));
  assert.equal(items[1].title, "Második & harmadik");
  assert.match(items[1].summary, /HTML-es leírás/);
});

test("iso-8859-2: az XML-deklarációból detektált kódolással helyes ékezetek", () => {
  const { items, channelTitle } = parseFeed(fx("rss_ksh_iso88592.xml"));
  assert.match(channelTitle, /Gyorstájékoztatók/);
  assert.equal(items[0].title, "Árvíztűrő tükörfúrógép");
  assert.ok(!items[0].title.includes("�"), "nincs replacement karakter");
});

test("iso-8859-2: a Content-Type charset felülírja a detektálást", () => {
  // A bájtok iso-8859-2-esek; ha a fejléc helyesen jelzi, akkor is jó.
  const { items } = parseFeed(fx("rss_ksh_iso88592.xml"), "text/xml;charset=iso-8859-2");
  assert.equal(items[0].title, "Árvíztűrő tükörfúrógép");
});

test("Atom: entry → normalizált tétel (link@href, id, published)", () => {
  const { format, items } = parseFeed(fx("atom_sample.xml"));
  assert.equal(format, "atom");
  assert.equal(items.length, 1);
  assert.equal(items[0].guid, "urn:atom-1");
  assert.equal(items[0].url, "https://example.org/a1");
  assert.equal(items[0].title, "Atom tétel egy");
  assert.equal(items[0].publishedAt, "2026-07-22T04:30:00.000Z");
});

test("Üres feed: valid RSS, 0 tétel (Szabad Európa eset)", () => {
  const { format, channelTitle, items } = parseFeed(fx("rss_empty.xml"));
  assert.equal(format, "rss");
  assert.match(channelTitle, /Szabad Európa/);
  assert.deepEqual(items, []);
});

test("Nem-feed bemenet: format 'unknown', üres tétellista, nem dob", () => {
  const { format, items } = parseFeed(Buffer.from("<html><body>404</body></html>"));
  assert.equal(format, "unknown");
  assert.deepEqual(items, []);
});
