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

const PER_SOURCE_CAP = 25;
const TZ = "Europe/Budapest";

// A publikált Pages-site GYÖKERE — a digest „Legfrissebb jelentés →" linkjének célja.
// FORRÁS: `gh api repos/Goszmarton/survey-monitor/pages` → `html_url` (verifikált,
// `cname:null` — nincs egyedi domain, a github.io séma érvényes). NEM lehet a
// deploy-pages action `page_url` outputjából venni: a levél a `node src/run.js`
// lépésben megy ki, a Pages-deploy KÉSŐBBI lépés (a page_url a render pillanatában
// még nem létezik) — lásd .github/workflows/monitor.yml.
//
// MIÉRT A GYÖKÉR, NEM A NAPI ARCHÍV (empirikus, 2026-08-12 élő curl): a `deploy-pages`
// NEM additív — a `dist/` minden futáskor TELJES site-ként publikálódik, és a run.js
// csak {index.html, a MAI archív}-ot írja bele. Ezért a tegnapi `ÉÉÉÉ/HH/NN.html` archív
// URL MÁSNAP 404 (igazolva: 08-11 archív 404 volt 08-12-n). A napra rögzített link tehát
// másnaptól halott lenne → a link a mindig-élő gyökérre mutat (a mai jelentés, ill. később
// a frissebb). Trailing perjel a bázison KELL.
// KORLÁT (a komment a korlátot mondja, nem többet ígér az adatnál): ha egyedi domaint
// (CNAME) kapcsolsz a Pages-hez, EZT KÉZZEL kell átírni — a github.io URL akkor elavul.
export const PAGES_BASE = "https://goszmarton.github.io/survey-monitor/";

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
  const visibleRaw = visibleItems(run);
  const { representatives: visible, merges } = storyGroups(run);

  const hivatalos = visible.filter((i) => i.kind === "hivatalos_adat");
  const sajto = visible.filter((i) => i.kind === "sajto");
  const latestHivatalos = sortItems(hivatalos)[0];
  const uj24 = visible.filter((i) => i.freshness === "UJ_24H");
  // Új sztori: a csoport LEGKORÁBBI tagja most jelent meg (egyetlen tagját sem
  // láttuk a mai futás előtt). A _groupFirstSeen a csoport-min; singletonnál a saját.
  const newStories = visible.filter((i) => (i._groupFirstSeen ?? i.first_seen_at) === run.runStartedAt);
  // Releváns új tétel (nyers, összevonás ELŐTT) — a mondat őszinteségéhez elkülönítve
  // a countNewInRun-tól (ami a teljes DB-t számolja, a kód-DROP-olt churnnel együtt).
  const newRelevant = visibleRaw.filter((i) => i.first_seen_at === run.runStartedAt).length;

  // Kapu-lehúzás szekció (cap- és dedup-független, tétel-szinten): a per-forrás cap a
  // FIGYELENDO-farkat levágja a Sajtószemléből, így a lehúzások a fő táblákban láthatatlanok.
  // Itt a teljes látható halmazból (visibleRaw) soroljuk fel őket, kapu ELŐTTI érték + reason.
  const RAWRANK = { KIEMELT: 0, FONTOS: 1 };
  const downgraded = visibleRaw.filter(isDowngraded)
    .sort((a, b) => (RAWRANK[rawSignificance(a)] - RAWRANK[rawSignificance(b)]) || (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0));
  const unassessableDown = visibleRaw.filter(isUnassessableDowngrade).length;
  const downRows = downgraded.map((it) =>
    `<li>${esc(sourceNames[it.source_id] ?? it.source_id)}: ${titleLink(it)} <span class="empty">↳ ${esc(rawSignificance(it))}→FIGYELENDO — ${esc(triageReason(it))}</span></li>`).join("");
  const gateSection = `<section id="kapu">
    <h2>🔻 Kapu lehúzta (adat nélkül → FIGYELENDO)</h2>
    ${downgraded.length
      ? `<p class="empty">${downgraded.length} tétel: a modell FONTOS/KIEMELT-nek ítélte, de data_backed=false → a kapu FIGYELENDO-ra húzta (spec 1./15.).</p><ul>${downRows}</ul>`
      : `<p class="empty">nincs lehúzott tétel ebben az ablakban</p>`}
    ${unassessableDown > 0
      ? `<p class="empty">⚠️ további ${unassessableDown} FIGYELENDO tétel lehúzása nem megállapítható (significance_raw nélküli, korábbi triázs) — a 14-napos ablakból fokozatosan kigördül.</p>`
      : ""}
  </section>`;

  const naploRows = checks.length
    ? checks.map((c) => `<tr><td>${esc(sourceNames[c.source_id] ?? c.source_id)}</td><td>${esc(CHECK[c.status] ?? c.status)}</td><td>${esc(c.detail ?? "")}</td></tr>`).join("\n")
    : `<tr><td colspan="3" class="empty">nincs ellenőrzött forrás</td></tr>`;

  const changeList = newStories.length
    ? `<ul>${newStories.slice(0, 20).map((i) => `<li>${esc(sourceNames[i.source_id] ?? i.source_id)}: ${esc(i.title)}${pressUrlsHtml(i)}</li>`).join("")}</ul>`
    : `<p class="empty">nincs új tétel az előző futás óta</p>`;

  const unjudged = visible.filter((i) => i.triage_missing).length;
  const unjudgedNote = unjudged > 0
    ? `<p class="empty">⏳ ${unjudged} tétel ítélet nélkül maradt (bukott triázs-batch) — a következő futás újrapróbálja, addig megjelölve szerepel.</p>`
    : "";

  // Összevonás-napló (spec 13.): összegzés + részletes lista, hogy egy esetleges
  // hamis összevonás felfedezhető legyen (nem csak „eltűnt egy tétel"). A providers_used
  // részletes bejegyzését a run.js írja a runs-ba; itt a jelentésbe kerül.
  let mergeNote = "";
  if (merges.length) {
    const totalMembers = merges.reduce((a, m) => a + m.members.length, 0);
    const byRule = {};
    for (const m of merges) for (const mem of m.members) { const k = mem.rule.split(" ")[0]; byRule[k] = (byRule[k] ?? 0) + 1; }
    const rules = Object.entries(byRule).map(([k, v]) => `${esc(k)}: ${v}`).join(", ");
    const list = merges.map((m) => `<li><strong>${esc(m.story)}</strong> ← ${m.members.map((x) => esc(sourceNames[x.source_id] ?? x.source_id)).join(", ")}</li>`).join("");
    mergeNote = `<p class="empty">🔗 ${merges.length} sztori összevonva ${totalMembers} további forrásból (${rules}) — cross-source dedup (spec 13.):</p><ul>${list}</ul>`;
  }

  const notCovered = (run.notCovered ?? []).map((s) => `<li>${esc(s)}</li>`).join("\n");
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
    <div class="meta">futás: ${esc(run.runId)} · generálva: ${esc(run.generatedAt)} (Budapest)
      · <span class="phase">${esc(run.phase ?? "F2 — LLM-réteg")}</span></div>
  </header>

  <section id="fejlec">
    <div class="headline"><span>🕒</span><span class="label">UTOLSÓ ÚJ KUTATÁS:</span>
      <span class="empty">intézeti kutatásfigyelés az F3-tól</span></div>
    <div class="headline"><span>📈</span><span class="label">LEGFRISSEBB HIVATALOS ADAT:</span>
      <span>${latestHivatalos ? esc(latestHivatalos.title) + " — " + esc(fmtTime(latestHivatalos.published_at)) : '<span class="empty">nincs friss hivatalos adat</span>'}</span></div>
  </section>

  <section id="24h">
    <h2>Mi jelent meg az utolsó 24 órában?</h2>
    ${synth}${degradedNote}
  </section>

  <section id="tablak">
    <h2>Tételek jelentőség szerint</h2>
    ${table("📈 Hivatalos adatközlések", hivatalos, sourceNames)}
    ${table("📰 Sajtószemle", sajto, sourceNames)}
  </section>

  ${gateSection}

  <section id="valtozas">
    <h2>Mi változott az előző jelentéshez képest?</h2>
    <p>${newRelevant > 0 || newStories.length > 0
      ? `${run.newCount != null ? `<strong>${run.newCount}</strong> új tétel begyűjtve, ebből ` : ""}<strong>${newRelevant}</strong> releváns${newStories.length ? `, <strong>${newStories.length}</strong> sztoriban` : ""} az előző futás óta.`
      : "Nincs új tétel az előző futás óta."}</p>
    ${changeList}
  </section>

  <section id="naplo">
    <h2>Ellenőrzési napló</h2>
    ${unjudgedNote}
    ${mergeNote}
    <table>
      <tr><th>Forrás</th><th>Státusz</th><th>Részlet</th></tr>
      ${naploRows}
    </table>
    <h2 style="margin-top:22px">Még nem lefedett (becsületes részlegesség)</h2>
    <ul>
${notCovered}
    </ul>
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
  <section><h2>Mi jelent meg az utolsó 24 órában?</h2>${synth}</section>
  <section><h2>Friss tételek jelentőség szerint</h2>${digestItemList(fresh, sourceNames)}</section>
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
