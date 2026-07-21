// Survey Monitor — napi futás (F0: csontváz)
// A kézbesítési lánc előbb legyen kész, mint a tartalom:
// jelentés → dist/ (Pages) → email. A tartalom-fázisok (F1–F4) ide épülnek be.

import { mkdir, writeFile } from "node:fs/promises";
import { renderReport } from "./report.js";
import { sendMail } from "./email.js";

const TZ = "Europe/Budapest";

function nowBudapest() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("hu-HU", {
    timeZone: TZ, dateStyle: "short", timeStyle: "short",
  });
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
  return { display: fmt.format(d), ymd, iso: d.toISOString() };
}

async function main() {
  const started = Date.now();
  const now = nowBudapest();
  const runId = now.ymd;

  // ---- F0: még nincs gyűjtés; a futás ténye és a napló-váz az adat ----
  const run = {
    runId,
    generatedAt: now.display,
    phase: "F0 — csontváz",
    items: [],            // F1-től: begyűjtött, deduplikált tételek
    sourceChecks: [],     // F1-től: forrásonkénti tényleges státusz
    notCovered: [
      "KSH, Eurostat, MNB (F1)",
      "Híroldalak RSS (F1)",
      "LLM-triázs és jelentőségi besorolás (F2)",
      "Intézeti agentikus ellenőrzés, rejtett magyar adat (F3)",
    ],
    providersUsed: { note: "F0 — LLM-hívás még nincs" },
    durationMs: 0,
  };

  run.durationMs = Date.now() - started;

  // ---- Jelentés kirenderelése: index + dátumozott archív példány ----
  const html = renderReport(run);
  const [y, m, d] = now.ymd.split("-");
  await mkdir(`dist/${y}/${m}`, { recursive: true });
  await writeFile("dist/index.html", html);
  await writeFile(`dist/${y}/${m}/${d}.html`, html);
  console.log(`Jelentés kész: dist/index.html és dist/${y}/${m}/${d}.html`);

  // ---- Email (ha van SMTP-konfig; nélküle a futás nem hasal el) ----
  const subject = `📊 Monitor ${now.ymd} — F0 próbafutás`;
  const sent = await sendMail(subject, html);
  console.log(sent ? "Email elküldve." : "Email kihagyva (nincs SMTP-konfig).");
}

main().catch((err) => {
  console.error("A futás elhasalt:", err);
  process.exit(1);
});
