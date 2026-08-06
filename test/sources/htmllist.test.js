import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNew } from "../../src/sources/htmllist.js";

const fx = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

function resp(body, { status = 200, contentType = "text/html; charset=UTF-8" } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("utf8"),
  };
}
const stub = (body, opts) => async () => resp(body, opts);
const src = { id: "eurostat", name: "Eurostat", list_url: "https://ec.europa.eu/eurostat/web/main/news/euro-indicators" };

test("HTML-listából a cikk-headline linkek kinyerve (nav kihagyva)", async () => {
  const r = await fetchNew(src, { fetchImpl: stub(fx("eurostat_list.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2);
  const titles = r.items.map((i) => i.title);
  assert.ok(titles.some((t) => /GDP up by 0\.3%/.test(t)));
  // A relatív URL abszolúttá vált, a rövid nav-linkek ("Help", "Home") kimaradtak.
  assert.match(r.items[0].url, /^https:\/\/ec\.europa\.eu\//);
  assert.ok(!titles.some((t) => /^Help$|^Home$/.test(t)));
  // publikációs idő ismeretlen HTML-listából
  assert.equal(r.items[0].publishedAt, null);
});

test("RESZLEGES: nincs kinyerhető cikk-link", async () => {
  const r = await fetchNew(src, { fetchImpl: stub("<html><body><a href='/x'>rövid</a></body></html>") });
  assert.equal(r.check.status, "RESZLEGES");
  assert.deepEqual(r.items, []);
});

test("HIBA: HTTP 500", async () => {
  const r = await fetchNew(src, { fetchImpl: stub("err", { status: 500 }) });
  assert.equal(r.check.status, "HIBA");
  assert.match(r.check.detail, /500/);
});

// --- 21 Kutatóközpont: dátumozott Bootstrap-collapse accordion (per-source parser) ---
// A tételek NEM <a>-tagek, hanem <div class="... question" href="#faqNN">ÉÉÉÉ.HH.NN. – Cím<,
// ezért a generikus <a>-extractor nem látja őket, és dátumot sem von ki. A per-source parser
// kinyeri a CÍMET, a DÁTUMOT (publishedAt) és a LINKET (base#faqNN). PIROS az implementáció előtt.
const src21 = { id: "21kutato", name: "21 Kutatóközpont", list_url: "https://21kutatokozpont.hu/" };
test("21kutato: accordion-tételek — cím + dátum + link kinyerve", async () => {
  const r = await fetchNew(src21, { fetchImpl: stub(fx("21kutato_accordion.html")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 3, "3 accordion-tétel (a nav-linkek kimaradnak)");
  const first = r.items[0];
  assert.equal(first.title, "Kétharmados többség Sulyok távozása mellett", "a dátum-prefix levágva a címről");
  assert.equal(first.publishedAt, "2026-05-28T00:00:00.000Z", "a dátum kinyerve publishedAt-ba");
  assert.equal(first.url, "https://21kutatokozpont.hu/#faq76", "a link a base#faqNN anchor");
  // az identitás a CÍM (a #faqNN renumberálódhat) — guid a címből
  assert.equal(first.guid, first.title);
  // mindhárom tételnek van valós dátuma (nem null, mint a generikus HTML-listánál)
  assert.ok(r.items.every((i) => /^\d{4}-\d{2}-\d{2}T/.test(i.publishedAt)));
});

// --- since-szűrés csapda: dátum-granularitás vs. a since IDŐPONTJA ---
// A dateOnly tétel publishedAt-je 00:00Z. A since az ELŐZŐ FUTÁS KEZDETE (~03:54Z).
// Naiv (rss-szerű) publishedAt>=since összehasonlítás az ELŐZŐ FUTÁS NAPJÁN publikált
// tételt kivágná (00:00 < 03:54), és holnap a since még későbbi → VÉGLEG elveszne
// (néma adatvesztés, CLAUDE.md 2). A helyes: dateOnly tételnél NAP-szinten hasonlíts.
const longTitle = (s) => s + " " + "x".repeat(20);
test("21kutato since-szűrés: az előző futás NAPJÁN publikált (dateOnly) tétel BENT marad", async () => {
  const html = `<div class="accordion">
    <div class="question" href="#faq2">2026.08.06. – ${longTitle("Elemzes az elozo futas napjan")}<i></i></div>
    <div class="question" href="#faq1">2026.08.05. – ${longTitle("Korabbi napi elemzes")}<i></i></div>
  </div>`;
  const since = Date.parse("2026-08-06T03:54:00.000Z"); // az előző futás KEZDETE, nem éjfél
  const r = await fetchNew(src21, { fetchImpl: stub(html), since });
  const dates = r.items.map((i) => i.publishedAt);
  assert.ok(dates.includes("2026-08-06T00:00:00.000Z"), "a since NAPJÁN publikált tétel BENT marad (nap-szint, nem 00:00<03:54)");
  assert.ok(!dates.includes("2026-08-05T00:00:00.000Z"), "az egy nappal korábbi tétel kiesik");
  assert.equal(r.items.length, 1);
});

test("since-szűrés: publishedAt NÉLKÜLI tétel (generikus HTML-lista, pl. Eurostat) since mellett is marad", async () => {
  // dátum nélküli tétel → nem szűrhető → marad (mint az rss-ben); az Eurostat-lista érintetlen.
  const r = await fetchNew(src, { fetchImpl: stub(fx("eurostat_list.html")), since: Date.parse("2026-08-06T03:54:00.000Z") });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2, "a dátumtalan lista-tételek since mellett is bent maradnak");
});
