// Survey Monitor — napi futás (F1: A-kaszt mag).
// Determinisztikus gyűjtés (RSS/HTML) → SQLite-állapot + dedup + frissesség
// → jelentés dist/-be (Pages) → email. A jelentés sosem marad el: forrás- vagy
// LLM-hiba degradált, de működő jelentést ad (LLM-réteg az F2-től).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { renderReport } from "./report.js";
import { sendMail } from "./email.js";
import { openDb, startRun, finishRun, getLastRunStartedAt } from "./state/db.js";
import { collect } from "./collect.js";

const TZ = "Europe/Budapest";
const DB_PATH = "state/monitor.db";
const FALLBACK_WINDOW_MS = 48 * 3600 * 1000; // első futáshoz / előzmény híján

function nowBudapest() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("hu-HU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
  return { display: fmt.format(d), ymd, iso: d.toISOString(), ms: d.getTime() };
}

async function loadSources() {
  const raw = await readFile(new URL("../config/sources.json", import.meta.url), "utf8");
  const { sources } = JSON.parse(raw);
  // F1: kizárólag A-kaszt, aminek van verifikált feed-je vagy list_url-je.
  return sources.filter((s) => s.kaszt === "A" && (s.feed || s.list_url));
}

async function main() {
  const startedMs = Date.now();
  const now = nowBudapest();
  const runId = now.ymd;

  const db = openDb(DB_PATH);
  startRun(db, { runId, startedAt: now.iso });

  const since = getLastRunStartedAt(db, { excludeRunId: runId }) ?? now.ms - FALLBACK_WINDOW_MS;
  const sources = await loadSources();

  const { items, sourceChecks, newCount } = await collect({
    db, sources, now: now.ms, runId, runStartedAt: now.iso, since,
  });

  const run = {
    runId,
    generatedAt: now.display,
    phase: "F1 — A-kaszt mag",
    runStartedAt: now.iso,
    sourceNames: Object.fromEntries(sources.map((s) => [s.id, s.name])),
    items,
    sourceChecks,
    newCount,
    sinceIso: new Date(since).toISOString(),
    notCovered: [
      "LLM-triázs és jelentőségi besorolás (F2)",
      "Digest + 🔴 KIEMELT email, szintézis-bekezdések (F2)",
      "Intézeti agentikus ellenőrzés, rejtett magyar adat (F3)",
    ],
    providersUsed: { note: "F1 — LLM-hívás még nincs (triázs az F2-től)" },
    durationMs: 0,
  };
  run.durationMs = Date.now() - startedMs;

  // ---- Jelentés: index + dátumozott archív példány ----
  const html = renderReport(run);
  const [y, m, d] = now.ymd.split("-");
  await mkdir(`dist/${y}/${m}`, { recursive: true });
  await writeFile("dist/index.html", html);
  await writeFile(`dist/${y}/${m}/${d}.html`, html);
  console.log(`Jelentés kész: ${items.length} tétel (${newCount} új), ${sourceChecks.length} forrás ellenőrizve.`);

  // ---- Email (ha van SMTP-konfig; nélküle a futás nem hasal el) ----
  const subject = `📊 Monitor ${now.ymd} — ${newCount} új tétel`;
  const sent = await sendMail(subject, html);
  console.log(sent ? "Email elküldve." : "Email kihagyva (nincs SMTP-konfig).");

  finishRun(db, {
    runId,
    finishedAt: new Date().toISOString(),
    providersUsed: run.providersUsed,
    reportUrl: `${y}/${m}/${d}.html`,
    emailStatus: sent ? "sent" : "skipped",
  });
  db.close();
}

main().catch((err) => {
  console.error("A futás elhasalt:", err);
  process.exit(1);
});
