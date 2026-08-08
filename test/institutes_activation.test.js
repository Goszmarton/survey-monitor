import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectActiveSources } from "../src/collect.js";
import { fetchNew } from "../src/sources/rss.js";
import { prefilter, triageItems } from "../src/triage.js";
import { groupStories, deriveInstitutes } from "../src/lib/storygroup.js";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const cfg = JSON.parse(readFileSync(new URL("../config/dedup.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);

// Fixture-alapú feed-stub (a rss.test.js mintája): a ma lekért valós feed mentett példánya.
const fx = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
function resp(body, { status = 200, contentType = "application/rss+xml; charset=UTF-8" } = {}) {
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
const latestDay = (items) => new Date(Math.max(...items.map((i) => Date.parse(i.publishedAt)))).toISOString().slice(0, 10);

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

// --- feed-intézet aktiválás (2026-08-08): szazadveg + realpr93, rss.js-en, kódírás nélkül ---
// PIROS a sources.json-flip ELŐTT (szazadveg kaszt="?" / feed=/feed/ üres; realpr93 kaszt="B").
// ZÖLD, ha A-kasztra + a helyes feed-URL-re állítjuk. A parse a MA lekért valós feed
// mentett példányán fut (fixture) — a mért tételszám és legfrissebb dátum a szerződés.
test("feed-aktiválás: szazadveg A-feed a /cikkek/feed/-en (NEM /feed/), a mentett feed 10 tétel / legfr. 2026-08-03", async () => {
  const s = selectActiveSources(sources).find((x) => x.id === "szazadveg");
  assert.ok(s, "szazadveg aktív forrás (kaszt A + feed)");
  assert.equal(s.feed, "https://szazadveg.hu/cikkek/feed/", "a /cikkek/feed/ a helyes — a fő /feed/ ÜRES");
  const r = await fetchNew(s, { since: 0, fetchImpl: stub(fx("szazadveg_cikkek_feed.xml")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 10, "a mai mentett feed 10 tétele");
  assert.equal(latestDay(r.items), "2026-08-03", "legfrissebb tétel 2026-08-03");
});

test("feed-aktiválás: realpr93 B→A WordPress-feed, a mentett feed 10 tétel / legfr. 2026-02-09 (határeset-STALE)", async () => {
  const s = selectActiveSources(sources).find((x) => x.id === "realpr93");
  assert.ok(s, "realpr93 aktív forrás (kaszt B→A + feed)");
  assert.equal(s.feed, "https://realpr93.hu/feed/", "WordPress fő-feed");
  const r = await fetchNew(s, { since: 0, fetchImpl: stub(fx("realpr93_feed.xml")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 10, "a mai mentett feed 10 tétele");
  assert.equal(latestDay(r.items), "2026-02-09", "legfrissebb tétel 2026-02-09 — 180 nap, a STALE-határon");
});

// HTML-listás intézetek (list_url + per-source parser, feed NÉLKÜL) aktívak.
for (const id of ["21kutato", "republikon", "minerva", "opinio", "publicus"]) {
  test(`intézet-aktiválás: ${id} aktív HTML-listaként (list_url, feed nélkül)`, () => {
    const s = selectActiveSources(sources).find((x) => x.id === id);
    assert.ok(s, `${id} aktív forrás (A + list_url) — a collect felveszi`);
    assert.ok(!s.feed && /^https:\/\//.test(s.list_url), "list_url-lel, feed nélkül");
  });
}

// A többi (még be nem kötött) intézet MARAD inaktív.
test("intézet-aktiválás: a be nem kötött intézetek érintetlenek (nem aktív forrás)", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  const others = ["zavecz", "idea", "nezopont", "tarskutato"];
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
