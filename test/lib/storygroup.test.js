import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupStories, deriveInstitutes } from "../../src/lib/storygroup.js";

const cfg = JSON.parse(readFileSync(new URL("../../config/dedup.json", import.meta.url), "utf8"));
const { sources } = JSON.parse(readFileSync(new URL("../../config/sources.json", import.meta.url), "utf8"));
const institutes = deriveInstitutes(sources, cfg);

// A VALÓDI API a groupStories; az alábbiak csak teszt-helperek, amelyek a
// groupStories eredményét kényelmesebb alakra hozzák (NEM külön kódút).
// groups(): csoportonként a kanonikus kulcsok halmaza (a reprezentáns + press_urls-tagjai).
function groups(items, opts) {
  return groupStories(items, opts).representatives.map(
    (r) => new Set([r.canonical_key, ...(r._pressUrls ?? []).map((p) => p.canonical_key)]),
  );
}
// Halmaz-tagságos assertek — sorrend/elválasztó-függetlenek (nem string-egyezés).
const sameGroup = (gs, a, b) => gs.some((g) => g.has(a) && g.has(b));
const isSingleton = (gs, a) => gs.some((g) => g.has(a) && g.size === 1);
// Teljes csoportosítás sorrend-normalizált alakja — CSAK az indexelt vs naiv ekvivalencia
// összehasonlításhoz (két teljes csoportosítás egyenlőségéhez), nem tagsági assertekhez.
function groupingSets(items, opts) {
  return groups(items, opts).map((g) => [...g].sort().join("|")).sort();
}

const D1 = "2026-07-22T06:00:00Z";
const D2 = "2026-07-23T06:00:00Z";

// Reprezentatív fixture (a valós 47 KIEMELT dup-esetei kicsiben)
function fixture() {
  return [
    // ügyész — 3 forrás, ugyanaz a sztori (containment)
    { canonical_key: "telex:ugyesz", source_id: "telex", kind: "sajto", title: "Lemondott a legfőbb ügyész", first_seen_at: D2, significance: "KIEMELT", freshness: "UJ_24H" },
    { canonical_key: "444:ugyesz", source_id: "444", kind: "sajto", title: "Lemondott a legfőbb ügyész", first_seen_at: D2, significance: "FONTOS", freshness: "UJ_24H" },
    { canonical_key: "infostart:ugyesz", source_id: "infostart", kind: "sajto", title: "Lemond a legfőbb ügyész", first_seen_at: D2, significance: "FIGYELENDO", freshness: "UJ_24H" },
    // Závecz ×2 (ugyanaz az intézet → összevonható)
    { canonical_key: "nepszava:zavecz", source_id: "nepszava", kind: "sajto", title: "Závecz: Tisza 74 százalék, Fidesz 19", first_seen_at: D2, significance: "KIEMELT", freshness: "UJ_24H" },
    { canonical_key: "telex:zavecz", source_id: "telex", kind: "sajto", title: "Závecz Research: 74 százalékon a Tisza", first_seen_at: D2, significance: "KIEMELT", freshness: "UJ_24H" },
    // Medián — SZÁNDÉKOSAN a Závecz-cel majdnem azonos szöveg, de MÁS intézet → guard tiltja
    { canonical_key: "hvg:median", source_id: "hvg", kind: "sajto", title: "Medián Research: 74 százalékon a Tisza", first_seen_at: D2, significance: "KIEMELT", freshness: "UJ_24H" },
    // KSH a sajtóvisszhang UTÁN: tegnapi sajtó + mai hivatalos_adat → egy sztori,
    // rep = KSH (hivatalos), és NEM új (a csoport legkorábbi tagja tegnapi).
    { canonical_key: "telex:infl", source_id: "telex", kind: "sajto", title: "KSH inflációs gyorsjelentés jön kedden", first_seen_at: D1, significance: "FONTOS", freshness: "KORABBI" },
    { canonical_key: "ksh:infl", source_id: "ksh", kind: "hivatalos_adat", title: "KSH inflációs gyorsjelentés: 5 százalék", first_seen_at: D2, significance: "KIEMELT", freshness: "UJ_24H" },
    // singleton
    { canonical_key: "portfolio:x", source_id: "portfolio", kind: "sajto", title: "Egyedi elemzés a forint árfolyamáról", first_seen_at: D2, significance: "FONTOS", freshness: "UJ_24H" },
  ];
}

