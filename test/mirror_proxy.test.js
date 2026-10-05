import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

// TÜKÖR-PROXY (2026-10-05): a Cloudflare a GitHub-runner datacenter-ASN-jéről blokkolta a telexet
// (403) és a policysolt (fetch failed), miközben a Hetzner-tükörszerver mindkettőt ELÉRI (mérve).
// Megoldás: a szerver (scripts/mirror-feeds.sh) letölti őket a webroot cache-be, a Caddy kiszolgálja
// napihir.duckdns.org/cache/…-en, amit az Actions elér → a forrás feed/list_url a tükör-cache-re mutat.
const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(selectActiveSources(sources).map((s) => [s.id, s]));

test("tükör-proxy: a telex feedje a napihir cache-re mutat (datacenter-blokk megkerülése)", () => {
  const s = byId.telex;
  assert.ok(s, "telex aktív");
  assert.equal(s.feed, "https://napihir.duckdns.org/cache/telex.xml", "telex a tükör-cache RSS-re mutat");
  assert.equal(s.kind, "sajto");
});

test("tükör-proxy: a policysol list_url-je a napihir cache-re mutat", () => {
  const s = byId.policysol;
  assert.ok(s, "policysol aktív");
  assert.equal(s.list_url, "https://napihir.duckdns.org/cache/policysol.html", "policysol a tükör-cache HTML-re mutat");
});

test("tükör-proxy: a mirror-feeds.sh mindkét forrást lefedi (a scriptben szerepelnek)", () => {
  const sh = readFileSync(new URL("../scripts/mirror-feeds.sh", import.meta.url), "utf8");
  assert.match(sh, /telex\.hu\/rss/, "a script letölti a telex RSS-t");
  assert.match(sh, /policysolutions\.hu\/hu\/elemzesek/, "a script letölti a policysol HTML-t");
  assert.match(sh, /telex\.xml/, "telex.xml cache-fájl");
  assert.match(sh, /policysol\.html/, "policysol.html cache-fájl");
});
