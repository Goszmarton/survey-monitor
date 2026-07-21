// Jelentés-renderelő. A váz a specifikáció 17–23. pontját követi;
// F0-ban a szekciók helye és a becsületes "még nincs lefedve" napló a tartalom.
// A stílus szándékosan email-barát: egyszerű, beágyazott CSS, webfont nélkül.

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function renderReport(run) {
  const notCovered = run.notCovered.map((s) => `<li>${esc(s)}</li>`).join("\n");

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitor — ${esc(run.runId)}</title>
<style>
  :root{
    --ink:#1c1e21; --muted:#5f6672; --paper:#fbfaf7; --line:#e3e0d8;
    --uj:#c0392b; --h48:#d98324; --korabbi:#8a8f98;
  }
  body{margin:0;background:var(--paper);color:var(--ink);
    font:16px/1.55 Georgia,"Times New Roman",serif}
  main{max-width:820px;margin:0 auto;padding:32px 20px 64px}
  header h1{font-size:1.35rem;margin:0 0 2px;letter-spacing:.01em}
  header .meta{font:13px/1.5 ui-monospace,Consolas,monospace;color:var(--muted)}
  section{margin-top:34px}
  h2{font-size:1.05rem;border-bottom:1px solid var(--line);padding-bottom:6px;margin:0 0 12px}
  .headline{display:flex;gap:10px;align-items:baseline;
    font:15px/1.5 ui-monospace,Consolas,monospace;margin:6px 0}
  .headline .label{color:var(--muted)}
  .empty{color:var(--muted);font-style:italic}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  ul{margin:8px 0;padding-left:22px}
  footer{margin-top:48px;padding-top:12px;border-top:1px solid var(--line);
    font:12px/1.6 ui-monospace,Consolas,monospace;color:var(--muted)}
  .phase{display:inline-block;background:var(--ink);color:var(--paper);
    font:12px/1 ui-monospace,Consolas,monospace;padding:4px 8px;border-radius:3px}
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
      <span class="empty">még nincs adatgyűjtés (F1-től)</span></div>
    <div class="headline"><span>📈</span><span class="label">UTOLSÓ ÚJ JELENTŐS HIVATALOS ADAT:</span>
      <span class="empty">még nincs adatgyűjtés (F1-től)</span></div>
  </section>

  <section id="tablak">
    <h2>Gyors áttekintő táblázatok</h2>
    <p class="empty">A) 🇭🇺 magyar kutatások · B) 🌍 nemzetközi magyar adattal ·
      C) 📈 hivatalos adatok — az F1/F2 fázisban töltődnek fel.</p>
  </section>

  <section id="24h">
    <h2>Mi jelent meg az utolsó 24 órában?</h2>
    <p class="empty">LLM-szintézis az F2 fázistól.</p>
  </section>

  <section id="valtozas">
    <h2>Mi változott az előző jelentéshez képest?</h2>
    <p class="empty">Állapot-összevetés az F1 fázistól.</p>
  </section>

  <section id="naplo">
    <h2>Ellenőrzési napló</h2>
    <table>
      <tr><th>Forrás</th><th>Státusz</th><th>Részlet</th></tr>
      <tr><td colspan="3" class="empty">F0 — még egyetlen forrás sincs bekötve.</td></tr>
    </table>
    <h2 style="margin-top:22px">Még nem lefedett (becsületes részlegesség)</h2>
    <ul>
${notCovered}
    </ul>
  </section>

  <footer>
    futási idő: ${run.durationMs} ms · LLM: ${esc(run.providersUsed.note ?? "—")}
    · survey-monitor v0.1 (F0)
  </footer>
</main>
</body>
</html>
`;
}
