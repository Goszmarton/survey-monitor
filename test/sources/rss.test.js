import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNew } from "../../src/sources/rss.js";

const fx = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

// Minimál Response-stub, ami a fetchNew által használt felületet adja.
function resp(body, { status = 200, contentType = "text/xml; charset=UTF-8" } = {}) {
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
const src = { id: "telex", name: "Telex", feed: "https://telex.hu/rss" };

const T = (iso) => Date.parse(iso);

test("OK_UJ: minden tétel újabb a since-nél", async () => {
  const r = await fetchNew(src, { since: T("2026-07-22T00:00:00Z"), fetchImpl: stub(fx("rss_sample.xml")) });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].guid, "telex-1");
});

test("since-szűrés: csak az újabb tétel marad", async () => {
  const r = await fetchNew(src, { since: T("2026-07-22T02:30:00Z"), fetchImpl: stub(fx("rss_sample.xml")) });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].guid, "telex-1");
  assert.equal(r.check.status, "OK_UJ");
});

test("OK_NINCS_UJ: van tétel, de egyik sem újabb a since-nél", async () => {
  const r = await fetchNew(src, { since: T("2026-07-22T06:00:00Z"), fetchImpl: stub(fx("rss_sample.xml")) });
  assert.equal(r.items.length, 0);
  assert.equal(r.check.status, "OK_NINCS_UJ");
});

test("RESZLEGES: valid feed, de 0 tétel (Szabad Európa üres eset)", async () => {
  const r = await fetchNew(src, { since: 0, fetchImpl: stub(fx("rss_empty.xml")) });
  assert.equal(r.check.status, "RESZLEGES");
  assert.match(r.check.detail, /üres/i);
  assert.deepEqual(r.items, []);
});

test("HIBA: HTTP 404", async () => {
  const r = await fetchNew(src, { since: 0, fetchImpl: stub("<html>404</html>", { status: 404, contentType: "text/html" }) });
  assert.equal(r.check.status, "HIBA");
  assert.match(r.check.detail, /404/);
});

test("HIBA: 200-as, de nem feed (soft-404 HTML)", async () => {
  const r = await fetchNew(src, { since: 0, fetchImpl: stub("<html><body>oldal</body></html>", { contentType: "text/html" }) });
  assert.equal(r.check.status, "HIBA");
  assert.match(r.check.detail, /nem RSS|nem feed/i);
});

test("HIBA: hálózati hiba/kivétel elkapva", async () => {
  const r = await fetchNew(src, { since: 0, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.equal(r.check.status, "HIBA");
  assert.match(r.check.detail, /ECONNRESET/);
});

test("HIBA: időtúllépés (AbortError)", async () => {
  const r = await fetchNew(src, {
    since: 0,
    timeoutMs: 5,
    fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
  });
  assert.equal(r.check.status, "HIBA");
  assert.match(r.check.detail, /időtúllépés|abort/i);
});

test("iso-8859-2 feed a fetcheren át is helyesen dekódolódik", async () => {
  const ksh = { id: "ksh", name: "KSH", feed: "https://www.ksh.hu/rss/gyorstajekoztatok" };
  const r = await fetchNew(ksh, {
    since: 0,
    fetchImpl: stub(fx("rss_ksh_iso88592.xml"), { contentType: "text/xml;charset=iso-8859-2" }),
  });
  assert.equal(r.check.status, "OK_UJ");
  assert.equal(r.items[0].title, "Árvíztűrő tükörfúrógép");
});
