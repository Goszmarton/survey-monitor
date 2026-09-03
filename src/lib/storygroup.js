// Cross-source story-dedup (spec 13., F2 javító kör). Tisztán determinisztikus,
// LLM NÉLKÜL. A forrásonkénti canonical_key marad (dedup + first_seen stabilitás);
// e fölé story-csoportokat képzünk: azonos hír több forrásból → egy reprezentatív
// tétel (a leghitelesebb forrás), a többi press_urls-be.
//
// Hasonlóság — HIBRID, precízió-fókusz (küszöbök config/dedup.json-ból):
//   (A) stemmelt salient-token CONTAINMENT ≥ containment_min (≥ N közös token) — a
//       szerkezetében átfedő címeket fogja meg;
//   (B) karakter-TRIGRAM Dice ≥ trigram_dice_min (+ ≥1 közös salient token guard) —
//       az inflexiós/elgépelt variánsokat is (pl. "aszály"/"aszályos", "oszág").
//
// INTÉZET-GUARD — KEMÉNY szabály a küszöbök FÖLÖTT: ha két tétel KÜLÖNBÖZŐ intézetet
// nevez meg (Závecz vs Medián…), SOHA nem vonjuk össze, akármit ad a pontszám. Egy
// pártpreferencia-monitornál épp az intézetek közti eltérés a legértékesebb jel.

import { slug } from "./slug.js";

// Leghitelesebb forrás rangsora a reprezentánshoz: hivatalos_adat > kutatas > sajto.
const KIND_RANK = { hivatalos_adat: 0, kutatas: 1, nemzetkozi: 2, sajto: 3 };
const SIGNIF_RANK = { KIEMELT: 0, FONTOS: 1, FIGYELENDO: 2 };
const FRESH_RANK = { UJ_24H: 0, H24_48: 1, KIHAGYOTT_MOST: 2, KORABBI: 3 };

/** Könnyű magyar suffix-strip (nem teljes stemmer — a dedup toleranciájához elég). */
function stem(t) {
  if (/^[0-9]+$/.test(t)) return t;
  return t.replace(/(akat|eket|okat|aban|eben|jat|jet|ait|nal|nel|hoz|hez|ok|ek|ak|at|et|ot|ja|je|it|ai|os|es|as|us|a|e|t|i|k)$/, "") || t;
}

/** Salient slug-tokenek: stopszavak és ≤3 hosszú (nem-szám) tokenek nélkül. */
function rawTokens(title, stop) {
  return slug(title).split("-").filter((t) => t && !stop.has(t) && (t.length >= 4 || /^[0-9]+$/.test(t)));
}

function trigrams(title) {
  const s = "  " + slug(title).replace(/-/g, "") + "  ";
  const g = new Set();
  for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3));
  return g;
}

const overlap = (a, b) => { let n = 0; for (const t of a) if (b.has(t)) n++; return n; };
const dice = (a, b) => (2 * overlap(a, b)) / ((a.size + b.size) || 1);
const disjoint = (a, b) => { for (const t of a) if (b.has(t)) return false; return true; };

/**
 * Intézet-detektor a config/sources.json (kind=intezet) + config/dedup.json
 * institutes aliasaiból. @returns {Array<{key:string, tokens:Set<string>}>}
 */
