// Google Gemini REST adapter (generateContent). Séma esetén JSON-mime kényszer;
// a séma-ellenőrzés a complete()-ben történik.

import { httpError } from "./errors.js";

export async function geminiRest({ apiKey, model, prompt, schema, endpoint, fetchImpl = fetch }) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: schema ? { response_mime_type: "application/json" } : {},
  };
  // A kulcs HEADERBEN megy (nem query-stringben) — így egy hálózati hiba
  // URL-je sem tartalmazza, nem szivárog a publikus láblécbe.
  const url = `${endpoint}/models/${model}:generateContent`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, "gemini");

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? "").join("");
  return { text };
}
