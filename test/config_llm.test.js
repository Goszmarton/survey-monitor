import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config/llm.json", import.meta.url)), "utf8"));

// A Groq által LEÁLLÍTOTT modellek (docs/deprecations, mérve groq-limits-probe 2026-08-17).
// BŐVÍTENDŐ, amikor a napi providers_used magas groq-404-rátát mutat (új leállás jele).
// Fail-closed guard: ha a triázs groq-láncszeme ezek EGYIKÉRE hivatkozik, a teszt BUKIK — így
// egy leállt modell nem futhat be némán 404-be (2026-08-17: a llama-3.3-70b-versatile 13×404-et
// adott némán, és a FIZETŐS anthropic-fallback vitte az egész triázst).
const GROQ_DEPRECATED = new Set([
  "llama-3.3-70b-versatile", // shutdown 2026-08-16
  "llama-3.1-8b-instant",    // shutdown 2026-08-16
]);

const groqLinks = (cfg) =>
  Object.entries(cfg.roles).flatMap(([role, r]) =>
    (r.chain ?? []).filter((l) => l.provider === "groq").map((l) => ({ role, model: l.model })));

test("llm-config: egyetlen groq-láncszem sem hivatkozik LEÁLLÍTOTT modellre (korai bukás a néma 404 helyett)", () => {
  const offenders = groqLinks(cfg).filter((m) => GROQ_DEPRECATED.has(m.model));
  assert.deepEqual(offenders, [], `leállított groq-modell(ek) a configban: ${offenders.map((o) => `${o.role}:${o.model}`).join(", ")}`);
});

test("llm-config: a triázs groq-modellje a verifikált openai/gpt-oss-120b (groq-limits-probe 2026-08-17)", () => {
  const groq = cfg.roles.triage.chain.find((l) => l.provider === "groq");
  assert.ok(groq, "van groq láncszem a triázsban");
  assert.equal(groq.model, "openai/gpt-oss-120b");
});