export function deriveInstitutes(sources = [], dedupCfg = {}) {
  const generic = new Set(dedupCfg.institute_generic_tokens ?? []);
  const map = new Map(); // key -> { tokens:Set<string>, bigrams:Array<[string,string]> }
  const ensure = (key) => { if (!map.has(key)) map.set(key, { tokens: new Set(), bigrams: [] }); return map.get(key); };
  // Egy szó felvétele token-matcherként. A PUSZTÁN NUMERIKUS token (pl. '21', '93') SOHA nem önálló
  // matcher: illeszkedne bármely cím párt-százalékára/évszámára ('Fidesz 21%') → a tétel hamisan
  // felvenné a 21kutato/realpr93 intézet-kulcsot (institute-token kollízió; a hamis összevonás a
  // drágább hibamód, ARCHITEKTURA 2–3., CLAUDE.md 5). A numerikus tokent CSAK bigramban használjuk
  // (lásd addName). A rövid (<4) nem-numerikus token is kimarad (túl gyenge jel).
  const addToken = (key, word) => {
    const t = slug(word);
    if (!t || generic.has(t) || /^[0-9]+$/.test(t) || t.length < 4) return;
    ensure(key).tokens.add(t);
  };
  // Intézetnév felvétele: szavanként token, ÉS 'numerikus szó + következő szó' BIGRAM, hogy a
  // '21 Kutatóközpont' felismerhető legyen (a bare '21' tiltása mellett), de a 'Fidesz 21 százalék' NE.
  const addName = (key, name) => {
    const words = slug(name).split("-").filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      addToken(key, words[i]);
      if (/^[0-9]+$/.test(words[i]) && words[i + 1]) ensure(key).bigrams.push([words[i], words[i + 1]]);
    }
  };
  for (const s of sources) {
    if (s.kind !== "intezet") continue;
    addToken(s.id, s.id); // az id egészben (pl. '21kutato' — nem numerikus-only, ezért matcher)
    addName(s.id, s.name);
  }
  for (const [key, aliases] of Object.entries(dedupCfg.institutes ?? {})) {
    for (const a of aliases) addName(key, a);
  }
  return [...map.entries()].map(([key, v]) => ({ key, tokens: v.tokens, bigrams: v.bigrams }));
}

/** Egy tételhez tartozó intézet-kulcsok halmaza (a címben/forrásban megnevezettek). Exportált a
 *  kollízió-teszthez. A token-matchen felül a BIGRAM (numerikus + következő szó, pl. '21 kutatóközpont')
 *  SZOMSZÉDOS párként illeszt a cím szó-sorozatában — így a bare '21' nem illeszkedik párt-%-ra. */
export function instituteKeysOf(item, institutes) {
  const words = slug(`${item.source_id ?? ""} ${item.title ?? ""}`).split("-").filter(Boolean);
  const hay = new Set(words);
  const keys = new Set();
  for (const inst of institutes) {
    let matched = false;
    for (const tok of inst.tokens) if (hay.has(tok)) { matched = true; break; }
    if (!matched && inst.bigrams) {
      for (const [a, b] of inst.bigrams) {
        for (let i = 0; i < words.length - 1; i++) if (words[i] === a && words[i + 1] === b) { matched = true; break; }
        if (matched) break;
      }
    }
    if (matched) keys.add(inst.key);
  }
  return keys;
}

/** Melyik szabály (ha van) köti össze a és b tételt — vagy null. Intézet-guard felül. */
function edgeRule(a, b, cfg) {
  // STANDALONE forrás (poll-adatpont, pl. europeelects): a tételei SOSEM story-merge-elődnek —
  // két kutatás KÜLÖN mérés, nem „ugyanaz a sztori" (a false-merge egy önálló pollt REJTENE,
  // ARCHITEKTURA 2–3.). A generikus title-scan amúgy is törékeny itt: a „21 Kutatóközpont" bare
  // numerikus „21" intézet-tokene illeszkedik más cégek címeiben a párt-százalékra ("Fidesz 21%"),
  // ami hamisan összekötné a Mediánt a 21kutato-val. Config-vezérelt (dedup.json), üres alapból.
  const standalone = cfg.standalone_sources ?? [];
  if (standalone.includes(a.it.source_id) || standalone.includes(b.it.source_id)) return null;

  // KEMÉNY intézet-guard: két KÜLÖNBÖZŐ, nem üres intézet-halmaz → soha.
  if (a.inst.size && b.inst.size && disjoint(a.inst, b.inst)) return null;

  const n = overlap(a.stoks, b.stoks);
  const contain = n / (Math.min(a.stoks.size, b.stoks.size) || 1);
  if (n >= (cfg.containment_min_tokens ?? 2) && contain >= (cfg.containment_min ?? 0.5)) {
    return `containment ${contain.toFixed(2)} (${n} közös token)`;
  }
  const d = dice(a.tri, b.tri);
  if (d >= (cfg.trigram_dice_min ?? 0.55) && n >= (cfg.trigram_min_shared_tokens ?? 1)) {
    return `trigram-dice ${d.toFixed(2)}`;
  }
  return null;
}

const best = (arr, rankOf) => arr.reduce((m, x) => (rankOf(x) < rankOf(m) ? x : m), arr[0]);

