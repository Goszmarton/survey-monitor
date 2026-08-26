// OpenAI-kompatibilis chat/completions adapter (Groq, OpenRouter).
// Séma esetén json_object mód (a prompt tartalmazza a séma-utasítást); a
// tényleges séma-ellenőrzést a complete() végzi a validátorral.

import { httpError, LLM_TIMEOUT_MS } from "./errors.js";

// Rate-limit-mérés (groq-plafon): a groq (és az OpenRouter) MINDEN válaszban visszaadja az
// x-ratelimit-* headereket. Groq-szemantika: a request-headerek NAPI, a token-headerek PERCES
// limitre vonatkoznak. A plafon így passzív mérés nélkül, minden hívásból kiolvasható. Ha nincs
// header (pl. teszt-mock v. más provider) → undefined, a hívó nem számol vele. Neutrális
// mezőnevek (a napi/perces szemantika provider-függő, dokumentációban rögzítve).
function parseRateLimit(headers) {
  const g = (n) => headers?.get?.(n) ?? undefined;
  const num = (v) => (v == null ? undefined : Number(v));
  const rl = {
    requests_limit: num(g("x-ratelimit-limit-requests")),
    requests_remaining: num(g("x-ratelimit-remaining-requests")),
    requests_reset: g("x-ratelimit-reset-requests"),
    tokens_limit: num(g("x-ratelimit-limit-tokens")),
    tokens_remaining: num(g("x-ratelimit-remaining-tokens")),
    tokens_reset: g("x-ratelimit-reset-tokens"),
  };
  return Object.values(rl).some((v) => v !== undefined) ? rl : undefined;
}

export async function openaiCompat({ apiKey, model, prompt, schema, endpoint, fetchImpl = fetch, timeoutMs = LLM_TIMEOUT_MS }) {
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

  // Per-hívás időkorlát (a0ad31a mintája az LLM-rétegre): a signal fedi a fejléc- ÉS a
  // törzs-olvasást (a timert a json() UTÁN töröljük) — bare fetch enélkül percekig lógna.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw await httpError(res, "openai_compat");

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    // Token-mérés (backfill-headroom): az OpenAI-kompatibilis válasz usage-objektuma;
    // normalizálva {input,output,total}. Hiánynál undefined — a hívó nem számol vele.
    const u = json?.usage;
    const usage = u ? { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens ?? 0 } : undefined;
    const ratelimit = parseRateLimit(res.headers);
    return { text, usage, ratelimit };
  } finally {
    clearTimeout(timer);
  }
}
