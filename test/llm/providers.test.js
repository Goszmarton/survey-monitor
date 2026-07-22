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

test("openai_compat: séma esetén json_object mód", async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return resp({ choices: [{ message: { content: "{}" } }] }); };
  await openaiCompat({ apiKey: "k", model: "m", prompt: "p", schema: { type: "array" }, endpoint: "e", fetchImpl });
  assert.equal(body.response_format.type, "json_object");
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
