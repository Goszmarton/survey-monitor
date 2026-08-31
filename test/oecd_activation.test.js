import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));

// 2026-08-31 (user: „az OECD kell"): az api.oecd.org RSS a MŰKÖDŐ csatorna (a www.oecd.org oldalak
// 403 Cloudflare-blokk datacenterről — a Hungary country-page NEM scrape-elhető a runnerről). A
// kombinált RSS az összes publikáció-típust adja (15 legfrissebb); kind=nemzetkozi, HU title_filter
// (globális kiadó → csak a Magyar-vonatkozású érdekes, mint Pew/WHO). A runner-elérhetőséget az
// első éles futás igazolja (ha 403/HIBA ott is → HIBA_TARTOS, mint 21kutato).
test("OECD: aktív forrás (kaszt A, kind nemzetkozi, api.oecd.org RSS feed)", () => {
  const s = selectActiveSources(sources).find((x) => x.id === "oecd");
  assert.ok(s, "oecd a kiválasztott aktív források közt");
  assert.equal(s.kind, "nemzetkozi");
  assert.equal(s.kaszt, "A");
  assert.match(s.feed, /^https:\/\/api\.oecd\.org\/webcms\/search\/rss/, "az api.oecd.org RSS (a működő csatorna)");
});

test("OECD: HU-relevancia title_filter (a globális kiadványokat cím-szinten szűri)", () => {
  const s = sources.find((x) => x.id === "oecd");
  assert.ok(Array.isArray(s.title_filter) && s.title_filter.includes("hungary") && s.title_filter.includes("magyar"),
    "hungary/magyar title_filter (nem önti el a triázst a globális OECD-kiadvány)");
});
