// Jelentés-renderelő (F2). A Pages-jelentés a spec 17-23. pontját követi;
// az e-mail (digest) az elmúlt 24 órára fókuszál (szintézis + UJ_24H tételek
// jelentőség szerint). Triázs után a nem-releváns tételek kimaradnak a
// megjelenítésből (a DB-ben maradnak); degradált (LLM nélküli) módban minden
// tétel nyersen látszik. Stílus: a levél email-barát beágyazott CSS-t (STYLE) kap; a honlap
// (jelentés + info-oldal) a külön WEB_STYLE-t (oldalsáv, kártyák, saját paletta — 2026-11-28).

import { groupStories } from "./lib/storygroup.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Magyar tipográfia (user-kérés 2026-08-31): gondolatjel = RÖVID (–, U+2013), NEM a hosszú
// em-dash (—, U+2014). A kimenet (HTML-törzs + email-tárgy) ZÁRÓ normalizálása garantálja, hogy
// sem a sablonok, sem az LLM-narratíva ne vigyen be hosszú gondolatjelet — most és a jövőben sem
// (CLAUDE.md 2: a szándék — „ne legyen benne —" — egy helyen, kikerülhetetlenül érvényesül, nem
// szanaszét a sablonokban, ahonnan a következő szerkesztés kifelejthetné). URL-t nem érint (abban
// nincs U+2014). A render-függvények és a *Subject-helperek ezen keresztül adnak vissza.
const endash = (s) => String(s ?? "").replace(/—/g, "–");

// Cross-source story-dedup (spec 13.): a látható tételeket EGYSZER csoportosítjuk
// run-szinten, és a run objektumon memoizáljuk — így a report + digest + KIEMELT
// render mind UGYANAZT az egy csoportosítást használja (nem fut szekciónként/
// levelenként újra), és a merges-napló egységes. Config híján (pl. régi teszt vagy
// betöltési hiba) érintetlen a lista; ÉLES futásban a run.js WARN-t naplóz erről.
export function storyGroups(run) {
  if (run.__storyGroups) return run.__storyGroups;
  const src = visibleItems(run);
  const res = (!run?.dedupCfg || !run?.institutes)
    ? { representatives: src, merges: [] }
    : groupStories(src, { cfg: run.dedupCfg, institutes: run.institutes });
  try { Object.defineProperty(run, "__storyGroups", { value: res, enumerable: false, configurable: true }); } catch { /* fagyasztott run: memo nélkül */ }
  return res;
}

// „+N forrás" a reprezentáns mellé, a press_urls-ből linkelve (spec 13.).
function pressUrlsHtml(it) {
  const p = it._pressUrls ?? [];
  if (!p.length) return "";
  const links = p.map((u) => (u.url ? `<a href="${esc(u.url)}"${LINK_ATTR}>${esc(u.source_id)}</a>` : esc(u.source_id))).join(", ");
  return ` <span class="empty">+${p.length} forrás: ${links}</span>`;
}

const FRESHNESS = {
  UJ_24H: { label: "🟢 ÚJ (24h)", rank: 0 },
  H24_48: { label: "🟡 24–48h", rank: 1 },
  KIHAGYOTT_MOST: { label: "⚠️ korábban kihagyott, most", rank: 2 },
  KORABBI: { label: "⚪ korábbi", rank: 3 },
};

const SIGNIF = {
  KIEMELT: { label: "🔴 KIEMELT", rank: 0 },
  FONTOS: { label: "🟠 FONTOS", rank: 1 },
  FIGYELENDO: { label: "🟡 FIGYELENDO", rank: 2 },
};

// HIBA: a forrás LÉTEZIK, de a gyűjtő-környezetből most nem érhető el (datacenter-egress blokk
// vagy átmeneti hálózati hiba) — a puszta „hiba" félrevezető (nem a forrással van baj). A
// beszédesebb címke ezt fejezi ki (user 2026-09-01).
const CHECK = { OK_UJ: "✅ új", OK_NINCS_UJ: "☑️ nincs új", RESZLEGES: "⚠️ részleges", SKIPPED_VALIDATION: "🚫 validáció elutasította", HIBA: "⚠️ jelenleg nem elérhető" };

// Egységes taxonómia a honlapon és az emailben: minden NEM-sajtó tétel/forrás a „Kutatások és
// hivatalos adatok" csoportba esik (hivatalos_adat + kutatas + nemzetkozi), a sajtó külön. Így a
// kapuzott tétel-tábla és a Forrás-ellenőrzés UGYANAZT a két csoportot mutatja, és semmi nem esik
// ki némán (CLAUDE.md 2 — a korábbi hivatalos_adat/sajto bontás a kutatas/nemzetkozi tételeket
// eldobta). A tétel `kind`-je mindig jelen van; a forrás `kind`-jét a run.sourceKinds adja (annak
// hiányában minden forrás a Kutatások csoportba kerül — biztonságos fallback régi run/teszt esetén).
const KUTATAS_LABEL = "📈 Kutatások és hivatalos adatok";
const SAJTO_LABEL = "📰 Sajtószemle";
// A Forrás-ellenőrzésben (nem a kapuzott tétel-táblában) a Kutatások/hivatalos csoport két
// altáblára bomlik: Hazai (hivatalos + intézet) vs Nemzetközi (kind=nemzetkozi) — user 2026-08-31.
const HAZAI_LABEL = "📈 Kutatások és hivatalos adatok – Hazai";
const NEMZ_LABEL = "🌍 Kutatások és hivatalos adatok – Nemzetközi";
// A Nemzetközi altáblába a `kind==="nemzetkozi"` forrásokon FELÜL explicit ide sorolt források is
// bekerülnek (user 2026-08-31): az Eurostat (EU-s hivatalos adat, kind=hivatalos) és az
// Europion/Opinio (európai poll-aggregátor, kind=intezet) — ezek nemzetköziek, csak a kind-jük más.
const NEMZ_EXTRA_IDS = new Set(["eurostat", "opinio"]);
const isNemzetkoziSource = (id, sourceKinds) => sourceKinds[id] === "nemzetkozi" || NEMZ_EXTRA_IDS.has(id);
const isSajtoItem = (it) => it.kind === "sajto";

// „📊 Kulcsszámok ma" — a szám/százalék-tartalmú címeket VERBATIM emeljük ki (garantáltan
// valós: szó szerinti idézet a címből, nulla hallucináció). A rendszer csak a címeket tárolja,
// de a magyar hír-címek szám-gazdagok. Precízió-fókusz: egységhez/százalékhoz/ezres-csoporthoz
// kötött szám kell (a puszta évszám/„24 óra" kimarad). Ld. synthesis.js (a narratíva számai a
// forrás ellen IGAZOLTAK) — a kettő együtt adja a „számokra támaszkodó, nem hallucináló" jelentést.
const KEY_NUM = /\d+(?:[.,]\d+)?\s*(?:%|százalék)|\d[\d . ]*\s*(?:forint|\bFt\b|milliárd|millió|ezer|billió)|\d{1,3}(?:[  ]\d{3})+/i;
const hasKeyNumber = (it) => KEY_NUM.test(it.title ?? "");

const PER_SOURCE_CAP = 25;
const TZ = "Europe/Budapest";

// A napi jelentés email „Legfrissebb jelentés →" linkjének célja. 2026-08-27-től a
// FÜGGETLEN tükörre mutat (napihir.duckdns.org), NEM a github.io Pages-re — hogy a publikus
// link ne a személyes github.io-identitásra vigyen. A github.io Pages-deploy a workflow-ban
// VÁLTOZATLANUL tovább fut; ez a konstans CSAK az email-linket állítja (a Pages-kiszolgálást
// nem). A név történeti okból maradt PAGES_BASE. A levél a `node src/run.js` lépésben megy ki.
//
// A tükör külön szerver (Hetzner + Caddy), ami a repo `archive/`-ját szolgálja ki (ld.
// scripts/build-site.mjs + memória: duckdns-mirror). ŐSZINTÉN a korlátról: a tükör a SAJÁT
// timeréről frissül (~30 perces esti sweep), a levél viszont a GH-futásban megy ki — így a
// levél megérkezése UTÁN a tükör gyökere még ~30 percig a KORÁBBI napot mutathatja, míg a
// következő sweep behúzza a friss commitot. A link SZÖVEGE ezért „Legfrissebb" (nem ígéri,
// hogy pont EZT a jelentést nyitja).
//
// MIÉRT A GYÖKÉR, NEM A NAPI ARCHÍV: a „legfrissebb" szemantika a gyökér. (A github.io Pages
// nem-additív volt → a dátumozott URL másnap 404; a TÜKRÖN a dátumozott URL-ek PERZISZTENSEK,
// mert a buildDist a TELJES archívot kiteszi — de a link így is a mindig-friss gyökeret adja.)
// Trailing perjel a bázison KELL. KORLÁT: ha a tükör domainje változik, EZT kézzel kell átírni.
export const PAGES_BASE = "https://napihir.duckdns.org/";

