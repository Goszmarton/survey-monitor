import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A daily cron 14:33 UTC-re került (2026-08-26 user-döntés: esti kézbesítés, a futás a
// helyi 16:30 UTÁN). A korábbi 08:43 UTC / 15:00-s SLA elévült; a régi cron nem maradhat.
test("workflow: a daily cron 14:33 UTC (33 14 * * *) — esti kézbesítés (2026-08-26)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /cron:\s*"33 14 \* \* \*"/, "a cron 14:33 UTC-re állítva (16:33 CEST)");
  assert.ok(!/cron:\s*"43 8 \* \* \*"/.test(yml), "a régi 08:43 UTC nincs többé");
  assert.ok(!/cron:\s*"43 0 \* \* \*"/.test(yml), "a legrégebbi 00:43 UTC sincs többé");
});

// A cron-indoklás továbbra is a MÉRT sorállás-adatra hivatkozik (112–218 perc — most
// történeti kontextusként), és a DST-figyelmeztetést is rögzíti (egy fix UTC-cron nem
// tud egész évben 16:33 helyit). A doksi az új cront írja.
test("ARCHITEKTURA 3.: a cron-indoklás az új 14:33 cront + a mért sorállást + a DST-t rögzíti", () => {
  const md = readFileSync(new URL("../docs/ARCHITEKTURA.md", import.meta.url), "utf8");
  assert.match(md, /112–218/, "a mért Actions-sorállás sávja szerepel (történeti kontextus)");
  assert.match(md, /33 14 \* \* \*/, "a doksi az új 14:33 cront írja");
  assert.match(md, /DST/, "a DST-eltolódás dokumentálva");
});

// F4-B: a nem-additív Pages-deployhoz az archive/-ot vissza KELL commitolni, különben
// a buildDist következő futáskor nem látja a korábbi napokat → az archív URL-ek 404-elnek.
test("workflow: az archive/ visszacommitálva (F4-B archív-perzisztálás)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /git add .*archive\//, "a commit-lépés az archive/-ot is hozzáadja");
});

// F4-C: a tranziens Pages-backend beragadásra natív 1-retry (marketplace-függés nélkül) —
// az első deploy continue-on-error, bukáskor egy második próba fut.
test("workflow: a Pages-deploynak van natív retry-ága (F4-C)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /continue-on-error:\s*true/, "az első deploy nem bukik azonnal");
  assert.match(yml, /steps\.deploy1\.outcome == 'failure'/, "bukáskor fut a retry-lépés");
});

// (a) test-gate: a config-blocklist guard (config_llm.test.js — deprecated groq-modell
// tiltása) csak akkor VÉD élesben, ha a CI ténylegesen futtatja a teszteket a napi futás
// ELŐTT. Enélkül egy leállt modellt (mint a 08-16-i llama-deprecation) semmi nem fog el
// deploy előtt. Az `npm test` lépésnek a `node src/run.js` lépés ELÉ kell kerülnie, hogy
// bukó teszt megállítsa a futást, mielőtt hibás konfiggal levelet küldene.
test("workflow: npm test test-gate a napi futás (node src/run.js) ELŐTT (a-pont)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  const testIdx = yml.search(/run:\s*npm test\b/);
  const runIdx = yml.search(/node src\/run\.js/);
  assert.ok(testIdx !== -1, "van 'npm test' lépés a workflow-ban");
  assert.ok(runIdx !== -1, "van 'node src/run.js' lépés a workflow-ban");
  assert.ok(testIdx < runIdx, "a test-gate a napi futás ELŐTT fut (bukó teszt megállítja)");
});

// 2026-08-24 incidens: a napi futás beragadt és a job timeout-minutes:30 CANCELLED-del
// ölte meg. A hiba-email `if: failure()`-e cancellationre NEM fut → a beragadt futás NÉMA
// volt (se levél, se hiba-jelzés). A guardnak a cancellationt (timeout) is fednie kell.
test("workflow: a hiba-email cancellationre (timeout) is fut, nem csak failure()-re", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /if:\s*failure\(\)\s*\|\|\s*cancelled\(\)/, "a hiba-email if-je failure() VAGY cancelled()");
});

// Belt-and-suspenders: a "Napi futás" lépés SAJÁT timeout-minutese kisebb a job-énál (30),
// hogy egy beragadás a LÉPÉST buktassa (failure()) — tartalékkal a hiba-email lefutására —
// a job-szintű cancel ELŐTT. A cancel-ág (fent) így csak a végső védőháló.
test("workflow: a Napi futás lépésnek saját (a job alatti) timeout-minutese van", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  const runStep = yml.slice(yml.indexOf("Napi futás"), yml.indexOf("Állapot-DB"));
  assert.match(runStep, /timeout-minutes:\s*\d+/, "a napi futás lépésnek van step-szintű timeoutja");
});
