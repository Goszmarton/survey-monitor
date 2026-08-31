import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNew } from "../src/sources/htmllist.js";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const fx = readFileSync(fileURLToPath(new URL("./fixtures/politicalcapital_hirek.html", import.meta.url)), "utf8");

function resp(body, { status = 200, contentType = "text/html; charset=UTF-8" } = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}
const stub = (body) => async () => resp(body);

// 2026-08-31 forrás-bővítés, scrape-only kör: Political Capital (nincs RSS → HTML-lista parser).
// A tétel-szerkezet: <div class="pages"><div class="news_date">ÉÉÉÉ-HH-NN</div><a href="hirek.php?
// ...article_id=N"><H3>CÍM</H3><p class='news_box'>kategória</p></a></div>. A dátum NAP-granularitás.
test("scrape Political Capital: a parser címet + linket + dátumot nyer ki (nem a generikus <a>-szöveget)", async () => {
  const { items, check } = await fetchNew(
    { id: "polcapital", list_url: "https://politicalcapital.hu/hirek.php" },
    { since: 0, fetchImpl: stub(fx) },
  );
  assert.equal(check.status, "OK_UJ", "van kinyert cikk");
  assert.equal(items.length, 8, "mind a 8 tétel a fixture-ből");
  const first = items[0];
  assert.equal(first.title, "Baka Andrásnak nehéz dolga lesz", "a H3 a cím (a 'news_box' kategória NEM a címben)");
  assert.match(first.url, /politicalcapital\.hu\/hirek\.php\?article_read=1&article_id=3722/, "abszolutizált cikk-URL az article_id-vel");
  assert.equal(first.publishedAt?.slice(0, 10), "2026-08-08", "a news_date-ből a publikációs dátum");
  assert.equal(first.dateOnly, true, "NAP-granularitás (dateOnly) — a since-szűrés nap-szinten");
});

test("scrape Political Capital: aktív forrás (kaszt A, kind intezet, list_url)", () => {
  const s = selectActiveSources(sources).find((x) => x.id === "polcapital");
  assert.ok(s, "polcapital a kiválasztott aktív források közt");
  assert.equal(s.kind, "intezet");
  assert.equal(s.kaszt, "A");
  assert.match(s.list_url, /^https:\/\/politicalcapital\.hu\/hirek\.php/);
});
