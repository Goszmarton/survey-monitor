import { test } from "node:test";
import assert from "node:assert/strict";
import { hasHungarianData, normalizeForGrounding, isGrounded, extractHungarianData } from "../../src/sources/pew_extract.js";

// A pew az EGYETLEN valódi agentikus forrás (§1): a magyar adat a cikk adattáblájában rejlik,
// nem a metaadatban. A kinyerés-réteg HÁROM rétege (§3): (1) determinista Hungar-pre-grep kapu
// (0 LLM, ha nincs magyar); (2) LLM-határ injektált adapterrel; (3) grounding-verifikáció (§2):
// a modell kimenete HÁRMAS {ertek, szo_szerinti_idezet, tabla_vagy_szekcio_fejlec}, és a KÓD
// determinisztikusan ellenőrzi, hogy az idézet (normalizálás után) BENNE van-e a dokumentumban —
// ha nem, a tétel ELVETVE (a modell hallucinált). Ez a veszélyes hibamódot (fabrikált magyar szám)
// determinisztikusan RED-teszthetővé teszi.

// Reprezentatív dokumentum-szöveg (a grounding formátum-független: substring-ellenőrzés a szövegen).
const DOC = `Views of democracy across 24 countries.
In Hungary, 45% of adults say they are satisfied with the way democracy is working,
while 54% are dissatisfied. Table 3 shows the Hungary figures alongside Poland and Slovakia.`;
const DOC_NO_HU = `In the United States and Canada, majorities favor the proposal.
Table 1 shows figures for Germany and France only.`;

// --- réteg 1: determinista Hungar-pre-grep kapu ---

test("hasHungarianData: magyar említés → true; nélküle → false", () => {
  assert.equal(hasHungarianData(DOC), true);
  assert.equal(hasHungarianData("Hungarian respondents were more likely..."), true, "Hungarian is fedi (Hungar prefix)");
  assert.equal(hasHungarianData(DOC_NO_HU), false);
});

test("extractHungarianData: Hungar-találat NÉLKÜL 0 LLM-hívás (legolcsóbb kvóta-guard)", async () => {
  let calls = 0;
  const completeFn = async () => { calls++; return { data: [] }; };
  const r = await extractHungarianData({ document: DOC_NO_HU, completeFn });
  assert.equal(calls, 0, "az egész agentikus ág kimarad, ha nincs magyar");
  assert.equal(r.llmCalled, false);
  assert.deepEqual(r.items, []);
});

// --- réteg 3: grounding-verifikáció (a fabrikáció-guard) ---

test("isGrounded: a dokumentumban SZÓ SZERINT jelen lévő idézet → elfogadva", () => {
  const t = { ertek: "45%", szo_szerinti_idezet: "In Hungary, 45% of adults say they are satisfied", tabla_vagy_szekcio_fejlec: "Views of democracy" };
  assert.equal(isGrounded(t, normalizeForGrounding(DOC)), true);
});

test("isGrounded: FABRIKÁLT idézet (nincs a dokumentumban) → elvetve", () => {
  const t = { ertek: "82%", szo_szerinti_idezet: "In Hungary, 82% of adults strongly support the government", tabla_vagy_szekcio_fejlec: "Views of democracy" };
  assert.equal(isGrounded(t, normalizeForGrounding(DOC)), false);
});

test("isGrounded: üres idézet → elvetve (nem lehet grounding nélkül tárolni)", () => {
  assert.equal(isGrounded({ ertek: "45%", szo_szerinti_idezet: "", tabla_vagy_szekcio_fejlec: "x" }, normalizeForGrounding(DOC)), false);
});

test("normalizeForGrounding: whitespace-eltérés + HTML-entity ellenére illeszkedik", () => {
  const doc = "In Hungary,&#160;45% of\n\n  adults are satisfied";
  const quote = "In Hungary, 45% of adults are satisfied"; // más whitespace, entity feloldva
  assert.equal(isGrounded({ ertek: "45%", szo_szerinti_idezet: quote, tabla_vagy_szekcio_fejlec: "x" }, normalizeForGrounding(doc)), true);
});

// --- réteg 2+3 együtt: injektált adapter, a fabrikáció-guard RED-je ---

test("extractHungarianData: grounded tétel MEGMARAD, FABRIKÁLT tétel ELVETVE (a modell nem ronthat adatot)", async () => {
  const completeFn = async (role, prompt, { log }) => {
    log?.push({ role, provider: "groq", status: "OK", usage: { total_tokens: 900 } });
    return { data: [
      // valós: az idézet a dokumentumban van
      { ertek: "45%", szo_szerinti_idezet: "45% of adults say they are satisfied", tabla_vagy_szekcio_fejlec: "Views of democracy" },
      // fabrikált: hihető szám, DE az idézet nincs a dokumentumban → grounding elveti
      { ertek: "82%", szo_szerinti_idezet: "82% of Hungarians strongly support the government", tabla_vagy_szekcio_fejlec: "Views of democracy" },
    ], provider: "groq", model: "m" };
  };
  const log = [];
  const r = await extractHungarianData({ document: DOC, completeFn, log });

  assert.equal(r.llmCalled, true);
  assert.equal(r.items.length, 1, "csak a grounded tétel marad");
  assert.equal(r.items[0].ertek, "45%");
  assert.equal(r.rejected.length, 1, "a fabrikált tétel elvetve (látható, nem néma)");
  assert.equal(r.rejected[0].ertek, "82%");
});

test("extractHungarianData: provider-kiesés (null) → üres, nem törik", async () => {
  const r = await extractHungarianData({ document: DOC, completeFn: async () => null });
  assert.equal(r.llmCalled, true);
  assert.deepEqual(r.items, []);
});
