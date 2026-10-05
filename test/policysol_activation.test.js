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
// PARSER-UNIT: a valós-oldali (gyökér-relatív linkű) HTML-t a VALÓS bázis ellen oldja fel.
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

// TÜKÖR-PROXY PRODUKCIÓS ÚT (2026-10-05): élesben a fetch a napihir-tükörről megy (list_url =
// napihir/cache/policysol.html), ahol a szerver a gyökér-relatív linkeket MÁR abszolutizálta
// www.policysolutions.hu-ra (mirror-feeds.sh sed). Így a parser a már-abszolút PDF-linket a
// napihir-bázis MELLETT is megtartja (az abszolút URL figyelmen kívül hagyja a bázist). Ezt a
// sed-transzformációt itt szimuláljuk, és igazoljuk, hogy a link policysolutions.hu marad (NEM napihir).
test("tükör-proxy: a szerver-abszolutizált cache-HTML-ből a parser policysolutions.hu linket ad (napihir-bázissal is)", async () => {
  const cached = fx.replace(/href="\//g, 'href="https://www.policysolutions.hu/'); // = a mirror-feeds.sh sed-je
  const { items, check } = await fetchNew(
    { id: "policysol", list_url: "https://napihir.duckdns.org/cache/policysol.html" },
    { since: 0, fetchImpl: stub(cached) },
  );
  assert.equal(check.status, "OK_UJ");
  assert.equal(items.length, 3);
  assert.match(items[0].url, /^https:\/\/www\.policysolutions\.hu\/userfiles\/elemzes\/381\//, "az eredeti oldalra mutat, NEM a tükörre");
  assert.ok(!items[0].url.includes("napihir"), "a PDF-link SOHA nem a napihir-tükörre mutat");
});

test("scrape Policy Solutions: aktív forrás (kaszt A, kind intezet, tükör-proxy list_url)", () => {
  const s = selectActiveSources(sources).find((x) => x.id === "policysol");
  assert.ok(s, "policysol aktív");
  assert.equal(s.kind, "intezet");
  assert.equal(s.kaszt, "A");
  assert.match(s.list_url, /^https:\/\/napihir\.duckdns\.org\/cache\/policysol\.html$/, "tükör-proxy cache-URL (2026-10-05)");
});
