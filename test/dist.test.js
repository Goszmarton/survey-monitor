import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDist } from "../src/dist.js";

// F4-B: a Pages-deploy NEM additív — minden deploy a TELJES site-ot cseréli, ezért a
// tegnapi ÉÉÉÉ/HH/NN.html archív URL másnap 404 lett. A megoldás: a dátumozott
// pillanatképek PERZISZTENS (git-trackelt) `archive/`-ban élnek, és a build MINDEN
// archívot bemásol a dist/-be a Pages-feltöltés ELŐTT, a legújabbat téve index.html-nek.

async function tmp() {
  const base = await mkdtemp(join(tmpdir(), "distbuild-"));
  return { archiveDir: join(base, "archive"), distDir: join(base, "dist"), base };
}

test("buildDist: minden dátumozott archívot bemásol, a legújabb lesz az index.html", async () => {
  const { archiveDir, distDir, base } = await tmp();
  try {
    await mkdir(join(archiveDir, "2026", "08"), { recursive: true });
    await writeFile(join(archiveDir, "2026", "08", "14.html"), "<h1>14-i jelentés</h1>");
    await writeFile(join(archiveDir, "2026", "08", "15.html"), "<h1>15-i jelentés</h1>");

    const { latest } = await buildDist({ archiveDir, distDir });

    assert.equal(latest, join("2026", "08", "15.html"));
    assert.equal(await readFile(join(distDir, "index.html"), "utf8"), "<h1>15-i jelentés</h1>");
    assert.equal(await readFile(join(distDir, "2026", "08", "15.html"), "utf8"), "<h1>15-i jelentés</h1>");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// 2026-09-01 (user): statikus „Az oldalról" info-fül. A buildDist minden futáskor újraírja
// info.html-ként a gyökérbe ÉS minden aloldal-könyvtárba (hogy a relatív `info.html` link a
// dátumozott archív oldalakról is működjön). Kódból generált, mindkét felületre (Pages + tükör).
test("buildDist: info.html-t ír a gyökérbe ÉS az archív aloldalak könyvtárába", async () => {
  const { archiveDir, distDir, base } = await tmp();
  try {
    await mkdir(join(archiveDir, "2026", "08"), { recursive: true });
    await writeFile(join(archiveDir, "2026", "08", "15.html"), "<h1>15-i jelentés</h1>");

    await buildDist({ archiveDir, distDir });

    const rootInfo = await readFile(join(distDir, "info.html"), "utf8");
    assert.match(rootInfo, /Az oldalról/, "a gyökér info.html a renderInfoPage kimenete");
    // az aloldal (2026/08/15.html) mellett is ott az info.html → a relatív link nem 404-el
    const subInfo = await readFile(join(distDir, "2026", "08", "info.html"), "utf8");
    assert.match(subInfo, /Az oldalról/, "az archív alkönyvtárban is van info.html");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("buildDist: a KORÁBBI nap archívja nem vész el (F4-B lényege — nem-additív Pages)", async () => {
  const { archiveDir, distDir, base } = await tmp();
  try {
    await mkdir(join(archiveDir, "2026", "08"), { recursive: true });
    await writeFile(join(archiveDir, "2026", "08", "14.html"), "<h1>14-i jelentés</h1>");
    await writeFile(join(archiveDir, "2026", "08", "15.html"), "<h1>15-i jelentés</h1>");

    await buildDist({ archiveDir, distDir });

    // a 14-i archív a dist/-ben marad → az URL másnap is 200 (nem 404)
    assert.equal(await readFile(join(distDir, "2026", "08", "14.html"), "utf8"), "<h1>14-i jelentés</h1>");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
