// Anthropic adapter a hivatalos SDK-val. A séma-ellenőrzés a complete()-ben
// (uniform a providerek közt); a promptba a JSON-utasítás kerül.
// Megjegyzés: nem állítunk thinkinget — Haiku 4.5-nél nincs, Sonnet 5-nél
// adaptív alap; a rövid triázs/szintézis ezt nem igényli. A Sonnet 5 tokenizere
// ~30%-kal több tokent számol — ezt a költségbecslés veszi figyelembe.

import Anthropic from "@anthropic-ai/sdk";
import { LLM_TIMEOUT_MS } from "./errors.js";

export async function anthropic({ apiKey, model, prompt, client }) {
  // Bounded timeout a valódi kliensre: az SDK-default 10 perc — 13 batchen át túl sok
  // (2026-08-26 step-timeout tanulság). Injektált klienst (teszt) érintetlenül hagyunk.
  const c = client ?? new Anthropic({ apiKey, timeout: LLM_TIMEOUT_MS });
  const res = await c.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (res.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  // Token-mérés (backfill-headroom): az Anthropic usage input/output-ot ad, total nélkül;
  // normalizálva {input,output,total=input+output}. Hiánynál undefined.
  const u = res?.usage;
  const usage = u ? { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) } : undefined;
  return { text, usage };
}