test("storygroup: azonos sztori több forrásból egy csoportba (containment)", () => {
  const { representatives } = groupStories(fixture(), { cfg, institutes });
  const ugyesz = representatives.find((r) => r.canonical_key.includes("ugyesz"));
  assert.equal(ugyesz._groupSize, 3, "3 ügyész-forrás egy sztori");
  // groupSig = legerősebb tag (KIEMELT), bár a rep-en más is lehetett
  assert.equal(ugyesz.significance, "KIEMELT");
});

test("storygroup: INTÉZET-GUARD — Závecz és Medián SOHA nem egy csoport (küszöbök fölött)", () => {
  const gs = groups(fixture(), { cfg, institutes });
  assert.ok(sameGroup(gs, "nepszava:zavecz", "telex:zavecz"), "a két Závecz összevonva");
  assert.ok(!sameGroup(gs, "nepszava:zavecz", "hvg:median"), "a Medián NINCS a Závecz-csoportban (guard)");
  // a Medián önálló marad, pedig szövegre majdnem azonos
  assert.ok(isSingleton(gs, "hvg:median"), "Medián önálló sztori");
});

test("storygroup: TAGSÁGI INVARIÁNS — a DISTINCT kulcsok halmaza (g.size) === _groupSize", () => {
  // _groupSize = members.length (a union-find belső tagsága). A groups() a rep + press_urls
  // canonical_key-eiből Set-et épít; ha bármelyik press_url duplikált vagy a reprezentánssal
  // egyezik, g.size < _groupSize → a teszt elbukik. Így NEM körkörös: a tényleges,
  // deduplikált projekcióméretet veti össze a belső tagszámmal.
  const items = fixture();
  const { representatives } = groupStories(items, { cfg, institutes });
  const gs = groups(items, { cfg, institutes }); // ugyanaz a determinisztikus sorrend (groupStories nem memoizál)
  // Üresjárat-védelem: a teszt csak akkor mér, ha van többtagú csoport és igazodnak az indexek.
  assert.equal(gs.length, representatives.length, "index-párosítás előfeltétele");
  assert.ok(representatives.some((r) => r._groupSize > 1), "a fixture-nek tartalmaznia kell legalább egy többtagú csoportot");
  representatives.forEach((r, i) => {
    assert.ok(gs[i].has(r.canonical_key), "a reprezentáns benne van a saját csoportjában");
    assert.equal(gs[i].size, r._groupSize, `${r.canonical_key}: distinct kulcsok = _groupSize (nincs duplikált/átfedő tag)`);
  });
});

test("storygroup: reprezentáns a leghitelesebb forrás (hivatalos_adat > sajto)", () => {
  const { representatives } = groupStories(fixture(), { cfg, institutes });
  const infl = representatives.find((r) => r.canonical_key === "ksh:infl" || (r._pressUrls ?? []).some((p) => p.canonical_key === "ksh:infl"));
  assert.equal(infl.canonical_key, "ksh:infl", "a KSH (hivatalos_adat) a reprezentáns, nem a sajtó");
  assert.ok((infl._pressUrls ?? []).some((p) => p.canonical_key === "telex:infl"), "a sajtó a press_urls-ben");
});

test("storygroup: ÚJ SZTORI a csoport legkorábbi tagjából — KSH a sajtó után NEM új", () => {
  const { representatives } = groupStories(fixture(), { cfg, institutes });
  const infl = representatives.find((r) => r.canonical_key === "ksh:infl");
  assert.equal(infl._groupFirstSeen, D1, "a csoport-min a tegnapi sajtó first_seen-je");
  assert.notEqual(infl._groupFirstSeen, D2, "tehát a mai futásban NEM számít új sztorinak");
  // egytagú mai tétel viszont új
  const solo = representatives.find((r) => r.canonical_key === "portfolio:x");
  assert.equal(solo._groupFirstSeen, D2);
  assert.equal(solo._groupSize, 1);
});

