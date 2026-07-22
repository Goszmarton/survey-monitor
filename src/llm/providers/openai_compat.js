// OpenAI-kompatibilis chat/completions adapter (Groq, OpenRouter).
// Séma esetén json_object mód (a prompt tartalmazza a séma-utasítást); a
// tényleges séma-ellenőrzést a complete() végzi a validátorral.

import { httpError } from "./errors.js";

export async function openaiCompat({ apiKey, model, prompt, schema, endpoint, fetchImpl = fetch }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  };
  if (schema) body.response_format = { type: "json_object" };

  const res = await fetchImpl(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, "openai_compat");

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { text };
}
