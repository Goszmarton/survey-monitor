// Survey Monitor — napi futás (F2: LLM-réteg).
// Determinisztikus gyűjtés (RSS/HTML) → SQLite-állapot + dedup + frissesség
// → LLM-triázs (relevancia + jelentőség) + szintézis → jelentés dist/-be (Pages)
// → digest-email (24h) + 🔴 KIEMELT-email. Sosem hasal el: forrás- vagy
// provider-kiesés degradált, de működő jelentést ad (triázs kimarad, nyers lista).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { renderReport, renderDigest, renderKiemelt, digestSubject, storyGroups, PAGES_BASE } from "./report.js";
import { buildDist } from "./dist.js";
import { sendMail } from "./email.js";
import { openDb, startRun, finishRun, getLastRunStartedAt } from "./state/db.js";
import { collect, selectActiveSources } from "./collect.js";
import { complete } from "./llm/complete.js";
import { enrichWithTriage } from "./enrich.js";
import { deriveInstitutes } from "./lib/storygroup.js";
import { auditProviders } from "./audit.js";
import { phaseLine } from "./lib/phaselog.js";

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
  // Fázis-időbélyeg (levél-semleges, csak stdout): a 08-24/08-25 tanulság — a run.js
  // NÉMA volt a szakaszhatárokon, így egy lassú futás fázisa nem volt visszakereshető.
  // A `mark(label)` az előző mark ÓTA eltelt időt írja ki, gépi-parse-olható formában.
  let phaseMark = startedMs;
  const mark = (label) => { const t = Date.now(); console.log(phaseLine(label, t - phaseMark)); phaseMark = t; };
  const now = nowBudapest();
  const runId = now.ymd;

  const db = openDb(DB_PATH);
  const attemptId = startRun(db, { runId, startedAt: now.iso });

  const since = getLastRunStartedAt(db, { excludeRunId: runId }) ?? now.ms - FALLBACK_WINDOW_MS;
  const sources = await loadSources();

  const collected = await collect({ db, sources, now: now.ms, runId, runStartedAt: now.iso, since });
  mark("collect");

  // ---- F2: LLM-triázs + szintézis (degradál, ha nincs elérhető provider) ----
  const prefilterCfg = await loadJson("../config/triage.json");
  const providersUsed = [];
  const { items, synthesisText, kiemeltCount, triageDegraded } = await enrichWithTriage({
    db, items: collected.items, completeFn: complete, prefilterCfg, providersUsed,
  });
  mark("triázs+szintézis");

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
      "UTC-fix cron (43 8 * * *) DST-viselkedése — RENDEZVE 2026-08-08 a 15:00-s SLA-ra állással: az UTC-fix cron ±1h nyári/téli helyi eltolódását a 15:00 SLA elnyeli (nyáron a levél ~14:21 CEST, ~40 perc tartalék; télen ~13:21 CET, ~100 perc, bővebb). A korábbi 00:43 UTC / 7:00-s SLA-nál ez még szűk volt; a 15:00-s célnál a téli eltolódás NÖVELI a tartalékot, nem csökkenti",
      "MAIL_TO több-címzett guard — ✅ SHIPPELVE 2026-08-15 (email.js parseRecipients + test/email.test.js): a nyers secret helyett tisztított címzett-lista megy a `to` mezőbe (vesszős split, szóköz/záró-whitespace trim, üres tagok dobása), a pontosvessző-elválasztót helyreállítja ÉS jelzi (console.warn), a @-nélküli gyanús címet MEGTARTJA de jelzi (nem néma dobás), üres eredmény → mint a hiányzó konfig. A korábbi rés: a kód nyersen adta a MAIL_TO-t a `to`-ba, így elgépelt elválasztó/záró newline NÉMÁN ronthatta a kézbesítést (CLAUDE.md 2). RESIDUAL: a warningok csak a futás-logba mennek (console.warn), a providers_used-be nem — a küldés maga megy, csak nem jelenik meg a lábléc-naplóban (F4)",
      "Pages-deploy tranziens beragadás — a 2026-08-06-i kézi dispatch (12:58) Pages-deploy lépése 13:03:11→13:13:14 = 10m03s után 'Timeout reached, aborting!'-tal elhasalt: ez az actions/deploy-pages@v4 SAJÁT 10 perces self-timeoutja (default timeout 600000 ms), NEM a job timeout-minutes:30 (az sosem kötő, 10<30). NEM concurrency-sor ütközés (a korábbi 'github-pages környezet-sor' attribúció TÉVES volt): 12:58-kor semmilyen másik deploy nem futott (az aznapi 03:54-es schedule ~9 órával korábban végzett), a workflow már most sorosít (concurrency group daily-monitor, cancel-in-progress:false) és csak ez a workflow deployol Pages-t → nem volt mivel ütköznie. Valódi ok: tranziens Pages-backend beragadás (a deploy nem jelezte a befejeztét 10 percen belül). RENDELKEZÉSRE-ÁLLÁSI, nem korrektségi: a DB-visszacommit a Pages-lépés ELŐTT van (adatvesztés nincs), és a gyökér-link (5b772a5) miatt egy bukott deploynál is 200-as a levél linkje (a korábbi jelentés) — csak a mai archív késik egy napot. Eszköz tranziensre a retry, NEM concurrency-guard. ✅ RETRY SHIPPELVE 2026-08-15 (F4-C): natív 1-retry a workflow-ban (deploy1 continue-on-error + feltételes második próba, marketplace-függés nélkül) — az F4-B óta értékes napi archív miatt vált újra fontossá (F3/infra)",
      "A deploy-pages timeout explicit emelése — az actions/deploy-pages@v4 default timeout-ja 600000 ms (10 perc); ez a DEPLOY-LÉPÉS self-timeoutja sült el 2026-08-06-on (nem a job timeout-minutes:30). A with.timeout emelése (pl. 1200000) csak a LASSÚ deployt segíti; a 08-06-i beragadt volt (10 perc egy 2-fájlos site-ra bőséges), így az emelés valószínűleg nem segít — retry a helyesebb eszköz. Rendelkezésre-állási, nem korrektségi (F3/infra, F4-C)",
      "Forrásbővítés v2-listákról, publikációs naptár (F4)",
    ],
    durationMs: 0,
  };
  run.durationMs = Date.now() - startedMs;

  // Néma provider-degradáció + MAIL_TO-guard AUDIT → WARN a providers_used-be (audit.js).
  // A renderReport ELŐTT, hogy a lábléc kiírja; a finishRun (lentebb) perzisztálja. Ez teszi
  // a napi "a triázst az ingyenes provider vitte-e, vagy fizetős fallbackre esett?" ellenőrzést
  // a jelentésből leolvashatóvá (08-16: 13× groq-404 + néma fizetős fallback, csak kézzel derült ki).
  // A triázs-lánc ELSŐDLEGES providere (chain[0]) — a ③ lánc-sorrend audithoz (az elsődleges
  // kiesését az ingyenes/nem-404 fallback eddig elrejtette). Config-hiba → null → a check kimarad.
  let triagePrimary = null;
  try { triagePrimary = (await loadJson("../config/llm.json"))?.roles?.triage?.chain?.[0]?.provider ?? null; } catch { /* nincs config → lánc-check kimarad */ }
  for (const w of auditProviders({ log: providersUsed, env: process.env, primary: triagePrimary })) {
    providersUsed.push(w);
    console.warn(`AUDIT ${w.role}: ${w.detail}`);
  }

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
  const reportPath = `${y}/${m}/${d}.html`; // a napra rögzített archív
  // F4-B: a napi pillanatkép a PERZISZTENS, git-trackelt archive/-ba kerül; a dist/-et
  // (Pages-artifact) a buildDist a TELJES archívból rakja össze, a legújabb napot téve
  // index.html-nek — így a korábbi napok archív URL-jei NEM 404-elnek a nem-additív
  // Pages-deploy után (a workflow az archive/-ot is visszacommitolja, mint a monitor.db-t).
  await mkdir(`archive/${y}/${m}`, { recursive: true });
  await writeFile(`archive/${reportPath}`, html);
  await buildDist({ archiveDir: "archive", distDir: "dist" });
  mark("render+dedup");
  console.log(`Jelentés kész: ${items.length} tétel, ${kiemeltCount} KIEMELT${triageDegraded ? " (triázs degradált)" : ""}, ${collected.sourceChecks.length} forrás.`);

  // A digest linkje a Pages-GYÖKÉRRE mutat (nem a napi archívra): a deploy-pages NEM additív,
  // a napi ÉÉÉÉ/HH/NN.html archív URL másnap 404 (empíria 2026-08-12) — a gyökér mindig él.
  // (A reportPath-t továbbra is írjuk dist/-be és a finishRun-ba, csak nem ez a link célja.)
  run.pagesUrl = PAGES_BASE;

  // ---- E-mailek (SMTP-konfig nélkül a futás nem hasal el) ----
  const digestSent = await sendMail(digestSubject(run), renderDigest(run));
  console.log(digestSent ? "Digest-email elküldve." : "Digest-email kihagyva (nincs SMTP-konfig).");

  let kiemeltSent = false;
  if (kiemeltCount > 0) {
    kiemeltSent = await sendMail(`🔴 KIEMELT — ${runId} — ${kiemeltCount} tétel`, renderKiemelt(run));
    console.log(kiemeltSent ? "KIEMELT-email elküldve." : "KIEMELT-email kihagyva (nincs SMTP-konfig).");
  }
  mark("email");

  finishRun(db, {
    runId,
    attemptId,
    finishedAt: new Date().toISOString(),
    providersUsed,
    reportUrl: reportPath,
    emailStatus: digestSent ? (kiemeltSent ? "sent+kiemelt" : "sent") : "skipped",
  });
  db.close();
}

main().catch((err) => {
  console.error("A futás elhasalt:", err);
  process.exit(1);
});