// ---- C-star: a tranzitív closure korlátozása a patológiás mega-blobon (dedup(b)) ----
// A nagy gyakoriságú hub-tokenek (szereplőnevek: 'magyar péter', 'orbán viktor'; 'paks'/'duna')
// a containment-ágon KÜLÖNBÖZŐ sztorik közt hamis éleket húznak, a union-find tranzitív closure-je
// egy blobbá láncolja őket (mért: 318-tagú, 1.88% élsűrűség — nem klikk, hanem vékony hidak). A
// naiv C-star (tag csak közvetlen éllel a rephez) a blobot szétveri, DE valódi parafrázisokat is
// árvává tesz (mért: 38 dice>=0.55 pár megtörve). Ezért KÉT lépés:
//   (1) star-dekompozíció REKURZÍVAN: a rep köré a közvetlen szomszédok; a leszakadt tagokat nem
//       árvázzuk, hanem összefüggő al-komponensenként ÚJRACSOPORTOSÍTJUK (rekurzió);
//   (2) dice-repair: bármely két al-csoportot, ami közt van valódi parafrázis-él (trigram-dice >=
//       trigram_dice_min), visszaEGYESÍTÜNK (fixpont). Ez GARANTÁLJA, hogy egyetlen dice-kohézív
//       VALÓDI sztori se szakadjon szét (akár nagy is): a Paks-leállás 22 parafrázisa egyben marad,
//       csak a hamis, containment-hídon lógó rész válik le. Mért a 2026-08-07 korpuszon: 318→22,
//       0 megtört dice-jogos pár, 10 erős-containment (>=0.75) pár leválik. Utóbbi becsületes
//       részlegesség (CLAUDE.md 5): egy hamis blob egy fontos tételt REJT (drága, ARCHITEKTURA 2–3.),
//       egy megmaradó duplikátum LÁTHATÓ (olcsó) → a szétbontás a helyes irányú hiba. Csak a
//       decompose_min_component-nél NAGYOBB komponensre fut (a kis csoportok containment-merge-ei
//       érintetlenek); a küszöb config-ból, nem kódból.
function starCenter(idxs, nodes) {
  return [...idxs].sort((a, b) =>
    ((SIGNIF_RANK[nodes[a].it.significance] ?? 9) - (SIGNIF_RANK[nodes[b].it.significance] ?? 9)) ||
    ((KIND_RANK[nodes[a].it.kind] ?? 9) - (KIND_RANK[nodes[b].it.kind] ?? 9)) ||
    ((nodes[a].it.first_seen_at ?? "").localeCompare(nodes[b].it.first_seen_at ?? "")) ||
    ((nodes[a].it.canonical_key ?? "").localeCompare(nodes[b].it.canonical_key ?? "")))[0];
}
function connectedSubgroups(idxs, adj) {
  const set = new Set(idxs), seen = new Set(), out = [];
  for (const s of idxs) {
    if (seen.has(s)) continue;
    const comp = [], stack = [s]; seen.add(s);
    while (stack.length) {
      const x = stack.pop(); comp.push(x);
      for (const y of (adj.get(x) ?? [])) if (set.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
    }
    out.push(comp);
  }
  return out;
}
function starDecompose(comp, nodes, adj, depth = 0) {
  if (comp.length <= 2 || depth > 60) return [comp];
  const center = starCenter(comp, nodes);
  const centerAdj = adj.get(center) ?? new Set();
  const star = [center, ...comp.filter((i) => i !== center && centerAdj.has(i))];
  const starSet = new Set(star);
  const rest = comp.filter((i) => !starSet.has(i));
  const out = [star];
  for (const sub of connectedSubgroups(rest, adj)) out.push(...starDecompose(sub, nodes, adj, depth + 1));
  return out;
}
function diceRepair(groups, nodes, cfg) {
  const thr = cfg.trigram_dice_min ?? 0.55;
  let changed = true;
  while (changed) {
    changed = false;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        let merge = false;
        for (const i of groups[a]) { for (const j of groups[b]) { if (dice(nodes[i].tri, nodes[j].tri) >= thr) { merge = true; break; } } if (merge) break; }
        if (merge) { groups[a] = groups[a].concat(groups[b]); groups.splice(b, 1); changed = true; b--; }
      }
    }
  }
  return groups;
}
function decomposeComponent(comp, nodes, adj, cfg) {
  return diceRepair(starDecompose(comp, nodes, adj), nodes, cfg);
}

