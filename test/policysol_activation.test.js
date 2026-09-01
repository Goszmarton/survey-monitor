import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNew } from "../src/sources/htmllist.js";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const fx = readFileSync(fileURLToPath(new URL("./fixtures/policysolutions_elemzesek.html", import.meta.url)), "utf8");

function resp(body) {
  return { ok: true, status: 200, headers: { get: () => "text/html; charset=UTF-8" }, text: async () => body };
}
const stub = (body) => async () => resp(body);

// 2026-08-31 scrape-only: Policy Solutions /elemzesek. Tétel: <div class="elemzes"> ... <h3
// class="cim">CÍM</h3> <p>összefoglaló</p> <a href="...pdf">letöltés</a>. Nincs per-tétel dátum
// → publishedAt null (a frissesség a first_seen-re támaszkodik, mint az Eurostat-listánál).
test("scrape Policy Solutions: cím a h3.cim-ből, url a PDF-letöltő linkből (dátum nélkül)", async () => {
  const { items, check } = await fetchNew(
    { id: "policysol", list_url: "https://www.policysolutions.hu/elemzesek" },
    { since: 0, fetchImpl: stub(fx) },
  );
  assert.equal(check.status, "OK_UJ", "van kinyert elemzés");
  assert.equal(items.length, 3, "a 3 fixture-elemzés");
  const first = items[0];
  assert.equal(first.title, "Közhangulat Magyarországon a 2026-os parlamenti választás előtt");
  assert.match(first.url, /policysolutions\.hu\/userfiles\/elemzes\/381\//, "abszolutizált PDF-URL");
  assert.equal(first.publishedAt, null, "nincs per-tétel dátum → first_seen vezérli a frissességet");
});

test("scrape Policy Solutions: aktív forrás (kaszt A, kind intezet, list_url)", () => {
  const s = selectActiveSources(sources).find((x) => x.id === "policysol");
  assert.ok(s, "policysol aktív");
  assert.equal(s.kind, "intezet");
  assert.equal(s.kaszt, "A");
  assert.match(s.list_url, /policysolutions\.hu\/hu\/elemzesek/);
});
