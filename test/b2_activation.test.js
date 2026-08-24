import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectActiveSources, isActiveSource, channelsOf } from "../src/collect.js";
import * as eurobarometer from "../src/sources/eurobarometer.js";

// B2 PARKOLVA (2026-08-24 incidens) — az eurobarometer AKTIVÁLÁS ideiglenesen VISSZAVONVA.
// Az első éles B2-futás (32711742333) 30 percig némán beragadt (a http.js törzs-olvasása
// időtlen volt egy fojtott volumeA.xlsx body-streamnél a datacenter-IP-ről), a job-timeout
// CANCELLED-del ölte meg, a napi levél elmaradt. A fix (http.js törzs-timeout + workflow
// step-timeout/cancelled()-ág) shippelve; az ÚJRAAKTIVÁLÁS külön nap, éles bizonyítás után.
//
// Ez a teszt a PARKOLT állapotot ŐRZI: (1) eurobarometer jelenleg NEM aktív; (2) az
// adapter-kód + ADAPTERS-registry ÉRINTETLEN, így az újraaktiválás EGYETLEN status-flip
// (NEM_AKTIVALT→OK) — ezt a routing-teszt egy szintetikus OK-státuszú forráson igazolja.

const { sources } = JSON.parse(readFileSync(fileURLToPath(new URL("../config/sources.json", import.meta.url)), "utf8"));

test("B2 parkolva: az eurobarometer JELENLEG NEM aktív (status != OK) — a napi futás nem hívja", () => {
  const active = selectActiveSources(sources);
  assert.ok(!active.find((s) => s.id === "eurobarometer"), "eurobarometer NINCS a kiválasztott aktív források közt");
  const eb = sources.find((s) => s.id === "eurobarometer");
  assert.ok(eb, "a config-bejegyzés megmarad (parkolva, nem törölve)");
  assert.equal(eb.adapter, "eurobarometer", "a dedikált adapter-mező ÉRINTETLEN (újraaktiváláshoz)");
  assert.notEqual(eb.status, "OK", "a status NEM OK (parkolt) — ez tartja ki a fail-closed adapter-ágból");
});

test("B2 parkolva: a routing ÉP — egy OK-státuszú eurobarometer a dedikált adapterre menne (reaktiválás = 1 flip)", () => {
  // A live config parkolt; a routingot szintetikus OK-forráson igazoljuk, hogy az
  // újraaktiváláskor a channelsOf a valós eurobarometer modulra routol (nem generikus).
  const synthetic = { id: "eurobarometer", kaszt: "B", adapter: "eurobarometer", status: "OK", list_url: "https://europa.eu/eurobarometer/" };
  assert.equal(isActiveSource(synthetic), true, "adapter + OK → aktív lenne");
  const ch = channelsOf(synthetic);
  assert.equal(ch.length, 1, "pontosan egy csatorna");
  assert.equal(ch[0].fetcher, eurobarometer, "a dedikált eurobarometer adapter viszi (registry ép)");
});

test("B2 parkolva: FAIL-CLOSED — adapter status OK NÉLKÜL NEM aktivál (ez tartja parkoltan)", () => {
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer", status: "NEM_AKTIVALT" }), false, "adapter + nem-OK → inaktív");
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer" }), false, "status hiánya → inaktív");
  assert.equal(isActiveSource({ id: "x", kaszt: "B", adapter: "eurobarometer", status: "OK" }), true, "adapter + OK → aktív");
});

test("B2 parkolva: regresszió — az E2 (europeelects) továbbra is aktív (a park nem érinti)", () => {
  const activeIds = new Set(selectActiveSources(sources).map((s) => s.id));
  assert.ok(activeIds.has("europeelects"), "europeelects marad aktív");
  assert.ok(!activeIds.has("eurobarometer"), "eurobarometer parkolt");
});
