import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// STRUKTURÁLIS teszt (a workflow.test.js mintájára): a run.js orchesztrátort nem tudjuk
// olcsón end-to-end futtatni (db + collect + LLM + email mockolása nélkül), de a némaság-
// rés reprodukálható a forrásból: a 08-24/08-25 tanulság az, hogy a run.js 0 fázis-
// időbélyeget adott a collect → triázs → render → email szakaszhatárokon. Ez a teszt
// megköveteli, hogy a run.js bekösse a phaseLine-fázisjeleket MIND a négy határon.

const src = readFileSync(new URL("../src/run.js", import.meta.url), "utf8");

test("run.js: importálja a phaseLine fázis-idő helpert", () => {
  assert.match(src, /import\s*\{[^}]*\bphaseLine\b[^}]*\}\s*from\s*["']\.\/lib\/phaselog\.js["']/);
});

test("run.js: mind a négy fázishatáron van fázis-időbélyeg (collect, triázs, render, email)", () => {
  // A fázis-jel a `mark("<label>")` wrapperen át megy (ő hívja a phaseLine-t az eltelt
  // idővel); a lefedett fázisokat e hívások címkéiből olvassuk ki. (phaseLine literál
  // hívást is elfogadunk, ha valaki később inline-olja.)
  const labels = [...src.matchAll(/(?:mark|phaseLine)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1].toLowerCase());
  assert.ok(labels.length >= 4, `legalább 4 fázis-jel kell, van: ${labels.length} (${labels.join(", ")})`);
  for (const phase of ["collect", "triázs", "render", "email"]) {
    assert.ok(
      labels.some((l) => l.includes(phase)),
      `hiányzó fázis-időbélyeg: "${phase}" (meglévők: ${labels.join(", ")})`,
    );
  }
});
