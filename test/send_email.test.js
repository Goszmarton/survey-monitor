import { test } from "node:test";
import assert from "node:assert/strict";
import { isMirrorFresh, waitForMirror } from "../scripts/send-email.mjs";

// 2026-09-23: a levél a Pages-deploy + tükör-frissítés UTÁN megy ki (send-email.mjs), hogy a linkre
// (napihir tükör) kattintva a MAI jelentés jöjjön. A tükör frissülését megvárjuk, DE FAIL-OPEN: a
// türelmi idő letelte után is küldünk (a napi levél sosem maradhat el — ARCHITEKTURA/CLAUDE.md).

test("isMirrorFresh: a mai runId 'futás:' markerére illeszt, tegnapi archív-linkre NEM", () => {
  const runId = "2026-09-23";
  assert.equal(isMirrorFresh(`<div class="meta">futás: 2026-09-23 · generálva: ...</div>`, runId), true);
  // tegnapi oldal: csak egy előző-napi archív-LINKet tartalmaz, nem a mai "futás:" markert → nem friss
  assert.equal(isMirrorFresh(`futás: 2026-09-22 ... <a href="2026/09/23.html">`, runId), false);
  assert.equal(isMirrorFresh("", runId), false);
  assert.equal(isMirrorFresh(null, runId), false);
});

test("waitForMirror: friss tükörnél azonnal true (nincs fölösleges várakozás)", async () => {
  let fetches = 0, sleeps = 0;
  const ok = await waitForMirror({
    url: "https://x/", runId: "2026-09-23",
    fetchImpl: async () => { fetches++; return { text: async () => "futás: 2026-09-23 ·" }; },
    sleep: async () => { sleeps++; }, log: () => {},
  });
  assert.equal(ok, true);
  assert.equal(fetches, 1, "első próbán friss → egy lekérés");
  assert.equal(sleeps, 0, "nem várakozott");
});

test("waitForMirror: akkor tér vissza true-val, amikor a tükör frissül (közben pollozik)", async () => {
  let n = 0;
  const ok = await waitForMirror({
    url: "https://x/", runId: "2026-09-23", attempts: 5,
    fetchImpl: async () => { n++; return { text: async () => (n >= 3 ? "futás: 2026-09-23" : "futás: 2026-09-22") }; },
    sleep: async () => {}, log: () => {},
  });
  assert.equal(ok, true);
  assert.equal(n, 3, "a 3. próbán lett friss");
});

test("waitForMirror: FAIL-OPEN — a türelmi idő letelte után false (de a hívó ekkor is küld)", async () => {
  let fetches = 0, sleeps = 0;
  const ok = await waitForMirror({
    url: "https://x/", runId: "2026-09-23", attempts: 4,
    fetchImpl: async () => { fetches++; return { text: async () => "futás: 2026-09-22 (mindig tegnapi)" }; },
    sleep: async () => { sleeps++; }, log: () => {},
  });
  assert.equal(ok, false, "sosem frissült → false (fail-open jelzés)");
  assert.equal(fetches, 4, "minden próbát kihasznált");
  assert.equal(sleeps, 3, "attempts-1 várakozás a próbák közt");
});

test("waitForMirror: a lekérés-hibát TŰRI (retry), nem dob (fail-open az egész)", async () => {
  let n = 0;
  const ok = await waitForMirror({
    url: "https://x/", runId: "2026-09-23", attempts: 3,
    fetchImpl: async () => { n++; if (n < 2) throw new Error("ECONNRESET"); return { text: async () => "futás: 2026-09-23" }; },
    sleep: async () => {}, log: () => {},
  });
  assert.equal(ok, true, "az első hiba után a 2. próbán friss");
});