test("storygroup: az inverz-indexes és a naiv O(n²) UGYANAZT a csoportosítást adja", () => {
  const indexed = groupingSets(fixture(), { cfg, institutes });
  const naive = groupingSets(fixture(), { cfg, institutes, _naive: true });
  assert.deepEqual(indexed, naive);
});

test("storygroup: merges-napló szerkezete — minden tag pontosan egyszer, rule a 3 megengedettből", () => {
  const { representatives, merges } = groupStories(fixture(), { cfg, institutes });
  const memberKeys = merges.flatMap((m) => m.members.map((x) => x.canonical_key));
  assert.equal(memberKeys.length, new Set(memberKeys).size, "nincs duplikált tag a naplóban");
  // a reprezentánsok NEM szerepelnek tagként (ők a story-fej)
  const repKeys = new Set(representatives.map((r) => r.canonical_key));
  for (const k of memberKeys) assert.ok(!repKeys.has(k), `${k} nem lehet egyszerre rep és tag`);
  for (const m of merges) for (const mem of m.members) {
    assert.match(mem.rule, /^containment |^trigram-dice |^tranzitív$/, `megengedett szabály: ${mem.rule}`);
  }
});

test("storygroup: ÜRES token-halmazú címek SOHA nem vonódnak össze (nincs NaN/óriáscsoport)", () => {
  // Csupa-stopszó cím → 0 salient token. A contain = n/(min||1) = 0 (nem NaN), és
  // mindkét ág ≥1 közös tokent követel → nincs él. Két ilyen tétel külön marad.
  // SZÁNDÉKOS: két SZÓ SZERINT azonos, csupa-stopszó cím (a:1 és a:3 "a az egy és")
  // is KÜLÖN marad — ez a biztonságos irány. NE tegyél ide nyers cím-egyezés fallbacket:
  // egy csupa-stopszó cím nem hordoz sztori-azonosságot, az összevonása hamis lenne.
  const items = [
    { canonical_key: "a:1", source_id: "telex", kind: "sajto", title: "a az egy és", first_seen_at: D2 },
    { canonical_key: "a:2", source_id: "444", kind: "sajto", title: "de vagy is meg", first_seen_at: D2 },
    { canonical_key: "a:3", source_id: "hvg", kind: "sajto", title: "a az egy és", first_seen_at: D2 }, // szó szerint azonos a:1-gyel
  ];
  const { representatives, merges } = groupStories(items, { cfg, institutes });
  assert.equal(representatives.length, 3, "minden üres-token cím külön sztori (a szó szerint azonos is)");
  assert.equal(merges.length, 0);
  for (const r of representatives) assert.ok(Number.isFinite(r._groupSize) && r._groupSize === 1);
});

test("storygroup: EGYTOKENES címek — közös token + trigram-egyezés összevon, eltérő token nem", () => {
  const items = [
    { canonical_key: "x:1", source_id: "telex", kind: "sajto", title: "Aszály", first_seen_at: D2 },
    { canonical_key: "x:2", source_id: "444", kind: "sajto", title: "Aszály", first_seen_at: D2 }, // azonos → trigram-dice 1.0
    { canonical_key: "y:1", source_id: "hvg", kind: "sajto", title: "Infláció", first_seen_at: D2 }, // más token → külön
  ];
  const gs = groups(items, { cfg, institutes });
  assert.ok(sameGroup(gs, "x:1", "x:2"), "az azonos egytokenes cím összevonódik (trigram-ág, n=1)");
  assert.ok(!sameGroup(gs, "x:1", "y:1"), "az eltérő tokenű egytokenes cím külön marad");
  assert.ok(isSingleton(gs, "y:1"));
});

