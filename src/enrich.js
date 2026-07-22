// F2 orchestráció: a begyűjtött, frissesség-számolt tételeket triázzsal és
// szintézissel gazdagítja. Tesztelhető mag — a run.js és az e2e-teszt is ezt
// hívja, injektált completeFn-nel (offline). Degradáció: ha minden provider
// kiesik, triageDegraded=true → a jelentés F1-módban (nyersen) megy ki.

import { triageItems } from "./triage.js";
import { synthesize } from "./synthesis.js";
import { applyTriage } from "./state/db.js";

/**
 * @param {object} p
 * @param {import('node:sqlite').DatabaseSync} p.db
 * @param {Array}  p.items          finalizeFreshness kimenete (snake_case sorok)
 * @param {function} p.completeFn   (role, prompt, {schema, log}) → {data|text}|null
 * @param {object} p.prefilterCfg
 * @param {Array}  [p.providersUsed]
 * @returns {Promise<{items:Array, synthesisText:string|null, kiemeltCount:number, triageDegraded:boolean}>}
 */
export async function enrichWithTriage({ db, items, completeFn, prefilterCfg, providersUsed = [] }) {
  // Csak a még nem triázolt tételeket adjuk az LLM-nek (új + korábban kimaradt).
  const candidates = items.filter((it) => !it.triage_json);
  const { verdicts, degraded } = await triageItems(candidates, { completeFn, prefilterCfg, log: providersUsed });

  applyTriage(db, verdicts);

  // Verdiktek beolvasztása a memóriabeli tétellistába (a DB-sorok különben elavulnának).
  for (const it of items) {
    const v = verdicts.get(it.canonical_key);
    if (v) {
      it.significance = v.significance;
      it.relevant = v.relevant ? 1 : 0;
      it.triage_reason = v.reason;
    }
  }

  // Szintézis csak nem-degradált esetben, a friss + jelentős tételekből.
  const relevantFresh = items.filter((it) => it.relevant === 1 && it.freshness === "UJ_24H");
  const synth = degraded ? null : await synthesize(relevantFresh, { completeFn, log: providersUsed });

  const kiemeltCount = items.filter((it) => it.relevant === 1 && it.significance === "KIEMELT").length;

  return { items, synthesisText: synth?.text ?? null, kiemeltCount, triageDegraded: degraded };
}
