// provider.type → adapter leképezés a complete() számára.
import { anthropic } from "./anthropic.js";
import { geminiRest } from "./gemini.js";
import { openaiCompat } from "./openai_compat.js";

export const adapters = {
  anthropic,
  gemini_rest: geminiRest,
  openai_compat: openaiCompat, // Groq + OpenRouter
};
