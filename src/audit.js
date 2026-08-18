// Néma provider-degradáció + MAIL_TO-guard AUDIT → providers_used WARN-bejegyzések.
//
// A 08-16/08-17-i eset: a groq deprecated modellje 13× HTTP_404-et adott, és a FIZETŐS
// anthropic fallback NÉMÁN elvitte a triázs-batcheket. Csak kézi Actions-log-belenézéssel
// derült ki. Ez a napi verifikáció FIX pontja: a kérdés minden nap "a triázst a KONFIGURÁLT
// (ingyenes) provider vitte-e, vagy fizetős fallbackre esett?" — a válasz a providers_used-ből
// olvasható, és a jelentés-lábléc (renderReport) automatikusan kiírja (nem kell kézzel nézni).
//
// Egy megoldás fedi a MAIL_TO-guard residualt is (F4): a parseRecipients warningjai eddig csak
// console.warn-ba mentek — ugyanaz a "csak a log látja" minta. Mindkettő ugyanabba a providers_used
// WARN-csatornába kerül.

import { parseRecipients } from "./email.js";

// A fizetős fallback: BOTH ingyenes provider (gemini, groq) elbukott, ha ide esett. Steady-state 0.
const PAID_PROVIDERS = new Set(["anthropic"]);
// A user szerint >2 fölött riasztunk: tranziens 1-2 batch (ritka ingyenes-kiesés) nem zaj.
const PAID_FALLBACK_ALERT = 2;

/**
 * A triázs-szerep provider-naplójának auditja.
 * @param {Array} log providers_used bejegyzések ({role, provider, status, usage?})
 * @returns {{carrier:string|null, okBy:object, groq404:number, paidBatches:number, warnings:string[]}}
 */
export function auditTriageProviders(log = []) {
  const triage = log.filter((e) => e && e.role === "triage");
  const okBy = {};
  let groq404 = 0;
  let paidBatches = 0;
  for (const e of triage) {
    if (e.status === "OK") {
      okBy[e.provider] = (okBy[e.provider] ?? 0) + 1;
      if (PAID_PROVIDERS.has(e.provider)) paidBatches++;
    }
    // HTTP_404 a groq-on = a modell nincs meg (deprecation), NEM rate-limit (429). Bármely 404 jelez.
    if (e.provider === "groq" && e.status === "HTTP_404") groq404++;
  }
  const carrier = Object.entries(okBy).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const warnings = [];
  if (groq404 > 0) {
    warnings.push(`groq ${groq404}× HTTP_404 a triázson — modell-deprecation gyanú, config-váltás kell`);
  }
  if (paidBatches > PAID_FALLBACK_ALERT) {
    warnings.push(`fizetős fallback (${[...PAID_PROVIDERS].join(", ")}) vitte a triázs ${paidBatches} batch-ét — az ingyenes providerek elbuktak (néma degradáció)`);
  }
  return { carrier, okBy, groq404, paidBatches, warnings };
}

/**
 * A MAIL_TO-guard warningjai (pontosvessző, gyanús cím, szétbontás-utáni üres) felszínre hozva.
 * A "nincs beállítva" esetet NEM jelezzük: lokális/SMTP-nélküli futásban ez normál, nem degradáció.
 * @param {object} env alap: process.env
 * @returns {string[]}
 */
export function auditMailTo(env = process.env) {
  if (env?.MAIL_TO == null) return []; // beállítatlan → nincs lábléc-zaj
  const { warnings } = parseRecipients(env.MAIL_TO);
  return warnings;
}

/**
 * Egy hívás, ami mindkét auditot lefuttatja és providers_used-kompatibilis WARN-bejegyzéseket ad.
 * A hívó (run.js) a renderReport ELŐTT fűzi a providersUsed-be → a lábléc automatikusan kiírja,
 * és a finishRun perzisztálja (runs.providers_used).
 * @param {object} p
 * @param {Array}  p.log providers_used eddigi bejegyzései (triázs-naplóval)
 * @param {object} [p.env]
 * @returns {Array<{role:string, status:'WARN', detail:string}>}
 */
export function auditProviders({ log = [], env = process.env } = {}) {
  const entries = [];
  for (const detail of auditTriageProviders(log).warnings) {
    entries.push({ role: "triage", status: "WARN", detail });
  }
  for (const detail of auditMailTo(env)) {
    entries.push({ role: "mail", status: "WARN", detail });
  }
  return entries;
}
