// Survey Monitor — napi futás (F2: LLM-réteg).
// Determinisztikus gyűjtés (RSS/HTML) → SQLite-állapot + dedup + frissesség
// → LLM-triázs (relevancia + jelentőség) + szintézis → jelentés dist/-be (Pages)
// → digest-email (24h) + 🔴 KIEMELT-email. Sosem hasal el: forrás- vagy
// provider-kiesés degradált, de működő jelentést ad (triázs kimarad, nyers lista).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { renderReport, renderDigest, renderKiemelt, digestSubject, storyGroups } from "./report.js";
import { sendMail } from "./email.js";
import { openDb, startRun, finishRun, getLastRunStartedAt } from "./state/db.js";
import { collect, selectActiveSources } from "./collect.js";
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
  // Kizárólag A-kaszt, aminek van verifikált feed-je vagy list_url-je (selectActiveSources).
  return selectActiveSources(sources);
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
      "Dedup stoplista újramérése produkciós korpuszon — a 360k pár Eurostat-churnből jött, amit az éles futás DROP után nem lát; a data/dataset angol forrásoknál tartalmi szó (F3)",
      "Containment metrika stopszó-érzékenysége felfelé is — mérlegelendő abszolút min. közös token, hogy a stopszó-metszet ne emelje a hasonlóságot (F3)",
      "Dedup(b)/C-star mega-blob — ✅ SHIPPELVE 2026-08-07 (storygroup.js: rekurzív star-dekompozíció + dice-repair, decompose_min_component=30). A nagy gyakoriságú hub-tokenek (szereplőnevek: 'orbán viktor', 'magyar péter'; 'paks'/'duna') a containment-ágon KÜLÖNBÖZŐ sztorikat láncoltak egy blobbá (2026-08-07: 318 tag, 1.88% élsűrűség). A naiv C-star (közvetlen éllel a rephez) 38 valódi parafrázist is szétárvázott; a dice-repair (dice≥0.55-ös al-csoportok visszaegyesítése) ezt 0-ra viszi. Mérés: 318→22, 1053→1201 csoport, 0 megtört dice-jogos. RESIDUAL: 10 erős-containment (val≥0.75, dice<0.55) valódi same-story pár leválik — becsületes részlegesség (látható duplikátum, olcsóbb hiba, CLAUDE.md 5), mérlegelendő későbbi lokális-IDF hub-detekcióval csökkenteni (F3, dedup(b)/C-star residual). Az Eurostat-6-blob ettől FÜGGETLEN: a generikus-token (euro/area) fix oldja (shippelve 2026-08-06, title_generic_tokens).",
      "Dedup(b) számjegy-drop (a százalék-számjegyek mint tartalmatlan bridging-token eldobása a rawTokens-ből) — MÉRVE 2026-08-06, ELVETVE: önmagában NEM oldja az Eurostat-fixture-t (475 pár, 0 jogos, de a 6-blob euro+are+szó éleken túléli); a title_generic_tokens fixen FELÜL +478 hamis %-merge-et bontana korpusz-szerte (0 jogos), VISZONT a rendszerszintű mega-blobot NÖVELI (455→469, tokenizáció-eltolódás) → diffúz haszon + rossz irány, nem shippeljük. Ha később mégis kell, a számok készen (F3, dedup(b))",
      "Rendezési sorrend felülvizsgálata — freshness vs significance mint elsődleges kulcs; ma tudatosan significance-primary (a missing átmeneti, ezért a lista aljára kerül) (F3)",
      "Kapu-hatás A/B (data_backed) — a kapu a PROMPTBAN érvényesül (a modell öncenzúráz: FONTOS/KIEMELT-et csak data_backed=true mellé ad), a kód-oldali significance-plafon csak BACKSTOP: 2026-08-06-án 0 eltérés 105 triázsolt tételen (raw==kapuzott). A post-gate ki/be kapcsolgatása így ~0-t mér — egy ÉRTELMES A/B-hez a PROMPT A-ágát kell a data_backed-szabály NÉLKÜL lefuttatni UGYANAZON a korpuszon. Ehhez NEM kell napokig raw-t gyűjteni: egyetlen nap ~105 triázsolt tétele elég korpusz a prompt-A/B-hez (F3, 3b)",
      "UTC-fix cron (43 0 * * *) DST-csúszása — októbertől a 00:43 UTC egy órával későbbi helyi időt jelent, a levél-érkezés eltolódik; mérlegelendő időzóna-tudatos ütemezés vagy cron-váltás (F3)",
      "MAIL_TO több-címzett viselkedése nem tesztelt implicit függés a nodemailer addressparser-étől (vesszős lista, szóköz-trim a címek körül) — a kód a MAIL_TO-t nyersen adja a `to` mezőbe, nincs saját split/trim. Nincs guard elgépelt elválasztóra (pontosvessző NEM működik) vagy a titokban lévő záró newline/szóközre; egy jövőbeli refaktor (pl. tömbre váltás) vagy egy rosszul formázott secret NÉMÁN ronthatja a kézbesítést (CLAUDE.md 2). Regressziós teszt sincs rá (csak import-smoke) (F3/F4)",
      "GitHub Pages KÖRNYEZET deploy-koncurrenciája nincs kezelve — a workflow-szintű concurrency guard (group: daily-monitor) NEM fedi a github-pages környezet saját deploy-sorát. Egy elakadt Pages-deploy 10 perc után timeoutolja a jobot (2026-08-06-i kézi dispatch: piros job + hiba-email). RENDELKEZÉSRE-ÁLLÁSI, nem korrektségi kérdés: a DB-visszacommit a Pages-lépés ELŐTT van, adatvesztés nincs, csak az archívum késik egy napot (F3/infra)",
      "A deploy-pages timeout explicit emelése — az actions/deploy-pages@v4 default timeout-ja 600000 ms (10 perc), ez okozta a 2026-08-06-i job-timeoutot. Mérlegelendő: with.timeout: 1200000 (20 perc), plusz error_count. Szintén rendelkezésre-állási, nem korrektségi (F3/infra)",
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
