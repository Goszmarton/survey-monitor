import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { sources } = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
const by = (id) => sources.find((s) => s.id === id);

// A `revisit` mező egy felülvizsgálati politikát kódol. 2026-08-28-tól a fetcher a `"never"`-t
// OLVASSA (isActiveSource kizárja) — a véglegesen megszűnt forrást nem kérdezi le, de a config-
// tombstone marad. A többi érték továbbra is puszta regiszter-jelzés (a fetcher nem hat rájuk):
// "never" = a FORRÁS megszűnt, sose nézd újra (→ kizárva a gyűjtésből); "if-republishes" = a
// szervezet ÉL, de a csatorna halott/nincs → érdemes időnként újranézni; "active"/elhagyva =
// bekötött. Létjogosultsága: a
// MEGSZŰNT szabadeu (2025-11-20) és az ÉLŐ, halott-csatornás zavecz NEM ugyanaz az állapot — ezt
// egy `status`-mező (mindkettő üres/stale-jellegű) nem különbözteti meg. Ezt EGY teszt mondja ki.
test("revisit-séma: a megszűnt szabadeu (never) ≠ az élő-csatorna-halott zavecz (if-republishes)", () => {
  assert.equal(by("szabadeu").revisit, "never", "szabadeu = never (a szervezet megszűnt 2025-11-20)");
  assert.equal(by("zavecz").revisit, "if-republishes", "zavecz = if-republishes (intézet él, csatorna halott)");
  assert.notEqual(by("szabadeu").revisit, by("zavecz").revisit, "a két állapot a regiszterben elkülönül");
});

// last_content: a legutóbbi VALÓS tétel ISO-dátuma (ahol mértük) — egy mechanikus STALE-sweep
// alapja, a szöveges note elolvasása nélkül.
test("revisit-séma: last_content a felmért forrásokon a mért dátum", () => {
  assert.equal(by("szabadeu").last_content, "2025-11-20");
  assert.equal(by("zavecz").last_content, "2023-09-27");
  assert.equal(by("realpr93").last_content, "2026-02-09");
  assert.equal(by("nezopont").last_content, "2026-04-13");
});

// TARTÓSAN NEM SZÁLLÍTÓ forrás jelölése KÉT ORTOGONÁLIS regiszter-mezővel (nincs új séma):
//   status  = „szállít-e MOST?"     → HIBA_TARTOS = bekötve, de tartósan nem szállít
//   revisit = „visszajön-e valaha?" → never = végleg halott | active = él, várható visszatérés
// A két eset (szabadeu végleg megszűnt / 21kutato átmenetileg IP-blokkolt) NEM ugyanaz az
// állapot — a KÜLÖNBSÉGET a `revisit` viszi (never ≠ active), NEM a status. Egy mezőbe gyúrva
// ugyanazt a hibát követnénk el, mint a revisit előtt. A `status`-t a fetcher NEM olvassa; a
// `revisit`-ből a `"never"`-t IGEN (kizárja a véglegesen megszűntet → a szabadeu nyugdíjazva,
// a forrásszám 26). A 21kutato (revisit:"active") bekötve marad, a futásidejű hibája a
// source_checks-ben külön látszik. Létjogosultságát EGY teszt mondja ki (StaleSweep + napi
// verifikációs ellenőrzőpont a docs-ban, BESZAMOLO §7.)
test("egészség-jelölő: a MEGSZŰNT szabadeu és az ÁTMENETILEG-blokkolt 21kutato külön állapot", () => {
  // szabadeu: végleg halott (szervezet megszűnt 2025-11-20) — never marad, status MEGSZUNT
  assert.equal(by("szabadeu").status, "MEGSZUNT", "szabadeu = MEGSZUNT (a szervezet végleg megszűnt)");
  assert.equal(by("szabadeu").revisit, "never", "szabadeu = never (sose nézd újra)");
  // 21kutato: a forrás ÉL, csak a runner-IP blokkolt → HIBA_TARTOS + active (magától visszaáll)
  assert.equal(by("21kutato").status, "HIBA_TARTOS", "21kutato = HIBA_TARTOS (tartós 403, bekötve marad)");
  assert.equal(by("21kutato").revisit, "active", "21kutato = active (él, várható visszatérés)");
  // a KÜLÖNBSÉGET a revisit viszi, nem a status: a két tartós-hibás forrás NEM ugyanaz
  assert.notEqual(by("szabadeu").revisit, by("21kutato").revisit, "végleges (never) ≠ átmeneti (active)");
});
