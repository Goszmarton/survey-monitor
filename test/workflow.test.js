import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-08-28: a napi futás ELSŐDLEGES indítója a SZERVER (curl → workflow_dispatch, 16:30
// Budapest, pontos — nem függ a scheduled-cron sorállásától). A GitHub scheduled cron BACKUP-ra
// tolva a szerver-trigger MÖGÉ: 16:00 UTC (nyáron 18:00 CEST, télen 17:00 CET — év közben végig a
// szerver-trigger után). A dupla indítást a run.js idempotencia-őre dedupolja (hasCompletedRun).
test("workflow: a scheduled cron BACKUP-slotra tolva (16:00 UTC), a régi 14:33 nincs többé", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /cron:\s*"0 16 \* \* \*"/, "a backup cron 16:00 UTC-re állítva");
  assert.ok(!/cron:\s*"33 14 \* \* \*"/.test(yml), "a régi 14:33 UTC cron nincs többé");
  assert.ok(!/cron:\s*"43 8 \* \* \*"/.test(yml), "a régi 08:43 UTC sincs");
});

// A napi trigger dupla-indítás dedup: a workflow_dispatch kap egy `force` inputot (alapból false);
// a kézi „küldj most" dispatch force=true-val átlépi az őrt. A Napi futás lépés a FORCE_RUN envet
// az inputból tölti, hogy a run.js-őr (hasCompletedRun + FORCE_RUN) olvashassa.
test("workflow: workflow_dispatch force input + FORCE_RUN env az inputból (őr-átlépés)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /force:/, "a workflow_dispatch-nak van force inputja");
  assert.match(yml, /FORCE_RUN:\s*\$\{\{[^}]*inputs\.force/, "a FORCE_RUN env az inputs.force-ból töltődik");
});

// A cron-indoklás a szerver-trigger PRIMARY-t + a backup cront + a DST-eltolódást rögzíti.
test("ARCHITEKTURA 3.: a szerver-trigger PRIMARY + a backup cron (16:00 UTC) + DST dokumentálva", () => {
  const md = readFileSync(new URL("../docs/ARCHITEKTURA.md", import.meta.url), "utf8");
  assert.match(md, /0 16 \* \* \*/, "a doksi az új backup cront (16:00 UTC) írja");
  assert.match(md, /workflow_dispatch|curl|szerver-trigger/i, "a szerver-trigger primary dokumentálva");
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
