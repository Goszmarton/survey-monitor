import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openaiCompat } from "../../src/llm/providers/openai_compat.js";
import { geminiRest } from "../../src/llm/providers/gemini.js";
import { LLM_TIMEOUT_MS } from "../../src/llm/providers/errors.js";

// REGRESSZIÓ (2026-08-26 step-timeout bukás): az LLM-adapterek `fetch`-et hívtak
// timeout/AbortController NÉLKÜL — szemben a forrás-réteggel (sources/http.js, a0ad31a).
// A tartósan degradált gemini (a triázs-lánc ELSŐ szeme) beragadó kapcsolata így
// batchenként az undici-defaultig függött; a triázs 25 perc alatt sem végzett, a
// step-timeout ölte a futást (⏱ fázis "collect": 6.6s után SEMMI). A javítás: bounded
// per-call timeout, ami — mint a httpGet — a FEJLÉC- ÉS a TÖRZS-olvasást is fedi.

// Signal-tudatos beragadó mock: a FEJLÉC sose érkezik, DE az abort-signalra elenged.
// (Egy signalt IGNORÁLÓ mock sose abortálna → a teszt a fix után is függne; ez a mock
// épp azt kényszeríti ki, hogy az adapter átadja a signalt ÉS időzítsen rá abortot.)
const stalledHeaders = (_url, init) =>
  new Promise((_res, rej) =>
    init?.signal?.addEventListener?.("abort", () =>
      rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
    ),
  );

// Signal-tudatos: a fejléc megvan (ok:true), de a TÖRZS (json) ragad be; abortra elenged.
const stalledBody = (_url, init) => Promise.resolve({
  ok: true,
  status: 200,
  headers: new Map(),
  text: async () => "",
  json: () =>
    new Promise((_res, rej) =>
      init?.signal?.addEventListener?.("abort", () =>
        rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
      ),
    ),
});

const isAbort = (e) => e?.name === "AbortError" || /abort/i.test(String(e?.message ?? e));

test("errors.js: van megosztott LLM_TIMEOUT_MS konstans (bounded, nem végtelen)", () => {
  assert.equal(typeof LLM_TIMEOUT_MS, "number");
  assert.ok(LLM_TIMEOUT_MS > 0 && LLM_TIMEOUT_MS <= 60_000, "értelmes felső korlát (≤60s)");
});

for (const [name, adapter] of [["gemini_rest", geminiRest], ["openai_compat", openaiCompat]]) {
  test(`${name}: beragadó FEJLÉC az időkorlátnál megszakad (nem függ örökké)`, { timeout: 3000 }, async () => {
    await assert.rejects(
      adapter({ apiKey: "k", model: "m", prompt: "p", schema: { type: "array" }, endpoint: "e", fetchImpl: stalledHeaders, timeoutMs: 60 }),
      isAbort,
    );
  });

  test(`${name}: beragadó TÖRZS (json) is megszakad az időkorlátnál (a0ad31a a törzsre is)`, { timeout: 3000 }, async () => {
    await assert.rejects(
      adapter({ apiKey: "k", model: "m", prompt: "p", endpoint: "e", fetchImpl: stalledBody, timeoutMs: 60 }),
      isAbort,
    );
  });
}

// Anthropic: a hivatalos SDK-t használja (nincs saját fetch), ezért a timeoutot a
// kliens-konstrukcióban adjuk át. Injektált klienssel ez nem mérhető viselkedésben
// (a teszt saját mock-klienst ad), ezért strukturálisan igazoljuk, hogy a valódi
// kliens bounded timeoutot kap (a régi SDK-default 10 perc — 13 batchen túl sok).
test("anthropic.js: a valódi SDK-kliens bounded timeoutot kap (LLM_TIMEOUT_MS)", () => {
  const src = readFileSync(new URL("../../src/llm/providers/anthropic.js", import.meta.url), "utf8");
  assert.match(src, /new Anthropic\(\s*\{[^}]*timeout[^}]*\}/s, "az Anthropic konstruktor timeoutot kap");
  assert.match(src, /LLM_TIMEOUT_MS/, "a megosztott LLM_TIMEOUT_MS-t használja");
});