/**
 * Story-csoportosítás a report-ablak tételein.
 * @param {Array} items  snake_case tétel-sorok (canonical_key, source_id, kind, title, url, first_seen_at, significance, freshness, triage_missing)
 * @param {object} opts  { cfg: dedupCfg, institutes: deriveInstitutes(...) kimenete }
 * @returns {{ representatives: Array, merges: Array<{story:string, representative:string, members:Array<{canonical_key,source_id,title,rule}>}> }}
 *          A representatives a reprezentáns-tételek (a merged story-k összevonva); a
 *          nem-reprezentáns tagok kimaradnak, de rep._pressUrls-ben elérhetők.
 */
export function groupStories(items, { cfg = {}, institutes = [], _naive = false } = {}) {
  // Story-token stopszavak: magyar funkciószavak (stopwords) + tartalmatlan angol
  // title-boilerplate (title_generic_tokens: 'euro'/'area'/'both'). Ez utóbbit MINDEN
  // euro-area statisztikai közlemény osztja, ezért hamis bridging-token: e nélkül a 6
  // különböző Eurostat-közlemény egyetlen blobbá láncolódik (dedup(b)). KÜLÖN config-
  // kulcsban, hogy a magyar stoplista tiszta maradjon (nem nyelvi funkciószó).
  // + name_hub_tokens (2026-08-19 mérés): SZEMÉLYNÉV-hubok (Vitézy, Mészáros, keresztnevek),
  // amelyek KÜLÖNBÖZŐ sztorikat hidalnak a containment-élen egy mega-blobbá (mért: 28-Vitézy,
  // 13-Mészáros). Eltávolításuk a nevek MENTÉN vágja szét a hamis blobot, a valódi
  // parafrázisokat (közös témaszó/magas dice) érintetlenül hagyva. SZÁNDÉKOSAN üres a shippelt
  // configban (levél-semleges); a feltöltése külön, levél-ható flip. A poliszém 'magyar'
  // (=Hungarian ÉS Magyar Péter) KIMARAD a listából — kivétele valódi parafrázisokat törne
  // (dice-él ≥1 közös-salient guard-ja), lásd a name-hub-guard tesztet.
  // + procedural_hub_tokens (2026-09-03 mérés): GENERIKUS JOGI-ELJÁRÁSI kifejezések ('hűtlen
  // kezelés', 'nyomoz', 'rendőrség', 'hivatali visszaélés', 'házkutatás', 'feljelentés'), amelyek a
  // containment-élen KÜLÖNBÖZŐ korrupciós/nyomozati ÜGYEKET hidalnak egyetlen blobbá (mért éles: egy
  // 26-tagú blob fűzte össze az Eximbank + Paks-2 tőkeemelés + 'nyuszimotor' + Orbán Győző–Mészáros +
  // Covid ügyeket). Ugyanaz a HIBAOSZTÁLY, mint a személynév-hub, csak eljárási szókincsen. Az ügyek
  // a SAJÁT entitásukon (eximbank/paks/nyuszimotor) csoportosulnak, a generikus eljárási hídon NEM; a
  // valódi, ugyanazon ügyről szóló parafrázisok (közös entitás/magas dice) érintetlenek.
  const stop = new Set([...(cfg.stopwords ?? []), ...(cfg.title_generic_tokens ?? []), ...(cfg.name_hub_tokens ?? []), ...(cfg.procedural_hub_tokens ?? [])]);
  const nodes = items.map((it) => ({
    it,
    stoks: new Set(rawTokens(it.title, stop).map(stem)),
    tri: trigrams(it.title),
    inst: instituteKeysOf(it, institutes),
  }));

  // Union-find. Determinisztikus: az items eleve stabil sorrendben jön (a hívó rendezi).
  const parent = nodes.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const rule = new Map(); // gyerek-index -> a szülőhöz kötő szabály (naplóhoz)
  // Teljes él-lista (adjacency) — NEM csak az union-t létrehozó élek: a C-star dekompozíció
  // (lásd lentebb) a komponens BELSŐ gráfját járja, ezért a már összekötött komponensen belüli
  // éleket is rögzíteni kell (különben a háromszögek harmadik éle hiányozna). A find===find
  // csak az UNION-t hagyja ki, az él-rögzítést nem.
  const adj = new Map();
  const addAdj = (i, j) => {
    if (!adj.has(i)) adj.set(i, new Set());
    if (!adj.has(j)) adj.set(j, new Set());
    adj.get(i).add(j); adj.get(j).add(i);
  };
  const tryEdge = (i, j) => {
    const r = edgeRule(nodes[i], nodes[j], cfg);
    if (!r) return;
    addAdj(i, j);
    if (find(i) !== find(j)) { parent[find(j)] = find(i); rule.set(j, { r, anchor: i }); }
  };

  // Inverz index: él CSAK legalább 1 közös stemmelt salient tokent osztó pár között
  // keletkezhet (A ág: n>=containment_min_tokens; B ág: n>=trigram_min_shared_tokens).
  // Ezért elég a közös tokent osztó párokat vizsgálni — a kihagyott párokon az edgeRule
  // úgyis null lett volna. EKVIVALENS az O(n²) bejárással (lásd storygroup ekvivalencia-
  // teszt), nem közelítés. Feltétel: mindkét ág >=1 közös tokent követel; különben
  // (0-ra állított küszöb) biztonságos O(n²) fallback. _naive: a teszt kényszeríti az O(n²)-t.
  const indexSafe = (cfg.containment_min_tokens ?? 2) >= 1 && (cfg.trigram_min_shared_tokens ?? 1) >= 1;
  if (_naive || !indexSafe) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) tryEdge(i, j);
  } else {
    const index = new Map(); // stemmelt token -> tétel-indexek (növekvő)
    nodes.forEach((n, i) => { for (const t of n.stoks) { if (!index.has(t)) index.set(t, []); index.get(t).push(i); } });
    const seen = new Set(); // egyszer futtatott kandidáns-párok (i*N+j, i<j)
    const N = nodes.length;
    for (const bucket of index.values()) {
      for (let a = 0; a < bucket.length; a++) {
        for (let b = a + 1; b < bucket.length; b++) {
          const i = bucket[a], j = bucket[b]; // i<j (a bucket növekvő)
          const key = i * N + j;
          if (seen.has(key)) continue;
          seen.add(key);
          tryEdge(i, j);
        }
      }
    }
  }

  const groups = new Map();
  nodes.forEach((n, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(i); });

  // C-star: a decompose_min_component-nél NAGYOBB komponens (patológiás mega-blob) rekurzív
  // star-dekompozíció + dice-repair; a kisebbek érintetlenek (teljes closure). Küszöb config-ból.
  const gate = cfg.decompose_min_component ?? 30;
  const finalGroups = [];
  for (const idxs of groups.values()) {
    if (idxs.length > gate) finalGroups.push(...decomposeComponent(idxs, nodes, adj, cfg));
    else finalGroups.push(idxs);
  }

  const representatives = [];
  const merges = [];
  for (const idxs of finalGroups) {
    const members = idxs.map((i) => nodes[i].it);
    // Egytagú sztori is kap _groupSize/_groupFirstSeen mezőt — hogy a mező jelenléte
    // ne függjön a csoport méretétől, és egy későbbi hívó ne felejtse el a fallbackot.
    if (members.length === 1) {
      representatives.push({ ...members[0], _groupSize: 1, _groupFirstSeen: members[0].first_seen_at });
      continue;
    }

    // CENTRALITÁS a tie-breakhez: a tag csoporton belüli edgeRule-szomszédsági FOKA (hány másik
    // taggal van közvetlen éle az `adj` gráfban). A legcentrálisabb tag a sztori magja; a legkorábbi
    // first_seen ehelyett egy PERIFÉRIÁS címet tehetett rep-pé egy nagy kohézív klaszterben (mért:
    // a 08-13-i +52 Paks-mergeben a „díszkivilágítás" [fok 7] lett rep a „teljesen leáll" mag helyett).
    // A fok a produkciós élgráfot használja (containment VAGY dice — épp az, amivel a csoport készült);
    // NEM sum-dice (az rövid/generikus címet favorizál, length-bias). Over-merge-nél a fok tipikusan
    // DÖNTETLEN (a hamis fúzió hídjai szimmetrikusak) → visszaesik first_seen-re, nem ront.
    const degIn = new Map(); // item → csoporton belüli fok
    for (const i of idxs) {
      const nb = adj.get(i);
      let d = 0;
      if (nb) for (const j of idxs) if (j !== i && nb.has(j)) d++;
      degIn.set(nodes[i].it, d);
    }

    // Reprezentáns: LEGMAGASABB jelentőség (dedup(a)) → azon belül leghitelesebb kind → CENTRALITÁS
    // (fok, csökkenő) → legkorábbi first_seen → canonical_key. A significance elsődlegessége azért
    // kell, mert a groupSig eddig is felhúzta a rep significance-MEZŐJÉT a legerősebbre (a badge
    // KIEMELT lett), DE a rep IDENTITÁSA (cím/url) a kind-nyertesé maradt → egy KIEMELT sztori egy
    // FONTOS/FIGYELENDO cím alatt, rutinnak hangzó headline-nal jelent meg a levélben, a valódi
    // KIEMELT cím a press_urls-be süllyedt (félrekeretezés, ARCHITEKTURA.md 2–3.). A KIND a
    // centralitás ELŐTT marad → a primer-forrás (hivatalos_adat/kutatas) NEM veszti el a rep-séget
    // egy központibb sajtó-cím miatt. A missing ítéletű tag significance-e null → rank 9 → sose rep.
    const rep = [...members].sort((a, b) =>
      ((SIGNIF_RANK[a.significance] ?? 9) - (SIGNIF_RANK[b.significance] ?? 9)) ||
      ((KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9)) ||
      ((degIn.get(b) ?? 0) - (degIn.get(a) ?? 0)) ||
      (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? "") ||
      (a.canonical_key ?? "").localeCompare(b.canonical_key ?? ""))[0];
    const others = members.filter((m) => m !== rep);

    // A story JELENTŐSÉGE a legerősebb tagé (bármely framing KIEMELT → a story KIEMELT);
    // ítélet nélküli csak akkor, ha MINDEN tag az.
    // SZÁNDÉKOS recall-fókusz ITT (szemben a tagság precízió-fókuszával): ha egy csoport
    // MÁR igazoltan egy sztori (guard+küszöbök átengedték), akkor a legerősebb jelentőség
    // felvétele a helyes — egy fontos sztorit elrejteni rosszabb, mint egyben mutatni. A
    // téves-KIEMELT kockázatot a triázs kétkapus kapuja (data_backed) külön levágja.
    const groupSig = best(members.map((m) => m.significance).filter((s) => s in SIGNIF_RANK), (s) => SIGNIF_RANK[s]) ?? rep.significance;
    // A FRISSESSÉG viszont a REPREZENTÁNSÉ, NEM a legfrissebb tagé (2026-08-31 fix, user).
    // A badge a MEGJELENÍTETT sorral (rep címe + rep dátuma) konzisztens legyen: korábban a
    // groupFresh a legfrissebb tag UJ_24H-ját húzta rá egy RÉGI dátumú reprezentánsra →
    // „08-25 + 🟢 ÚJ (24h)" (a badge hazudott a kor felől). A jelentőség-emeléssel ellentétben
    // a kor OBJEKTÍV (a rep publikációs ideje) — nem „framing", amit egy tag felülírhat. Ha egy
    // régi sztorinak van mai újraközlése, az külön (friss) tételként a rep saját friss dátumával
    // jön (vagy ha a rep a régi, akkor a sztori a rep kora szerint KORABBI — becsületes).
    const groupFresh = rep.freshness;

    // A csoport legkorábbi first_seen-je — az „új sztori" ebből dől el (nem a
    // reprezentánséból: a rep elsődlegesen kind szerint választódik, így egy MAI
    // hivatalos_adat lehet a rep egy TEGNAPI sajtó-sztori mellett is → az a sztori
    // nem új). A sztori akkor új, ha egyetlen tagját sem láttuk a mai futás előtt.
    const groupFirstSeen = members.reduce(
      (min, m) => (m.first_seen_at && (min == null || m.first_seen_at < min) ? m.first_seen_at : min), null);
    representatives.push({
      ...rep,
      significance: groupSig,
      freshness: groupFresh,
      triage_missing: members.every((m) => m.triage_missing),
      _groupSize: members.length,
      _groupFirstSeen: groupFirstSeen,
      _pressUrls: others.map((m) => ({ canonical_key: m.canonical_key, source_id: m.source_id, url: m.url, title: m.title })),
    });

    merges.push({
      story: rep.title,
      representative: rep.canonical_key,
      members: idxs.filter((i) => nodes[i].it !== rep).map((i) => ({
        canonical_key: nodes[i].it.canonical_key,
        source_id: nodes[i].it.source_id,
        title: nodes[i].it.title,
        rule: rule.get(i)?.r ?? "tranzitív",
      })),
    });
  }
  return { representatives, merges };
}
