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
  const map = new Map(); // key -> Set(token)
  const add = (key, token) => {
    const t = slug(token);
    if (!t || generic.has(t) || (t.length < 4 && !/^[0-9]/.test(t))) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(t);
  };
  for (const s of sources) {
    if (s.kind !== "intezet") continue;
    add(s.id, s.id);
    for (const w of slug(s.name).split("-")) add(s.id, w);
  }
  for (const [key, aliases] of Object.entries(dedupCfg.institutes ?? {})) {
    for (const a of aliases) for (const w of slug(a).split("-")) add(key, w);
  }
  return [...map.entries()].map(([key, tokens]) => ({ key, tokens }));
}

/** Egy tételhez tartozó intézet-kulcsok halmaza (a címben/forrásban megnevezettek). */
function instituteKeysOf(item, institutes) {
  const hay = new Set(slug(`${item.source_id ?? ""} ${item.title ?? ""}`).split("-"));
  const keys = new Set();
  for (const inst of institutes) {
    for (const tok of inst.tokens) if (hay.has(tok)) { keys.add(inst.key); break; }
  }
  return keys;
}

/** Melyik szabály (ha van) köti össze a és b tételt — vagy null. Intézet-guard felül. */
function edgeRule(a, b, cfg) {
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

/**
 * Story-csoportosítás a report-ablak tételein.
 * @param {Array} items  snake_case tétel-sorok (canonical_key, source_id, kind, title, url, first_seen_at, significance, freshness, triage_missing)
 * @param {object} opts  { cfg: dedupCfg, institutes: deriveInstitutes(...) kimenete }
 * @returns {{ representatives: Array, merges: Array<{story:string, representative:string, members:Array<{canonical_key,source_id,title,rule}>}> }}
 *          A representatives a reprezentáns-tételek (a merged story-k összevonva); a
 *          nem-reprezentáns tagok kimaradnak, de rep._pressUrls-ben elérhetők.
 */
export function groupStories(items, { cfg = {}, institutes = [], _naive = false } = {}) {
  const stop = new Set(cfg.stopwords ?? []);
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
  const tryEdge = (i, j) => {
    if (find(i) === find(j)) return;
    const r = edgeRule(nodes[i], nodes[j], cfg);
    if (r) { parent[find(j)] = find(i); rule.set(j, { r, anchor: i }); }
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

  const representatives = [];
  const merges = [];
  for (const idxs of groups.values()) {
    const members = idxs.map((i) => nodes[i].it);
    // Egytagú sztori is kap _groupSize/_groupFirstSeen mezőt — hogy a mező jelenléte
    // ne függjön a csoport méretétől, és egy későbbi hívó ne felejtse el a fallbackot.
    if (members.length === 1) {
      representatives.push({ ...members[0], _groupSize: 1, _groupFirstSeen: members[0].first_seen_at });
      continue;
    }

    // Reprezentáns: LEGMAGASABB jelentőség (dedup(a)) → azon belül leghitelesebb kind →
    // legkorábbi first_seen → canonical_key. A significance elsődlegessége azért kell, mert
    // a groupSig eddig is felhúzta a rep significance-MEZŐJÉT a legerősebbre (a badge KIEMELT
    // lett), DE a rep IDENTITÁSA (cím/url) a kind-nyertesé maradt → egy KIEMELT sztori egy
    // FONTOS/FIGYELENDO cím alatt, rutinnak hangzó headline-nal jelent meg a levélben, a valódi
    // KIEMELT cím a press_urls-be süllyedt (félrekeretezés, ARCHITEKTURA.md 2–3.). A missing
    // ítéletű tag significance-e null → rank 9 → sose lesz rep, hacsak MINDEN tag az.
    const rep = [...members].sort((a, b) =>
      ((SIGNIF_RANK[a.significance] ?? 9) - (SIGNIF_RANK[b.significance] ?? 9)) ||
      ((KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9)) ||
      (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? "") ||
      (a.canonical_key ?? "").localeCompare(b.canonical_key ?? ""))[0];
    const others = members.filter((m) => m !== rep);

    // A story jelentősége/frissessége a legerősebb tagé (bármely framing KIEMELT → a story KIEMELT);
    // ítélet nélküli csak akkor, ha MINDEN tag az.
    // SZÁNDÉKOS recall-fókusz ITT (szemben a tagság precízió-fókuszával): ha egy csoport
    // MÁR igazoltan egy sztori (guard+küszöbök átengedték), akkor a legerősebb jelentőség
    // felvétele a helyes — egy fontos sztorit elrejteni rosszabb, mint egyben mutatni. A
    // téves-KIEMELT kockázatot a triázs kétkapus kapuja (data_backed) külön levágja.
    const groupSig = best(members.map((m) => m.significance).filter((s) => s in SIGNIF_RANK), (s) => SIGNIF_RANK[s]) ?? rep.significance;
    const groupFresh = best(members.map((m) => m.freshness).filter((f) => f in FRESH_RANK), (f) => FRESH_RANK[f]) ?? rep.freshness;

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
