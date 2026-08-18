import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEuropeElects } from "../../src/sources/europeelects.js";
import { groupStories, deriveInstitutes } from "../../src/lib/storygroup.js";

const cfg = JSON.parse(readFileSync(new URL("../../config/dedup.json", import.meta.url), "utf8"));
const { sources } = JSON.parse(readFileSync(new URL("../../config/sources.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);
const html = readFileSync(new URL("../fixtures/europeelects_hu.html", import.meta.url), "utf8");

// A pollToItem-mel egyező alak (a collect ezt a source_id-t adja): a cím a kutatócéget
// tartalmazza, a source_id az AGGREGÁTOR ("europeelects").
function pollItem(poll, i) {
  const named = poll.parties.filter((p) => p.pct != null);
  const summary = named.map((p) => `${p.name} ${p.pct}%`).join(", ");
  return {
    canonical_key: `europeelects:${i}`,
    source_id: "europeelects",
    kind: "nemzetkozi",
    title: `Europe Elects – ${poll.pollingFirm} pártpreferencia (${poll.fieldwork.raw}): ${summary}`,
    published_at: `${poll.fieldwork.end}T00:00:00.000Z`,
    first_seen_at: "2026-08-18T09:00:00.000Z",
    freshness: "UJ_24H", relevant: 1, significance: "FIGYELENDO",
  };
}

// E2/B: az ASAPOP-tábla KÜLÖNBÖZŐ kutatócégeinek pollja KÜLÖN sztori — az intézet-guardnak
// szét kell tartania őket. A veszély: a templált cím ("Europe Elects – X pártpreferencia: TISZA
// n%, Fidesz–KDNP m%, …") minden pollnál majdnem azonos → magas containment → az intézet-guard
// NÉLKÜL mind EGY blobba olvad (mért: 50 poll → 1 rep). A guard akkor véd, ha (1) minden cég
// intézetként regisztrált ÉS (2) a közös aggregátor-token ("europeelects" source_id) NEM
// intézet-token (különben minden poll osztja → a disjointness eltörik).
test("dedup: KÜLÖNBÖZŐ kutatócégek pollja NEM olvad egy sztoriba (intézet-guard, E2/B)", () => {
  const { polls } = parseEuropeElects(html);
  // cégenként egy poll (a legfrissebb), hogy a same-firm-different-date kérdést kizárjuk
  const byFirm = new Map();
  polls.forEach((p, i) => { if (!byFirm.has(p.pollingFirm)) byFirm.set(p.pollingFirm, pollItem(p, i)); });
  const items = [...byFirm.values()];
  assert.ok(items.length >= 10, `legalább 10 különböző cég a fixture-ben (${items.length})`);

  const { representatives, merges } = groupStories(items, { cfg, institutes });
  assert.equal(merges.length, 0, "nincs összevonás különböző intézetek közt");
  assert.equal(representatives.length, items.length, `minden cég külön reprezentáns (${representatives.length}/${items.length})`);
});
