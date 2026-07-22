import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, extractJson } from "../../src/llm/validate.js";

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id", "relevant", "significance"],
  properties: {
    id: { type: "integer" },
    relevant: { type: "boolean" },
    significance: { type: "string", enum: ["KIEMELT", "FONTOS", "FIGYELENDO"] },
    reason: { type: "string" },
  },
};
const BATCH = { type: "array", items: ITEM };

test("valid objektum átmegy", () => {
  assert.deepEqual(validate({ id: 1, relevant: true, significance: "FONTOS" }, ITEM), { ok: true, errors: [] });
});

test("hiányzó kötelező mező elbukik", () => {
  const r = validate({ id: 1, relevant: true }, ITEM);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /significance/);
});

test("rossz enum-érték elbukik", () => {
  const r = validate({ id: 1, relevant: true, significance: "EGYEB" }, ITEM);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /significance|enum/i);
});

test("rossz típus elbukik (relevant string)", () => {
  const r = validate({ id: 1, relevant: "igen", significance: "FONTOS" }, ITEM);
  assert.equal(r.ok, false);
});

test("additionalProperties:false → ismeretlen mező elbukik", () => {
  const r = validate({ id: 1, relevant: true, significance: "FONTOS", xxx: 1 }, ITEM);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /xxx/);
});

test("tömb: minden elem validálva", () => {
  assert.equal(validate([{ id: 1, relevant: true, significance: "FONTOS" }], BATCH).ok, true);
  const bad = validate([{ id: 1, relevant: true, significance: "FONTOS" }, { id: 2 }], BATCH);
  assert.equal(bad.ok, false);
});

test("extractJson: tiszta JSON, kódkerítéses, és szöveggel körülvett", () => {
  assert.deepEqual(extractJson('[{"id":1}]'), [{ id: 1 }]);
  assert.deepEqual(extractJson('```json\n[{"id":1}]\n```'), [{ id: 1 }]);
  assert.deepEqual(extractJson('Itt a válasz: [{"id":1}] kész.'), [{ id: 1 }]);
  assert.equal(extractJson("nincs json"), null);
});
