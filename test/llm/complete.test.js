import { test } from "node:test";
import assert from "node:assert/strict";
import { complete } from "../../src/llm/complete.js";

const CFG = {
  providers: {
    gemini: { type: "gemini_rest", env: "GEMINI_API_KEY", endpoint: "g" },
    groq: { type: "openai_compat", env: "GROQ_API_KEY", endpoint: "q" },
    anthropic: { type: "anthropic", env: "ANTHROPIC_API_KEY" },
  },
  roles: {
    triage: { chain: [{ provider: "gemini", model: "gm" }, { provider: "groq", model: "gq" }, { provider: "anthropic", model: "hk" }] },
    synthesis: { chain: [{ provider: "anthropic", model: "sn" }, { provider: "SKIP" }] },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
const okText = '{"ok":true}';

// adapter-gyár: típusonként megadott viselkedés (return text | throw {status})
function adapters(byType) {
  const wrap = (fn) => async (params) => fn(params);
  return Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, wrap(v)]));
}
const httpErr = (status) => () => { throw Object.assign(new Error("http"), { status }); };

test("happy: első provider valid JSON → data + OK napló", async () => {
  const log = [];
  const r = await complete("triage", "p", {
    schema: SCHEMA, llmConfig: CFG, env: { GEMINI_API_KEY: "k" },
    adapters: adapters({ gemini_rest: () => ({ text: okText }) }), log,
  });
  assert.deepEqual(r.data, { ok: true });
  assert.equal(r.provider, "gemini");
  assert.equal(log[0].status, "OK");
});

test("hiányzó kulcs → SKIPPED_NO_KEY, következő provider szolgál ki", async () => {
  const log = [];
  const r = await complete("triage", "p", {
    schema: SCHEMA, llmConfig: CFG, env: { GROQ_API_KEY: "k" }, // nincs GEMINI kulcs
    adapters: adapters({ openai_compat: () => ({ text: okText }) }), log,
  });
  assert.equal(r.provider, "groq");
  assert.equal(log[0].status, "SKIPPED_NO_KEY");
  assert.equal(log[0].provider, "gemini");
  assert.equal(log[1].status, "OK");
});

test("429 → HTTP_429 napló, lánc lép tovább", async () => {
  const log = [];
  const r = await complete("triage", "p", {
    schema: SCHEMA, llmConfig: CFG, env: { GEMINI_API_KEY: "k", GROQ_API_KEY: "k" },
    adapters: adapters({ gemini_rest: httpErr(429), openai_compat: () => ({ text: okText }) }), log,
  });
  assert.equal(r.provider, "groq");
  assert.equal(log[0].status, "HTTP_429");
});

test("sémahibás JSON → 1 retry, majd SCHEMA_FAIL és tovább", async () => {
  const log = [];
  let calls = 0;
  const r = await complete("triage", "p", {
    schema: SCHEMA, llmConfig: CFG, env: { GEMINI_API_KEY: "k", GROQ_API_KEY: "k" },
    adapters: adapters({
      gemini_rest: () => { calls++; return { text: '{"ok":"nem-bool"}' }; },
      openai_compat: () => ({ text: okText }),
    }), log,
  });
  assert.equal(calls, 2, "egy retry ugyanazon a provideren");
  assert.equal(log[0].status, "SCHEMA_FAIL");
  assert.equal(r.provider, "groq");
});

test("SKIP láncszem → null, SKIP napló (synthesis degradáció)", async () => {
  const log = [];
  const r = await complete("synthesis", "p", {
    llmConfig: CFG, env: {}, // nincs ANTHROPIC kulcs → SKIPPED_NO_KEY, majd SKIP
    adapters: adapters({}), log,
  });
  assert.equal(r, null);
  assert.equal(log.at(-1).status, "SKIP");
});

test("minden láncszem elbukik → null", async () => {
  const log = [];
  const r = await complete("triage", "p", {
    schema: SCHEMA, llmConfig: CFG, env: { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", ANTHROPIC_API_KEY: "k" },
    adapters: adapters({ gemini_rest: httpErr(500), openai_compat: httpErr(503), anthropic: httpErr(429) }), log,
  });
  assert.equal(r, null);
  assert.equal(log.length, 3);
});

test("séma nélküli szerep → text visszaadva", async () => {
  const log = [];
  const r = await complete("synthesis", "p", {
    llmConfig: CFG, env: { ANTHROPIC_API_KEY: "k" },
    adapters: adapters({ anthropic: () => ({ text: "Egy összefoglaló bekezdés." }) }), log,
  });
  assert.equal(r.text, "Egy összefoglaló bekezdés.");
  assert.equal(r.provider, "anthropic");
});
