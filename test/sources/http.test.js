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
