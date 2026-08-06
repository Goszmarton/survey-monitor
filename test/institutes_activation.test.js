import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectActiveSources } from "../src/collect.js";
import { prefilter, triageItems } from "../src/triage.js";
import { groupStories, deriveInstitutes } from "../src/lib/storygroup.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const cfg = JSON.parse(readFileSync(new URL("../config/dedup.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);

// --- 3. pont: reprodukció — a collect FELVESZI median + iranytu forrásokat ---
// A run.js loadSources a selectActiveSources-t hívja, és a collect() KIZÁRÓLAG az így
// kiválasztott forrásokat kapja. PIROS a sources.json-flip ELŐTT (median kaszt="?",
// iranytu kaszt="B" → nincs kiválasztva); ZÖLD, ha A-kasztra + feed-re állítjuk.
test("intézet-aktiválás: a collect felveszi a median és iranytu forrást (A-kaszt + feed)", () => {
  const active = selectActiveSources(sources);
  const ids = new Set(active.map((s) => s.id));
  for (const id of ["median", "iranytu"]) {
    assert.ok(ids.has(id), `${id} aktív forrás (kaszt A + feed) — a collect felveszi`);
    const s = active.find((x) => x.id === id);
    assert.ok(s.feed && /^https:\/\//.test(s.feed), `${id} verifikált https feed-URL-lel`);
  }
});

// HTML-listás intézetek (list_url + per-source parser, feed NÉLKÜL) aktívak.
for (const id of ["21kutato", "republikon"]) {
  test(`intézet-aktiválás: ${id} aktív HTML-listaként (list_url, feed nélkül)`, () => {
    const s = selectActiveSources(sources).find((x) => x.id === id);
    assert.ok(s, `${id} aktív forrás (A + list_url) — a collect felveszi`);
    assert.ok(!s.feed && /^https:\/\//.test(s.list_url), "list_url-lel, feed nélkül");
  });
}

// A többi (még be nem kötött) intézet MARAD inaktív.
test("intézet-aktiválás: a be nem kötött intézetek érintetlenek (nem aktív forrás)", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  const others = ["zavecz", "publicus", "idea", "nezopont",
    "szazadveg", "realpr93", "opinio", "tarskutato", "minerva"];
  for (const id of others) assert.ok(!activeIds.has(id), `${id} NEM aktív (még nincs bekötve)`);
});

// --- 1. pont: az intézet-guard él a median≠iranytu párra (eddig üresben futott) ---
// Két majdnem azonos szövegű tétel KÜLÖNBÖZŐ intézettől SOHA nem vonódhat össze
// (a Závecz≠Medián guard analógja). Most válik load-bearinggé, mert primer anyag jön tőlük.
test("intézet-guard: median és iranytu azonos számadata KÜLÖN sztori marad", () => {
  const items = [
    { canonical_key: "median:p1", source_id: "median", kind: "kutatas", title: "Medián: Tisza 45 százalék, Fidesz 32 százalék", first_seen_at: "2026-08-07T06:00:00Z", significance: "KIEMELT", freshness: "UJ_24H" },
    { canonical_key: "iranytu:p1", source_id: "iranytu", kind: "kutatas", title: "Iránytű: Tisza 45 százalék, Fidesz 32 százalék", first_seen_at: "2026-08-07T06:00:00Z", significance: "KIEMELT", freshness: "UJ_24H" },
  ];
  const { representatives } = groupStories(items, { cfg, institutes });
  assert.equal(representatives.length, 2, "különböző intézet → a guard tiltja az összevonást (2 külön sztori)");
});

// Kontroll: ugyanaz az intézet (median×2) VISZONT összevonható — a guard nem vak szétválasztó.
test("intézet-guard: UGYANAZ az intézet (median két forrásból) összevonódik", () => {
  const items = [
    { canonical_key: "median:a", source_id: "median", kind: "kutatas", title: "Medián: Tisza 45 százalék, Fidesz 32 százalék", first_seen_at: "2026-08-07T06:00:00Z", significance: "KIEMELT", freshness: "UJ_24H" },
    { canonical_key: "telex:median", source_id: "telex", kind: "sajto", title: "Medián: Tisza 45 százalék, Fidesz 32 százalék", first_seen_at: "2026-08-07T06:00:00Z", significance: "FONTOS", freshness: "UJ_24H" },
  ];
  const { representatives } = groupStories(items, { cfg, institutes });
  assert.equal(representatives.length, 1, "azonos intézet (median) a sajtóvisszhanggal egy sztori");
  // dedup(a): a primer, KIEMELT intézeti tétel a reprezentáns (nem a FONTOS sajtócím)
  assert.equal(representatives[0].canonical_key, "median:a", "a primer intézeti tétel a reprezentáns (dedup(a))");
});

// --- 3. pont (folyt.): az intézeti tétel data_backed-KÉPES ---
// (a) Strukturálisan eljut a triázsig — a prefilter NEM ejti (nem eurostat-churn, nem sajtó-exclude).
test("intézet-tétel: a prefilter NEM ejti (eljut a triázsig, ahol data_backed lehet)", () => {
  const it = { canonical_key: "median:x", source_id: "median", kind: "kutatas", title: "Medián: 45 százalékon a Tisza" };
  assert.equal(prefilter(it, { keywords: [], exclude_patterns: [] }), "LLM");
});

// (b) Ha a triázs data_backed=true + KIEMELT ítéletet ad egy intézeti tételre, a kapu
// MEGTARTJA a KIEMELT-et (szemben a data_backed=false sajtóhírrel, ami FIGYELENDO-ra esik).
test("intézet-tétel: data_backed=true KIEMELT ítélet átmegy a kapun (KIEMELT-képes)", async () => {
  const items = [{ canonical_key: "median:y", source_id: "median", kind: "kutatas", title: "Medián: rekord pártpreferencia-változás" }];
  const completeFn = async () => ({ data: [{ id: 1, relevant: true, significance: "KIEMELT", data_backed: true, kind: "kutatas" }], provider: "gemini", model: "m" });
  const { verdicts } = await triageItems(items, { completeFn, prefilterCfg: { keywords: [], exclude_patterns: [] }, log: [], batchSize: 1 });
  const v = verdicts.get("median:y");
  assert.equal(v.significance, "KIEMELT", "az intézeti primer adat KIEMELT-je NEM esik FIGYELENDO-ra");
  assert.equal(v.data_backed, true);
});
