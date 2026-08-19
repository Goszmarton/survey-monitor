import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, startRun } from "../src/state/db.js";
import { collect, combineStatus, channelsOf } from "../src/collect.js";
import * as europeelects from "../src/sources/europeelects.js";

// E2/A: dedikált adapter-routing. Egy forrás a `feed`/`list_url` generikus csatornái helyett
// (vagy mellett) a SAJÁT adapterét használhatja (source.adapter → registry). Az europeelects
// az ASAPOP-táblát a dedikált parserrel olvassa, NEM a generikus htmllist-tel; a list_url-t az
// adapter birtokolja, ezért a htmllist-csatorna NEM indul mellette (nincs dupla fetch).
test("channelsOf: source.adapter → a dedikált adapter az EGYETLEN csatorna (nem htmllist) (E2/A)", () => {
  const ch = channelsOf({ id: "europeelects", adapter: "europeelects", list_url: "https://x/hu.html" });
  assert.equal(ch.length, 1, "pontosan egy csatorna");
  assert.equal(ch[0].fetcher, europeelects, "a dedikált europeelects adapter viszi");
  assert.equal(ch[0].fetcher.fetchNew, europeelects.fetchNew, "a fetchNew a dedikált adapteré");
});

test("channelsOf: adapter nélkül a generikus feed/list_url útvonal marad (regresszió)", () => {
  const ch = channelsOf({ id: "x", feed: "https://x/rss", list_url: "https://x/list" });
  assert.equal(ch.length, 2);
  assert.deepEqual(ch.map((c) => c.name), ["feed", "lista"]);
});

// B2-előkészítés (routing-plumbing, LEVÉL-SEMLEGES): a channelsOf adapter-registryje
// INJEKTÁLHATÓ (opcionális 2. paraméter, default a valós ADAPTERS). Így egy új dedikált
// forrás (eurobarometer) routingja FAKE adapterrel tesztelhető, a modul valós (még hiányzó)
// I/O-ja NÉLKÜL. A valódi eurobarometer regisztráció a B2 aktiváláskor jön, amikor a
// fetchNew adapter-szerződés (→ {items, check}) elkészül — enélkül a registry-be tétel
// csapda lenne (a hívás elszállna). A collect() a default registryvel hívja → visszafelé kompatibilis.
test("channelsOf: injektált registry → a fake adapter az EGYETLEN csatorna (B2-előkészítés)", () => {
  const fake = { fetchNew: async () => ({ items: [], check: { status: "OK_NINCS_UJ", detail: "fake" } }) };
  const ch = channelsOf({ id: "x", adapter: "myfake", list_url: "https://x/y" }, { myfake: fake });
  assert.equal(ch.length, 1, "az injektált adapter az egyetlen csatorna (nem htmllist a list_url-re)");
  assert.equal(ch[0].name, "myfake");
  assert.equal(ch[0].fetcher, fake, "az injektált fake adapter viszi a fetch-et");
  assert.equal(ch[0].fetcher.fetchNew, fake.fetchNew);
});

test("channelsOf: injektált registryben sem szereplő adapter → üres (fail-closed, nem esik htmllistre)", () => {
  const ch = channelsOf({ id: "x", adapter: "nincs", list_url: "https://x/y" }, { myfake: {} });
  assert.equal(ch.length, 0, "ismeretlen adapter → nincs csatorna; a list_url NEM indít generikus htmllist-et");
});

// E2 előkészítés: az europeelects fail-closed validátora SKIPPED_VALIDATION check-státuszt
// ad (a fetch sikerült, de a guard elutasította — NEM hálózati HIBA). A combineStatus RANK
// eddig nem ismerte → RANK[s]=undefined → HIBA-ként esett vissza. Ez a fail-closed skipet
// hibás fetch-nek tüntetné fel a jelentésben. A SKIPPED_VALIDATION saját, HIBA fölötti rangot
// kap (de bármely valódi adat OK_* felülírja).
test("combineStatus: SKIPPED_VALIDATION önálló státusz, NEM esik HIBA-ra (E2)", () => {
  assert.equal(combineStatus(["SKIPPED_VALIDATION"]), "SKIPPED_VALIDATION");
});

test("combineStatus: SKIPPED_VALIDATION vs HIBA → a validation-skip informatívabb, az nyer (E2)", () => {
  assert.equal(combineStatus(["SKIPPED_VALIDATION", "HIBA"]), "SKIPPED_VALIDATION");
});

test("combineStatus: van valódi adat (OK_UJ) → az felülírja a SKIPPED_VALIDATION-t (E2)", () => {
  assert.equal(combineStatus(["SKIPPED_VALIDATION", "OK_UJ"]), "OK_UJ");
  assert.equal(combineStatus(["OK_NINCS_UJ", "SKIPPED_VALIDATION"]), "OK_NINCS_UJ");
});

const fx = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

// URL → fixture routing a hálózat helyett.
function routedFetch(url) {
  const mk = (body, contentType) => ({
    ok: true, status: 200,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    text: async () => (Buffer.isBuffer(body) ? body.toString("utf8") : String(body)),
  });
  if (url.includes("telex")) return mk(fx("rss_sample.xml"), "text/xml; charset=UTF-8");
  if (url.includes("ksh")) return mk(fx("rss_ksh_iso88592.xml"), "text/xml;charset=iso-8859-2");
  if (url.includes("szabadeuropa")) return mk(fx("rss_empty.xml"), "text/xml");
  if (url.includes("euro-indicators")) return mk(fx("eurostat_list.html"), "text/html");
  throw new Error("nem várt URL: " + url);
}

