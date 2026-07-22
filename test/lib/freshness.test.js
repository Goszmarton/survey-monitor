import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFreshness } from "../../src/lib/freshness.js";

const H = 3600 * 1000;
const now = Date.parse("2026-07-22T06:00:00Z");
const ago = (h) => new Date(now - h * H).toISOString();

test("UJ_24H: publikálva 10 órája", () => {
  assert.equal(computeFreshness({ publishedAt: ago(10), firstSeenAt: ago(10), now }), "UJ_24H");
});

test("H24_48: publikálva 36 órája", () => {
  assert.equal(computeFreshness({ publishedAt: ago(36), firstSeenAt: ago(36), now }), "H24_48");
});

test("KORABBI: publikálva 5 napja, és már korábban is láttuk", () => {
  assert.equal(
    computeFreshness({ publishedAt: ago(120), firstSeenAt: ago(120), now, runStartedAt: ago(1) }),
    "KORABBI",
  );
});

test("KIHAGYOTT_MOST: régi publikáció (>48h), de most látjuk először", () => {
  // published 5 napja, first_seen a mostani futásban (runStartedAt óta)
  assert.equal(
    computeFreshness({ publishedAt: ago(120), firstSeenAt: ago(0), now, runStartedAt: ago(0.1) }),
    "KIHAGYOTT_MOST",
  );
});

test("publishedAt hiányában first_seen_at az alap", () => {
  assert.equal(computeFreshness({ publishedAt: null, firstSeenAt: ago(2), now }), "UJ_24H");
  assert.equal(computeFreshness({ publishedAt: null, firstSeenAt: ago(30), now }), "H24_48");
});

test("ms-epoch és Date bemenet is elfogadott", () => {
  assert.equal(computeFreshness({ publishedAt: now - 5 * H, firstSeenAt: now - 5 * H, now }), "UJ_24H");
  assert.equal(
    computeFreshness({ publishedAt: new Date(now - 5 * H), firstSeenAt: new Date(now - 5 * H), now }),
    "UJ_24H",
  );
});
