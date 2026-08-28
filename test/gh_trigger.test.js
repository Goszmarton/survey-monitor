import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A szerver-oldali PRIMARY indító (scripts/gh-trigger.sh) az owner/repo-t a git remote-ból
// olvassa (nincs hardcode — a stated követelmény), és a workflow_dispatch dispatch-URL-t ebből
// építi. A rossz owner/repo = ROSSZ repót indítana → ezt teszttel guardoljuk. A DRY_RUN mód a
// curl (és a PAT) NÉLKÜL, csak a derivált slug-ot + URL-t írja ki — így CI-ben is fut, titok nélkül.

const SCRIPT = fileURLToPath(new URL("../scripts/gh-trigger.sh", import.meta.url));

function tempRepo(remoteUrl) {
  const dir = mkdtempSync(join(tmpdir(), "ghtrig-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", remoteUrl]);
  return dir;
}
const dryRun = (repoDir) =>
  execFileSync("bash", [SCRIPT], { env: { ...process.env, REPO_DIR: repoDir, DRY_RUN: "1" }, encoding: "utf8" });

test("gh-trigger: owner/repo a HTTPS remote-ból, helyes dispatch-URL", () => {
  const dir = tempRepo("https://github.com/Foo/bar.git");
  try {
    const out = dryRun(dir);
    assert.match(out, /slug=Foo\/bar\b/, "owner/repo a remote-ból");
    assert.match(out, /api\.github\.com\/repos\/Foo\/bar\/actions\/workflows\/monitor\.yml\/dispatches/, "helyes dispatch-URL");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("gh-trigger: owner/repo az SSH remote-ból (git@github.com:Foo/bar.git) is", () => {
  const dir = tempRepo("git@github.com:Foo/bar.git");
  try {
    const out = dryRun(dir);
    assert.match(out, /slug=Foo\/bar\b/, "SSH-alakból is helyes owner/repo");
    assert.match(out, /repos\/Foo\/bar\/actions/, "helyes dispatch-URL SSH-remote-ból");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("gh-trigger: DRY_RUN nem curl-öz és PAT (TOKEN_FILE) nélkül sem bukik", () => {
  const dir = tempRepo("https://github.com/o/r.git");
  try {
    const out = dryRun(dir); // nincs TOKEN_FILE → DRY_RUN-ban akkor sem hasalhat el
    assert.match(out, /DRY_RUN/, "DRY_RUN-jelzés a kimenetben (nem történt hívás)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
