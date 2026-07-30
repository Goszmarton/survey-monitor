import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #1 SLA: a cron 00:43 UTC-re került (a mért 142–188 perces Actions-késés miatt),
// és az ARCHITEKTURA.md indoklása a MÉRT adatra hivatkozik, nem a régi becslésre.
test("workflow: a daily cron 00:43 UTC (43 0 * * *) — az SLA-fix (#1)", () => {
  const yml = readFileSync(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8");
  assert.match(yml, /cron:\s*"43 0 \* \* \*"/, "a cron 00:43 UTC-re állítva");
  assert.ok(!/cron:\s*"43 3 \* \* \*"/.test(yml), "a régi 03:43 UTC nincs többé");
});

test("ARCHITEKTURA 3.: a cron-indoklás a mért 142–188 perces késésre hivatkozik (#1)", () => {
  const md = readFileSync(new URL("../docs/ARCHITEKTURA.md", import.meta.url), "utf8");
  assert.match(md, /142–188/, "a mért Actions-késés szerepel az indoklásban");
  assert.match(md, /43 0 \* \* \*/, "a doksi a 00:43 cront írja");
});
