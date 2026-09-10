import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractDocumentMID,
  calendarJsonPath,
  parseMnbDate,
  calendarsToItems,
  fetchNew,
} from "../../src/sources/mnbpubnap.js";
import { selectActiveSources, channelsOf } from "../../src/collect.js";

// 2026-09-10 forrás-bővítés (user): MNB Statisztika publikációs naptár. A /pubnap Vue-SPA, a naptárt
// statikus JSON hordozza (/sw/content/<MID-utolsó-betű>/<MID>_mnbStatPortalPublicationCalendars.json);
// az adapter a HTML documentMID-jéből építi az utat, majd a `calendars[]` tömbből determinista módon
// emeli be a MEGJELENT (lastUpdateDate ≤ ma) kiadványokat. „Minden megjelenés" (user-döntés): Tájékoztató
// ÉS Idősor egyaránt — nincs type-szűrő. Fail-closed: jövőbeli/hiányos-dátumú bejegyzés kimarad (számolva).

const HTML = readFileSync(fileURLToPath(new URL("../fixtures/mnb_pubnap.html", import.meta.url)), "utf8");
const CAL = readFileSync(fileURLToPath(new URL("../fixtures/mnb_pubnap_calendars.json", import.meta.url)), "utf8");
const LIST_URL = "https://statisztika.mnb.hu/pubnap";
const NOW = Date.parse("2026-09-10T12:00:00Z");

function resp(body, { status = 200, contentType = "text/html" } = {}) {
  const buf = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("utf8"),
  };
}
// URL-alapú routing: a pubnap-oldal → HTML, a .json út → naptár-JSON.
const routedStub = (html = HTML, cal = CAL) => async (url) =>
  url.endsWith(".json") ? resp(cal, { contentType: "application/json" }) : resp(html);

test("extractDocumentMID: a pubnap HTML-ből kinyeri a MID-et", () => {
  assert.equal(extractDocumentMID(HTML), "jIwqR117R9Gxx3bf4pTo9w");
  assert.equal(extractDocumentMID("<html>nincs mid</html>"), null);
});

test("calendarJsonPath: a MID utolsó betűje a shard", () => {
  assert.equal(
    calendarJsonPath("jIwqR117R9Gxx3bf4pTo9w"),
    "/sw/content/w/jIwqR117R9Gxx3bf4pTo9w_mnbStatPortalPublicationCalendars.json",
  );
});

test("parseMnbDate: 'ÉÉÉÉ.HH.NN. óó:pp' → nap; érvénytelen → null", () => {
  assert.deepEqual(parseMnbDate("2026.09.07. 08:30"), { day: "2026-09-07", ms: Date.UTC(2026, 8, 7) });
  assert.equal(parseMnbDate(""), null);
  assert.equal(parseMnbDate("tegnap"), null);
  assert.equal(parseMnbDate(null), null);
});

test("calendarsToItems: jövőbeli és hiányos-dátumú bejegyzés KIMARAD, a múltbeli megjelent bekerül", () => {
  const calendars = JSON.parse(CAL).calendars;
  const { items, skipped } = calendarsToItems(calendars, { listUrl: LIST_URL, nowMs: NOW });
  // 3 megjelent (lakásárindex, BUX, régi), 2 kihagyva (09.14 jövőbeli + üres dátum)
  assert.equal(items.length, 3, "3 megjelent kiadvány");
  assert.equal(skipped, 2, "2 kihagyva (jövőbeli + hiányos)");
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes("MNB-lakásárindex (2026. II. negyedév)"), "cím + referencePeriod");
  assert.ok(!titles.some((t) => t.startsWith("Havi fizetési mérleg")), "a 2026.09.14 (jövőbeli) NEM került be");
  const lak = items.find((i) => i.title.startsWith("MNB-lakásárindex"));
  assert.equal(lak.url, "https://statisztika.mnb.hu/publikacios-temak/arak_-arfolyamok/lakasarak/tajekoztato---mnb-lakasarindex", "abszolutizált url");
  assert.equal(lak.publishedAt, "2026-09-07T00:00:00.000Z");
  assert.equal(lak.dataBacked, true, "hivatalos statisztika → data-backed");
  assert.match(lak.guid, /^mnbpubnap:.*#2026\.09\.07\. 08:30$/, "guid = url#lastUpdateDate (kiadásonként egyedi)");
});

