import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEuropeElects } from "../../src/sources/europeelects.js";
import { deriveInstitutes, groupStories } from "../../src/lib/storygroup.js";

// Az europeelects pollok ADATPONTOK, nem sztorik: két kutatócég ugyanarra a pártra/dátumra
// KÜLÖN mérés, sosem „ugyanaz a sztori". A story-dedupnak ezért NEM szabad őket összevonnia.
// A hiba, amit ez a teszt reprodukál (2026-08-21 dry-run): a „21 Kutatóközpont" intézet bare
// numerikus „21" tokene illeszkedik a MÁS cégek címeiben lévő párt-százalékra ("Fidesz 21%"),
// így a Medián inst-halmaza {median,21kutato} lesz → nem disjoint a 21kutato-tól → a KEMÉNY
// intézet-guard nem tüzel → cross-cég összevonás. A fix: config `standalone_sources` — a poll-
// forrás tételei sosem story-merge-elődnek (mindegyik önálló reprezentáns).

const FX = fileURLToPath(new URL("../fixtures/europeelects_hu.html", import.meta.url));
const HTML = readFileSync(FX);
const dedup = JSON.parse(readFileSync(fileURLToPath(new URL("../../config/dedup.json", import.meta.url)), "utf8"));
const sources = JSON.parse(readFileSync(fileURLToPath(new URL("../../config/sources.json", import.meta.url)), "utf8"));
const srcArr = Array.isArray(sources) ? sources : sources.sources;

// A befagyasztott fixture MÉRETE ismert → egy csendes fixture-frissülés (más adat) detektálható.
test("fixture-guard: az europeelects_hu.html mérete a befagyasztott 15641 bájt", () => {
  assert.equal(HTML.length, 15641, "a fixture frissült — a lenti mérések/elvárások újranézendők");
});

const buildItems = () => {
  const { polls } = parseEuropeElects(HTML.toString("utf8"));
  return polls.map((p) => ({
    canonical_key: `europeelects:${p.pollingFirm}:${p.fieldwork.start}:${p.fieldwork.end}`,
    source_id: "europeelects",
    kind: "nemzetkozi",
    title: `Europe Elects – ${p.pollingFirm} pártpreferencia (${p.fieldwork.raw}): ${p.parties.filter((x) => x.pct != null).map((x) => `${x.name} ${x.pct}%`).join(", ")}`,
    published_at: `${p.fieldwork.end}T00:00:00.000Z`,
    first_seen_at: "2026-08-20T09:16:09.334Z",
    significance: "FIGYELENDO",
    relevant: 1,
    _firm: p.pollingFirm,
  }));
};

test("intézet-guard: KÜLÖNBÖZŐ kutatócégek polljai NEM vonódnak össze (cross-cég = 0)", () => {
  const items = buildItems();
  const institutes = deriveInstitutes(srcArr, dedup);
  const { representatives, merges } = groupStories(items, { cfg: dedup, institutes });
  const firmOf = new Map(items.map((it) => [it.canonical_key, it._firm]));
  let crossFirm = 0;
  for (const m of merges) {
    const repFirm = firmOf.get(m.representative);
    for (const mem of m.members) {
      if (repFirm && firmOf.get(mem.canonical_key) && repFirm !== firmOf.get(mem.canonical_key)) crossFirm++;
    }
  }
  assert.equal(crossFirm, 0, "két különböző kutatócég polljai összevonódtak — az intézet-guard nem tart");
  // minden poll önálló reprezentáns (adatpont, nem sztori)
  assert.equal(representatives.length, items.length, "minden europeelects-poll külön reprezentáns");
});

test("standalone_sources: egy nem-poll forrás normál story-merge-e ÉRINTETLEN (nincs globális regresszió)", () => {
  // két majdnem-azonos sajtócím (nem standalone forrás) → ÖSSZEVONHATÓ marad
  const items = [
    { canonical_key: "t1", source_id: "telex", kind: "sajto", title: "Leállt a paksi atomerőmű egyik blokkja karbantartás miatt", published_at: "2026-08-19T00:00:00.000Z", first_seen_at: "2026-08-20T09:16:09.334Z", significance: "FIGYELENDO", relevant: 1 },
    { canonical_key: "t2", source_id: "hvg", kind: "sajto", title: "Leállt a paksi atomerőmű egyik blokkja karbantartás miatt ma", published_at: "2026-08-19T00:00:00.000Z", first_seen_at: "2026-08-20T09:16:09.334Z", significance: "FIGYELENDO", relevant: 1 },
  ];
  const institutes = deriveInstitutes(srcArr, dedup);
  const { representatives } = groupStories(items, { cfg: dedup, institutes });
  assert.equal(representatives.length, 1, "a két sajtó-parafrázis továbbra is összevonódik (standalone csak a poll-forrásokra hat)");
});
