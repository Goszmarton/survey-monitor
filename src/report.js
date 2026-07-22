// Jelentés-renderelő (F2). A Pages-jelentés a spec 17-23. pontját követi;
// az e-mail (digest) az elmúlt 24 órára fókuszál (szintézis + UJ_24H tételek
// jelentőség szerint). Triázs után a nem-releváns tételek kimaradnak a
// megjelenítésből (a DB-ben maradnak); degradált (LLM nélküli) módban minden
// tétel nyersen látszik. Stílus: email-barát, beágyazott CSS.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

const CHECK = { OK_UJ: "✅ új", OK_NINCS_UJ: "☑️ nincs új", RESZLEGES: "⚠️ részleges", HIBA: "❌ hiba" };

const PER_SOURCE_CAP = 25;
const TZ = "Europe/Budapest";

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
const sortItems = (items) =>
  [...items].sort((a, b) => {
    const s = (SIGNIF[a.significance]?.rank ?? 9) - (SIGNIF[b.significance]?.rank ?? 9);
    if (s !== 0) return s;
    const fr = (FRESHNESS[a.freshness]?.rank ?? 9) - (FRESHNESS[b.freshness]?.rank ?? 9);
    if (fr !== 0) return fr;
    return (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0);
  });

const titleLink = (it) => (it.url ? `<a href="${esc(it.url)}">${esc(it.title)}</a>` : esc(it.title));

function renderRow(it, sourceNames) {
  const src = esc(sourceNames[it.source_id] ?? it.source_id);
  const sig = SIGNIF[it.significance]?.label ?? "—";
  const fresh = FRESHNESS[it.freshness]?.label ?? esc(it.freshness ?? "—");
  return `<tr><td>${src}</td><td>${titleLink(it)}</td><td>${sig}</td><td>${esc(fmtTime(it.published_at))}</td><td>${fresh}</td></tr>`;
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
  const failed = log.filter((e) => !["OK", "SKIPPED_NO_KEY", "SKIP"].includes(e.status)).map((e) => `${e.provider}:${e.status}`);
  const parts = [];
  if (ok.length) parts.push(ok.join(" · "));
  if (failed.length) parts.push("váltás: " + failed.join(", "));
  if (skipped.length) parts.push("kihagyva: " + [...new Set(skipped)].join(", "));
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
  const visible = visibleItems(run);

  const hivatalos = visible.filter((i) => i.kind === "hivatalos_adat");
  const sajto = visible.filter((i) => i.kind === "sajto");
  const latestHivatalos = sortItems(hivatalos)[0];
  const uj24 = visible.filter((i) => i.freshness === "UJ_24H");
  const newItems = visible.filter((i) => i.first_seen_at === run.runStartedAt);

  const naploRows = checks.length
    ? checks.map((c) => `<tr><td>${esc(sourceNames[c.source_id] ?? c.source_id)}</td><td>${esc(CHECK[c.status] ?? c.status)}</td><td>${esc(c.detail ?? "")}</td></tr>`).join("\n")
    : `<tr><td colspan="3" class="empty">nincs ellenőrzött forrás</td></tr>`;

  const changeList = newItems.length
    ? `<ul>${newItems.slice(0, 20).map((i) => `<li>${esc(sourceNames[i.source_id] ?? i.source_id)}: ${esc(i.title)}</li>`).join("")}</ul>`
    : `<p class="empty">nincs új tétel az előző futás óta</p>`;

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

  <section id="valtozas">
    <h2>Mi változott az előző jelentéshez képest?</h2>
    <p>${(run.newCount ?? newItems.length) > 0 ? `<strong>${run.newCount ?? newItems.length}</strong> új tétel az előző futás óta.` : "Nincs új tétel az előző futás óta."}</p>
    ${changeList}
  </section>

  <section id="naplo">
    <h2>Ellenőrzési napló</h2>
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
    `<li>${SIGNIF[it.significance]?.label ?? "—"} <strong>${esc(sourceNames[it.source_id] ?? it.source_id)}</strong>: ${titleLink(it)}</li>`,
  ).join("")}</ul>`;
}

export function digestSubject(run) {
  const fresh = visibleItems(run).filter((i) => i.freshness === "UJ_24H");
  const kiemelt = run.kiemeltCount ?? fresh.filter((i) => i.significance === "KIEMELT").length;
  return `Survey Monitor — ${fresh.length} új (24h), ebből ${kiemelt} kiemelt`;
}

export function renderDigest(run) {
  const sourceNames = run.sourceNames ?? {};
  const fresh = visibleItems(run).filter((i) => i.freshness === "UJ_24H");
  const synth = run.synthesisText
    ? `<p class="synth">${esc(run.synthesisText)}</p>`
    : (run.triageDegraded ? `<p class="empty">⚠️ triázs kihagyva (nincs LLM) — nyers 24 órás lista.</p>` : "");
  const link = run.pagesUrl ? `<p><a href="${esc(run.pagesUrl)}">Teljes jelentés →</a></p>` : `<p class="empty">A teljes jelentés a GitHub Pages-archívumban.</p>`;

  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(digestSubject(run))}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>📊 Napi monitor — elmúlt 24 óra</h1>
    <div class="meta">${esc(run.generatedAt)} (Budapest) · ${fresh.length} új tétel</div></header>
  <section><h2>Mi jelent meg az utolsó 24 órában?</h2>${synth}</section>
  <section><h2>Friss tételek jelentőség szerint</h2>${digestItemList(fresh, sourceNames)}</section>
  ${link}
</main></body></html>
`;
}

// ---- 🔴 KIEMELT e-mail: csak a kiemelt tételek (csak ha van ilyen) ----
export function renderKiemelt(run) {
  const sourceNames = run.sourceNames ?? {};
  const kiemelt = visibleItems(run).filter((i) => i.significance === "KIEMELT");
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>🔴 KIEMELT — ${esc(run.runId)}</title><style>${STYLE}</style></head>
<body><main>
  <header><h1>🔴 KIEMELT tételek — ${esc(run.runId)}</h1></header>
  <section>${digestItemList(kiemelt, sourceNames)}</section>
  <p class="empty">A teljes jelentés a GitHub Pages-archívumban.</p>
</main></body></html>
`;
}
