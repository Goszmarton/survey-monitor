// Provider-absztrakció (F2). A hívó nem tud providerről: complete(role, prompt,
// {schema}) a config-lánc szerint próbálkozik. A séma a szerződés — bármelyik
// modell futtathatja a szerepet. Determinisztikus fallback-trigger:
//   402/429/5xx/hiba, vagy sémahibás JSON 1 retry után → következő láncszem.
// Hiányzó env-kulcs → némán kimarad (SKIPPED_NO_KEY). SKIP → a szerep kimarad.
// Minden lépés a `log` tömbbe kerül (→ runs.providers_used + jelentés-lábléc).

import { readFile } from "node:fs/promises";
import { validate, extractJson } from "./validate.js";
import { redactSecrets } from "./providers/errors.js";

let cachedConfig = null;
async function loadConfig() {
  if (!cachedConfig) {
    const raw = await readFile(new URL("../../config/llm.json", import.meta.url), "utf8");
    cachedConfig = JSON.parse(raw);
  }
  return cachedConfig;
}

let cachedAdapters = null;
async function loadDefaultAdapters() {
  if (!cachedAdapters) ({ adapters: cachedAdapters } = await import("./providers/index.js"));
  return cachedAdapters;
}

/**
 * @param {string} role
 * @param {string} prompt
 * @param {object} [opts]
 * @param {object} [opts.schema]      JSON-séma; ha van, a kimenet validálva (retry, majd tovább)
 * @param {object} [opts.llmConfig]   {providers, roles}; alap: config/llm.json
 * @param {object} [opts.adapters]    provider.type → adapter; alap: valódi adapterek
 * @param {object} [opts.env]         alap: process.env
 * @param {function}[opts.fetchImpl]  az adaptereknek átadva (teszthez injektálható)
 * @param {Array}  [opts.log]         provider-napló akkumulátor
 * @param {number} [opts.maxSchemaRetries] alap: 1
 * @returns {Promise<{data?:any,text?:string,provider:string,model:string}|null>}
 */
export async function complete(role, prompt, opts = {}) {
  const {
    schema,
    llmConfig = await loadConfig(),
    adapters = await loadDefaultAdapters(),
    env = process.env,
    fetchImpl,
    log = [],
    maxSchemaRetries = 1,
  } = opts;

  const roleCfg = llmConfig.roles?.[role];
  if (!roleCfg) throw new Error(`ismeretlen szerep: ${role}`);

  for (const link of roleCfg.chain) {
    if (link.provider === "SKIP") {
      log.push({ role, provider: "SKIP", status: "SKIP" });
      return null;
    }

    const pdef = llmConfig.providers[link.provider];
    if (!pdef) {
      log.push({ role, provider: link.provider, model: link.model, status: "ERROR", detail: "ismeretlen provider" });
      continue;
    }

    // .trim(): a beillesztett secret gyakran hordoz szóközt/újsort → 401. A trim
    // csak whitespace-t szed le; a whitespace-only kulcs továbbra is SKIPPED_NO_KEY.
    const apiKey = (env[pdef.env] ?? "").trim();
    if (!apiKey) {
      log.push({ role, provider: link.provider, model: link.model, status: "SKIPPED_NO_KEY" });
      continue;
    }

    const adapter = adapters[pdef.type];
    if (!adapter) {
      log.push({ role, provider: link.provider, model: link.model, status: "ERROR", detail: `nincs adapter: ${pdef.type}` });
      continue;
    }

    let attempt = 0;
    let advanced = false;
    while (attempt <= maxSchemaRetries && !advanced) {
      attempt++;
      try {
        const { text } = await adapter({ apiKey, model: link.model, prompt, schema, endpoint: pdef.endpoint, fetchImpl });

        if (!schema) {
          log.push({ role, provider: link.provider, model: link.model, status: "OK" });
          return { text, provider: link.provider, model: link.model };
        }

        const data = extractJson(text);
        const v = data == null ? { ok: false, errors: ["nem értelmezhető JSON"] } : validate(data, schema);
        if (v.ok) {
          log.push({ role, provider: link.provider, model: link.model, status: "OK" });
          return { data, provider: link.provider, model: link.model };
        }
        if (attempt > maxSchemaRetries) {
          log.push({ role, provider: link.provider, model: link.model, status: "SCHEMA_FAIL", detail: v.errors.slice(0, 3).join("; ") });
          advanced = true;
        }
        // különben: retry ugyanazon a provideren
      } catch (err) {
        const status = err?.status ? `HTTP_${err.status}` : "ERROR";
        // A detail publikus láblécbe kerülhet → titokmaszkolás (hálózati hiba URL-je is).
        log.push({ role, provider: link.provider, model: link.model, status, detail: redactSecrets(err?.message ?? "").slice(0, 120) });
        advanced = true; // bármilyen hiba → következő láncszem
      }
    }
  }

  return null; // minden láncszem kimerült → degradált (a hívó kezeli)
}
