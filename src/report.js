// Jelentés-renderelő (F2). A Pages-jelentés a spec 17-23. pontját követi;
// az e-mail (digest) az elmúlt 24 órára fókuszál (szintézis + UJ_24H tételek
// jelentőség szerint). Triázs után a nem-releváns tételek kimaradnak a
// megjelenítésből (a DB-ben maradnak); degradált (LLM nélküli) módban minden
// tétel nyersen látszik. Stílus: email-barát, beágyazott CSS.

import { groupStories } from "./lib/storygroup.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
  const links = p.map((u) => (u.url ? `<a href="${esc(u.url)}">${esc(u.source_id)}</a>` : esc(u.source_id))).join(", ");
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

const CHECK = { OK_UJ: "✅ új", OK_NINCS_UJ: "☑️ nincs új", RESZLEGES: "⚠️ részleges", SKIPPED_VALIDATION: "🚫 validáció elutasította", HIBA: "❌ hiba" };

// Egységes taxonómia a honlapon és az emailben: minden NEM-sajtó tétel/forrás a „Kutatások és
// hivatalos adatok" csoportba esik (hivatalos_adat + kutatas + nemzetkozi), a sajtó külön. Így a
// kapuzott tétel-tábla és a Forrás-ellenőrzés UGYANAZT a két csoportot mutatja, és semmi nem esik
// ki némán (CLAUDE.md 2 — a korábbi hivatalos_adat/sajto bontás a kutatas/nemzetkozi tételeket
// eldobta). A tétel `kind`-je mindig jelen van; a forrás `kind`-jét a run.sourceKinds adja (annak
// hiányában minden forrás a Kutatások csoportba kerül — biztonságos fallback régi run/teszt esetén).
const KUTATAS_LABEL = "📈 Kutatások és hivatalos adatok";
const SAJTO_LABEL = "📰 Sajtószemle";
const isSajtoItem = (it) => it.kind === "sajto";

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

