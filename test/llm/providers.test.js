import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiCompat } from "../../src/llm/providers/openai_compat.js";
import { geminiRest } from "../../src/llm/providers/gemini.js";
import { anthropic } from "../../src/llm/providers/anthropic.js";

function resp(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

test("openai_compat: chat/completions → message.content", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return resp({ choices: [{ message: { content: "SZÖVEG" } }] }); };
  const r = await openaiCompat({ apiKey: "k", model: "llama", prompt: "p", endpoint: "https://api.groq.com/openai/v1", fetchImpl });
  assert.equal(r.text, "SZÖVEG");
  assert.match(seen.url, /\/chat\/completions$/);
  assert.equal(JSON.parse(seen.init.body).model, "llama");
  assert.match(seen.init.headers.Authorization, /^Bearer k$/);
});

test("openai_compat: OBJECT-gyökerű séma → json_object mód", async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return resp({ choices: [{ message: { content: "{}" } }] }); };
  await openaiCompat({ apiKey: "k", model: "m", prompt: "p", schema: { type: "object" }, endpoint: "e", fetchImpl });
  assert.equal(body.response_format.type, "json_object");
});

test("openai_compat: TÖMB-gyökerű séma → NINCS json_object (különben 'root: várt array'-jel bukna)", async () => {
  // Regresszió (#5): a json_object objektum-gyökeret kényszerít; a TRIAGE_SCHEMA gyökere
  // tömb → 8 nap alatt 2/2 Groq-hívás így hasalt el. Tömb-gyökérnél nem küldünk response_format-ot.
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return resp({ choices: [{ message: { content: "[]" } }] }); };
  await openaiCompat({ apiKey: "k", model: "m", prompt: "p", schema: { type: "array" }, endpoint: "e", fetchImpl });
  assert.equal(body.response_format, undefined);
});

test("openai_compat: HTTP-hiba → dobás státuszkóddal", async () => {
  const fetchImpl = async () => resp({ error: "rate" }, { ok: false, status: 429 });
  await assert.rejects(
    openaiCompat({ apiKey: "k", model: "m", prompt: "p", endpoint: "e", fetchImpl }),
    (err) => err.status === 429,
  );
});

test("gemini_rest: generateContent → parts[0].text, kulcs headerben (nem URL-ben)", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return resp({ candidates: [{ content: { parts: [{ text: "GEMINI" }] } }] }); };
  const r = await geminiRest({ apiKey: "KEY", model: "gemini-2.5-flash", prompt: "p", endpoint: "https://gen.googleapis.com/v1beta", fetchImpl });
  assert.equal(r.text, "GEMINI");
  assert.match(seen.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.ok(!seen.url.includes("KEY"), "a kulcs NEM az URL-ben van");
  assert.equal(seen.init.headers["x-goog-api-key"], "KEY");
});

test("gemini_rest: séma esetén application/json mime", async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return resp({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }); };
  await geminiRest({ apiKey: "k", model: "m", prompt: "p", schema: { type: "array" }, endpoint: "e", fetchImpl });
  assert.equal(body.generationConfig.response_mime_type, "application/json");
});

test("gemini_rest: HTTP-hiba → dobás státuszkóddal", async () => {
  const fetchImpl = async () => resp({ error: {} }, { ok: false, status: 503 });
  await assert.rejects(
    geminiRest({ apiKey: "k", model: "m", prompt: "p", endpoint: "e", fetchImpl }),
    (err) => err.status === 503,
  );
});

test("anthropic: injektált klienssel → text blokkok összefűzve", async () => {
  const client = { messages: { create: async () => ({ content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }) } };
  const r = await anthropic({ apiKey: "k", model: "claude-haiku-4-5", prompt: "p", client });
  assert.equal(r.text, "AB");
});

test("anthropic: a kliens hibája (státusszal) propagálódik", async () => {
  const client = { messages: { create: async () => { throw Object.assign(new Error("rate"), { status: 429 }); } } };
  await assert.rejects(
    anthropic({ apiKey: "k", model: "m", prompt: "p", client }),
    (err) => err.status === 429,
  );
});

// Token-mérés (backfill-headroom, cost_estimate F4): az adapterek a válasz-body
// token-számait NORMALIZÁLVA adják vissza ({input_tokens, output_tokens,
// total_tokens}) — eddig eldobták. A hívó (complete) a naplóba fűzi. Hiányzó
// usage-mező (régi válasz / degradált) → usage undefined, a text NEM törik.

test("openai_compat: usage → normalizált token-számok", async () => {
  const fetchImpl = async () => resp({ choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  const r = await openaiCompat({ apiKey: "k", model: "m", prompt: "p", endpoint: "e", fetchImpl });
  assert.deepEqual(r.usage, { input_tokens: 100, output_tokens: 20, total_tokens: 120 });
});

test("gemini_rest: usageMetadata → normalizált token-számok", async () => {
  const fetchImpl = async () => resp({ candidates: [{ content: { parts: [{ text: "x" }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30, totalTokenCount: 230 } });
  const r = await geminiRest({ apiKey: "k", model: "m", prompt: "p", endpoint: "e", fetchImpl });
  assert.deepEqual(r.usage, { input_tokens: 200, output_tokens: 30, total_tokens: 230 });
});

test("anthropic: usage → normalizált token-számok (total = input+output)", async () => {
  const client = { messages: { create: async () => ({ content: [{ type: "text", text: "A" }], usage: { input_tokens: 150, output_tokens: 40 } }) } };
  const r = await anthropic({ apiKey: "k", model: "m", prompt: "p", client });
  assert.deepEqual(r.usage, { input_tokens: 150, output_tokens: 40, total_tokens: 190 });
});

test("gemini_rest: hiányzó usageMetadata → usage undefined, a text nem törik", async () => {
  const fetchImpl = async () => resp({ candidates: [{ content: { parts: [{ text: "x" }] } }] });
  const r = await geminiRest({ apiKey: "k", model: "m", prompt: "p", endpoint: "e", fetchImpl });
  assert.equal(r.text, "x");
  assert.equal(r.usage, undefined);
});
