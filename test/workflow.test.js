import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #1 SLA: a cron 08:43 UTC-re került (2026-08-08: az SLA-t 15:00 Budapestre
// toltuk, a mért 112–218 perces Actions-sorállás max-jára tervezve), és az
// ARCHITEKTURA.md indoklása a MÉRT adatra hivatkozik, nem a régi becslésre.
test("workflow: a daily cron 08:43 UTC (43 8 * * *) — az SLA-fix (#1)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /cron:\s*"43 8 \* \* \*"/, "a cron 08:43 UTC-re állítva");
  assert.ok(!/cron:\s*"43 0 \* \* \*"/.test(yml), "a régi 00:43 UTC nincs többé");
});

test("ARCHITEKTURA 3.: a cron-indoklás a mért 112–218 perces sorállásra és a 15:00 SLA-ra hivatkozik (#1)", () => {
  const md = readFileSync(new URL("../docs/ARCHITEKTURA.md", import.meta.url), "utf8");
  assert.match(md, /112–218/, "a mért Actions-sorállás sávja szerepel az indoklásban");
  assert.match(md, /43 8 \* \* \*/, "a doksi a 08:43 cront írja");
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
