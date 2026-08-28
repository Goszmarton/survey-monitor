import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesize, numberTokens } from "../src/synthesis.js";

const NUM_ITEMS = [
  { title: "A bruttó átlagkereset 754 700 forint volt júniusban", source_id: "ksh", significance: "FONTOS", freshness: "UJ_24H" },
  { title: "3,7-ről 7,5 százalékosra emeli az éves hiánycélt a kormány", source_id: "hvg", significance: "KIEMELT", freshness: "UJ_24H" },
];

test("numberTokens: a címekből kiszedi a szám-tokeneket (ezres-szóköz, tizedes-vessző, %)", () => {
  const t = numberTokens("A bruttó átlagkereset 754 700 forint; a hiánycél 7,5 százalék, azaz 7,5%");
  const norm = t.map((s) => s.replace(/[\s ]/g, ""));
  assert.ok(norm.includes("754700"), "754 700 → 754700");
  assert.ok(norm.includes("7,5"), "7,5 token megvan");
});

test("szintézis-prompt: tartalmazza az engedélyezett számok whitelistjét a címekből", async () => {
  let seen = "";
  const completeFn = async (role, prompt) => { seen = prompt; return { text: "Ma emelkedtek a bérek.", provider: "x", model: "y" }; };
  await synthesize(NUM_ITEMS, { completeFn, log: [] });
  assert.match(seen, /754 700/, "a 754 700 a whitelistben");
  assert.match(seen, /7,5/, "a 7,5 a whitelistben");
});

test("szám-ellenőrzés: hallucinált szám → egy újragenerálás, a tiszta változat nyer", async () => {
  let calls = 0;
  const completeFn = async () => {
    calls++;
    // 1. hívás: a corpusban NEM szereplő 9,9% (hallucináció); 2. hívás: tiszta (7,5%)
    return calls === 1
      ? { text: "A hiánycélt 9,9 százalékra emelték.", provider: "x", model: "y" }
      : { text: "A hiánycélt 7,5 százalékra emelték.", provider: "x", model: "y" };
  };
  const r = await synthesize(NUM_ITEMS, { completeFn, log: [] });
  assert.equal(calls, 2, "egyszer újragenerált");
  assert.match(r.text, /7,5/, "a tiszta (igazolt) változat jött vissza");
  assert.ok(!/9,9/.test(r.text), "a hallucinált szám nincs a végeredményben");
});

test("szám-ellenőrzés: tartósan hallucinál → WARN a logba (audit), a szöveg visszajön", async () => {
  const log = [];
  const completeFn = async () => ({ text: "A hiánycélt 9,9 százalékra emelték.", provider: "x", model: "y" });
  const r = await synthesize(NUM_ITEMS, { completeFn, log });
  assert.ok(r && r.text, "kapunk szöveget (degradáció-biztos)");
  const warn = log.find((e) => e.role === "synthesis" && e.status === "WARN");
  assert.ok(warn, "van synthesis WARN az igazolatlan számról");
  assert.match(warn.detail, /9,9|igazolatlan|nem igazolt/i, "a WARN megnevezi az igazolatlan számot");
});

test("szám-ellenőrzés: csak igazolt számok → nincs újragenerálás", async () => {
  let calls = 0;
  const completeFn = async () => { calls++; return { text: "A kereset 754 700 forintra nőtt.", provider: "x", model: "y" }; };
  const r = await synthesize(NUM_ITEMS, { completeFn, log: [] });
  assert.equal(calls, 1, "egy hívás, nincs újragenerálás");
  assert.match(r.text, /754 700/);
});

const items = [
  { title: "Új pártpreferencia-kutatás", source_id: "telex", significance: "KIEMELT", freshness: "UJ_24H" },
  { title: "KSH inflációs adat", source_id: "ksh", significance: "FONTOS", freshness: "UJ_24H" },
];

test("van tétel + LLM válaszol → bekezdés szöveg", async () => {
  const completeFn = async (role, prompt) => {
    assert.equal(role, "synthesis");
    assert.match(prompt, /pártpreferencia/);
    return { text: "Ma két fontos tétel jelent meg.", provider: "anthropic", model: "claude-sonnet-5" };
  };
  const r = await synthesize(items, { completeFn, log: [] });
  assert.equal(r.text, "Ma két fontos tétel jelent meg.");
});

test("minden provider kiesik (SKIP) → null, a jelentés bekezdés nélkül megy ki", async () => {
  const completeFn = async () => null;
  const r = await synthesize(items, { completeFn, log: [] });
  assert.equal(r, null);
});

test("nincs releváns tétel → null, LLM-hívás nélkül", async () => {
  let called = false;
  const completeFn = async () => { called = true; return { text: "x" }; };
  const r = await synthesize([], { completeFn, log: [] });
  assert.equal(r, null);
  assert.equal(called, false);
});
