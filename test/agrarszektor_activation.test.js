import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNew } from "../src/sources/rss.js";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const fx = readFileSync(fileURLToPath(new URL("./fixtures/agrarszektor_rss.xml", import.meta.url)), "utf8");

// Fixture-alapú feed-stub (a rss.test.js / institutes_activation mintája): a rss.js res.bytes()-t
// olvas → arrayBuffer kell a stubba.
function resp(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: true,
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? "application/rss+xml; charset=UTF-8" : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("utf8"),
  };
}
const stub = (body) => async () => resp(body);

// 2026-09-10 forrás-bővítés (user): Agrárszektor — agrár-szektor hírportál, A-kaszt RSS
// (a generikus rss.js út kezeli, 0 új parser), kind=sajto (→ item kind=sajto), a 📰 Sajtószemle
// ágra. SZŰRETLENÜL kötjük be (user-döntés): a triázs-kapu rostálja a közéleti relevanciát,
// nincs source.title_filter. PIROS a config-bővítés ELŐTT (az id nincs a sources.json-ban), ZÖLD utána.
test("agrarszektor: aktív forrás (kaszt A, kind sajto, https RSS feed)", () => {
  const s = selectActiveSources(sources).find((x) => x.id === "agrarszektor");
  assert.ok(s, "agrarszektor a kiválasztott aktív források közt");
  assert.equal(s.kind, "sajto", "kind=sajto → 📰 Sajtószemle");
  assert.equal(s.kaszt, "A", "A-kaszt (generikus feed-út, 0 új parser)");
  assert.ok(s.feed && /^https:\/\/www\.agrarszektor\.hu\/rss$/.test(s.feed), "verifikált https RSS feed-URL");
  assert.ok(!s.title_filter, "szűretlen bekötés (nincs source.title_filter)");
});

test("agrarszektor: a generikus rss.js parse-olja a feedet (cím + abszolút link + dátum)", async () => {
  const { items, check } = await fetchNew(
    { id: "agrarszektor", feed: "https://www.agrarszektor.hu/rss" },
    { since: 0, fetchImpl: stub(fx) },
  );
  assert.equal(check.status, "OK_UJ", "van kinyert tétel");
  assert.equal(items.length, 2, "a 2 fixture-item");
  const first = items[0];
  assert.equal(first.title, "Dráma a gabonaföldeken: durva, ami Békés megyében történt");
  assert.match(first.url, /^https:\/\/www\.agrarszektor\.hu\/noveny\/20260910\//, "abszolút cikk-URL");
  assert.ok(first.publishedAt, "van pubDate → publishedAt");
});