test("storygroup: EGYOLDALI token — a stopszó-eltávolítás NÖVELHETI a hasonlóságot (nevező fogy, számláló nem)", () => {
  // FIGYELEM: ez ismert ÉRZÉKENYSÉGET dokumentál, NEM kívánatos viselkedést. Ha a metrika
  // változik (pl. abszolút minimum közös token, más normalizálás), ezt a tesztet SZÁNDÉKOSAN
  // kell módosítani — nem „elromlott", hanem a dokumentált hibamód eltűnt/megváltozott.
  // A teszt a jelenlegi küszöbre van kalibrálva; ha ez változik, a hibaüzenet megmondja:
  assert.equal(cfg.containment_min, 0.5, "a teszt a 0.5-ös containment-küszöbre kalibrált");
  assert.equal(cfg.containment_min_tokens, 2, "a teszt a 2 közös token minimumra kalibrált");
  // Két cím, közös {tisza, kutatas} (n=2). Az A-ban van egy extra token ("magyar"),
  // a B-ben nincs. containment = n / min(|A|,|B|). Base: min=5 → 2/5=0.4 < 0.5 → NEM összevonva.
  // Ha "magyar"-t stopszóvá tennénk: A mérete 5→4, min=4 → 2/4=0.5 ≥ 0.5 → ÁTBILLEN → összevonva.
  // Ez a hibamód: stopszó-bővítés NÖVELHETI a hasonlóságot (unió/nevező fogy, metszet nem).
  const items = [
    { canonical_key: "A", source_id: "telex", kind: "sajto", title: "Tisza kutatás magyar régió alföld", first_seen_at: D2 },
    { canonical_key: "B", source_id: "444", kind: "sajto", title: "Tisza kutatás dunántúl budapest pécs", first_seen_at: D2 },
  ];
  const base = groups(items, { cfg, institutes });
  assert.ok(!sameGroup(base, "A", "B"), "alap stoplistával a küszöb alatt → külön");

  const widened = { ...cfg, stopwords: [...cfg.stopwords, "magyar"] }; // egyoldali token eltávolítása
  const after = groups(items, { cfg: widened, institutes });
  assert.ok(sameGroup(after, "A", "B"), "a stopszó-bővítés átbillenti a küszöbön → ÖSSZEVONVA (érzékenység igazolva)");
});

// --- dedup (a): a reprezentáns IDENTITÁSA a legmagasabb significance-ű tag legyen ---
// VALÓS eset, verifikálva a commitolt state/monitor.db-ből (2026-07-31): a Paks-
// energiakrízis összevont (15-tagú) csoportjában a KIEMELT „Le kell állítani a Paksi
// Atomerőművet" (444) egy FONTOS reprezentáns ALÁ került, mert a rep-választás
// significance-VAK: kind → first_seen → canonical_key (storygroup.js). A groupSig a rep
// significance MEZŐJÉT felhúzza KIEMELT-re (így a csoport megjelenik a KIEMELT-levélben),
// DE a rep IDENTITÁSA (cím/url) a FONTOS tagé marad → a levélben a KIEMELT-sztori
// félrevezető, rutinnak hangzó cím alatt szerepel, a valódi KIEMELT headline a +N
// press-linkbe süllyed (nem kihagyás, hanem FÉLREKERETEZÉS — ARCHITEKTURA.md 2–3.).
// Ez a fixture a 15-tagú csoport minimális, KÖZVETLENÜL összeolvadó valós részhalmaza
// (a tranzitív láncolódás külön kérdés = dedup(b)); a két cím ≥2 közös salient tokenen
// (paks, atomeromuv, kell, allitan) merge-öl. A teszt MOST PIROS: a rep a korábbi
// first_seen-ű FONTOS tétel, nem a KIEMELT.
test("storygroup: dedup (a) — a reprezentáns a legmagasabb significance-ű tag (KIEMELT nem rejtőzhet FONTOS rep alá)", () => {
  const KIEMELT_KEY = "444:https-444-hu-2026-07-30-le-kell-allitani-a-paksi-atomeromuvet";
  const items = [
    // FONTOS, KORÁBBI first_seen → a jelenlegi (significance-vak) rep-választás EZT teszi reprezentánssá.
    { canonical_key: "telex:https-telex-hu-belfold-2026-07-29-magyar-peter-hoseg-aszaly-vizallas-paks-bejelentes",
      source_id: "telex", kind: "sajto",
      title: "Magyar Péter szerint akkor sincs veszélyben az energiaellátás, ha le kell állítani a Paksi Atomerőművet",
      url: "https://telex.hu/belfold/2026/07/29/paks", significance: "FONTOS", freshness: "UJ_24H",
      first_seen_at: "2026-07-30T06:11:39.722Z" },
    // KIEMELT, későbbi first_seen → MOST a press_urls-be süllyed a rep helyett.
    { canonical_key: KIEMELT_KEY, source_id: "444", kind: "sajto",
      title: "Le kell állítani a Paksi Atomerőművet",
      url: "https://444.hu/2026/07/30/le-kell-allitani-a-paksi-atomeromuvet", significance: "KIEMELT", freshness: "UJ_24H",
      first_seen_at: "2026-07-31T06:32:34.181Z" },
  ];
  const { representatives } = groupStories(items, { cfg, institutes });
  assert.equal(representatives.length, 1, "a két cím egy sztoriba olvad (≥2 közös salient token)");
  const rep = representatives[0];
  assert.equal(rep._groupSize, 2);
  // A LÉNYEG: a reprezentáns IDENTITÁSA a KIEMELT tag legyen — a levél headline-ja a
  // KIEMELT cím, ne a FONTOS. (A rep.significance mezője groupSig miatt amúgy is KIEMELT;
  // itt az identitást — canonical_key/cím/url — állítjuk, az a valódi hibamód.)
  assert.equal(rep.canonical_key, KIEMELT_KEY,
    "a reprezentáns a legmagasabb significance-ű (KIEMELT) tag, nem a korábbi first_seen-ű FONTOS");
});

