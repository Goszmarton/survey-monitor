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
