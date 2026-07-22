import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "../src/synthesis.js";

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
