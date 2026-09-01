import { test } from "node:test";
import assert from "node:assert/strict";
import { httpGet } from "../../src/sources/http.js";

// Regresszió (2026-08-24 incidens): a napi futás 30 percig NÉMÁN beragadt és a job
// timeout-minutes:30 megölte → DB-commit/Pages/deploy skipped, levél elmaradt. Gyök-ok:
// a httpGet AbortController-timerét a fejléc megérkezése UTÁN, a finally-ben törölte a
// kód — MIELŐTT a törzset (res.bytes()/res.text() → arrayBuffer()/text()) beolvasta
// volna. Így a fejléc-fázis 20s-es korláttal védett volt, a TÖRZS-olvasás viszont
// IDŐTLEN: egy megállt/fojtott body-stream (webgate volumeA.xlsx a datacenter-IP-ről)
// örökre függött. A collect() Promise.allSettled-je minden forrásra vár → egyetlen
// beragadt fetcher az EGÉSZ futást megállította.

// Response-stub, amelynek a TÖRZS-olvasója megáll, amíg az abort-signal el nem sül —
// a valós undici body-stream viselkedését tükrözi (a törzs a fetch signaljára abortál).
function stallingResp(signal, { status = 200 } = {}) {
  const stall = () =>
    new Promise((_, reject) => {
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal.aborted) return fail();
      signal.addEventListener("abort", fail, { once: true });
    });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: stall,
    text: stall,
  };
}

test("httpGet: a TÖRZS-olvasás (bytes) is időtúllépik megállt body-streamnél, nem csak a fejléc", { timeout: 1000 }, async () => {
  const fetchImpl = async (_url, { signal }) => stallingResp(signal);
  const res = await httpGet("https://example.test/volumeA.xlsx", { fetchImpl, timeoutMs: 50 });
  await assert.rejects(res.bytes(), (e) => e.name === "AbortError");
});

test("httpGet: a TÖRZS-olvasás (text) is időtúllépik megállt body-streamnél", { timeout: 1000 }, async () => {
  const fetchImpl = async (_url, { signal }) => stallingResp(signal);
  const res = await httpGet("https://example.test/dataset.json", { fetchImpl, timeoutMs: 50 });
  await assert.rejects(res.text(), (e) => e.name === "AbortError");
});

// 2026-09-01: tranziens-retry. A dobott (nem-Abort) hibát és a 429/5xx-et újrapróbáljuk, a
// determinisztikus státuszt (403/404) NEM. retryDelayMs:0 → a teszt nem vár valós backoffot.
const okResp = (body = "ok", status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => "text/plain" },
  arrayBuffer: async () => Buffer.from(body).buffer, text: async () => body,
});

test("httpGet: dobott (tranziens) hiba → újrapróbál, majd sikerül", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; if (n < 3) throw new Error("fetch failed"); return okResp("nyert"); };
  const res = await httpGet("https://x.test/a", { fetchImpl, retryDelayMs: 0 });
  assert.equal(n, 3, "kétszer bukott, harmadszorra sikerült");
  assert.equal(await res.text(), "nyert");
});

test("httpGet: 503 (tranziens szerver) → újrapróbál, majd 200", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return n < 2 ? okResp("hiba", 503) : okResp("jo", 200); };
  const res = await httpGet("https://x.test/b", { fetchImpl, retryDelayMs: 0 });
  assert.equal(res.status, 200);
  assert.equal(n, 2);
});

test("httpGet: 403 DETERMINISZTIKUS → NEM próbál újra (egyetlen hívás)", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return okResp("tiltva", 403); };
  const res = await httpGet("https://x.test/c", { fetchImpl, retryDelayMs: 0 });
  assert.equal(res.status, 403);
  assert.equal(n, 1, "403-ra nincs retry (nem tranziens)");
});

test("httpGet: minden próbálkozás bukik → az utolsó hibát dobja", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; throw new Error("ECONNRESET"); };
  await assert.rejects(httpGet("https://x.test/d", { fetchImpl, retryDelayMs: 0 }), /ECONNRESET/);
  assert.equal(n, 3, "3 próbálkozás (MAX_ATTEMPTS)");
});

test("httpGet: időtúllépés (AbortError) → NEM próbál újra (a teljes időt korlátozzuk)", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
  await assert.rejects(httpGet("https://x.test/e", { fetchImpl, retryDelayMs: 0 }), (e) => e.name === "AbortError");
  assert.equal(n, 1, "AbortError-ra nincs retry");
});

test("httpGet: egészséges törzs-olvasás változatlanul működik (nincs regresszió)", async () => {
  const buf = Buffer.from("hello");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/plain" },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => "hello",
  });
  const res = await httpGet("https://example.test/ok", { fetchImpl, timeoutMs: 1000 });
  assert.equal((await res.bytes()).toString("utf8"), "hello");
  assert.equal(await (await httpGet("https://example.test/ok", { fetchImpl, timeoutMs: 1000 })).text(), "hello");
});