function fmtTime(iso) {
  if (!iso) return "publikációs idő nem elérhető";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "publikációs idő nem elérhető";
  return new Intl.DateTimeFormat("hu-HU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(t));
}

/** Triázs után: a nem-releváns (relevant===0) tételek kimaradnak; degradáltban minden látszik. */
function visibleItems(run) {
  const items = run.items ?? [];
  if (run.triageDegraded) return items;
  return items.filter((it) => it.relevant !== 0);
}

// Rendezés: jelentőség (ha van), majd frissesség, majd publikációs idő.
//
// TUDATOS DÖNTÉS — ne „javítsd" reflexből: az ítélet nélküli (triage_missing)
// tétel significance-e MINDIG null (missingVerdict → triage.js), amit a SIGNIF-
// lookup rank 9-re képez → a lista LEGALJÁRA kerül, MINDEN ítélt tétel alá, a
// régebbi ítélt tételek alá is. Ez szándékolt: a missing csak ÁTMENETI állapot —
// a verdikt nem perzisztál (applyTriage: `if (v.missing) continue`), így a
// triage_json NULL marad és a következő futás újratriázsolja. Egy „még
// feldolgozandó" faroknak a lista alján a helye; ítélet nélküli tétel ne
// kerüljön egy ítélt FONTOS hír fölé a napi levélben.
//
// Ezért NINCS külön „missing-utolsó" tiebreaker: a jelenlegi adatmodellben
// megfigyelhetetlen no-op lenne (a missing sig=9 és az ítélt sig=0–2 már az
// első kulcsnál szétválik). A freshness elsődleges kulccsá tétele (ami a
// missinget a saját frissességi csoportjában tartaná) az EGÉSZ jelentést
// átrendezné (FONTOS/KORABBI a FIGYELENDO/UJ_24H alá esne) — az termék-szintű
// döntés, F3-ra halasztva (lásd run.js notCovered).
const sortItems = (items) =>
  [...items].sort((a, b) => {
    const s = (SIGNIF[a.significance]?.rank ?? 9) - (SIGNIF[b.significance]?.rank ?? 9);
    if (s !== 0) return s;
    const fr = (FRESHNESS[a.freshness]?.rank ?? 9) - (FRESHNESS[b.freshness]?.rank ?? 9);
    if (fr !== 0) return fr;
    return (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0);
  });

// Minden link ÚJ TABBAN nyílik (user-kérés 2026-08-31): target=_blank + rel=noopener (biztonság).
// EGY helyen a link-attribútum, hogy a helper-alapú linkek (titleLink/pressUrls/pagesLink) mind
// egységesen új tabosak legyenek — a honlapon és az emailben is (utóbbin ártalmatlan).
const LINK_ATTR = ' target="_blank" rel="noopener"';
const titleLink = (it) => (it.url ? `<a href="${esc(it.url)}"${LINK_ATTR}>${esc(it.title)}</a>` : esc(it.title));

// Fejléc-tétel (UTOLSÓ ÚJ KUTATÁS / LEGFRISSEBB HIVATALOS ADAT): kattintható cím + publikálás
// ideje (user-kérés 2026-08-31). URL híján sima szöveg (titleLink), így sose bukik hiányzó linken.
const headlineHtml = (it, emptyMsg) => (it
  ? `${titleLink(it)} — ${esc(fmtTime(it.published_at))}`
  : `<span class="empty">${emptyMsg}</span>`);

// A kapu-lehúzás auditálhatóságához a kapu ELŐTTI jelentőség és az indoklás kell. Friss
// tételen az enrich felszínre hozta (significance_raw / triage_reason); korábbi futás
// tételén CSAK a triage_json-ben van (az in-memory tétel oszlopai közt nincs). Ezért mindkét
// forrásból olvasunk — különben a korábbi futásból származó lehúzások (a többség) NÉMÁN
// kiesnének a szekció szűrőjéből (ugyanaz a csendes eltűnés, amit épp javítunk).
function triageBlob(it) {
  if (!it.triage_json) return null;
  try { return JSON.parse(it.triage_json); } catch { return null; }
}
const rawSignificance = (it) => it.significance_raw ?? triageBlob(it)?.significance_raw ?? null;
const triageReason = (it) => it.triage_reason ?? triageBlob(it)?.reason ?? "";
// Lehúzás: a kapu (data_backed=false) egy FONTOS/KIEMELT-nek ítélt tételt FIGYELENDO-ra vitt.
// A kapu KIZÁRÓLAG FIGYELENDO-ra húz (gatedSignificance), így a lehúzottak halmaza pontosan a
// FIGYELENDO-végű, erősebb-nyers tételek.
const isDowngraded = (it) => it.significance === "FIGYELENDO" && (rawSignificance(it) === "FONTOS" || rawSignificance(it) === "KIEMELT");
// Nem megállapítható: FIGYELENDO, de a kapu ELŐTTI érték SEHOL (significance_raw bevezetése
// előtti, korábbi triázs) — nem tudjuk, lehúzás volt-e. Külön darabszám (becsületes
// részlegesség): a levél ne állítsa, hogy N lehúzás, ha valójában N + ismeretlen.
const isUnassessableDowngrade = (it) => it.significance === "FIGYELENDO" && rawSignificance(it) == null;

// Jelentőség-címke: az ítélet nélküli (bukott batch) tétel külön megjelölve — nem
// keveredik a triázsolt tételek jelentőségi soraiba (becsületes részlegesség).
const sigLabel = (it) => (it.triage_missing ? "⏳ ítélet nélkül (köv. futásra halasztva)" : SIGNIF[it.significance]?.label ?? "—");

// Forrás-címke a reprezentánson: „Telex +4" ha több forrás áll a sztori mögött —
// becsületes részlegesség: látszódjon, hogy többen is lehozták (KIEMELT-nél megerősítés-jel).
const srcLabel = (it, sourceNames) =>
  esc(sourceNames[it.source_id] ?? it.source_id) + (it._groupSize > 1 ? ` <span class="empty">+${it._groupSize - 1}</span>` : "");

function renderRow(it, sourceNames) {
  const src = srcLabel(it, sourceNames);
  const sig = sigLabel(it);
  const fresh = FRESHNESS[it.freshness]?.label ?? esc(it.freshness ?? "—");
  // A jelentőség (pötty+felirat), a publikálva (dátum+óra) és a frissesség cella egy sorban
  // marad (nowrap) — user-kérés 2026-08-31: ne törjön a „🟡 FIGYELENDO" / „2026. 08. 30. 16:12"
  // két sorba.
  return `<tr><td>${src}</td><td>${titleLink(it)}${pressUrlsHtml(it)}</td><td class="nowrap">${sig}</td><td class="nowrap">${esc(fmtTime(it.published_at))}</td><td class="nowrap">${fresh}</td></tr>`;
}

function itemRows(items, sourceNames) {
  if (items.length === 0) return `<tr><td colspan="5" class="empty">nincs tétel ebben a körben</td></tr>`;
  const shown = new Map();
  const hidden = new Map();
  const rows = [];
  for (const it of sortItems(items)) {
    const n = shown.get(it.source_id) ?? 0;
    if (n < PER_SOURCE_CAP) { shown.set(it.source_id, n + 1); rows.push(renderRow(it, sourceNames)); }
    else hidden.set(it.source_id, (hidden.get(it.source_id) ?? 0) + 1);
  }
  for (const [sid, k] of hidden) {
    rows.push(`<tr class="more"><td>${esc(sourceNames[sid] ?? sid)}</td><td colspan="4" class="empty">+ ${k} további tétel a DB-ben (F2 triázs szűri)</td></tr>`);
  }
  return rows.join("\n");
}

function table(caption, items, sourceNames) {
  return `<table>
  <caption>${esc(caption)} <span class="count">(${items.length})</span></caption>
  <tr><th>Forrás</th><th>Cím</th><th>Jelentőség</th><th>Publikálva</th><th>Frissesség</th></tr>
  ${itemRows(items, sourceNames)}
</table>`;
}

/** providers_used → tömör lábléc-szöveg: mely provider futtatta a szerepeket. */
function summarizeProviders(log = []) {
  if (!log.length) return "F2 — LLM-hívás nem történt";
  const ok = log.filter((e) => e.status === "OK").map((e) => `${e.role}: ${e.model ?? e.provider}`);
  const skipped = log.filter((e) => e.status === "SKIPPED_NO_KEY").map((e) => `${e.provider}(nincs kulcs)`);
  // WARN külön: a néma provider-degradáció / MAIL_TO-guard a RÉSZLETÉVEL, láthatóan (nem
  // státusz-címkeként a "váltás:" listában) — hogy a napi 404/fallback ellenőrzés a
  // jelentésből leolvasható legyen (audit.js).
  const warned = log.filter((e) => e.status === "WARN").map((e) => `⚠️ ${e.detail ?? e.role}`);
  const failed = log.filter((e) => !["OK", "SKIPPED_NO_KEY", "SKIP", "WARN"].includes(e.status)).map((e) => `${e.provider}:${e.status}`);
  const parts = [];
  if (ok.length) parts.push(ok.join(" · "));
  if (failed.length) parts.push("váltás: " + failed.join(", "));
  if (skipped.length) parts.push("kihagyva: " + [...new Set(skipped)].join(", "));
  if (warned.length) parts.push(warned.join(" · "));
  return parts.join(" | ") || "triázs kihagyva";
}

const STYLE = `
  :root{--ink:#1c1e21;--muted:#5f6672;--paper:#fbfaf7;--line:#e3e0d8}
  body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Georgia,"Times New Roman",serif}
  main{max-width:820px;margin:0 auto;padding:32px 20px 64px}
  header h1{font-size:1.35rem;margin:0 0 2px}
  header .meta{font:13px/1.5 ui-monospace,Consolas,monospace;color:var(--muted)}
  section{margin-top:34px}
  h2{font-size:1.05rem;border-bottom:1px solid var(--line);padding-bottom:6px;margin:0 0 12px}
  h2 .count{color:var(--muted);font-weight:400;font-size:.8em}
  h3{font-size:.98rem;margin:18px 0 6px;color:var(--ink)}
  h3 .count{color:var(--muted);font-weight:400}
  .headline{display:flex;gap:10px;align-items:baseline;font:15px/1.5 ui-monospace,Consolas,monospace;margin:6px 0}
  .headline .label{color:var(--muted)}
  .empty{color:var(--muted);font-style:italic}
  .synth{font-size:1.02rem;line-height:1.6}
  table{border-collapse:collapse;width:100%;font-size:14px;margin-bottom:8px}
  caption{text-align:left;font-weight:600;padding:6px 0;font-size:.95rem}
  caption .count{color:var(--muted);font-weight:400}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  td.nowrap{white-space:nowrap}
  table.checks{table-layout:fixed}
  table.checks th:nth-child(1),table.checks td:nth-child(1){width:26%}
  table.checks th:nth-child(2),table.checks td:nth-child(2){width:15%}
  td.srclinks{font-size:12px;word-break:break-all}
  td.srclinks a{line-height:1.5}
  dl.legend{margin:14px 0 4px;font-size:13px;color:var(--muted)}
  dl.legend dt{font-weight:600;color:inherit;text-transform:uppercase;letter-spacing:.05em;font-size:12px;margin-bottom:6px}
  dl.legend dd{margin:0 0 5px;line-height:1.5}
  dl.legend dd b{color:var(--fg,inherit);font-weight:600}
  nav.topnav{margin:8px 0 2px}
  nav.topnav a{font-size:14px;font-weight:600}
  section.info h2{font-size:1.1rem;margin:22px 0 8px}
  section.info p,section.info li{line-height:1.65;max-width:70ch}
  section.info ul,section.info ol{padding-left:22px}
  section.info li{margin-bottom:6px}
  th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  a{color:#0b5aa2}
  .toplink{margin:18px 0 8px;text-align:center;font-size:1.2rem;font-weight:700}
  .toplink a{display:inline-block;padding:11px 20px;border:2px solid #0b5aa2;border-radius:6px;text-decoration:none;color:#0b5aa2}
  ul{margin:8px 0;padding-left:22px}
  li{margin:3px 0}
  footer{margin-top:48px;padding-top:12px;border-top:1px solid var(--line);font:12px/1.6 ui-monospace,Consolas,monospace;color:var(--muted)}
  .phase{display:inline-block;background:var(--ink);color:var(--paper);font:12px/1 ui-monospace,Consolas,monospace;padding:4px 8px;border-radius:3px}`;

// ---- HONLAP-dizájn (2026-11-28, user-kérés) ----
// Az „adattár"-minta szerkezete (teljes magasságú sötét oldalsáv, felső sáv breadcrumb-bal,
// oldalfejléc állapot-pill-lel, kártyák, stat-sor) a projekt SAJÁT palettájával. KIZÁRÓLAG a
// honlap (renderReport + renderInfoPage) kapja; a levél-renderelők a fenti, email-barát STYLE-t
// használják tovább (Gmail nem kezel CSS-változót / oldalsávot) — a levél bájtazonos marad.
// A színek EGY helyen, a :root-ban; a szabályok csak var(--…)-ra hivatkoznak.
const WEB_STYLE = `
  :root{--sidebar-bg:#2A1A2E;--sidebar-fg:#D3C6D6;--sidebar-section:#9A889E;--nav-active-bg:#EBC7D9;--nav-active-fg:#2A1A2E;--bg:#F7F5F6;--card:#FFFFFF;--border:#E6E1E4;--text:#1D1A1F;--text-muted:#6E6872;--accent:#9C3D6B;--ok:#2E8B57;--warn:#D9A21B;--err:#C8414B;--neutral:#9A98A0;--radius:12px;--shadow-hover:0 4px 14px rgba(42,26,46,.07)}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:16px}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-underline-offset:2px}
  a:hover{text-decoration-thickness:2px}
  a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
  .layout{display:grid;grid-template-columns:264px minmax(0,1fr);min-height:100vh}
  .sidebar{background:var(--sidebar-bg);color:var(--sidebar-fg);position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column;padding:28px 18px 20px}
  .brand{display:flex;align-items:center;gap:12px;padding:0 10px 22px;border-bottom:1px solid rgba(211,198,214,.14);color:#fff;text-decoration:none}
  .brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--nav-active-bg);color:var(--nav-active-fg)}
  .brand-name{font-size:1.45rem;font-weight:800;letter-spacing:-.02em}
  .brand-name b{color:var(--nav-active-bg)}
  .scope{display:flex;align-items:center;gap:14px;padding:18px 10px;border-bottom:1px solid rgba(211,198,214,.14);font-size:13px;line-height:1.35}
  .scope-code{font-weight:700;font-size:1.05rem;color:#fff}
  .scope small{display:block;color:var(--sidebar-section)}
  .scope span{color:#fff}
  .nav-section{margin:24px 10px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--sidebar-section)}
  .sidebar nav ul{list-style:none;margin:0;padding:0}
  .sidebar nav li{margin:2px 0}
  .sidebar nav a{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:999px;color:var(--sidebar-fg);text-decoration:none;font-size:14.5px}
  .sidebar nav a:hover{background:rgba(235,199,217,.10);color:#fff}
  .sidebar nav a[aria-current="page"]{background:var(--nav-active-bg);color:var(--nav-active-fg);font-weight:600}
  .sidebar nav a:focus-visible{outline-color:var(--nav-active-bg)}
  .ico{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
  .badge{margin-left:auto;min-width:24px;padding:1px 7px;border-radius:999px;background:rgba(211,198,214,.16);color:var(--sidebar-fg);font-size:11.5px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}
  .sidebar-foot{margin-top:auto;padding:18px 10px 0;font-size:12px;color:var(--sidebar-section);display:flex;align-items:center;gap:8px}
  .sidebar-foot .dot{width:7px;height:7px;border-radius:50%;background:var(--ok)}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 48px;border-bottom:1px solid var(--border);background:var(--bg);font-size:13px;color:var(--text-muted)}
  .crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin:0;padding:0}
  .crumbs li+li::before{content:"/";margin-right:10px;color:var(--neutral)}
  .crumbs li:last-child{color:var(--text)}
  .crumbs a{color:inherit;text-decoration:none}
  .updated{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
  .updated .ico{width:14px;height:14px}
  main{max-width:1180px;padding:40px 48px 64px}
  .page-head{margin-bottom:28px}
  .eyebrow{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:12px;font-size:12px;color:var(--text-muted)}
  .status-pill{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text)}
  .status-pill::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--neutral)}
  .status-pill.ok::before{background:var(--ok)}
  .status-pill.warn::before{background:var(--warn)}
  .pill-date{padding:2px 9px;border:1px solid var(--border);border-radius:6px;background:var(--card);font-variant-numeric:tabular-nums}
  h1{font-size:2rem;line-height:1.2;font-weight:800;letter-spacing:-.02em;margin:0 0 8px}
  .page-head .meta{color:var(--text-muted);font-size:14px;font-variant-numeric:tabular-nums}
  nav.topnav{margin-top:14px}
  nav.topnav a{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:var(--card);font-size:13.5px;font-weight:600;text-decoration:none}
  nav.topnav a:hover{box-shadow:var(--shadow-hover)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:16px}
  .stat,.headline,main>section,section.info{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);transition:box-shadow .15s ease}
  .stat:hover,.headline:hover,main>section:hover{box-shadow:var(--shadow-hover)}
  .stat{padding:18px 20px;display:flex;flex-direction:column;gap:6px}
  .stat-label{font-size:12.5px;color:var(--text-muted)}
  .stat-value{font-size:1.75rem;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  main>section{margin-top:20px;padding:24px 28px;overflow-x:auto}
  main>section#fejlec{background:none;border:0;padding:0;margin-top:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;overflow:visible;box-shadow:none}
  .headline{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:18px 20px;margin:0;font-size:14.5px}
  .headline>span:first-child{font-size:15px}
  .headline .label{font-size:11.5px;font-weight:600;letter-spacing:.1em;color:var(--text-muted)}
  .headline>span:last-child{flex-basis:100%;font-weight:600;line-height:1.45;font-variant-numeric:tabular-nums}
  h2{font-size:1.1rem;font-weight:700;margin:0 0 14px;letter-spacing:-.005em}
  h2 .count,h3 .count,caption .count{color:var(--text-muted);font-weight:400}
  h3{font-size:.95rem;font-weight:700;margin:22px 0 8px}
  .empty{color:var(--text-muted);font-style:italic}
  .synth{font-size:1.05rem;line-height:1.7;margin:0;max-width:75ch}
  #kulcsszamok ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  #kulcsszamok li{margin:0;padding:14px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg);font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}
  table{border-collapse:collapse;width:100%;font-size:14px;margin-bottom:10px}
  caption{text-align:left;font-weight:700;padding:16px 0 8px;font-size:.95rem}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  th{font-weight:600;color:var(--text-muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;background:var(--bg)}
  tr:last-child td{border-bottom:0}
  tbody tr:hover td,table tr:hover td{background:rgba(247,245,246,.7)}
  td.nowrap{white-space:nowrap;font-variant-numeric:tabular-nums}
  table.checks{table-layout:fixed}
  table.checks th:nth-child(1),table.checks td:nth-child(1){width:26%}
  table.checks th:nth-child(2),table.checks td:nth-child(2){width:20%}
  td.srclinks{font-size:12.5px;word-break:break-all}
  td.srclinks a{line-height:1.6}
  .st{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:12.5px;font-weight:600;border:1px solid transparent}
  .st-ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent);border-color:color-mix(in srgb,var(--ok) 25%,transparent)}
  .st-warn{color:#8a6510;background:color-mix(in srgb,var(--warn) 14%,transparent);border-color:color-mix(in srgb,var(--warn) 35%,transparent)}
  .st-err{color:var(--err);background:color-mix(in srgb,var(--err) 9%,transparent);border-color:color-mix(in srgb,var(--err) 25%,transparent)}
  .st-neutral{color:#625f68;background:color-mix(in srgb,var(--neutral) 12%,transparent);border-color:color-mix(in srgb,var(--neutral) 28%,transparent)}
  dl.legend{margin:20px 0 0;padding-top:16px;border-top:1px solid var(--border);font-size:13px;color:var(--text-muted)}
  dl.legend dt{font-weight:600;text-transform:uppercase;letter-spacing:.1em;font-size:11.5px;margin-bottom:8px}
  dl.legend dd{margin:0 0 6px;line-height:1.55}
  dl.legend dd b{color:var(--text);font-weight:600}
  section.info{margin-top:20px;padding:24px 28px}
  section.info h2{font-size:1.1rem;margin:0 0 10px}
  section.info p,section.info li{line-height:1.7;max-width:75ch}
  section.info ul,section.info ol{padding-left:22px}
  section.info li{margin-bottom:6px}
  ul{margin:8px 0;padding-left:22px}
  li{margin:3px 0}
  footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--border);font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--text-muted)}
  @media (max-width:900px){
    .layout{grid-template-columns:minmax(0,1fr)}
    .sidebar{position:static;height:auto;padding:18px 16px}
    .brand{padding:0 4px 14px}
    .scope{display:none}
    .nav-section{margin:14px 4px 6px}
    .sidebar nav ul{display:flex;flex-wrap:wrap;gap:4px}
    .sidebar nav a{padding:7px 12px;font-size:13.5px}
    .sidebar-foot{display:none}
    .topbar{padding:14px 16px;flex-wrap:wrap}
    main{padding:24px 16px 48px}
    h1{font-size:1.5rem}
    .stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .stat{padding:14px 16px}
    .stat-value{font-size:1.5rem}
    main>section,section.info{padding:18px 16px}
  }`;

// Vonalas ikonok (lucide-készlet, inline SVG — nincs külső függőség, a statikus oldal önálló).
const ICON_PATHS = {
  logo: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  report: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  narrative: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  numbers: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  items: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  sources: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};
const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

// Menüpont: ikon + felirat + opcionális szám-badge; `current` → aktív „pill" (aria-current).
const navItem = ({ href, ico, label, badge, current, attrs = "" }) =>
  `<li><a href="${href}"${attrs}${current ? ' aria-current="page"' : ""}>${icon(ico)}<span>${esc(label)}</span>${badge != null ? `<span class="badge">${esc(badge)}</span>` : ""}</a></li>`;

// Teljes magasságú oldalsáv: logó/cím, alatta szekciókba csoportosított menü.
// `page`: "report" | "info" (melyik oldal aktív); `sections`: a jelentés szekció-ugrói.
function sidebarHtml(page, sections = []) {
  const pages = [
    navItem({ href: page === "report" ? "#" : "index.html", ico: "report", label: "Napi jelentés", current: page === "report", attrs: page === "report" ? "" : LINK_ATTR }),
    navItem({ href: "info.html", ico: "info", label: "Az oldalról", current: page === "info", attrs: page === "info" ? "" : LINK_ATTR }),
  ].join("");
  const onPage = sections.length
    ? `<div class="nav-section">Ezen az oldalon</div><ul>${sections.map(navItem).join("")}</ul>`
    : "";
  return `<aside class="sidebar">
    <a class="brand" href="${page === "report" ? "#" : "index.html"}"><span class="brand-mark">${icon("logo")}</span><span class="brand-name">monitor<b>.</b></span></a>
    <div class="scope"><span class="scope-code">HU</span><div><span>Magyarország</span><small>Közéleti kutatás- és adatmonitor</small></div></div>
    <nav aria-label="Fő menü"><div class="nav-section">Munkaterület</div><ul>${pages}</ul>${onPage}</nav>
    <div class="sidebar-foot"><span class="dot"></span>Napi automatikus futás</div>
  </aside>`;
}

// Felső sáv: breadcrumb balra, diszkréten az utolsó frissítés jobbra (ha van).
// `home`: a „Napi jelentés" morzsa célja ("#" a jelentésen, "index.html" az info-oldalon).
const topbarHtml = (home, crumb, updated) => `<div class="topbar">
    <nav class="crumbs" aria-label="Morzsamenü"><ol><li><a href="${home}"${home === "#" ? "" : LINK_ATTR}>Napi jelentés</a></li><li>${esc(crumb)}</li></ol></nav>
    ${updated ? `<div class="updated">${icon("clock")}<span>Utolsó frissítés: ${esc(updated)}</span></div>` : ""}
  </div>`;

// Forrás-státusz → állapotszín (rendben / figyelmeztetés / hiba / semleges).
const statusTone = (c, hasRelevantFresh) => {
  if (c.status === "OK_UJ") return hasRelevantFresh ? "ok" : "neutral";
  if (c.status === "RESZLEGES") return "warn";
  if (c.status === "SKIPPED_VALIDATION" || /HIBA/.test(c.status)) return "err";
  return "neutral";
};

// A „📊 Kulcsszámok ma" szekció HTML-je (vagy "" ha nincs szám-tartalmú tétel — üres dobozt nem
// renderelünk). A friss (UJ_24H) tételek közül a szám/százalék-tartalmú címek, jelentőség szerint,
// max 8, VERBATIM (a cím a szám kontextusával). A honlap és az email KÖZÖS helpere.
function keyNumbersSection(freshItems, sourceNames) {
  const nums = sortItems(freshItems.filter(hasKeyNumber)).slice(0, 8);
  if (!nums.length) return "";
  const list = `<ul>${nums.map((it) =>
    `<li>${sigLabel(it)} <strong>${srcLabel(it, sourceNames)}</strong>: ${titleLink(it)}</li>`,
  ).join("")}</ul>`;
  return `<section id="kulcsszamok"><h2>📊 Kulcsszámok ma</h2>${list}</section>`;
}

// ---- Teljes Pages-jelentés ----
export function renderReport(run) {
  const sourceNames = run.sourceNames ?? {};
  const checks = run.sourceChecks ?? [];
  // Story-dedup EGYSZER, run-szinten: minden szekció a reprezentánsokból válogat,
  // így a groupStories nem fut szekciónként újra, és a merges-napló egységes.
  const { representatives: visible } = storyGroups(run);

  const hivatalos = visible.filter((i) => i.kind === "hivatalos_adat");
  const latestHivatalos = sortItems(hivatalos)[0];
  // UTOLSÓ ÚJ KUTATÁS a fejlécben — a legfrissebb kutatás-tétel (intézeti közlemény vagy a
  // sajtóból kutatásként azonosított), a LEGFRISSEBB HIVATALOS ADAT párja (kind==="kutatas").
  const kutatas = visible.filter((i) => i.kind === "kutatas");
  const latestKutatas = sortItems(kutatas)[0];
  const uj24 = visible.filter((i) => i.freshness === "UJ_24H");
  // A kapuzott TÁBLÁK csak az elmúlt 24 óra (UJ_24H) tételeit sorolják — ez a szintézis
  // halmaza (enrich.js relevantFresh) és az email digest-je is. A KORÁBBI tételeket csak a fejléc
  // (latest*) viszi tovább; a korábbi 14 napos KIEMELT visszatekintő szekció kikerült (2026-09-01).
  // Két csoport (KUTATAS_LABEL / SAJTO_LABEL): a Kutatások-tábla MINDEN nem-sajtó friss tételt
  // felvesz (hivatalos_adat + kutatas + nemzetkozi) → nincs néma eltűnés (CLAUDE.md 2).
  const kutatasFresh = uj24.filter((i) => !isSajtoItem(i));
  const sajtoFresh = uj24.filter(isSajtoItem);

  // (A „🔻 Kapu lehúzta" szekció 2026-08-27-én kikerült a nézetből — nézet-tisztítás. A
  //  kapu-LOGIKA a triage-ben változatlanul fut, a lehúzott tétel FIGYELENDO-ként a
  //  Sajtószemlében jelenik meg. A DB-oldali audit-nyom megmarad; ld. triage_gate.test.js.)
  // Forrás-ellenőrzés két csoportra bontva (a kapuzott tétel-táblákkal AZONOS taxonómia):
  // Kutatások és hivatalos adatok (nem-sajtó forrás) + Sajtószemle, mindkettőn belül ABC
  // forrásnév szerint (hu locale). A forrás kind-je a run.sourceKinds-ból; hiányában minden
  // forrás a Kutatások csoportba esik (fallback régi run/teszt esetén).
  const sourceKinds = run.sourceKinds ?? {};
  // Forrás → a TÉNYLEGES gyűjtő-URL(ek) listája (run.js: sourceEndpoints). Egy forrás több linkről
  // is gyűjthet (ksh/mnb: feeds_extra; eurostat: feed+lista) → mindegyik megjelenik a link-oszlopban.
  const sourceUrls = run.sourceUrls ?? {};
  const byName = (a, b) => String(sourceNames[a.source_id] ?? a.source_id).localeCompare(String(sourceNames[b.source_id] ?? b.source_id), "hu");
  // Rendezés: az elérhető források elöl (ABC), a HIBA-státuszúak (most nem elérhetők) a tábla
  // VÉGÉRE, egymás közt szintén ABC (user 2026-09-01) — ne az ABC közepén tűnjenek fel.
  const isUnavailable = (c) => /HIBA/.test(c.status);
  const bySort = (a, b) => (isUnavailable(a) ? 1 : 0) - (isUnavailable(b) ? 1 : 0) || byName(a, b);
  // Forrás → a MAI (UJ_24H) LÁTHATÓ (releváns) tételének linkje = „az új, amiből dolgozott".
  // A Kutatások/hivatalos táblákon a nyers RÉSZLET-szöveg helyett EZ jelenik meg (user 2026-08-31).
  const freshVisibleBySource = {};
  for (const it of uj24) {
    if (!it.url) continue;
    const cur = freshVisibleBySource[it.source_id];
    if (!cur || (Date.parse(it.published_at) || 0) > (Date.parse(cur.published_at) || 0)) freshVisibleBySource[it.source_id] = it;
  }
  const newItemCell = (c) => {
    const it = c.status === "OK_UJ" ? freshVisibleBySource[c.source_id] : null;
    return it ? titleLink(it) : "";
  };
  const nameCell = (c) => `<td>${esc(sourceNames[c.source_id] ?? c.source_id)}</td>`;
  // „Gyűjtött link" cella: a forrás összes gyűjtő-URL-je kattinthatóan, de RÖVID címkével (a teljes
  // URL sok helyet foglalt — user 2026-09-01): egy link → „Forrás", több → „Forrás 1"/„Forrás 2".
  // A teljes URL a href-ben ÉS a title-tooltipben marad (hover megmutatja). Üres → „—".
  const linksCell = (c) => {
    const urls = sourceUrls[c.source_id] ?? [];
    if (!urls.length) return `<td class="empty">—</td>`;
    const label = (i) => (urls.length === 1 ? "Forrás" : `Forrás ${i + 1}`);
    return `<td class="srclinks">${urls.map((u, i) => `<a href="${esc(u)}"${LINK_ATTR} title="${esc(u)}">${esc(label(i))}</a>`).join("<br>")}</td>`;
  };
  // Státusz-cella RELEVANCIA-TUDATOS (user 2026-08-31): egy forrás lehet OK_UJ (hozott új tételt),
  // de az új tételét a relevancia-szűrő KÖZÉLETI szempontból nem tartotta fontosnak → nem jelenik
  // meg a jelentésben. A „✅ új" melletti üres „Új tétel" cella emiatt zavaró volt (néma hiány,
  // CLAUDE.md 2). Ezért a STÁTUSZ maga különbözteti: „új – releváns" (van megjeleníthető friss
  // tétel) vs „új – nem releváns" (hozott újat, de közéleti szempontból nem releváns). KÖZÉRTHETŐ
  // szó — NEM a belső „triázs" szakkifejezés (user kérés). A többi státusz a CHECK-térképből.
  const statusCell = (c) => {
    const label = c.status === "OK_UJ"
      ? (freshVisibleBySource[c.source_id] ? "✅ új – releváns" : "⚪ új – nem releváns")
      : (CHECK[c.status] ?? c.status);
    const tone = statusTone(c, Boolean(freshVisibleBySource[c.source_id]));
    return `<td class="nowrap"><span class="st st-${tone}">${esc(label)}</span></td>`;
  };
  // Kutatások/hivatalos altábla: Forrás | Státusz | Új tétel (link a friss tételre) | Gyűjtött link
  // (a forrás összes gyűjtő-URL-je, user 2026-09-01).
  const checkTableKut = (label, list) => `<h3>${esc(label)} <span class="count">(${list.length})</span></h3>
    <table class="checks">
      <tr><th>Forrás</th><th>Státusz</th><th>Új tétel</th><th>Gyűjtött link</th></tr>
      ${list.length ? list.map((c) => `<tr>${nameCell(c)}${statusCell(c)}<td>${newItemCell(c)}</td>${linksCell(c)}</tr>`).join("\n") : `<tr><td colspan="4" class="empty">nincs ellenőrzött forrás</td></tr>`}
    </table>`;
  // Sajtószemle altábla: Forrás | Státusz | Gyűjtött link (a RÉSZLET-oszlop TÖRÖLVE, user 2026-08-31;
  // a „Gyűjtött link" oszlop viszont ITT is kell, user 2026-09-01). Ugyanaz a `checks` fix elrendezés
  // (26%/15% az első két oszlopon) → a STÁTUSZ minden altáblában UGYANOTT kezdődik/végződik.
  const checkTableSajto = (label, list) => `<h3>${esc(label)} <span class="count">(${list.length})</span></h3>
    <table class="checks">
      <tr><th>Forrás</th><th>Státusz</th><th>Gyűjtött link</th></tr>
      ${list.length ? list.map((c) => `<tr>${nameCell(c)}${statusCell(c)}${linksCell(c)}</tr>`).join("\n") : `<tr><td colspan="3" class="empty">nincs ellenőrzött forrás</td></tr>`}
    </table>`;
  // A Kutatások/hivatalos forrás-ellenőrzés két altáblára: Hazai (hivatalos + intézet) vs
  // Nemzetközi (kind=nemzetkozi); a sajtó külön (detail nélkül). Fallback (nincs sourceKinds):
  // minden nem-sajtó a Hazai-ba esik (a nemzetkozi-szűrő üres). Mindegyik ABC forrásnév szerint.
  // Jelmagyarázat a Forrás-ellenőrzés alá — közérthetően, hogy mindenki értse a jelzéseket (user
  // 2026-09-01). A szövegek a statusCell/CHECK-címkékkel KONZISZTENSEK (ha ott változik egy címke,
  // itt is frissítsd — CLAUDE.md 2).
  const checksLegend = `<dl class="legend"><dt>Jelmagyarázat</dt>
    <dd><b>✅ új – releváns</b> — friss tétel érkezett, és közéleti szempontból releváns → bekerült a jelentésbe.</dd>
    <dd><b>⚪ új – nem releváns</b> — friss tétel érkezett, de közéleti szempontból nem releváns → nem került a jelentésbe.</dd>
    <dd><b>☑️ nincs új</b> — a forrás elérhető, de nincs új tétel az elmúlt időszakban.</dd>
    <dd><b>⚠️ részleges</b> — a forrás válaszolt, de üres vagy hiányos tartalmat adott.</dd>
    <dd><b>🚫 validáció elutasította</b> — az adat megérkezett, de a beépített ellenőrzés gyanúsnak találta, ezért nem került be.</dd>
    <dd><b>⚠️ jelenleg nem elérhető</b> — a forrás létezik, de a gyűjtő-környezetből most nem érhető el (átmeneti hálózati hiba vagy blokk); magától visszaáll, amint újra elérhető.</dd>
    <dd><b>Gyűjtött link</b> — a webcím(ek), ahonnan a rendszer az adott forrás adatait figyeli (egy forrásnak több is lehet).</dd></dl>`;

  const hazaiChecks = checks.filter((c) => sourceKinds[c.source_id] !== "sajto" && !isNemzetkoziSource(c.source_id, sourceKinds)).sort(bySort);
  const nemzChecks = checks.filter((c) => sourceKinds[c.source_id] !== "sajto" && isNemzetkoziSource(c.source_id, sourceKinds)).sort(bySort);
  const sajtoChecks = checks.filter((c) => sourceKinds[c.source_id] === "sajto").sort(bySort);

  const degradedNote = run.triageDegraded ? ` <strong>⚠️ triázs kihagyva (nincs elérhető LLM-provider) — nyers tétellista.</strong>` : "";

  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : `<p>${uj24.length} tétel az elmúlt 24 órában.${run.triageDegraded ? "" : ' <span class="empty">Szintézis nem készült.</span>'}</p>`;

  // Honlap-keret (csak megjelenítés): állapot-pill + az oldalsáv szekció-ugrói (badge = a szekció
  // már kiírt darabszáma). A Kulcsszámok menüpont csak akkor, ha a szekció renderelődik.
  const statusPill = run.triageDegraded
    ? `<span class="status-pill warn">NYERS LISTA – TRIÁZS KIHAGYVA</span>`
    : `<span class="status-pill ok">NAPI ELEMZÉS KÉSZ</span>`;
  const keyNumbers = keyNumbersSection(uj24, sourceNames);
  const navSections = [
    { href: "#fejlec", ico: "overview", label: "Áttekintés" },
    { href: "#24h", ico: "narrative", label: "Napi narratíva" },
    ...(keyNumbers ? [{ href: "#kulcsszamok", ico: "numbers", label: "Kulcsszámok" }] : []),
    { href: "#tablak", ico: "items", label: "Kapuzott tételek", badge: uj24.length },
    { href: "#forrasok", ico: "sources", label: "Forrás-ellenőrzés", badge: checks.length },
  ];

  return endash(`<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor — ${esc(run.runId)}</title>
<style>${WEB_STYLE}</style>
</head>
<body>
<div class="layout">
${sidebarHtml("report", navSections)}
<div class="shell">
${topbarHtml("#", run.runId, run.generatedAt ? `${run.generatedAt} (Budapest)` : "")}
<main>
  <header class="page-head">
    <div class="eyebrow">${statusPill}<span class="pill-date">${esc(run.runId)}</span></div>
    <h1>📊 Magyar közéleti kutatás- és adatmonitor</h1>
    <div class="meta">futás: ${esc(run.runId)} · generálva: ${esc(run.generatedAt)} (Budapest)</div>
    <nav class="topnav"><a href="info.html"${LINK_ATTR}>ℹ️ Az oldalról – hogyan gyűjtünk és mit látunk →</a></nav>
  </header>

  <div class="stats">
    <div class="stat"><span class="stat-label">Friss tétel (24 óra)</span><span class="stat-value">${uj24.length}</span></div>
    <div class="stat"><span class="stat-label">${KUTATAS_LABEL}</span><span class="stat-value">${kutatasFresh.length}</span></div>
    <div class="stat"><span class="stat-label">${SAJTO_LABEL}</span><span class="stat-value">${sajtoFresh.length}</span></div>
    <div class="stat"><span class="stat-label">Ellenőrzött forrás</span><span class="stat-value">${checks.length}</span></div>
  </div>

  <section id="fejlec">
    <div class="headline"><span>🕒</span><span class="label">UTOLSÓ ÚJ KUTATÁS:</span>
      <span>${headlineHtml(latestKutatas, "nincs friss kutatás")}</span></div>
    <div class="headline"><span>📈</span><span class="label">LEGFRISSEBB HIVATALOS ADAT:</span>
      <span>${headlineHtml(latestHivatalos, "nincs friss hivatalos adat")}</span></div>
  </section>

  <section id="24h">
    <h2>📰 Napi narratíva (utolsó 24 óra)</h2>
    ${synth}${degradedNote}
  </section>

  ${keyNumbers}

  <section id="tablak">
    <h2>📊 Adatjelentőség szerint, kapuzott</h2>
    ${table(KUTATAS_LABEL, kutatasFresh, sourceNames)}
    ${table(SAJTO_LABEL, sajtoFresh, sourceNames)}
  </section>

  <section id="forrasok">
    <h2>Forrás-ellenőrzés</h2>
    ${hazaiChecks.length ? checkTableKut(HAZAI_LABEL, hazaiChecks) : ""}
    ${nemzChecks.length ? checkTableKut(NEMZ_LABEL, nemzChecks) : ""}
    ${sajtoChecks.length ? checkTableSajto(SAJTO_LABEL, sajtoChecks) : ""}
    ${checksLegend}
  </section>

  <footer>
    ${visible.length} tétel · ${checks.length} forrás · futási idő: ${run.durationMs} ms
    · LLM: ${esc(summarizeProviders(run.providersUsed))} · survey-monitor v0.1 (F2)
  </footer>
</main>
</div>
</div>
</body>
</html>
`);
}

// ---- Információs oldal (statikus „fül") — mi ez, hogyan gyűjtünk, hogyan vonjuk össze a
// cikkeket, mit látunk a honlapon. NINCS futás-adat → tiszta függvény; a buildDist minden
// futáskor (a no-op-nál is) újraírja info.html-ként → mindig a friss kóddal, mindkét felületre
// (Pages + tükör). A leírás a VALÓS folyamatot tükrözi (ARCHITEKTURA.md + a tényleges render).
export function renderInfoPage() {
  return endash(`<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Az oldalról — Magyar közéleti kutatás- és adatmonitor</title>
<style>${WEB_STYLE}</style>
</head>
<body>
<div class="layout">
${sidebarHtml("info")}
<div class="shell">
${topbarHtml("index.html", "Az oldalról", "")}
<main>
  <header class="page-head">
    <h1>ℹ️ Az oldalról</h1>
    <div class="meta">Hogyan gyűjtjük az adatokat, hogyan vonjuk össze a cikkeket, és mit látunk a honlapon.</div>
    <nav class="topnav"><a href="index.html"${LINK_ATTR}>← Vissza a napi jelentéshez</a></nav>
  </header>

  <section class="info">
    <h2>Mi ez a felület?</h2>
    <p>Ez egy automatizált <b>magyar közéleti kutatás- és adatmonitor</b>. Minden nap egyetlen
    jelentést állít össze az <b>előző futás óta megjelent</b> magyar és nemzetközi
    közvélemény-kutatásokról, intézeti felmérésekről, hivatalos statisztikai adatközlésekről és a
    hozzájuk kapcsolódó sajtóról. A cél, hogy egy helyen, tömören, ellenőrizhető módon lásd, mi új
    a közvélemény- és adatvilágban — a napi zaj kiszűrésével.</p>
  </section>

  <section class="info">
    <h2>Honnan gyűjtünk?</h2>
    <p>Több tucat forrást figyelünk automatikusan, több csoportban:</p>
    <ul>
      <li><b>Hazai kutatóintézetek és közvélemény-kutatók</b> (pl. Medián, Publicus, Nézőpont,
      Iránytű, Republikon, Tárki, TK ELTE és társaik).</li>
      <li><b>Hivatalos statisztikai szervek</b> (KSH, Eurostat, MNB) és nemzetközi szervezetek
      (OECD, Pew, Ipsos, WHO, ECFR és mások).</li>
      <li><b>Sajtó</b> — a közélet-releváns híreket adó lapok (Telex, 444, HVG, 24.hu, Portfolio,
      Népszava és társaik).</li>
    </ul>
    <p>A források többségét szabványos <b>hír-csatornán (RSS/Atom feed)</b> keresztül olvassuk;
    ahol nincs ilyen, ott az adott oldal listáját dolgozzuk fel saját beolvasóval. Néhány forrásnak
    <b>több figyelt címe</b> is van (pl. a KSH-nak a gyorstájékoztatók ÉS a hírek külön csatornája) —
    ezek a jelentés „Forrás-ellenőrzés" tábláiban a „Gyűjtött link" oszlopban láthatók (Forrás 1,
    Forrás 2 …). A lekérés <b>naponta egyszer</b> fut.</p>
  </section>

  <section class="info">
    <h2>Hogyan dolgozzuk fel? — a folyamat</h2>
    <p>A rendszer vezérelve: <b>ami determinisztikus lehet, az kódban él</b> (dátumok, összevonás,
    frissesség, ellenőrzési napló); a mesterséges intelligencia csak ott dönt, ahol valódi ítélet
    kell (relevancia, jelentőség, összefoglaló). A lépések:</p>
    <ol>
      <li><b>Gyűjtés.</b> Végigolvassuk a forrásokat, és kigyűjtjük az új tételeket (cím, link, dátum).</li>
      <li><b>Egységesítés.</b> Minden tétel közös formátumra kerül, függetlenül attól, honnan jött.</li>
      <li><b>Összevonás és emlékezet.</b> Egy adatbázis nyilvántartja, mit láttunk már; a
      duplikátumokat kiszűrjük, és a legutóbbi ~két hét számít a kontextushoz (lásd lentebb).</li>
      <li><b>Triázs (relevancia + jelentőség).</b> Egy költséghatékony nyelvi modell minden tételről
      eldönti, hogy <b>közéleti szempontból releváns-e</b>, és ha igen, milyen a jelentősége:
      <b>🔴 KIEMELT</b>, <b>🟠 FONTOS</b> vagy <b>🟡 FIGYELENDŐ</b>.</li>
      <li><b>Adat-kapuzás.</b> Ha egy tétel fontosnak <em>tűnik</em>, de nincs mögötte tényleges
      adat/mérés, a rendszer óvatosan visszább sorolja — a szám nélküli állítás nem kap kiemelt helyet.</li>
      <li><b>Összefoglaló.</b> A releváns, friss tételekből egy nyelvi modell rövid napi narratívát
      ír, és a rendszer kigyűjti a címekben szereplő <b>konkrét számokat</b> (ezek szó szerintiek,
      hogy ne legyen félreértés).</li>
    </ol>
  </section>

  <section class="info">
    <h2>Hogyan vonjuk össze a cikkeket? (a „+N" jelölés)</h2>
    <p>Ugyanazt a hírt vagy kutatást gyakran <b>több forrás is lehozza</b>. Ilyenkor nem külön
    sorokban, egymást ismételve jelenítjük meg, hanem <b>egyetlen tételbe vonjuk össze</b> (ez a
    „story-összevonás"). A megjelenített változat a <b>reprezentáns</b>: a legjelentősebb / legtöbbet
    mondó, illetve legkorábban észlelt verzió.</p>
    <p>A forrás neve mellett a <b>„+N"</b> azt jelenti, hogy <b>további N forrás</b> is beszámolt
    <b>ugyanarról a sztoriról</b>. Például a <b>„444 +2"</b> azt jelenti: a megjelenített forrás a
    <b>444</b>, és rajta kívül <b>még 2 további forrás</b> is lehozta ugyanazt — összesen tehát három
    helyen jelent meg.</p>
    <p>Miért így? Egyrészt így <b>nincs duplikátum-zaj</b> (egy sztori egyszer szerepel), másrészt a
    „+N" a <b>megerősítést</b> mutatja: minél több forrás hozza, annál szélesebb körben visszhangzik.
    Az összevonás <b>determinisztikus</b> (kódban dől el, nem a modell tippjén múlik) és
    <b>forrásokon átível</b>. Szándékosan óvatos: a valóban <b>különböző</b> témákat nem olvasztjuk
    egybe — mert egy fontos, önálló tétel elrejtése súlyosabb hiba, mint egy megmaradt duplikátum.</p>
    <p>Az így összevont, megerősített tételek adják az alapját a napi <b>összefoglalónak</b> és a
    <b>Kulcsszámoknak</b> is.</p>
  </section>

  <section class="info">
    <h2>Mit látunk a honlapon?</h2>
    <ul>
      <li><b>Fejléc</b> — az utolsó új kutatás és a legfrissebb hivatalos adat, kattintható linkkel.</li>
      <li><b>📰 Napi narratíva</b> — rövid, gépi összefoglaló az elmúlt 24 óráról.</li>
      <li><b>📊 Kulcsszámok ma</b> — a friss címekből szó szerint kiemelt, konkrét számok (garantáltan
      valós, a címekből származó adatok).</li>
      <li><b>📊 Adatjelentőség szerint, kapuzott</b> — a friss (24 órás) tételek jelentőség szerint
      (🔴 KIEMELT → 🟠 FONTOS → 🟡 FIGYELENDŐ), Kutatások és Sajtószemle bontásban.</li>
      <li><b>Forrás-ellenőrzés</b> — forrásonként, hogy elérhető volt-e és volt-e új tétel; a
      „Gyűjtött link" oszlopban a figyelt cím(ek), a nem elérhető források a lista végén. Alatta
      <b>jelmagyarázat</b> minden jelzéshez.</li>
    </ul>
    <p>A jelentés ugyanez az e-mailben is megérkezik (rövidebb, 24 órás kivonatként), a teljes verzió
    pedig itt, a honlapon olvasható.</p>
  </section>

  <section class="info">
    <h2>Ütemezés</h2>
    <p>A rendszer <b>naponta egyszer</b>, jellemzően <b>16:30 (Budapest)</b> körül fut le, és az
    előző futás óta megjelent termést fedi le — így nem marad ki és nem duplikálódik tartalom.</p>
  </section>

  <nav class="topnav"><a href="index.html"${LINK_ATTR}>← Vissza a napi jelentéshez</a></nav>
</main>
</div>
</div>
</body>
</html>
`);
}

// ---- Digest e-mail: az elmúlt 24 órára fókuszál ----
function digestItemList(items, sourceNames) {
  const grouped = sortItems(items);
  if (!grouped.length) return `<p class="empty">nincs friss tétel az elmúlt 24 órában.</p>`;
  return `<ul>${grouped.map((it) =>
    `<li>${sigLabel(it)} <strong>${srcLabel(it, sourceNames)}</strong>: ${titleLink(it)}${pressUrlsHtml(it)}</li>`,
  ).join("")}</ul>`;
}

// A kapuzott szekció KÖZÖS tartalma az emailben: két al-csoport (Kutatások és hivatalos adatok /
// Sajtószemle), a honlappal AZONOS bontásban — a hivatalos/kutatás/nemzetközi tétel a Kutatások,
// a sajtó a Sajtószemle listába. Mindkettő jelentőség szerint rendezve (digestItemList → sortItems).
// EGY helyen, hogy a digest és a combined render-ág ne csússzon szét (CLAUDE.md 2).
function digestKapuzott(fresh, sourceNames) {
  const kutatas = fresh.filter((i) => !isSajtoItem(i));
  const sajto = fresh.filter(isSajtoItem);
  return `<h3>${KUTATAS_LABEL} <span class="count">(${kutatas.length})</span></h3>
    ${digestItemList(kutatas, sourceNames)}
    <h3>${SAJTO_LABEL} <span class="count">(${sajto.length})</span></h3>
    ${digestItemList(sajto, sourceNames)}`;
}

// A friss (UJ_24H) reprezentánsok — a memoizált story-dedupból (egyszer collapse-olva).
const freshRepresentatives = (run) =>
  storyGroups(run).representatives.filter((i) => i.freshness === "UJ_24H");

// A digest ÉS a KIEMELT-levél KÖZÖS „jelentés-linkje". A Pages-GYÖKÉRRE mutat (PAGES_BASE) →
// mindig a legfrissebb jelentés (a napi archív URL-ek másnap 404-esek, lásd PAGES_BASE komment);
// a szöveg ezért „Legfrissebb" — nem ígéri, hogy pont EZT a jelentést nyitja. Unset pagesUrl-nél
// fallback-szöveg, hogy a levél sose bukjon egy hiányzó linken (CLAUDE.md 2). EGY helyen, mert a
// duplikált fallback-literál volt a bug forrása: az 5b772a5 csak a digestet javította, a
// KIEMELT-levél iker-literálja link nélkül maradt — egy jövőbeli link-változás se maradjon le.
const pagesLink = (run) => run.pagesUrl
  ? `<p><a href="${esc(run.pagesUrl)}"${LINK_ATTR}>Legfrissebb jelentés →</a></p>`
  : `<p class="empty">A teljes jelentés a GitHub Pages-archívumban.</p>`;

// A napi levél TETEJÉN álló, kiemelt (nagyobb betűs) jelentés-link — user-kérés 2026-08-31.
// A szöveg egyértelműsíti, hogy ez a TELJES napi jelentés a HONLAPON (a levél csak a 24 órás
// kivonat) — „jelentés" + „honlap" a szövegben. UGYANARRA a gyökér-URL-re mutat, mint a
// pagesLink (run.pagesUrl = PAGES_BASE) → a href-forrás közös, nem csúszhat szét (CLAUDE.md 2).
const pagesLinkTop = (run) => run.pagesUrl
  ? `<p class="toplink"><a href="${esc(run.pagesUrl)}"${LINK_ATTR}>📄 Teljes napi jelentés a honlapon →</a></p>`
  : `<p class="empty">A teljes jelentés a honlap-archívumban.</p>`;

export function digestSubject(run) {
  // A tárgy CSAK a 24 órás képet mutatja: „N új (24h)" = a friss (UJ_24H) reprezentánsok száma.
  // A korábbi „· N kiemelt (14 nap)" rész KIKERÜLT (user 2026-09-01: napi jelentés, ne legyen
  // benne az elmúlt 14 napról infó — se a tárgyban, se a törzsben; a 14 napos KIEMELT szekció is
  // eltűnt az emailből és a honlapról egyaránt).
  const fresh = freshRepresentatives(run);
  // 2026-09-23 (user, kolléga-visszajelzés): a nap DÁTUMA (runId) a tárgyban. A korábbi dátumtalan,
  // napról napra azonos mintájú tárgy a levelezőben egy szálba fűződött / duplikátumnak tűnt (főleg
  // ha az „N" egyezett), így a mai levelet tegnapinak nézték. A dátum minden napot egyedivé tesz.
  return endash(`Survey Monitor — ${run.runId} — ${fresh.length} új (24h)`);
}

export function renderDigest(run) {
  const sourceNames = run.sourceNames ?? {};
  const fresh = freshRepresentatives(run);
  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : (run.triageDegraded ? `<p class="empty">⚠️ triázs kihagyva (nincs LLM) — nyers 24 órás lista.</p>` : "");
  return endash(`<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(digestSubject(run))}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>📊 Napi monitor — elmúlt 24 óra</h1>
    <div class="meta">${esc(run.generatedAt)} (Budapest) · ${fresh.length} új tétel</div></header>
  <section><h2>📰 Napi narratíva (utolsó 24 óra)</h2>${synth}</section>
  ${keyNumbersSection(fresh, sourceNames)}
  <section><h2>📊 Adatjelentőség szerint, kapuzott</h2>${digestKapuzott(fresh, sourceNames)}</section>
  ${pagesLink(run)}
</main></body></html>
`);
}

// ---- EGY összevont napi levél: felső jelentés-link + narratíva + Kulcsszámok + kapuzott digest ----
// (2026-09-01: a korábbi 🔴 KIEMELT 14 napos visszatekintő szekció kikerült.) A tartalom a
// friss (24h) digest, UGYANAZOKBÓL a helperekből (freshRepresentatives + digestKapuzott/
// digestItemList + a KÖZÖS pagesLink), hogy egy jövőbeli render-változásnál a digest és a combined
// ág ne csússzon szét (CLAUDE.md 2). renderDigest/renderKiemelt exportok megmaradnak (teszteltek),
// csak a küldés-ág nem használja őket külön.
export function combinedSubject(run) {
  // 2026-09-01 (user): a napi levélből kikerült a 14 napos KIEMELT visszatekintés → a 🔴 előtag
  // is megszűnt (az a 14 napos KIEMELT meglétéhez volt kötve). A combined tárgy = digest tárgy.
  return digestSubject(run);
}

export function renderCombined(run) {
  const sourceNames = run.sourceNames ?? {};
  const fresh = freshRepresentatives(run);
  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : (run.triageDegraded ? `<p class="empty">⚠️ triázs kihagyva (nincs LLM) — nyers 24 órás lista.</p>` : "");
  // Szekció-sorrend: FELÜL a kiemelt „teljes jelentés a honlapon" link (nagyobb betű), majd
  // narratíva → 📊 Kulcsszámok → kapuzott. A 14 napos 🔴 KIEMELT visszatekintő szekció KIKERÜLT
  // (user 2026-09-01: napi jelentés, ne legyen benne az elmúlt 14 napról infó). Záró endash → nincs em-dash.
  return endash(`<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(combinedSubject(run))}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>📊 Napi monitor — elmúlt 24 óra</h1>
    <div class="meta">${esc(run.generatedAt)} (Budapest) · ${fresh.length} új tétel</div></header>
  ${pagesLinkTop(run)}
  <section><h2>📰 Napi narratíva (utolsó 24 óra)</h2>${synth}</section>
  ${keyNumbersSection(fresh, sourceNames)}
  <section><h2>📊 Adatjelentőség szerint, kapuzott</h2>${digestKapuzott(fresh, sourceNames)}</section>
</main></body></html>
`);
}

// ---- 🔴 KIEMELT e-mail: csak a kiemelt tételek (csak ha van ilyen) ----
export function renderKiemelt(run) {
  const sourceNames = run.sourceNames ?? {};
  // Story-dedup UTÁN (memoizált): egy sztori egyszer szerepel (a groupSig a legerősebb
  // tagé → egy KIEMELT framing felhozza a sztorit); a többi forrás a reprezentáns +N / press_urls.
  const kiemelt = storyGroups(run).representatives.filter((i) => i.significance === "KIEMELT");
  return endash(`<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>🔴 KIEMELT — ${esc(run.runId)}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>🔴 KIEMELT tételek — ${esc(run.runId)}</h1></header>
  <section>${digestItemList(kiemelt, sourceNames)}</section>
  ${pagesLink(run)}
</main></body></html>
`);
}
