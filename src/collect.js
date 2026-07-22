// Gyűjtés-orchesztráció (A-kaszt). Forrásonként izolált: egy forrás hibája
// nem dönti el a futást (spec: a jelentés sosem marad el, a napló magától igaz).
// I/O-mentes mag — a dist-írás és email a run.js-ben; ez tesztelhető injektált
// fetchImpl-lel, temp DB-vel.

import { canonicalKey } from "./lib/slug.js";
import * as rss from "./sources/rss.js";
import * as htmllist from "./sources/htmllist.js";
import {
  upsertItems,
  recordSourceCheck,
  getSourceChecks,
  finalizeFreshness,
  countNewInRun,
} from "./state/db.js";

// config.kind → item.kind (spec 4. adatmodell). F1 A-kaszt: hivatalos + sajtó.
const KIND = { hivatalos: "hivatalos_adat", sajto: "sajto", intezet: "kutatas", nemzetkozi: "nemzetkozi" };

const WINDOW_DAYS = 14;

// Egy forrásnak több csatornája is lehet: verifikált RSS ÉS HTML-listaoldal
// (pl. Eurostat: katalógus-feed + euro-indicators lista). Mindkettőt lekérjük.
function channelsOf(source) {
  const ch = [];
  if (source.feed) ch.push({ name: "feed", fetcher: rss });
  if (source.list_url) ch.push({ name: "lista", fetcher: htmllist });
  return ch;
}

// Kombinált státusz több csatornából: a „legjobb" nyer (van-e bárhol új?).
const RANK = { OK_UJ: 3, OK_NINCS_UJ: 2, RESZLEGES: 1, HIBA: 0 };
const combineStatus = (statuses) =>
  statuses.reduce((best, s) => (RANK[s] > RANK[best] ? s : best), "HIBA");

/**
 * @param {object} p
 * @param {import('node:sqlite').DatabaseSync} p.db
 * @param {Array} p.sources     A-kaszt források (feed vagy list_url)
 * @param {number} p.now        futás ideje ms
 * @param {string} p.runId
 * @param {string} p.runStartedAt ISO — a first_seen_at ehhez igazodik
 * @param {number} p.since      ms — a fetch since-szűréshez (előző futás kezdete)
 * @param {function} [p.fetchImpl]
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{items:Array, sourceChecks:Array, newCount:number}>}
 */
export async function collect({ db, sources, now, runId, runStartedAt, since, fetchImpl, timeoutMs }) {
  const checkedAt = runStartedAt;

  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const channels = channelsOf(source);
      if (channels.length === 0) {
        return { source, items: [], status: "HIBA", detail: "nincs feed/list_url" };
      }
      const results = await Promise.all(
        channels.map(async (c) => {
          const { items, check } = await c.fetcher.fetchNew(source, { since, fetchImpl, timeoutMs });
          return { name: c.name, items, check };
        }),
      );
      const items = results.flatMap((r) => r.items);
      const status = combineStatus(results.map((r) => r.check.status));
      const detail = results.map((r) => `${r.name}: ${r.check.detail}`).join(" · ");
      return { source, items, status, detail };
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const source = sources[i];
    const res = settled[i];

    if (res.status === "rejected") {
      recordSourceCheck(db, { runId, sourceId: source.id, status: "HIBA", detail: String(res.reason?.message ?? res.reason), checkedAt });
      continue;
    }

    const { items, status: fetchStatus, detail: fetchDetail } = res.value;
    const enriched = items
      .map((it) => ({
        canonicalKey: canonicalKey(source.id, it),
        sourceId: source.id,
        kind: KIND[source.kind] ?? source.kind ?? null,
        title: it.title,
        url: it.url,
        publishedAt: it.publishedAt,
      }))
      .filter((it) => it.canonicalKey);

    const up = upsertItems(db, enriched, { seenAt: runStartedAt });
    const newN = up.filter((x) => x.isNew).length;

    // Ha a fetcher „új"-nak jelezte, de dedup után egyik sem új → becsületesen OK_NINCS_UJ.
    let status = fetchStatus;
    let detail = fetchDetail ?? "";
    if (status === "OK_UJ" && newN === 0) {
      status = "OK_NINCS_UJ";
      detail = `${detail} — dedup után 0 új`;
    } else if (status === "OK_UJ") {
      detail = `${detail} — ${newN} új a DB-be`;
    }
    recordSourceCheck(db, { runId, sourceId: source.id, status, detail, checkedAt });
  }

  const items = finalizeFreshness(db, { now, runStartedAt, windowStart: now - WINDOW_DAYS * 24 * 3600 * 1000 });
  const newCount = countNewInRun(db, { runStartedAt });
  const sourceChecks = getSourceChecks(db, runId);
  return { items, sourceChecks, newCount };
}