// --- dedup (b): a láncolódó over-merge — az Eurostat-6-blob (VALÓS, 2026-07-22) ---
// Hat KÜLÖNBÖZŐ Eurostat-közlemény (infláció, termelői ár, kisker, szolgáltatás, ipari
// termelés, építőipar) egyetlen csoportba olvad, mert a stemmelt salient tokenek közt a
// "euro"+"are" (az "area" a stemmertől "are") + a százalék-számjegyek (0,2,3) tartalmatlan
// bridging-tokeneket adnak: 15 párból 7 közvetlen élt húznak, a union-find tranzitív
// lezárása ebből egy 6-blobbá láncolja. Ez CSENDES INFÓVESZTÉS (ARCHITEKTURA 2–3.): a hat
// önálló közlemény egyetlen reprezentáns alá bújik. A teszt állítja, hogy ezek NEM egy
// csoport. MOST PIROS. (A fix iránya külön mérés dönti; a teszt fix-agnosztikus: a
// nyilvánvalóan független infláció és építőipar nem lehet egy sztori.)
test("storygroup: dedup (b) — az Eurostat 6 különböző közleménye NEM egy csoport (láncolódó over-merge)", () => {
  const D = "2026-07-22T06:00:00Z";
  const mk = (code, title) => ({ canonical_key: `eurostat:https-ec-europa-eu-eurostat-product-code-${code}`, source_id: "eurostat", kind: "hivatalos_adat", title, significance: "FONTOS", freshness: "UJ_24H", first_seen_at: D });
  const items = [
    mk("2-17072026-ap", "Annual inflation down to 2.8% in the euro area"),
    mk("4-06072026-ap", "Industrial producer prices up by 0.2% in both the euro area and the EU"),
    mk("4-06072026-bp", "Volume of retail trade up by 0.2% in the euro area and by 0.5% in the EU"),
    mk("4-07072026-ap", "Services production up by 0.7% in the euro area and by 0.3% in the EU"),
    mk("4-15072026-ap", "Industrial production down by 0.2% in the euro area and by 0.1% in the EU"),
    mk("4-20072026-ap", "Production in construction up by 0.4% in the euro area and by 0.3% in the EU"),
  ];
  const gs = groups(items, { cfg, institutes });
  // (1) nem szabad EGYETLEN blobba olvadniuk
  assert.ok(gs.length > 1, `a 6 különböző közlemény nem lehet egyetlen csoport (most: ${gs.length} csoport)`);
  // (2) a két legnyilvánvalóbban független közlemény külön sztori kell legyen
  const inflation = "eurostat:https-ec-europa-eu-eurostat-product-code-2-17072026-ap";
  const construction = "eurostat:https-ec-europa-eu-eurostat-product-code-4-20072026-ap";
  assert.ok(!sameGroup(gs, inflation, construction), "az infláció és az építőipari termelés NEM ugyanaz a sztori");
});

