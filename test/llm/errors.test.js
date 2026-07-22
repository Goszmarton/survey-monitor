import { test } from "node:test";
import assert from "node:assert/strict";
import { httpError, redactSecrets } from "../../src/llm/providers/errors.js";

test("redactSecrets: query-string kulcs maszkolva", () => {
  const out = redactSecrets("fetch failed: https://x/models/m:generateContent?key=sk-SECRET123");
  assert.ok(!out.includes("sk-SECRET123"));
  assert.match(out, /key=\*\*\*/);
});

test("redactSecrets: Bearer token és api_key maszkolva", () => {
  assert.ok(!redactSecrets("Authorization: Bearer gsk_ABC.def-123").includes("gsk_ABC.def-123"));
  assert.ok(!redactSecrets("...&api_key=KEYVAL999&...").includes("KEYVAL999"));
});

test("httpError: a válasz-törzsbe visszhangzott kulcs sem szivárog ki", async () => {
  const key = "AIzaSECRETKEY";
  const res = {
    status: 400,
    text: async () => `Bad request for ?key=${key}`,
  };
  const err = await httpError(res, "gemini");
  assert.equal(err.status, 400);
  assert.ok(!err.message.includes(key), "az apiKey értéke soha nem lehet az üzenetben");
  assert.match(err.message, /key=\*\*\*/);
});
