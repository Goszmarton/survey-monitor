import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecipients } from "../src/email.js";

// A MAIL_TO guard célja: a nyers secret NÉMA kézbesítési hibáinak kivédése
// (CLAUDE.md 2). A nodemailer csak a VESSZŐS listát érti; a pontosvessző, a záró
// newline/szóköz vagy egy elgépelt cím eddig csendben ronthatta a kézbesítést.

test("egy cím → egyelemű lista, nincs figyelmeztetés", () => {
  const { recipients, warnings } = parseRecipients("a@b.hu");
  assert.deepEqual(recipients, ["a@b.hu"]);
  assert.deepEqual(warnings, []);
});

test("vesszős lista → szóköz-trim, üresek eldobva", () => {
  const { recipients, warnings } = parseRecipients("a@b.hu ,  c@d.hu , ");
  assert.deepEqual(recipients, ["a@b.hu", "c@d.hu"]);
  assert.deepEqual(warnings, []);
});

test("záró newline/szóköz → nem lesz üres címzett", () => {
  const { recipients } = parseRecipients("a@b.hu\n");
  assert.deepEqual(recipients, ["a@b.hu"]);
});

test("pontosvessző elválasztó → helyreállítás + figyelmeztetés (nodemailer csak vesszőt ért)", () => {
  const { recipients, warnings } = parseRecipients("a@b.hu; c@d.hu");
  assert.deepEqual(recipients, ["a@b.hu", "c@d.hu"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /pontosvessz/i);
});

test("üres / csak-whitespace MAIL_TO → nincs címzett + figyelmeztetés", () => {
  const { recipients, warnings } = parseRecipients("   ");
  assert.deepEqual(recipients, []);
  assert.equal(warnings.length, 1);
});

test("gyanús cím (nincs @) → megtartva, de figyelmeztetés (nem néma dobás)", () => {
  const { recipients, warnings } = parseRecipients("a@b.hu, elgepelt-cim");
  assert.deepEqual(recipients, ["a@b.hu", "elgepelt-cim"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /elgepelt-cim/);
});

test("null/undefined MAIL_TO → üres lista + figyelmeztetés, nem dob", () => {
  assert.deepEqual(parseRecipients(undefined).recipients, []);
  assert.equal(parseRecipients(null).warnings.length, 1);
});
