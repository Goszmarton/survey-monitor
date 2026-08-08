import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const by = (id) => sources.find((s) => s.id === id);

// A `revisit` REGISZTER-mező (a fetcher NEM olvassa) egy jövőbeli felülvizsgálati politikát kódol:
// "never" = a FORRÁS megszűnt, sose nézd újra; "if-republishes" = a szervezet ÉL, de a csatorna
// halott/nincs → érdemes időnként újranézni; "active"/elhagyva = bekötött. Létjogosultsága: a
// MEGSZŰNT szabadeu (2025-11-20) és az ÉLŐ, halott-csatornás zavecz NEM ugyanaz az állapot — ezt
// egy `status`-mező (mindkettő üres/stale-jellegű) nem különbözteti meg. Ezt EGY teszt mondja ki.
test("revisit-séma: a megszűnt szabadeu (never) ≠ az élő-csatorna-halott zavecz (if-republishes)", () => {
  assert.equal(by("szabadeu").revisit, "never", "szabadeu = never (a szervezet megszűnt 2025-11-20)");
  assert.equal(by("zavecz").revisit, "if-republishes", "zavecz = if-republishes (intézet él, csatorna halott)");
  assert.notEqual(by("szabadeu").revisit, by("zavecz").revisit, "a két állapot a regiszterben elkülönül");
});

// last_content: a legutóbbi VALÓS tétel ISO-dátuma (ahol mértük) — egy mechanikus STALE-sweep
// alapja, a szöveges note elolvasása nélkül.
test("revisit-séma: last_content a felmért forrásokon a mért dátum", () => {
  assert.equal(by("szabadeu").last_content, "2025-11-20");
  assert.equal(by("zavecz").last_content, "2023-09-27");
  assert.equal(by("realpr93").last_content, "2026-02-09");
  assert.equal(by("nezopont").last_content, "2026-04-13");
});
