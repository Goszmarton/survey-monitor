import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Regressziós guard: a workflow által KÖZVETLENÜL futtatott belépőpontokat egyetlen
// import-teszt sem parse-olta (a tesztek a magot importálják, nem a run.js top-level-
// jét). Egy puszta SYNTAX-hiba (stringben egyenes idézőjel, ami lezárja a literált)
// így zöld npm test mellett kijutott az élesbe és a `node src/run.js`-nél bukott. A
// `node --check` az egész fájlt parse-olja → ezt az osztályt fogja, belépőpont-szinten.
const entrypoints = ["../src/run.js", "../src/email.js", "../scripts/reset-stuck-verdicts.mjs"];

for (const rel of entrypoints) {
  test(`belépőpont parse-olható (node --check): ${rel}`, () => {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    try {
      execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
    } catch (e) {
      // A stderr tartalmazza a fájlt+sort — kiírjuk, hogy a teszt-kimenetben lássék.
      assert.fail(`SyntaxError a ${rel}-ben:\n${e.stderr?.toString() ?? e.message}`);
    }
  });
}