// A title_generic_tokens kulcs LOAD-BEARING: nélküle (euro/area salient tokenné válik)
// a hat közlemény visszaolvad egyetlen blobbá. A teszt védi a kulcsot a néma törléstől
// (analóg az intézet-lista load-bearing tesztjével), és bizonyítja, hogy PONTOSAN ez a
// mechanizmus oldja a dedup(b) Eurostat-esetet — nem a küszöb, nem a stoplista.
test("storygroup: dedup (b) — a title_generic_tokens kulcs LOAD-BEARING (nélküle visszatér a blob)", () => {
  const D = "2026-07-22T06:00:00Z";
  const mk = (code, title) => ({ canonical_key: `eurostat:${code}`, source_id: "eurostat", kind: "hivatalos_adat", title, significance: "FONTOS", freshness: "UJ_24H", first_seen_at: D });
  const items = [
    mk("infl", "Annual inflation down to 2.8% in the euro area"),
    mk("ppi", "Industrial producer prices up by 0.2% in both the euro area and the EU"),
    mk("retail", "Volume of retail trade up by 0.2% in the euro area and by 0.5% in the EU"),
    mk("services", "Services production up by 0.7% in the euro area and by 0.3% in the EU"),
    mk("indprod", "Industrial production down by 0.2% in the euro area and by 0.1% in the EU"),
    mk("constr", "Production in construction up by 0.4% in the euro area and by 0.3% in the EU"),
  ];
  // A jelenlegi cfg-vel (title_generic_tokens jelen) NEM egy csoport:
  assert.ok(groups(items, { cfg, institutes }).length > 1, "generikus-kulccsal szét van választva");
  // A kulcs KIVÉTELÉVEL (üres title_generic_tokens) viszont egyetlen blobbá olvad
  // (a services/indprod hidakon át a 6 közlemény tranzitívan egy komponens):
  const cfgNoGeneric = { ...cfg, title_generic_tokens: [] };
  assert.equal(groups(items, { cfg: cfgNoGeneric, institutes }).length, 1, "a kulcs nélkül a 6 közlemény egy blob — a kulcs load-bearing");
});

// --- dedup(b)/C-star: a láncolódó mega-blob korlátozása same-story-megőrzéssel ---
// A valós 2026-08-07 korpusz 318-tagú blobjából vett HŰ szelet: egy „Magyar Péter" hub-tétel
// (rövid, generikus cím) a containment-ágon KÉT KÜLÖNBÖZŐ sztorihoz is kötődik — a Romsics-
// találkozó hármashoz ÉS a Paks-leállás hármashoz. A tranzitív closure emiatt egyetlen 7-tagú
// blobba olvasztja a két független sztorit (baseline: 1 csoport). A C-star (rekurzív star-
// dekompozíció + dice-repair) szétbontja a hamis containment-hidat, de a KÉT valódi parafrázis-
// hármast EGYBEN tartja (a dice-repair garanciája). A fixture 7 tétel < a produkciós gate (30),
// ezért a teszt alacsony gate-tel (decompose_min_component:3) hívja — a MECHANIZMUST teszteli,
// nem a küszöböt. A naiv C-star (repair nélkül) a hármasokat is szétárvázná → ez a regressziós védő.
function cstarFixture() {
  const mk = (id, title, sig = "FIGYELENDO") => ({ canonical_key: id, source_id: id.split(":")[0], kind: "sajto", title, first_seen_at: "2026-08-04T06:00:00Z", significance: sig, freshness: "UJ_24H" });
  return [
    // Romsics-találkozó sztori — 3 parafrázis (kölcsönös trigram-dice ≥ 0.55)
    mk("telex:r1", "Romsics Ignác történésszel találkozott Magyar Péter és Ruff Bálint"),
    mk("444:r2", "Romsics Ignáccal találkozott Magyar Péter és Ruff Bálint"),
    mk("hvg:r3", "Romsics Ignáccal találkozott Magyar Péter"),
    // Paks-leállás sztori — 3 parafrázis, KIEMELT primer
    mk("telex:p1", "Magyar Péter: vasárnap leáll a paksi atomerőmű", "KIEMELT"),
    mk("444:p2", "Magyar Péter: Vasárnap leáll a Paksi Atomerőmű"),
    mk("hvg:p3", "Magyar Péter: A Paksi Atomerőmű leállítása semmilyen nukleáris veszélyt nem jelent"),
    // hub-híd: rövid, generikus „Magyar Péter" cím — magyar+peter-en át MINDKÉT sztorihoz köt
    mk("24hu:h0", "Magyar Péter leadta a vészjelzést"),
  ];
}

