import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// Regressziós guard: a workflow által KÖZVETLENÜL futtatott belépőpontokat egyetlen
// import-teszt sem parse-olta (a tesztek a magot importálják, nem a run.js top-level-
// jét). Egy puszta SYNTAX-hiba (stringben egyenes idézőjel, ami lezárja a literált)
// így zöld npm test mellett kijutott az élesbe és a `node src/run.js`-nél bukott. Ez a
// teszt ezt az osztályt fogja, belépőpont-szinten.

const root = new URL("../", import.meta.url);

// A `node --check` a .js-t MODULKÉNT parse-olja, ha a package.json "type":"module" —
// különben a top-level `import` maga lenne SyntaxError (hamis piros). Expliciten
// állítjuk, hogy a guard alapfeltevése ne dőljön el némán egy type-váltással.
test("package.json type=module — a --check ESM-ként parse-ol", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.type, "module");
});

// `node --check`: a TELJES fájlt parse-olja → elkapja a SZINTAXIS-hibát. NEM fogja
// viszont: a hibás import-utat (modul-feloldás), a rossz named exportot, a top-level
// runtime hibát — ezekhez a modult be kellene TÖLTENI. A run.js main-guard NÉLKÜL
// hívja a main()-t a modul-törzsben, a reset-script pedig a top-level-en FUTTATJA a
// migrációt → importra mindkettő mellékhatást okozna (valódi futás / DB-írás). Ezért
// ezeket csak statikusan --check-eljük, a fenti korlátokat tudomásul véve.
const checkOnly = ["src/run.js", "scripts/reset-stuck-verdicts.mjs"];

// email.js argv-guarddal fut (a send CSAK `--failure` argv-re) és mellékhatás nélkül
// betölthető (config env nélkül null → nincs SMTP-hívás) → dinamikus import()-tal
// ERŐSEBBEN ellenőrizhető: parse + modul-feloldás + top-level eval + a várt export.
const importTested = ["src/email.js"];

for (const rel of checkOnly) {
  test(`szintaxis-check (node --check): ${rel}`, () => {
    const path = fileURLToPath(new URL(rel, root));
    try {
      // stdio:pipe elnyelné a stderrt; try/catch + assert.fail visszaadja, hogy a
      // fájl+sor lássék a teszt-kimenetben.
      execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
    } catch (e) {
      assert.fail(`SyntaxError a ${rel}-ben:\n${e.stderr?.toString() ?? e.message}`);
    }
  });
}

test("belépőpont betölthető (import): src/email.js + export ép", async () => {
  // A send nem indul: nincs SMTP-konfig a tesztkörnyezetben, és az argv[2] itt nem
  // "--failure". Az import() parse-ol, feloldja az import-utakat és lefuttatja a
  // top-level-t — a puszta --check-nél többet fog.
  const mod = await import(new URL("src/email.js", root).href);
  assert.equal(typeof mod.sendMail, "function", "a sendMail named export megvan");
});

// Ne drótozzuk be a listát: a workflow MINDEN `node <path>` hívása legyen lefedve
// (checkOnly ∪ importTested), különben a következő belépőpont néma lyuk. A listát a
// yml-ből olvassuk, nem a fejünkből.
test("a monitor.yml minden 'node <path>' belépőpontja lefedett", () => {
  const yml = readFileSync(new URL(".github/workflows/monitor.yml", root), "utf8");
  const calls = [...yml.matchAll(/node\s+(\S+\.(?:js|mjs))/g)].map((m) => m[1]);
  assert.ok(calls.length > 0, "van legalább egy node-hívás a workflow-ban");
  const covered = new Set([...checkOnly, ...importTested]);
  for (const p of calls) {
    assert.ok(covered.has(p), `a workflow futtatja '${p}'-t, de nincs lefedve (checkOnly vagy importTested) — fedetlen belépőpont`);
  }
});
