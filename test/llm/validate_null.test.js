import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../../src/llm/validate.js";

// #5: a significance required+enum string volt, de relevant=false-nál a modellek
// null-t adnak. A validátornak engednie kell a type-tömböt (["string","null"]) és a
// null enum-értéket — különben a fallback-lánc feleslegesen bukna.
const SIG = { type: ["string", "null"], enum: ["KIEMELT", "FONTOS", "FIGYELENDO", null] };

test("validate: significance null megengedett (type-tömb + null enum) (#5)", () => {
  assert.equal(validate(null, SIG).ok, true);
  assert.equal(validate("KIEMELT", SIG).ok, true);
});

test("validate: enum-on kívüli string továbbra is bukik (#5)", () => {
  const r = validate("EGYEB", SIG);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /enum/);
});

test("validate: type-tömb rossz típusnál bukik, az elfogadott típusokat listázza (#5)", () => {
  const r = validate(42, SIG);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /string\|null/);
});

test("validate: TRIAGE-elem — relevant=false + significance null séma-helyes (#5)", () => {
  const itemSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "relevant", "significance"],
    properties: { id: { type: "integer" }, relevant: { type: "boolean" }, significance: SIG },
  };
  assert.equal(validate({ id: 1, relevant: false, significance: null }, itemSchema).ok, true);
});
