// Google Gemini REST adapter (generateContent). Séma esetén JSON-mime kényszer;
// a séma-ellenőrzés a complete()-ben történik.

import { httpError, LLM_TIMEOUT_MS } from "./errors.js";

export async function geminiRest({ apiKey, model, prompt, schema, endpoint, fetchImpl = fetch, timeoutMs = LLM_TIMEOUT_MS }) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: schema ? { response_mime_type: "application/json" } : {},
  };
  // A kulcs HEADERBEN megy (nem query-stringben) — így egy hálózati hiba
  // URL-je sem tartalmazza, nem szivárog a publikus láblécbe.
  const url = `${endpoint}/models/${model}:generateContent`;

  // Per-hívás időkorlát (a0ad31a mintája az LLM-rétegre): egy AbortController fedi a
  // FEJLÉC-megérkezést ÉS a TÖRZS-olvasást — a timert csak a json() UTÁN töröljük, mert
  // egy beragadó body-stream a fetch signaljára abortál (a bare fetch enélkül percekig lógott).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw await httpError(res, "gemini");

    const json = await res.json();
    return finishGemini(json);
  } finally {
    clearTimeout(timer);
  }
}

function finishGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? "").join("");
  // Token-mérés (backfill-headroom): a generateContent visszaadja a usageMetadata-t;
  // normalizálva {input,output,total}. Hiánynál undefined — a hívó nem számol vele.
  const u = json?.usageMetadata;
  const usage = u ? { input_tokens: u.promptTokenCount ?? 0, output_tokens: u.candidatesTokenCount ?? 0, total_tokens: u.totalTokenCount ?? 0 } : undefined;
  return { text, usage };
}
