import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// STRUKTURÁLIS teszt (a run_phaselog.test.js mintájára): a run.js orchesztrátort nem tudjuk
// olcsón end-to-end futtatni, de a "két külön levél" hibás viselkedés reprodukálható a
// forrásból. A 2026-08-26 döntés: EGY levél a digest + KIEMELT helyett. A korábbi run.js KÉT
// sendMail-t hívott (digest + 🔴 KIEMELT); ez a teszt megköveteli, hogy a fő futásban pontosan
// egy levél menjen, a renderCombined + combinedSubject helperekkel.

const src = readFileSync(new URL("../src/run.js", import.meta.url), "utf8");

test("run.js: pontosan EGY sendMail a fő futásban (nem kettő) — a digest+KIEMELT egybe vonva", () => {
  const calls = [...src.matchAll(/\bsendMail\(/g)].length;
  assert.equal(calls, 1, `pontosan 1 sendMail kell a run.js-ben, van: ${calls}`);
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
