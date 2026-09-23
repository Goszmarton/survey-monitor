import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// STRUKTURÁLIS teszt (a run_phaselog.test.js mintájára): a run.js orchesztrátort nem tudjuk
// olcsón end-to-end futtatni, de a "két külön levél" hibás viselkedés reprodukálható a
// forrásból. A 2026-08-26 döntés: EGY levél a digest + KIEMELT helyett. A korábbi run.js KÉT
// sendMail-t hívott (digest + 🔴 KIEMELT); ez a teszt megköveteli, hogy a fő futásban pontosan
// egy levél menjen, a renderCombined + combinedSubject helperekkel.

const src = readFileSync(new URL("../src/run.js", import.meta.url), "utf8");

// 2026-09-23: a levél-KÜLDÉS kikerült a run.js-ből a scripts/send-email.mjs-be (a workflow utolsó
// lépése, a Pages-deploy + tükör-frissítés UTÁN — hogy a linkre kattintva a mai jelentés jöjjön).
// A run.js már csak ELŐKÉSZÍTI a levelet (outbox/), így 0 sendMail-t hív; a send-email.mjs pontosan
// egyet. Az „egy összevont levél" szerződés így a két fájl közt oszlik meg.
test("run.js: NEM küld levelet közvetlenül (0 sendMail) — a küldés a send-email.mjs-ben", () => {
  const calls = [...src.matchAll(/\bsendMail\(/g)].length;
  assert.equal(calls, 0, `a run.js már nem küld (outbox-előkészítés); sendMail-hívások: ${calls}`);
});

test("run.js: outbox-ba készíti a levelet (subject + body + meta)", () => {
  assert.match(src, /outbox\/subject\.txt/, "a tárgy outbox-ba");
  assert.match(src, /outbox\/body\.html/, "a törzs outbox-ba");
  assert.match(src, /outbox\/meta\.json/, "a meta (runId + kiemelt) outbox-ba");
});

test("send-email.mjs: pontosan EGY sendMail (az egy összevont levél)", () => {
  const se = readFileSync(new URL("../scripts/send-email.mjs", import.meta.url), "utf8");
  const calls = [...se.matchAll(/\bsendMail\(/g)].length;
  assert.equal(calls, 1, `pontosan 1 sendMail kell a send-email.mjs-ben, van: ${calls}`);
});

test("run.js: az összevont renderelőt használja (renderCombined + combinedSubject)", () => {
  assert.match(src, /renderCombined\(/, "renderCombined a törzsben");
  assert.match(src, /combinedSubject\(/, "combinedSubject a tárgyhoz");
});

test("run.js: nem hívja külön a régi digest/KIEMELT levél-renderelőt a küldéskor", () => {
  // A renderDigest/renderKiemelt exportok megmaradhatnak a report.js-ben (tesztelve), de a
  // run.js küldés-ága már NEM állít elő belőlük külön levelet.
  assert.ok(!/sendMail\(\s*digestSubject/.test(src), "nincs külön digest-levél küldés");
  assert.ok(!/sendMail\(\s*`?🔴 KIEMELT/.test(src), "nincs külön KIEMELT-levél küldés");
});