const SOURCES = [
  { id: "telex", name: "Telex", kaszt: "A", kind: "sajto", feed: "https://telex.hu/rss" },
  { id: "ksh", name: "KSH", kaszt: "A", kind: "hivatalos", feed: "https://www.ksh.hu/rss/gyorstajekoztatok" },
  { id: "szabadeu", name: "Szabad Európa", kaszt: "A", kind: "sajto", feed: "https://www.szabadeuropa.hu/api/xxx" },
  { id: "eurostat", name: "Eurostat", kaszt: "A", kind: "hivatalos", list_url: "https://ec.europa.eu/eurostat/web/main/news/euro-indicators" },
];

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-collect-"));
  return { db: openDb(join(dir, "monitor.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("collect: tételek gyűjtése, dedup, naplózás, frissesség", async () => {
  const { db, cleanup } = tempDb();
  try {
    const now = Date.parse("2026-07-22T06:00:00Z");
    const runStartedAt = new Date(now).toISOString();
    startRun(db, { runId: "2026-07-22", startedAt: runStartedAt });
    const r = await collect({ db, sources: SOURCES, now, runId: "2026-07-22", runStartedAt, since: 0, fetchImpl: routedFetch });

    // 2 telex + 1 ksh + 2 eurostat = 5, szabadeu 0
    assert.equal(r.items.length, 5);
    assert.equal(r.newCount, 5);

    const byId = Object.fromEntries(r.sourceChecks.map((c) => [c.source_id, c]));
    assert.equal(byId.telex.status, "OK_UJ");
    assert.equal(byId.ksh.status, "OK_UJ");
    assert.equal(byId.szabadeu.status, "RESZLEGES");
    assert.equal(byId.eurostat.status, "OK_UJ");

    // kind-leképezés és iso-8859-2 helyes dekódolás a láncon át
    const ksh = r.items.find((i) => i.source_id === "ksh");
    assert.equal(ksh.kind, "hivatalos_adat");
    assert.equal(ksh.title, "Árvíztűrő tükörfúrógép");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("collect: forrás-szintű title_filter a dedup ELŐTT szűr, a napló rögzíti az arányt", async () => {
  const { db, cleanup } = tempDb();
  try {
    const now = Date.parse("2026-07-22T06:00:00Z");
    const rs = new Date(now).toISOString();
    // telex → rss_sample (2 tétel: "Első cikk címe", "Második & harmadik"); a szűrő csak az
    // elsőre illeszt → 1 tétel marad, a napló „cím-szűrő: 2→1"-et mutat.
    const src = [{ id: "telex", name: "Telex", kaszt: "A", kind: "sajto", feed: "https://telex.hu/rss", title_filter: ["első"] }];
    startRun(db, { runId: "r", startedAt: rs });
    const r = await collect({ db, sources: src, now, runId: "r", runStartedAt: rs, since: 0, fetchImpl: routedFetch });

    assert.equal(r.items.length, 1, "a 2-ből 1 tétel maradt a szűrő után");
    assert.equal(r.items[0].title, "Első cikk címe");
    const check = r.sourceChecks.find((c) => c.source_id === "telex");
    assert.match(check.detail, /cím-szűrő: 2→1/, "a napló rögzíti a szűrés arányát (nem csendes)");
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("collect: két csatornás forrás (feed + list_url) mindkettőt lekéri, egy napló-sor", async () => {
  const { db, cleanup } = tempDb();
  try {
    const now = Date.parse("2026-07-22T06:00:00Z");
    const rs = new Date(now).toISOString();
    // az eurostat itt feed-et ÉS list_url-t is kap
    const src = [{
      id: "eurostat", name: "Eurostat", kaszt: "A", kind: "hivatalos",
      feed: "https://telex.hu/rss", // routedFetch: rss_sample (2 tétel)
      list_url: "https://ec.europa.eu/eurostat/web/main/news/euro-indicators", // 2 link
    }];
    startRun(db, { runId: "r", startedAt: rs });
    const r = await collect({ db, sources: src, now, runId: "r", runStartedAt: rs, since: 0, fetchImpl: routedFetch });

    // 2 (feed) + 2 (lista) = 4 tétel egy forrásból
    assert.equal(r.items.length, 4);
    // egyetlen napló-sor a forrásra, mindkét csatorna részlete benne
    const checks = r.sourceChecks.filter((c) => c.source_id === "eurostat");
    assert.equal(checks.length, 1);
    assert.equal(checks[0].status, "OK_UJ");
    assert.match(checks[0].detail, /feed:/);
    assert.match(checks[0].detail, /lista:/);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});

test("collect: második futásban minden duplikátum → 0 új, státusz OK_NINCS_UJ-re esik", async () => {
  const { db, cleanup } = tempDb();
  try {
    const now1 = Date.parse("2026-07-22T06:00:00Z");
    const rs1 = new Date(now1).toISOString();
    startRun(db, { runId: "r1", startedAt: rs1 });
    await collect({ db, sources: SOURCES, now: now1, runId: "r1", runStartedAt: rs1, since: 0, fetchImpl: routedFetch });

    const now2 = Date.parse("2026-07-23T06:00:00Z");
    const rs2 = new Date(now2).toISOString();
    startRun(db, { runId: "r2", startedAt: rs2 });
    const r2 = await collect({ db, sources: SOURCES, now: now2, runId: "r2", runStartedAt: rs2, since: 0, fetchImpl: routedFetch });

    assert.equal(r2.newCount, 0);
    const byId = Object.fromEntries(r2.sourceChecks.map((c) => [c.source_id, c]));
    // eurostat HTML-listája újra ugyanazt adja → mind duplikátum → OK_NINCS_UJ
    assert.equal(byId.eurostat.status, "OK_NINCS_UJ");
    assert.match(byId.eurostat.detail, /0 új|duplik/i);
    cleanup();
  } catch (e) { cleanup(); throw e; }
});
