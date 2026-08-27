import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A DuckDNS-tükör (napihir) napi build-belépőpontja. A szerveren `git pull` után egy
// systemd timer futtatja: `node scripts/build-site.mjs <webroot>`. NEM számol — a
// git-trackelt archive/-ból a webrootba másol a TESZTELT src/dist.js buildDist-tel,
// így a kiszolgált oldal bájtazonos a github.io Pages-szel. Ez a teszt a belépőpont
// HUZALOZÁSÁT fogja (a repo saját archive/-ját oldja fel, a kapott webrootba ír, és a
// hiányzó argumentumra nem-nulla kóddal lép ki) — a buildDist magját a dist.test.js.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const script = join(repoRoot, "scripts", "build-site.mjs");
const archiveDir = join(repoRoot, "archive");

// A repo archive/-ja alatti összes .html relatív útja, ISO-út szerint rendezve — a
// buildDist listHtml-jével egyező logika (a legfrissebb = az utolsó).
async function listArchiveHtml() {
  const entries = await readdir(archiveDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name).slice(archiveDir.length + 1))
    .sort();
}

test("build-site: a repo archive-jából a megadott webrootba épít, a legfrissebb nap = index.html", async () => {
  const webroot = await mkdtemp(join(tmpdir(), "napihir-"));
  try {
    const out = execFileSync(process.execPath, [script, webroot], { encoding: "utf8" });

    const files = await listArchiveHtml();
    assert.ok(files.length > 0, "a repo archive-jában van legalább egy .html");
    const latest = files[files.length - 1];

    // index.html == a legfrissebb archív nap (bájtazonos)
    assert.equal(
      await readFile(join(webroot, "index.html"), "utf8"),
      await readFile(join(archiveDir, latest), "utf8"),
      "az index.html a legfrissebb archív nap tartalma",
    );

    // MINDEN korábbi archív nap is átkerül (a régi URL-ek sem 404-esek)
    for (const rel of files) {
      assert.equal(
        await readFile(join(webroot, rel), "utf8"),
        await readFile(join(archiveDir, rel), "utf8"),
        `a(z) ${rel} archív átmásolva`,
      );
    }

    assert.match(out, /index\.html/, "értelmes összegzést ír a kimenetre");
  } finally {
    await rm(webroot, { recursive: true, force: true });
  }
});

test("build-site: webroot-argumentum nélkül nem-nulla kóddal lép ki + használatot ír", () => {
  try {
    execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" });
    assert.fail("argumentum nélkül hibakóddal kellett volna kilépnie");
  } catch (e) {
    assert.equal(e.status, 1, "kilépési kód = 1");
    assert.match((e.stderr ?? "").toString(), /Használat|webroot/i, "használati üzenet a stderr-en");
  }
});
