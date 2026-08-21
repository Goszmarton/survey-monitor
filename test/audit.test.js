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

// HARMADIK JEL (08-21): lánc-sorrend sérülés. A 08-21-i eset: gemini (elsődleges) 10× HTTP_503,
// a groq (INGYENES) vitte a triázs 10/13 batch-ét. Mindkét meglévő jel átcsúszott — a gemini 503
// nem 404, a fallback groq nem fizetős → 0 WARN, holott az elsődleges provider teljesen kiesett.
test("auditTriageProviders: az elsődleges provider <50%-ot visz (fallbackre csúszott) → WARN (③)", () => {
  const log = [];
  for (let i = 0; i < 10; i++) { // 10 batch: gemini bukik 503, groq (ingyenes) viszi
    log.push({ role: "triage", provider: "gemini", status: "HTTP_503" });
    log.push({ role: "triage", provider: "groq", status: "OK", usage: { total_tokens: 100 } });
  }
  for (let i = 0; i < 3; i++) log.push({ role: "triage", provider: "gemini", status: "OK", usage: { total_tokens: 100 } });
  const r = auditTriageProviders(log, { primary: "gemini" });
  // gemini OK 3/13 = 23% < 50% → tüzel; a 404 és a fizetős jel NEM (groq ingyenes, 503≠404)
  assert.equal(r.groq404, 0, "nincs 404");
  assert.equal(r.paidBatches, 0, "nincs fizetős batch");
  assert.ok(r.warnings.some((w) => /elsődleges|lánc/i.test(w) && /gemini/.test(w)), "van lánc-sorrend WARN a primaryval");
});

test("auditTriageProviders: az elsődleges viszi a többséget (≥50%) → nincs lánc-WARN (③)", () => {
  const log = [];
  for (let i = 0; i < 8; i++) log.push({ role: "triage", provider: "gemini", status: "OK", usage: { total_tokens: 100 } });
  for (let i = 0; i < 2; i++) log.push({ role: "triage", provider: "groq", status: "OK", usage: { total_tokens: 100 } });
  const r = auditTriageProviders(log, { primary: "gemini" });
  assert.ok(!r.warnings.some((w) => /elsődleges|lánc/i.test(w)), "8/10 → nincs lánc-WARN");
});

test("auditTriageProviders: az elsődleges NINCS kulccsal (csak SKIPPED_NO_KEY) → nincs lánc-WARN (③, lokális/konfig, nem degradáció)", () => {
  const log = [];
  for (let i = 0; i < 5; i++) {
    log.push({ role: "triage", provider: "gemini", status: "SKIPPED_NO_KEY" });
    log.push({ role: "triage", provider: "groq", status: "OK", usage: { total_tokens: 100 } });
  }
  const r = auditTriageProviders(log, { primary: "gemini" });
  assert.ok(!r.warnings.some((w) => /elsődleges|lánc/i.test(w)), "no-key primary → nem degradáció, nincs zaj");
});

test("auditTriageProviders: primary NÉLKÜL a lánc-check kimarad (visszafelé kompat) (③)", () => {
  const log = [{ role: "triage", provider: "groq", status: "OK", usage: { total_tokens: 100 } }];
  const r = auditTriageProviders(log); // nincs primary
  assert.ok(!r.warnings.some((w) => /elsődleges|lánc/i.test(w)), "primary nélkül nincs lánc-check");
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
