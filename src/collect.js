// Gyűjtés-orchesztráció (A-kaszt). Forrásonként izolált: egy forrás hibája
// nem dönti el a futást (spec: a jelentés sosem marad el, a napló magától igaz).
// I/O-mentes mag — a dist-írás és email a run.js-ben; ez tesztelhető injektált
// fetchImpl-lel, temp DB-vel.

import { canonicalKey } from "./lib/slug.js";
import * as rss from "./sources/rss.js";
import * as htmllist from "./sources/htmllist.js";
import * as europeelects from "./sources/europeelects.js";
import * as eurobarometer from "./sources/eurobarometer.js";
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

// Aktív forrás: (1) A-kaszt, verifikált feed VAGY list_url (a generikus RSS/HTML út), VAGY
// (2) dedikált adapterrel + status "OK" (E2: europeelects — kaszt B, de determinista gépi
// csatornája van, a channelsOf az adapterre routol). A (2) status-guardja FAIL-CLOSED: az
// adapter önmagában NEM aktivál, csak OK mellett — egy NEM_AKTIVALT/hibás adapter-forrás kimarad.
// Az (1) ág SZÁNDÉKOSAN status-független: a MEGSZUNT/HIBA_TARTOS A-források bekötve maradnak,
// számítanak a forrásszámba, a source_check naplózza a részlegességet (nem tűnhetnek el némán,
// CLAUDE.md 2). A run.js loadSources ezt hívja; a collect() KIZÁRÓLAG az így kiválasztott
// forrásokat kapja — ezért tesztelhető külön, hogy egy config-bejegyzés bekerül-e a gyűjtésbe.
export const isActiveSource = (s) =>
  (s.kaszt === "A" && Boolean(s.feed || s.list_url)) ||
  (Boolean(s.adapter) && s.status === "OK");
export const selectActiveSources = (sources) => sources.filter(isActiveSource);

// Forrás-szintű cím/leírás-szűrő (opcionális `source.title_filter: string[]`). Ahol egy forrás
// szerkezetileg sok irreleváns tételt ad (pl. Pew Research: ~minden cikk amerikai belpolitika),
// a kulcsszó-lista a FORRÁSRA szűkíti a bevitelt. Szándékosan NEM a triage.json globális
// kulcsszavai közé kerül — az MINDEN forrásra hatna; ez csak arra, amelyiknek van ilyen mezője.
// ILLESZTÉS: RÉSZSZÓ (includes), kisbetűsítve, a cím ÉS a leírás (summary) egyesített szövegén —
// így a "magyar" illeszkedik a "Magyarország"/"magyarok"-ra is (szó-határnál kimaradnának). A
// "hungary" és a "hungarian" KÜLÖN kell: a "hungary" NEM fedi le a "hungarian"/"Hungarians"-t
// (a 7. betű i≠y), empirikusan igazolva valós archív Pew-címen. A szűrés a dedup/upsert ELŐTT fut, és a source_check
// detailjében látható marad ("cím-szűrő: N→M") — nincs csendes eltűnés (CLAUDE.md 2). A cél a
// CÍM-szintű magyar relevancia; a "rejtett magyar adat" (globális kutatás, ahol Magyarország
// csak az adattáblában van) NEM ez az ág — az az agentikus/kétlépcsős pipeline dolga.
export function matchesTitleFilter(item, keywords) {
  const hay = `${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase();
  return keywords.some((k) => hay.includes(String(k).toLowerCase()));
}
export function applyTitleFilter(items, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return items;
  return items.filter((it) => matchesTitleFilter(it, keywords));
}

// Dedikált forrás-adapterek (nem a generikus feed/list_url út): source.adapter → modul.
// A modul a htmllist/rss-sel azonos szerződést teljesíti: fetchNew(source, opts) → {items, check}.
const ADAPTERS = { europeelects, eurobarometer };

// Egy forrásnak több csatornája is lehet: verifikált RSS ÉS HTML-listaoldal
// (pl. Eurostat: katalógus-feed + euro-indicators lista). Mindkettőt lekérjük.
// Ha a forrásnak dedikált adaptere van (source.adapter), az az EGYETLEN csatorna: a
// list_url-t az adapter birtokolja (saját parse), a generikus htmllist NEM indul mellette.
// A `adapters` registry INJEKTÁLHATÓ (default a valós ADAPTERS): egy új dedikált forrás
// routingja így FAKE adapterrel tesztelhető, a modul valós I/O-ja nélkül (B2-előkészítés).
// Ismeretlen adapter → üres lista (fail-closed): a collect HIBA-t naplóz, NEM esik vissza
// némán a generikus feed/list_url útra (a dedikált forrás explicit szerződést vár).
export function channelsOf(source, adapters = ADAPTERS) {
  if (source.adapter) {
    const a = adapters[source.adapter];
    return a ? [{ name: source.adapter, fetcher: a }] : [];
  }
  const ch = [];
  if (source.feed) ch.push({ name: "feed", fetcher: rss });
  if (source.list_url) ch.push({ name: "lista", fetcher: htmllist });
  return ch;
}

// Kombinált státusz több csatornából: a „legjobb" nyer (van-e bárhol új?).
// SKIPPED_VALIDATION (E2, fail-closed forrás-validáció): a fetch SIKERÜLT, de a guard
// elutasította az adatot — ez NEM hálózati HIBA, ezért HIBA fölött rangsorolt (0,5), de
// bármely valódi adat (OK_*/RESZLEGES) felülírja. Enélkül a fail-closed skip HIBA-ként
// esne be a jelentésbe (undefined rank → sosem nyerne a "HIBA" init fölött).
const RANK = { OK_UJ: 3, OK_NINCS_UJ: 2, RESZLEGES: 1, SKIPPED_VALIDATION: 0.5, HIBA: 0 };
export const combineStatus = (statuses) =>
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
      let items = results.flatMap((r) => r.items);
      const status = combineStatus(results.map((r) => r.check.status));
      let detail = results.map((r) => `${r.name}: ${r.check.detail}`).join(" · ");
      // Opcionális forrás-szintű cím/leírás-szűrő (a dedup ELŐTT; a napló rögzíti az arányt).
      if (Array.isArray(source.title_filter) && source.title_filter.length) {
        const before = items.length;
        items = applyTitleFilter(items, source.title_filter);
        detail += ` · cím-szűrő: ${before}→${items.length}`;
      }
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