test("calendarsToItems: 'minden megjelenés' — az Idősor típus IS bekerül (nincs type-szűrő)", () => {
  const calendars = JSON.parse(CAL).calendars;
  const { items } = calendarsToItems(calendars, { listUrl: LIST_URL, nowMs: NOW });
  assert.ok(items.some((i) => i.title.startsWith("BUX index adatok")), "az Idősor típusú BUX is bekerül");
});

test("fetchNew: HTML→MID→JSON lánc, since-szűrés napra, OK_UJ a friss kiadványokra", async () => {
  const since = Date.parse("2026-09-05T00:00:00Z"); // a 06.03 régi kiadvány ez alatt van → kiesik
  const { items, check } = await fetchNew(
    { id: "mnbpubnap", list_url: LIST_URL },
    { since, fetchImpl: routedStub(), now: NOW },
  );
  assert.equal(check.status, "OK_UJ", check.detail);
  assert.equal(items.length, 2, "2 friss (09.07 lakásárindex + BUX); a 06.03 régi a since alatt");
  assert.ok(items.every((i) => i.publishedAt >= "2026-09-05"), "mind ≥ since-nap");
});

test("fetchNew: since a legfrissebb fölött → OK_NINCS_UJ (nincs burst)", async () => {
  const since = Date.parse("2026-09-09T00:00:00Z"); // minden megjelent kiadvány ez alatt van
  const { items, check } = await fetchNew(
    { id: "mnbpubnap", list_url: LIST_URL },
    { since, fetchImpl: routedStub(), now: NOW },
  );
  assert.equal(check.status, "OK_NINCS_UJ", check.detail);
  assert.equal(items.length, 0);
});

test("fetchNew: hiányzó documentMID → SKIPPED_VALIDATION (fail-closed, nem HIBA)", async () => {
  const { items, check } = await fetchNew(
    { id: "mnbpubnap", list_url: LIST_URL },
    { fetchImpl: routedStub("<html>nincs mid</html>"), now: NOW },
  );
  assert.equal(check.status, "SKIPPED_VALIDATION");
  assert.equal(items.length, 0);
});

test("fetchNew: hibás naptár-JSON → SKIPPED_VALIDATION", async () => {
  const { check } = await fetchNew(
    { id: "mnbpubnap", list_url: LIST_URL },
    { fetchImpl: routedStub(HTML, "{ nem json"), now: NOW },
  );
  assert.equal(check.status, "SKIPPED_VALIDATION");
});

test("aktiválás: mnbpubnap aktív forrás (adapter, status OK, kind hivatalos), channelsOf az adapterre routol", () => {
  const { sources } = JSON.parse(readFileSync(new URL("../../config/sources.json", import.meta.url), "utf8"));
  const s = selectActiveSources(sources).find((x) => x.id === "mnbpubnap");
  assert.ok(s, "mnbpubnap a kiválasztott aktív források közt");
  assert.equal(s.adapter, "mnbpubnap", "dedikált adapter");
  assert.equal(s.status, "OK", "adapter-forrás csak OK mellett aktív (fail-closed)");
  assert.equal(s.kind, "hivatalos", "hivatalos adat → 📈 Kutatások és hivatalos adatok");
  const chans = channelsOf(s);
  assert.equal(chans.length, 1, "az adapter az EGYETLEN csatorna (generikus feed/lista nem indul)");
  assert.equal(chans[0].name, "mnbpubnap");
});
