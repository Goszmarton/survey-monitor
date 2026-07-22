// Anthropic adapter a hivatalos SDK-val. A séma-ellenőrzés a complete()-ben
// (uniform a providerek közt); a promptba a JSON-utasítás kerül.
// Megjegyzés: nem állítunk thinkinget — Haiku 4.5-nél nincs, Sonnet 5-nél
// adaptív alap; a rövid triázs/szintézis ezt nem igényli. A Sonnet 5 tokenizere
// ~30%-kal több tokent számol — ezt a költségbecslés veszi figyelembe.

import Anthropic from "@anthropic-ai/sdk";

export async function anthropic({ apiKey, model, prompt, client }) {
  const c = client ?? new Anthropic({ apiKey });
  const res = await c.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (res.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text };
}
