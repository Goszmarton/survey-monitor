// Survey Monitor — napi futás (F2: LLM-réteg).
// Determinisztikus gyűjtés (RSS/HTML) → SQLite-állapot + dedup + frissesség
// → LLM-triázs (relevancia + jelentőség) + szintézis → jelentés dist/-be (Pages)
// → digest-email (24h) + 🔴 KIEMELT-email. Sosem hasal el: forrás- vagy
// provider-kiesés degradált, de működő jelentést ad (triázs kimarad, nyers lista).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { renderReport, renderDigest, renderKiemelt, digestSubject, storyGroups } from "./report.js";
import { sendMail } from "./email.js";
import { openDb, startRun, finishRun, getLastRunStartedAt } from "./state/db.js";
import { collect } from "./collect.js";
import { complete } from "./llm/complete.js";
import { enrichWithTriage } from "./enrich.js";
import { deriveInstitutes } from "./lib/storygroup.js";

const TZ = "Europe/Budapest";
const DB_PATH = "state/monitor.db";
const FALLBACK_WINDOW_MS = 48 * 3600 * 1000; // első futáshoz / előzmény híján

function nowBudapest() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("hu-HU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
  return { display: fmt.format(d), ymd, iso: d.toISOString(), ms: d.getTime() };
}

async function loadJson(rel) {
  return JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));
}

async function loadSources() {
  const { sources } = await loadJson("../config/sources.json");
  // Kizárólag A-kaszt, aminek van verifikált feed-je vagy list_url-je.
  return sources.filter((s) => s.kaszt === "A" && (s.feed || s.list_url));
}

async function main() {
  const startedMs = Date.now();
  const now = nowBudapest();
  const runId = now.ymd;

  const db = openDb(DB_PATH);
  const attemptId = startRun(db, { runId, startedAt: now.iso });

  const since = getLastRunStartedAt(db, { excludeRunId: runId }) ?? now.ms - FALLBACK_WINDOW_MS;
  const sources = await loadSources();

  const collected = await collect({ db, sources, now: now.ms, runId, runStartedAt: now.iso, since });

  // ---- F2: LLM-triázs + szintézis (degradál, ha nincs elérhető provider) ----
  const prefilterCfg = await loadJson("../config/triage.json");
  const providersUsed = [];
  const { items, synthesisText, kiemeltCount, triageDegraded } = await enrichWithTriage({
    db, items: collected.items, completeFn: complete, prefilterCfg, providersUsed,
  });

  // Cross-source story-dedup config (spec 13.). Betöltési hiba ÉLES futásban NE legyen
  // csendes (mint a régi silent dedup-kiesés): WARN a naplóba + console, a dedup kimarad
  // (a jelentés megy, csak nem csoportosít). Ugyanaz az alakzat, mint a finishRun-fallback.
  let dedupCfg = null;
  let institutes = null;
  try {
    dedupCfg = await loadJson("../config/dedup.json");
    const { sources: allSources } = await loadJson("../config/sources.json");
    institutes = deriveInstitutes(allSources, dedupCfg);
  } catch (err) {
    dedupCfg = null; institutes = null;
    providersUsed.push({ role: "dedup", status: "WARN", detail: `dedup-config hiba: ${String(err?.message ?? err).slice(0, 80)} — story-dedup kimarad` });
    console.warn("Story-dedup config betöltése sikertelen, a dedup kimarad:", err?.message ?? err);
  }

  const run = {
    runId,
    generatedAt: now.display,
    phase: "F2 — LLM-réteg",
    runStartedAt: now.iso,
    sourceNames: Object.fromEntries(sources.map((s) => [s.id, s.name])),
    items,
    sourceChecks: collected.sourceChecks,
    newCount: collected.newCount,
    sinceIso: new Date(since).toISOString(),
    synthesisText,
    kiemeltCount,
    triageDegraded,
    providersUsed,
    dedupCfg,
    institutes,
    notCovered: [
      "Intézeti agentikus ellenőrzés (B-kaszt), rejtett magyar adat (F3)",
      "Mély audit KIEMELT tételekre (F3)",
      "Forrásbővítés v2-listákról, publikációs naptár (F4)",
    ],
    durationMs: 0,
  };
  run.durationMs = Date.now() - startedMs;

  // ---- Jelentés: index + dátumozott archív példány (teljes Pages-változat) ----
  const html = renderReport(run);

  // A story-dedup EGYSZER fut (memoizált a run-on); explicit hívjuk a merges-ért, hogy
  // a naplóbejegyzés ne egy render-mellékhatás sorrendjén múljon → összegzés a
  // providers_used-be (runs-ba perzisztálva), hogy egy hamis összevonás visszakövethető legyen.
  const { merges } = storyGroups(run);
  if (merges.length) {
    providersUsed.push({ role: "dedup", status: "OK", detail: `${merges.length} sztori összevonva (${merges.reduce((a, m) => a + m.members.length, 0)} további forrás)` });
  }
  const [y, m, d] = now.ymd.split("-");
  await mkdir(`dist/${y}/${m}`, { recursive: true });
  await writeFile("dist/index.html", html);
  await writeFile(`dist/${y}/${m}/${d}.html`, html);
  console.log(`Jelentés kész: ${items.length} tétel, ${kiemeltCount} KIEMELT${triageDegraded ? " (triázs degradált)" : ""}, ${collected.sourceChecks.length} forrás.`);

  // ---- E-mailek (SMTP-konfig nélkül a futás nem hasal el) ----
  const digestSent = await sendMail(digestSubject(run), renderDigest(run));
  console.log(digestSent ? "Digest-email elküldve." : "Digest-email kihagyva (nincs SMTP-konfig).");

  let kiemeltSent = false;
  if (kiemeltCount > 0) {
    kiemeltSent = await sendMail(`🔴 KIEMELT — ${runId} — ${kiemeltCount} tétel`, renderKiemelt(run));
    console.log(kiemeltSent ? "KIEMELT-email elküldve." : "KIEMELT-email kihagyva (nincs SMTP-konfig).");
  }

  finishRun(db, {
    runId,
    attemptId,
    finishedAt: new Date().toISOString(),
    providersUsed,
    reportUrl: `${y}/${m}/${d}.html`,
    emailStatus: digestSent ? (kiemeltSent ? "sent+kiemelt" : "sent") : "skipped",
  });
  db.close();
}

main().catch((err) => {
  console.error("A futás elhasalt:", err);
  process.exit(1);
});