test("storygroup: dedup(b)/C-star — a hub-hídon lógó blob szétesik (Romsics ≠ Paks sztori)", () => {
  const items = cstarFixture();
  const lowGate = { ...cfg, decompose_min_component: 3 };
  // baseline (a jelenlegi produkciós gate=30 a 7-tagú komponenst NEM bontja): egyetlen blob
  assert.equal(groups(items, { cfg, institutes }).length, 1, "gate=30 alatt a 7-tagú komponens érintetlen (egy blob) — a bontás a mega-blobra szabott");
  // C-star aktív (alacsony gate): a két független sztori KÜLÖN csoport
  const gs = groups(items, { cfg: lowGate, institutes });
  assert.ok(gs.length >= 2, `a blob szétesik (most: ${gs.length} csoport)`);
  assert.ok(!sameGroup(gs, "telex:r1", "telex:p1"), "a Romsics-találkozó és a Paks-leállás NEM ugyanaz a sztori");
});

test("storygroup: dedup(b)/C-star — a valódi parafrázis-hármasok EGYBEN maradnak (dice-repair, naiv C-star ellen)", () => {
  const gs = groups(cstarFixture(), { cfg: { ...cfg, decompose_min_component: 3 }, institutes });
  // regressziós védő: a dice-repair NÉLKÜL (naiv C-star) ezek a hármasok szétárvázódnának
  assert.ok(sameGroup(gs, "telex:r1", "444:r2") && sameGroup(gs, "444:r2", "hvg:r3"), "a Romsics-hármas egy csoport marad");
  assert.ok(sameGroup(gs, "telex:p1", "444:p2") && sameGroup(gs, "444:p2", "hvg:p3"), "a Paks-hármas egy csoport marad");
});

test("storygroup: intézet-lista NÉLKÜL a guard nem véd — a lista load-bearing (ezért WARN a run.js-ben)", () => {
  // Guard nélkül a Medián a Závecz-cel összevonódna (majdnem azonos szöveg) — ez a
  // hibamód, amit a config/intézet-lista megléte zár ki. Ha a run.js elfelejtené
  // átadni, ez csendes infóvesztés lenne → a run.js WARN-t naplóz a config-hiányról.
  const setsNoInst = groupStories(fixture(), { cfg, institutes: [] }).representatives
    .map((r) => [r.canonical_key, ...(r._pressUrls ?? []).map((p) => p.canonical_key)].sort().join("|"));
  const zavecz = setsNoInst.find((s) => s.includes("nepszava:zavecz"));
  assert.ok(zavecz.includes("hvg:median"), "intézet-lista nélkül a Medián tévesen összevonódik — a guard load-bearing");
});

