// F4-B — archív-perzisztálás a nem-additív Pages-deployhoz.
//
// A GitHub Pages deploy MINDEN feltöltéskor a TELJES site-ot cseréli (nem additív),
// ezért a run.js régen csak {index.html, a MAI archív}-ot írta dist/-be → a tegnapi
// ÉÉÉÉ/HH/NN.html URL MÁSNAP 404 lett (empíria: 08-11 archív 404 volt 08-12-n).
//
// Megoldás: a dátumozott pillanatképek PERZISZTENS forrása a git-trackelt `archive/`
// (a dist/ gitignore-olt build-kimenet marad). buildDist a Pages-feltöltés ELŐTT a
// TELJES archívot bemásolja a dist/-be, és a legújabb napot teszi index.html-nek.

import { mkdir, readdir, copyFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { renderInfoPage } from "./report.js";

/** archiveDir alatti összes .html relatív útja (rekurzív), pl. "2026/08/15.html". */
async function listHtml(archiveDir) {
  let entries;
  try {
    entries = await readdir(archiveDir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return []; // még nincs archív (első futás)
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    // parentPath (node 20.12+) a szülőkönyvtár; ebből az archiveDir-hez relatív út.
    .map((e) => join(e.parentPath, e.name).slice(archiveDir.length + 1))
    .sort(); // ISO dátum-út → sztring-rendezés = kronológia
}

/**
 * A teljes archívot dist/-be másolja, a legújabb napot index.html-nek.
 * @param {{archiveDir: string, distDir: string}} opts
 * @returns {Promise<{files: string[], latest: string|null}>}
 */
export async function buildDist({ archiveDir, distDir }) {
  const files = await listHtml(archiveDir);
  for (const rel of files) {
    const dest = join(distDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(archiveDir, rel), dest);
  }
  const latest = files.length ? files[files.length - 1] : null;
  if (latest) {
    await mkdir(distDir, { recursive: true });
    await copyFile(join(archiveDir, latest), join(distDir, "index.html"));
  }

  // Statikus „Az oldalról" info-fül (info.html). MINDEN futáskor (a no-op-nál is) újragenerálódik
  // a KÓDBÓL (renderInfoPage) → mindig a friss leírás, mindkét felületre (Pages + tükör), egyetlen
  // igazságforrásból. A jelentés fejlécéből relatív `info.html` link mutat rá; hogy a link a
  // dátumozott archív aloldalakról (ÉÉÉÉ/HH/NN.html) is működjön, az info.html-t a gyökérbe ÉS
  // minden olyan könyvtárba kiírjuk, ahol jelentés-oldal van.
  const infoHtml = renderInfoPage();
  const infoDirs = new Set(["."]);
  for (const rel of files) infoDirs.add(dirname(rel));
  for (const dir of infoDirs) {
    const destDir = join(distDir, dir);
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "info.html"), infoHtml);
  }

  return { files, latest };
}
