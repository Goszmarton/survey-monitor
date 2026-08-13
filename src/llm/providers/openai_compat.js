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
  // json_object CSAK object-gyökerű sémánál: a mód objektum-gyökeret kényszerít,
  // egy TÖMB-gyökerű séma (pl. TRIAGE_SCHEMA) esetén a modell kénytelen objektumba
  // csomagolni → validáció "root: várt array"-jel bukik (8 nap alatt 2/2 Groq-hívás
  // így hasalt el). Tömb-gyökérnél a response_format-ot elhagyjuk, a prompt utasítja
  // a JSON-tömböt, a complete() extractJson-je pedig a szövegből is kinyeri.
  if (schema && schema.type !== "array") body.response_format = { type: "json_object" };

  const res = await fetchImpl(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, "openai_compat");

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  // Token-mérés (backfill-headroom): az OpenAI-kompatibilis válasz usage-objektuma;
  // normalizálva {input,output,total}. Hiánynál undefined — a hívó nem számol vele.
  const u = json?.usage;
  const usage = u ? { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens ?? 0 } : undefined;
  return { text, usage };
}