// ---- rep-centralitás a tie-breakben (2026-08-14) ----
// A rep azonos significance mellett eddig KIND→first_seen→ck szerint dőlt el. Egy nagy,
// KOHÉZÍV klaszterben (mind FONTOS/sajto) a legkorábbi tag lehet egy PERIFÉRIÁS cím, míg
// a valódi központi sztori csak tag → a levél félrevezet. A 08-13-i +52 Paks-merge élő
// esete: a perifériás „díszkivilágítás" lett a főcím a központi „teljesen leáll a Paksi
// Atomerőmű" helyett. A fix: a KIND UTÁN, a first_seen ELÉ a csoporton belüli edgeRule-
// szomszédsági FOK (a legcentrálisabb tag a rep). A KIND elsőbbsége marad → a primer-forrás
// (hivatalos_adat/kutatas) NEM veszti el a rep-séget egy központibb sajtó-cím miatt.
function centralityFixture() {
  // Hub-token „magyar péter" felhő (c a legcentrálisabb, foka 4) + perifériás SZUPERHALMAZ
  // p (nincs benne „magyar péter", csak a „leáll a Paksi Atomerőmű" tokeneken lóg c-hez → fok 1).
  // p a LEGKORÁBBI first_seen → a régi tie-break p-t választaná (a bug); a fix c-t.
  const F = (k, s, t, fs) => ({ canonical_key: k, source_id: s, kind: "sajto", title: t, url: `x/${k}`, first_seen_at: fs, significance: "FONTOS", freshness: "UJ_24H" });
  return [
    F("p", "444", "Budapesten lekapcsolják a díszkivilágítást, ha leáll a Paksi Atomerőmű", "2026-08-01T00:00:00Z"),
    F("c", "nepszava", "Magyar Péter: Teljesen leáll a Paksi Atomerőmű", "2026-08-02T00:00:00Z"),
    F("m1", "telex", "Magyar Péter bejelentése", "2026-08-02T01:00:00Z"),
    F("m2", "hvg", "Magyar Péter nyilatkozata", "2026-08-02T02:00:00Z"),
    F("m3", "portfolio", "Magyar Péter üzenete", "2026-08-02T03:00:00Z"),
  ];
}

test("storygroup: rep-centralitás — azonos significance+kind mellett a legcentrálisabb (edgeRule-fok) tag a rep, nem a legkorábbi perifériás", () => {
  const { representatives } = groupStories(centralityFixture(), { cfg, institutes });
  const rep = representatives.find((r) => r._groupSize > 1);
  assert.equal(rep._groupSize, 5, "az öt Paks-tétel egy csoport");
  // c foka 4 (p, m1, m2, m3), p foka 1 (csak c) — a régi first_seen p-t adott, a fix c-t.
  assert.equal(rep.canonical_key, "c", "a központi „teljesen leáll” a rep, nem a perifériás, korábban látott „díszkivilágítás”");
  assert.ok((rep._pressUrls ?? []).some((x) => x.canonical_key === "p"), "a perifériás tétel a press_urls-be süllyed");
});

test("storygroup: rep-centralitás guard — hamis fúziónál (over-merge) a fok-döntetlen NEM ront (first_seen marad)", () => {
  // ELVI KORLÁT: ez a három KSH-hír ELLENTÉTES jelentésű (kiskereskedelem NŐTT vs építőipar
  // ESETT), csak a generikus „tovább”/„júniusban” tokeneken hídolva egy hamis fúzióba (a #2
  // hub-token over-merge tétel, TUDATOSAN halasztva — itt NEM oldjuk meg). A centralitás egy
  // over-merge-et nem tud jól rep-elni; a cél csak annyi, hogy NE rontson. Itt mindhárom tag
  // foka 2 (háromszög) → a fok DÖNTETLEN → a tie-break a régi first_seen-re esik vissza →
  // a rep VÁLTOZATLAN. (A korábbi sum-dice jel ezt „építőipar”-ra billentette volna — az edgeRule-
  // fok nem.) A teszt rögzíti: tudjuk, mi történik itt, és nem véletlenül.
  const F = (k, s, t, fs) => ({ canonical_key: k, source_id: s, kind: "sajto", title: t, url: `x/${k}`, first_seen_at: fs, significance: "FONTOS", freshness: "UJ_24H" });
  const items = [
    F("k1", "hvg", "Tovább pörgött a kiskereskedelem júniusban", "2026-08-06T00:00:00Z"),
    F("k2", "telex", "Tovább zuhant az építőipar teljesítménye júniusban", "2026-08-13T00:00:00Z"),
    F("k3", "portfolio", "Az ipari termelés nőtt, az építőipar tovább esett júniusban", "2026-08-13T01:00:00Z"),
  ];
  const rep = groupStories(items, { cfg, institutes }).representatives.find((r) => r._groupSize > 1);
  assert.equal(rep._groupSize, 3, "a három hír egy (hamis) fúzió");
  assert.equal(rep.canonical_key, "k1", "fok-döntetlen → a legkorábbi first_seen marad a rep, a változás nem billenti ellentétes jelentésű címre");
});
