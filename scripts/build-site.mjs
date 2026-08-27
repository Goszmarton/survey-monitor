// A DuckDNS-tükör (napihir.duckdns.org) napi build-belépőpontja — a survey-monitor
// jelentés kiszolgálható statikus site-jának előállítása egy külön szerveren.
//
// NEM számol: se LLM, se DB, se hálózat. A git-trackelt `archive/`-ból a megadott
// webrootba másol a Pages-t is előállító, TESZTELT src/dist.js buildDist-tel — így a
// kiszolgált oldal BÁJTAZONOS a github.io Pages-szel, és ha a buildDist logikája
// változik, a szerver egy `git pull`-lal automatikusan követi (egyetlen igazságforrás).
//
// A szerveren egy systemd timer futtatja, `git pull` után:
//   node scripts/build-site.mjs <webroot>
// (Az archive/ append-only, ezért a nem-törlő másolás elég: a régi napok megmaradnak,
// az index.html minden futáskor a legfrissebb napra íródik felül.)

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildDist } from "../src/dist.js";

const webrootArg = process.argv[2];
if (!webrootArg) {
  console.error("Használat: node scripts/build-site.mjs <webroot>");
  console.error("  A repo archive/-jából a <webroot>-ba építi a kiszolgálható site-ot.");
  process.exit(1);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const archiveDir = join(repoRoot, "archive");
const distDir = resolve(webrootArg);

const { files, latest } = await buildDist({ archiveDir, distDir });
console.log(
  `build-site: ${files.length} archív fájl → ${distDir}; index.html = ${latest ?? "(nincs archív)"}`,
);
