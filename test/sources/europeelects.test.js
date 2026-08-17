import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEuropeElects, validateEuropeElects, fetchNew } from "../../src/sources/europeelects.js";

// VALÓS fixture: a ma (2026-08-17) lakossági IP-ről lekért ASAPOP HU-widget, bájtazonos a
// 08-16-i Actions-ASN-próbával (15641 B). A korrupt variánsok EBBŐL származnak, egyetlen
// célzott mutációval (CLAUDE.md 1: valós fixture-rel), hogy pontosan egy guardot buktassanak.
const HTML = readFileSync(fileURLToPath(new URL("../fixtures/europeelects_hu.html", import.meta.url)), "utf8");
const SRC = { id: "europeelects", name: "Europe Elects", list_url: "https://storage.googleapis.com/asapop-website-20220812/_widgets/tables/hu.html" };
const stub = (body, { status = 200 } = {}) => async () => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => "text/html" },
  text: async () => body,
  arrayBuffer: async () => Buffer.from(body).buffer,
});
// A date-guard now-referenciája determinisztikus a tesztben (a fixture 2026-07-27-ig tart).
const NOW = Date.parse("2026-08-17T00:00:00Z");

test("parseEuropeElects: 50 poll-sor a valós ASAPOP-fixture-ből, az első sor mezői bájtra", () => {
  const { header, polls } = parseEuropeElects(HTML);
  assert.deepEqual(header.slice(0, 4), ["Fieldwork Period", "Polling Firm", "Commissioner(s)", "Sample Size"]);
  assert.ok(header.includes("TISZA") && header.includes("Fidesz–KDNP"), "a párt-oszlopok a fejlécben");
  assert.equal(polls.length, 50, "50 poll-sor a tbody-ból");

  const p0 = polls[0];
  assert.equal(p0.pollingFirm, "Republikon Intézet");
  assert.equal(p0.sampleSize, 1000);
  assert.equal(p0.fieldwork.start, "2026-07-22");
  assert.equal(p0.fieldwork.end, "2026-07-27");
  // a párt-% a forrásból, bájtra (TISZA 69, Fidesz–KDNP 23); a "—" hiányzó → null (nem 0).
  const byName = Object.fromEntries(p0.parties.map((x) => [x.name, x.pct]));
  assert.equal(byName["TISZA"], 69);
  assert.equal(byName["Fidesz–KDNP"], 23);
  assert.equal(byName["Other"], null, "a '—' hiányzó érték → null");
});

test("parseEuropeElects: tizedes-százalék megőrizve (pl. 5.9%)", () => {
  const { polls } = parseEuropeElects(HTML);
  const hasFloat = polls.some((p) => p.parties.some((x) => x.pct != null && !Number.isInteger(x.pct)));
  assert.ok(hasFloat, "van tizedes párt-% a fixture-ben, a parser nem kerekít egészre");
});

test("validateEuropeElects: a valós fixture ÁTMEGY minden guardon", () => {
  const parsed = parseEuropeElects(HTML);
  const v = validateEuropeElects(parsed, { now: NOW });
  assert.equal(v.ok, true, `a valós fixture valid, de: ${v.guard} — ${v.detail}`);
});

// --- FAIL-CLOSED guardok: mindegyik EGY célzott mutáció a valós fixture-ön (§7 (b)-döntés) ---

test("guard fejléc: átnevezett oszlop → SKIPPED (nem néma beengedés)", () => {
  const bad = HTML.replace("<th>Sample Size</th>", "<th>Minta</th>");
  const v = validateEuropeElects(parseEuropeElects(bad), { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.guard, "header");
});

test("guard %-összeg: eltolt érték (69%→9%, összeg≈40) → SKIPPED", () => {
  const bad = HTML.replace("69%", "9%");
  const v = validateEuropeElects(parseEuropeElects(bad), { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.guard, "pct_sum");
});

test("guard tartomány: párt-% > 100 (69%→169%) → SKIPPED", () => {
  const bad = HTML.replace("69%", "169%");
  const v = validateEuropeElects(parseEuropeElects(bad), { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.guard, "range");
});

test("guard mintaméret: 1000→50 (sávon kívül) → SKIPPED", () => {
  const bad = HTML.replace("<td>1000</td>", "<td>50</td>");
  const v = validateEuropeElects(parseEuropeElects(bad), { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.guard, "sample_size");
});

test("guard dátum: implauzibilis fieldwork (2026-07-27→1899-07-27) → SKIPPED", () => {
  const bad = HTML.replace("2026-07-27", "1899-07-27");
  const v = validateEuropeElects(parseEuropeElects(bad), { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.guard, "date");
});

test("guard sor-sanity: üres tbody → SKIPPED", () => {
  const bad = HTML.replace(/<tbody>[\s\S]*<\/tbody>/, "<tbody></tbody>");
  const v = validateEuropeElects(parseEuropeElects(bad), { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.guard, "rows");
});

// --- fetchNew: adapter (a source MÉG NEM aktív; a fetchNew standalone tesztelt) ---

test("fetchNew: valid HTML → OK_UJ, a tételek determinista poll-számokat hordoznak (data_backed)", async () => {
  const r = await fetchNew(SRC, { since: 0, fetchImpl: stub(HTML), now: NOW });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 50);
  const it = r.items[0];
  assert.equal(it.dataBacked, true, "a poll-sor eleve data_backed=true (determinista beemelés)");
  assert.ok(it.poll && Array.isArray(it.poll.parties), "a strukturált poll a tételen");
  assert.equal(it.poll.sampleSize, 1000);
  assert.ok(it.publishedAt.startsWith("2026-07-27"), "a fieldwork vége a publishedAt (dateOnly)");
  assert.match(it.title, /Republikon/);
});

test("fetchNew: guard-bukás → SKIPPED_VALIDATION, 0 tétel (fail-closed, nem néma rossz adat)", async () => {
  const bad = HTML.replace("<th>Sample Size</th>", "<th>Minta</th>");
  const r = await fetchNew(SRC, { since: 0, fetchImpl: stub(bad), now: NOW });
  assert.equal(r.check.status, "SKIPPED_VALIDATION");
  assert.equal(r.items.length, 0, "egyetlen tétel sem jut be a validáció bukásakor");
  assert.match(r.check.detail, /header/);
});

test("fetchNew: HTTP-hiba → HIBA (nem néma 0 tétel)", async () => {
  const r = await fetchNew(SRC, { since: 0, fetchImpl: stub("", { status: 503 }), now: NOW });
  assert.equal(r.check.status, "HIBA");
});
