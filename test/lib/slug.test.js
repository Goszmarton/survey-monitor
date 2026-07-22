import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, canonicalKey } from "../../src/lib/slug.js";

test("slug: kisbetűsít és kötőjelez", () => {
  assert.equal(slug("Hello World"), "hello-world");
});

test("slug: magyar ékezetek ASCII-ra", () => {
  assert.equal(slug("Árvíztűrő tükörfúrógép"), "arvizturo-tukorfurogep");
  assert.equal(slug("Népszava ŐŰ"), "nepszava-ou");
});

test("slug: több nem-alfanumerikus jel egyetlen kötőjellé, szélek levágva", () => {
  assert.equal(slug("  Foo -- Bar!! 2026  "), "foo-bar-2026");
  assert.equal(slug("///"), "");
});

test("canonicalKey: source_id + slug(guid|url|title), guid elsőbbség", () => {
  const k = canonicalKey("telex", { guid: "abc-123", url: "https://telex.hu/x", title: "Cím" });
  assert.equal(k, "telex:abc-123");
});

test("canonicalKey: guid híján url, majd title", () => {
  assert.equal(
    canonicalKey("ksh", { url: "https://www.ksh.hu/gyors/ker2605.html" }),
    "ksh:https-www-ksh-hu-gyors-ker2605-html",
  );
  assert.equal(canonicalKey("mnb", { title: "Kamatdöntés" }), "mnb:kamatdontes");
});

test("canonicalKey: azonos tétel kétszer → azonos kulcs (dedup alap)", () => {
  const a = canonicalKey("telex", { guid: "G1", url: "u" });
  const b = canonicalKey("telex", { guid: "G1", url: "más-url" });
  assert.equal(a, b);
});

test("canonicalKey: üres azonosító → null", () => {
  assert.equal(canonicalKey("telex", {}), null);
});
