// Jelentés-renderelő (F1). A váz a specifikáció 17–23. pontját követi; a
// tartalmat kód generálja a begyűjtött tételekből és a source_checks naplóból.
// Triázs/jelentőség/szintézis az F2-től — itt nyers, frissesség szerint rendezett
// tétellisták és a becsületes ellenőrzési napló. Stílus: email-barát, beágyazott CSS.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const FRESHNESS = {
  UJ_24H: { label: "🟢 ÚJ (24h)", rank: 0 },
  H24_48: { label: "🟡 24–48h", rank: 1 },
  KIHAGYOTT_MOST: { label: "⚠️ korábban kihagyott, most", rank: 2 },
  KORABBI: { label: "⚪ korábbi", rank: 3 },
};

const CHECK = {
  OK_UJ: "✅ új",
  OK_NINCS_UJ: "☑️ nincs új",
  RESZLEGES: "⚠️ részleges",
  HIBA: "❌ hiba",
};

const TZ = "Europe/Budapest";
function fmtTime(iso) {
  if (!iso) return "publikációs idő nem elérhető";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "publikációs idő nem elérhető";
  return new Intl.DateTimeFormat("hu-HU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(t));
}

// Report-higiénia (NEM triázs): forrásonként max ennyi sor a jelentésben, hogy
// egy bőbeszédű katalógus-feed (Eurostat) ne nyomja el a többit. Minden tétel a
// DB-ben marad; a kulcsszó-/relevancia-szűrés az F2 triázs dolga.
const PER_SOURCE_CAP = 25;

const sortItems = (items) =>
  [...items].sort((a, b) => {
    const fr = (FRESHNESS[a.freshness]?.rank ?? 9) - (FRESHNESS[b.freshness]?.rank ?? 9);
    if (fr !== 0) return fr;
    return (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0);
  });

function renderRow(it, sourceNames) {
  const src = esc(sourceNames[it.source_id] ?? it.source_id);
  const title = it.url ? `<a href="${esc(it.url)}">${esc(it.title)}</a>` : esc(it.title);
  const fresh = FRESHNESS[it.freshness]?.label ?? esc(it.freshness ?? "—");
  return `<tr><td>${src}</td><td>${title}</td><td>${esc(fmtTime(it.published_at))}</td><td>${fresh}</td></tr>`;
}

function itemRows(items, sourceNames) {
  if (items.length === 0) return `<tr><td colspan="4" class="empty">nincs tétel ebben a körben</td></tr>`;
  // Frissesség-sorrend megtartva; forrásonként a legfrissebb CAP tétel jelenik meg.
  const shownCount = new Map();
  const hidden = new Map();
  const rows = [];
  for (const it of sortItems(items)) {
    const sid = it.source_id;
    const n = shownCount.get(sid) ?? 0;
    if (n < PER_SOURCE_CAP) {
      shownCount.set(sid, n + 1);
      rows.push(renderRow(it, sourceNames));
    } else {
      hidden.set(sid, (hidden.get(sid) ?? 0) + 1);
    }
  }
  for (const [sid, k] of hidden) {
    const src = esc(sourceNames[sid] ?? sid);
    rows.push(`<tr class="more"><td>${src}</td><td colspan="3" class="empty">+ ${k} további tétel a DB-ben (F2 triázs szűri)</td></tr>`);
  }
  return rows.join("\n");
}

function table(caption, items, sourceNames) {
  return `<table>
  <caption>${esc(caption)} <span class="count">(${items.length})</span></caption>
  <tr><th>Forrás</th><th>Cím</th><th>Publikálva</th><th>Frissesség</th></tr>
  ${itemRows(items, sourceNames)}
</table>`;
}

export function renderReport(run) {
  const items = run.items ?? [];
  const sourceNames = run.sourceNames ?? {};
  const checks = run.sourceChecks ?? [];

  const hivatalos = items.filter((i) => i.kind === "hivatalos_adat");
  const sajto = items.filter((i) => i.kind === "sajto");

  // fejléc-sorok: legfrissebb hivatalos adat (F1-ben nincs intézeti kutatás → F3)
  const latestHivatalos = sortItems(hivatalos)[0];
  const uj24 = items.filter((i) => i.freshness === "UJ_24H");
  const newItems = items.filter((i) => i.first_seen_at === run.runStartedAt);

  const naploRows = checks.length
    ? checks
        .map(
          (c) =>
            `<tr><td>${esc(sourceNames[c.source_id] ?? c.source_id)}</td><td>${esc(CHECK[c.status] ?? c.status)}</td><td>${esc(c.detail ?? "")}</td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="3" class="empty">nincs ellenőrzött forrás</td></tr>`;

  const changeList = newItems.length
    ? `<ul>${newItems.slice(0, 20).map((i) => `<li>${esc(sourceNames[i.source_id] ?? i.source_id)}: ${esc(i.title)}</li>`).join("")}</ul>`
    : `<p class="empty">nincs új tétel az előző futás óta</p>`;

  const notCovered = (run.notCovered ?? []).map((s) => `<li>${esc(s)}</li>`).join("\n");

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor — ${esc(run.runId)}</title>
<style>
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
  table{border-collapse:collapse;width:100%;font-size:14px;margin-bottom:8px}
  caption{text-align:left;font-weight:600;padding:6px 0;font-size:.95rem}
  caption .count{color:var(--muted);font-weight:400}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  a{color:#0b5aa2}
  ul{margin:8px 0;padding-left:22px}
  footer{margin-top:48px;padding-top:12px;border-top:1px solid var(--line);font:12px/1.6 ui-monospace,Consolas,monospace;color:var(--muted)}
  .phase{display:inline-block;background:var(--ink);color:var(--paper);font:12px/1 ui-monospace,Consolas,monospace;padding:4px 8px;border-radius:3px}
</style>
</head>
<body>
<main>
  <header>
    <h1>📊 Magyar közéleti kutatás- és adatmonitor</h1>
    <div class="meta">futás: ${esc(run.runId)} · generálva: ${esc(run.generatedAt)} (Budapest)
      · <span class="phase">${esc(run.phase)}</span></div>
  </header>

  <section id="fejlec">
    <div class="headline"><span>🕒</span><span class="label">UTOLSÓ ÚJ KUTATÁS:</span>
      <span class="empty">intézeti kutatásfigyelés az F3-tól</span></div>
    <div class="headline"><span>📈</span><span class="label">LEGFRISSEBB HIVATALOS ADAT:</span>
      <span>${latestHivatalos ? esc(latestHivatalos.title) + " — " + esc(fmtTime(latestHivatalos.published_at)) : '<span class="empty">nincs friss hivatalos adat</span>'}</span></div>
  </section>

  <section id="tablak">
    <h2>Gyűjtött tételek (nyers, triázs nélkül — F2-től rangsorolva)</h2>
    ${table("📈 Hivatalos adatközlések", hivatalos, sourceNames)}
    ${table("📰 Sajtószemle", sajto, sourceNames)}
  </section>

  <section id="24h">
    <h2>Mi jelent meg az utolsó 24 órában?</h2>
    <p>${uj24.length} tétel az elmúlt 24 órában (UJ_24H). <span class="empty">Az összefoglaló LLM-szintézis az F2-től.</span></p>
  </section>

  <section id="valtozas">
    <h2>Mi változott az előző jelentéshez képest?</h2>
    <p>${newCountLine(run.newCount ?? newItems.length)}</p>
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
    ${items.length} tétel · ${checks.length} forrás · futási idő: ${run.durationMs} ms
    · LLM: ${esc(run.providersUsed?.note ?? "—")} · survey-monitor v0.1 (F1)
  </footer>
</main>
</body>
</html>
`;
}

function newCountLine(n) {
  return n > 0 ? `<strong>${n}</strong> új tétel az előző futás óta.` : "Nincs új tétel az előző futás óta.";
}
