import { test } from "node:test";
import assert from "node:assert/strict";
import { auditTriageProviders, auditMailTo, auditProviders } from "../src/audit.js";

// A 08-16/08-17-i néma degradáció: a groq deprecated modellje 13× HTTP_404-et adott,
// és a FIZETŐS anthropic fallback némán elvitte a triázs-batcheket. Csak kézi
// belenézéssel derült ki. Ennek a napi verifikáció FIX pontjának kell lennie:
// a providers_used-ből kiolvasható, mely provider vitte a triázst.

test("auditTriageProviders: groq HTTP_404 → deprecation-WARN", () => {
  const log = [
    { role: "triage", provider: "gemini", status: "HTTP_503" },
    { role: "triage", provider: "groq", status: "HTTP_404" },
    { role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } },
  ];
  const r = auditTriageProviders(log);
  assert.equal(r.groq404, 1);
  assert.ok(r.warnings.some((w) => /groq/i.test(w) && /404/.test(w)), "van groq-404 deprecation-warning");
});

test("auditTriageProviders: fizetős fallback vitte a batcheket (>2) → WARN + carrier", () => {
  // 3 batch: gemini bukik (503), groq deprecation (404), anthropic (FIZETŐS) OK — mindháromszor
  const log = [];
  for (let i = 0; i < 3; i++) {
    log.push({ role: "triage", provider: "gemini", status: "HTTP_503" });
    log.push({ role: "triage", provider: "groq", status: "HTTP_404" });
    log.push({ role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } });
  }
  const r = auditTriageProviders(log);
  assert.equal(r.paidBatches, 3, "3 batch-et a fizetős provider vitt");
  assert.equal(r.carrier, "anthropic", "a többséget az anthropic vitte");
  assert.ok(r.warnings.some((w) => /fizetős|anthropic/i.test(w) && /3/.test(w)), "van fizetős-fallback warning a batch-számmal");
});

test("auditTriageProviders: egészséges nap (gemini viszi) → nincs WARN", () => {
  const log = [];
  for (let i = 0; i < 5; i++) log.push({ role: "triage", provider: "gemini", status: "OK", usage: { total_tokens: 100 } });
  // más szerep-zaj: a synthesis-t az anthropic viszi — ez NEM triázs, nem szabad riasztania
  log.push({ role: "synthesis", provider: "anthropic", status: "OK" });
  const r = auditTriageProviders(log);
  assert.equal(r.paidBatches, 0, "0 fizetős triázs-batch");
  assert.equal(r.carrier, "gemini");
  assert.deepEqual(r.warnings, [], "egészséges nap → nincs warning");
});

test("auditTriageProviders: 1-2 fizetős batch a küszöb ALATT → nincs zajos WARN", () => {
  // steady-state ~0; a user szerint csak >2 fölött riasztunk (tranziens 1-2 batch nem zaj)
  const log = [
    { role: "triage", provider: "gemini", status: "OK", usage: { total_tokens: 100 } },
    { role: "triage", provider: "gemini", status: "OK", usage: { total_tokens: 100 } },
    { role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } },
    { role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } },
  ];
  const r = auditTriageProviders(log);
  assert.equal(r.paidBatches, 2);
  assert.ok(!r.warnings.some((w) => /fizetős/i.test(w)), "2 batch (küszöb alatt) → nincs fizetős-warning");
});

test("auditMailTo: pontosvessző-elválasztó → WARN (eddig csak console.warn látta)", () => {
  const ws = auditMailTo({ MAIL_TO: "a@b.hu; c@d.hu" });
  assert.ok(ws.some((w) => /pontosvessző/i.test(w)), "a pontosvessző-guard warning felszínre kerül");
});

test("auditMailTo: gyanús cím (nincs @) → WARN", () => {
  const ws = auditMailTo({ MAIL_TO: "rossz-cim" });
  assert.ok(ws.some((w) => /gyanús/i.test(w)));
});

test("auditMailTo: MAIL_TO nincs beállítva → NEM zajong (lokális futás nem hiba)", () => {
  const ws = auditMailTo({});
  assert.deepEqual(ws, [], "beállítatlan MAIL_TO nem generál lábléc-zajt");
});

test("auditProviders: egy hívás fedi mindkettőt — WARN-bejegyzések a providers_used-hez", () => {
  const log = [
    { role: "triage", provider: "groq", status: "HTTP_404" },
    { role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } },
    { role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } },
    { role: "triage", provider: "anthropic", status: "OK", usage: { total_tokens: 100 } },
  ];
  const entries = auditProviders({ log, env: { MAIL_TO: "a@b.hu; c@d.hu" } });
  assert.ok(Array.isArray(entries));
  assert.ok(entries.every((e) => e.status === "WARN"), "minden bejegyzés WARN");
  assert.ok(entries.some((e) => e.role === "triage" && /404/.test(e.detail)), "triázs deprecation WARN");
  assert.ok(entries.some((e) => e.role === "triage" && /fizetős|anthropic/i.test(e.detail)), "fizetős-fallback WARN");
  assert.ok(entries.some((e) => e.role === "mail" && /pontosvessző/i.test(e.detail)), "MAIL_TO WARN");
});