const titleLink = (it) => (it.url ? `<a href="${esc(it.url)}">${esc(it.title)}</a>` : esc(it.title));

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
  return `<tr><td>${src}</td><td>${titleLink(it)}${pressUrlsHtml(it)}</td><td>${sig}</td><td>${esc(fmtTime(it.published_at))}</td><td>${fresh}</td></tr>`;
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
  th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  a{color:#0b5aa2}
  ul{margin:8px 0;padding-left:22px}
  li{margin:3px 0}
  footer{margin-top:48px;padding-top:12px;border-top:1px solid var(--line);font:12px/1.6 ui-monospace,Consolas,monospace;color:var(--muted)}
  .phase{display:inline-block;background:var(--ink);color:var(--paper);font:12px/1 ui-monospace,Consolas,monospace;padding:4px 8px;border-radius:3px}`;

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
  // halmaza (enrich.js relevantFresh) és az email digest-je is. A KORÁBBI tételeket a fejléc
  // (latest*) és az email 🔴 KIEMELT-szekciója viszi tovább (a 14-napos ablak-feature).
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
  const checkRow = (c) => `<tr><td>${esc(sourceNames[c.source_id] ?? c.source_id)}</td><td>${esc(CHECK[c.status] ?? c.status)}</td><td>${esc(c.detail ?? "")}</td></tr>`;
  const byName = (a, b) => String(sourceNames[a.source_id] ?? a.source_id).localeCompare(String(sourceNames[b.source_id] ?? b.source_id), "hu");
  const kutatasChecks = checks.filter((c) => sourceKinds[c.source_id] !== "sajto").sort(byName);
  const sajtoChecks = checks.filter((c) => sourceKinds[c.source_id] === "sajto").sort(byName);
  const checkTable = (label, list) => `<h3>${esc(label)} <span class="count">(${list.length})</span></h3>
    <table>
      <tr><th>Forrás</th><th>Státusz</th><th>Részlet</th></tr>
      ${list.length ? list.map(checkRow).join("\n") : `<tr><td colspan="3" class="empty">nincs ellenőrzött forrás</td></tr>`}
    </table>`;

  const degradedNote = run.triageDegraded ? ` <strong>⚠️ triázs kihagyva (nincs elérhető LLM-provider) — nyers tétellista.</strong>` : "";

  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : `<p>${uj24.length} tétel az elmúlt 24 órában.${run.triageDegraded ? "" : ' <span class="empty">Szintézis nem készült.</span>'}</p>`;

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor — ${esc(run.runId)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>📊 Magyar közéleti kutatás- és adatmonitor</h1>
    <div class="meta">futás: ${esc(run.runId)} · generálva: ${esc(run.generatedAt)} (Budapest)</div>
  </header>

  <section id="fejlec">
    <div class="headline"><span>🕒</span><span class="label">UTOLSÓ ÚJ KUTATÁS:</span>
      <span>${latestKutatas ? esc(latestKutatas.title) + " — " + esc(fmtTime(latestKutatas.published_at)) : '<span class="empty">nincs friss kutatás</span>'}</span></div>
    <div class="headline"><span>📈</span><span class="label">LEGFRISSEBB HIVATALOS ADAT:</span>
      <span>${latestHivatalos ? esc(latestHivatalos.title) + " — " + esc(fmtTime(latestHivatalos.published_at)) : '<span class="empty">nincs friss hivatalos adat</span>'}</span></div>
  </section>

  <section id="24h">
    <h2>📰 Napi narratíva (utolsó 24 óra)</h2>
    ${synth}${degradedNote}
  </section>

  <section id="tablak">
    <h2>📊 Adatjelentőség szerint, kapuzott</h2>
    ${table(KUTATAS_LABEL, kutatasFresh, sourceNames)}
    ${table(SAJTO_LABEL, sajtoFresh, sourceNames)}
  </section>

  <section id="forrasok">
    <h2>Forrás-ellenőrzés</h2>
    ${checkTable(KUTATAS_LABEL, kutatasChecks)}
    ${checkTable(SAJTO_LABEL, sajtoChecks)}
  </section>

  <footer>
    ${visible.length} tétel · ${checks.length} forrás · futási idő: ${run.durationMs} ms
    · LLM: ${esc(summarizeProviders(run.providersUsed))} · survey-monitor v0.1 (F2)
  </footer>
</main>
</body>
</html>
`;
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
  ? `<p><a href="${esc(run.pagesUrl)}">Legfrissebb jelentés →</a></p>`
  : `<p class="empty">A teljes jelentés a GitHub Pages-archívumban.</p>`;

export function digestSubject(run) {
  // Mindkét szám a story-dedup UTÁNi halmazból — konzisztens a levél törzsével
  // (a nyers kiemeltCount-ot NEM keverjük ide, az a küldés-döntéshez van).
  const fresh = freshRepresentatives(run);
  const kiemelt = fresh.filter((i) => i.significance === "KIEMELT").length;
  return `Survey Monitor — ${fresh.length} új (24h), ebből ${kiemelt} kiemelt`;
}

export function renderDigest(run) {
  const sourceNames = run.sourceNames ?? {};
  const fresh = freshRepresentatives(run);
  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : (run.triageDegraded ? `<p class="empty">⚠️ triázs kihagyva (nincs LLM) — nyers 24 órás lista.</p>` : "");
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(digestSubject(run))}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>📊 Napi monitor — elmúlt 24 óra</h1>
    <div class="meta">${esc(run.generatedAt)} (Budapest) · ${fresh.length} új tétel</div></header>
  <section><h2>📰 Napi narratíva (utolsó 24 óra)</h2>${synth}</section>
  <section><h2>📊 Adatjelentőség szerint, kapuzott</h2>${digestKapuzott(fresh, sourceNames)}</section>
  ${pagesLink(run)}
</main></body></html>
`;
}

// ---- EGY összevont levél (2026-08-26): 🔴 KIEMELT szekció FELÜL (ha van) + teljes digest ----
// A korábbi két külön levél (renderDigest + renderKiemelt) helyett egy levél. A tartalom a kettő
// UNIÓJA, UGYANAZOKBÓL a helperekből (storyGroups KIEMELT-reprezentánsai a szekcióhoz + a digest
// freshRepresentatives-listája + digestItemList + a KÖZÖS pagesLink), hogy egy jövőbeli
// render-változásnál a két ág ne csússzon szét (CLAUDE.md 2). renderDigest/renderKiemelt
// exportok megmaradnak (teszteltek), csak a küldés-ág nem használja őket külön.
export function combinedSubject(run) {
  // 🔴 előtag CSAK ha van KIEMELT szekció (= a levélben ténylegesen megjelenő KIEMELT-reprezentáns).
  const hasKiemelt = storyGroups(run).representatives.some((i) => i.significance === "KIEMELT");
  return hasKiemelt ? `🔴 ${digestSubject(run)}` : digestSubject(run);
}

export function renderCombined(run) {
  const sourceNames = run.sourceNames ?? {};
  const kiemelt = storyGroups(run).representatives.filter((i) => i.significance === "KIEMELT");
  const fresh = freshRepresentatives(run);
  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : (run.triageDegraded ? `<p class="empty">⚠️ triázs kihagyva (nincs LLM) — nyers 24 órás lista.</p>` : "");
  const kiemeltSection = kiemelt.length
    ? `<section><h2>🔴 KIEMELT tételek</h2>${digestItemList(kiemelt, sourceNames)}</section>`
    : "";
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(combinedSubject(run))}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>📊 Napi monitor — elmúlt 24 óra</h1>
    <div class="meta">${esc(run.generatedAt)} (Budapest) · ${fresh.length} új tétel</div></header>
  ${kiemeltSection}
  <section><h2>📰 Napi narratíva (utolsó 24 óra)</h2>${synth}</section>
  <section><h2>📊 Adatjelentőség szerint, kapuzott</h2>${digestKapuzott(fresh, sourceNames)}</section>
  ${pagesLink(run)}
</main></body></html>
`;
}

// ---- 🔴 KIEMELT e-mail: csak a kiemelt tételek (csak ha van ilyen) ----
export function renderKiemelt(run) {
  const sourceNames = run.sourceNames ?? {};
  // Story-dedup UTÁN (memoizált): egy sztori egyszer szerepel (a groupSig a legerősebb
  // tagé → egy KIEMELT framing felhozza a sztorit); a többi forrás a reprezentáns +N / press_urls.
  const kiemelt = storyGroups(run).representatives.filter((i) => i.significance === "KIEMELT");
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>🔴 KIEMELT — ${esc(run.runId)}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>🔴 KIEMELT tételek — ${esc(run.runId)}</h1></header>
  <section>${digestItemList(kiemelt, sourceNames)}</section>
  ${pagesLink(run)}
</main></body></html>
`;
}
