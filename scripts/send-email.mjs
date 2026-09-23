// Napi levél KÜLDÉSE — a workflow UTOLSÓ érdemi lépése (a Pages-deploy + tükör-frissítés UTÁN).
//
// MIÉRT KÜLÖN LÉPÉS (2026-09-23, user + kolléga-visszajelzés): a levél linkje a PAGES_BASE-re
// (napihir.duckdns.org tükör) mutat, ami a szerver sweep-jén frissül. Korábban a levelet a run.js
// küldte a futás VÉGÉN — de a commit/push + a tükör-újraépítés CSAK EZUTÁN történt, így a levél
// megjöttekor a link még a TEGNAPI jelentést mutatta. Most a run.js csak ELŐKÉSZÍTI a levelet
// (outbox/), a tényleges küldés IDE került, a deploy után: előbb megvárjuk, míg a tükör a MAI
// jelentést mutatja, és csak utána küldünk → a linkre kattintva a mai jön.
//
// FAIL-OPEN (kritikus garancia): ha a tükör a türelmi időn belül NEM frissül (szerver-hiba,
// sweep-akadás), a levél AKKOR IS kimegy (inkább esetleg-régi linkkel, mint sehogy). A „napi levél
// SOSEM marad el" garancia (ARCHITEKTURA) nem sérülhet. Csak a valódi SMTP-hiba bukik (→ hiba-email).

import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { sendMail } from "../src/email.js";
import { PAGES_BASE } from "../src/report.js";

const OUTBOX = "outbox";
const DB_PATH = "state/monitor.db";

// A tükör a MAI jelentést mutatja-e? A render a jelentés metájába „futás: <runId>"-t ír (report.js),
// ez a marker csak a MAI oldalon van (a tegnapi oldal legfeljebb egy előző-napi archív-LINKET tartalmaz,
// nem a mai runId-t „futás:" előtaggal) → nincs hamis pozitív.
export function isMirrorFresh(html, runId) {
  return typeof html === "string" && html.includes(`futás: ${runId}`);
}

/**
 * Megvárja, míg a tükör a mai jelentést mutatja. FAIL-OPEN: a türelmi idő letelte után is
 * `false`-szal tér vissza (nem dob) — a hívó ekkor is küld.
 * @returns {Promise<boolean>} true, ha a tükör frissnek bizonyult a türelmi időn belül
 */
export async function waitForMirror({
  url, runId, fetchImpl = fetch, attempts = 30, delayMs = 20_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log,
} = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(url, { redirect: "follow" });
      const html = await res.text();
      if (isMirrorFresh(html, runId)) { log(`tükör friss (${i}. próba) — a link a mai jelentést mutatja`); return true; }
    } catch (err) {
      log(`tükör-lekérés hiba (${i}. próba, nem kritikus): ${err?.message ?? err}`);
    }
    if (i < attempts) await sleep(delayMs);
  }
  log(`FAIL-OPEN: a tükör ${attempts} próba után sem frissült — a levél így is megy (a link egy ideig a korábbi jelentést mutathatja)`);
  return false;
}

// Opcionális: a szerver tükör-újraépítésének azonnali kiváltása (a 30 perces sweep helyett).
// A MIRROR_REBUILD_HOOK egy védett szerver-végpont (a user állítja be); ha nincs, a poll a rendes
// sweepre támaszkodik (fail-openig). A hook hibája SOHA nem kritikus.
async function pokeRebuild(hook, log = console.log, fetchImpl = fetch) {
  if (!hook) return;
  try {
    const res = await fetchImpl(hook, { method: "POST" });
    log(`tükör-újraépítés jelzés elküldve (HTTP ${res.status})`);
  } catch (err) {
    log(`tükör-hook hiba (nem kritikus): ${err?.message ?? err}`);
  }
}

export async function main() {
  const [subject, body, metaRaw] = await Promise.all([
    readFile(`${OUTBOX}/subject.txt`, "utf8"),
    readFile(`${OUTBOX}/body.html`, "utf8"),
    readFile(`${OUTBOX}/meta.json`, "utf8"),
  ]);
  const meta = JSON.parse(metaRaw);

  await pokeRebuild(process.env.MIRROR_REBUILD_HOOK);
  await waitForMirror({ url: PAGES_BASE, runId: meta.runId });

  const sent = await sendMail(subject, body);
  const status = sent ? (meta.kiemelt ? "sent+kiemelt" : "sent") : "skipped";
  console.log(sent ? `Levél elküldve${meta.kiemelt ? " (KIEMELT szekcióval)" : ""}.` : "Levél kihagyva (nincs SMTP-konfig).");

  // A valós küldés-státusz visszaírása a DB-be (a run.js „prepared"-öt írt). A workflow ezután
  // commitolja+pusholja a main-re → a reggeli rutin / audit a VALÓS státuszt látja.
  const db = new DatabaseSync(DB_PATH);
  db.prepare("UPDATE runs SET email_status = ? WHERE run_id = ?").run(status, meta.runId);
  db.close();
}

// CLI-ból futtatva indul; importálva (teszt) csak az exportok.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error("A levélküldés elhasalt:", err); process.exit(1); });
}
