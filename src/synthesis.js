// Szintézis (F2, spec 19-20. pont): „Mi jelent meg az elmúlt 24 órában?" —
// 1-2 tömör magyar bekezdés a releváns tételekből. Végső fallback = SKIP:
// ha minden provider kiesik, a complete() null-t ad → a jelentés bekezdés
// nélkül megy ki (sosem marad el).
//
// SZÁMSZERŰSÍTÉS + ANTI-HALLUCINÁCIÓ (2026-08-28): a rendszer CSAK a címeket
// tárolja, de a magyar hír-címek szám-gazdagok. A prompt a címekből kinyert
// „engedélyezett számok" whitelistjével kéri a modellt, hogy KONKRÉT számokat
// idézzen — kizárólag a forrásból. Utólag DETERMINISZTIKUSAN ellenőrizzük: a
// szövegben szereplő minden szám-tokennek szerepelnie kell a forrás-címekben;
// igazolatlan szám esetén EGY újragenerálás (szigorúbb whitelist), majd ha még
// mindig igazolatlan → WARN az auditba (a garantáltan valós számokat a jelentés
// „📊 Kulcsszámok" szekciója viszi, ld. report.js). „Nem hallucinálva" = a
// megjelenített szám vagy verbatim a címből (Kulcsszámok), vagy a forrás ellen
// igazolt (narratíva).

// Szám-token: számjegy-futam ezres-elválasztóval (szóköz/nbsp/pont) és tizedes
// vesszővel/ponttal. A záró/kezdő elválasztókat nem kötjük be (csak számjegyek közt).
const NUM_RE = /\d(?:[\d.,  ]*\d)?/g;

/** A szövegben szereplő nyers szám-token-sztringek (verbatim, ahogy a címben állnak). */
export function numberTokens(text) {
  const m = String(text ?? "").match(NUM_RE);
  return m ? m.map((s) => s.trim()).filter(Boolean) : [];
}

// Normalizálás az ÖSSZEHASONLÍTÁSHOZ: az ezres-elválasztó szóköz/nbsp eltűnik
// („754 700" ≡ „754700"); a tizedes vessző/pont marad (magyar szövegben vessző).
const normNum = (s) => String(s).replace(/[\s ]/g, "");

/** A szövegben szereplő, a forrásban (allowedSet normalizált) NEM igazolható szám-tokenek. */
function unverifiedNumbers(text, allowedSet) {
  return [...new Set(numberTokens(text).filter((t) => !allowedSet.has(normNum(t))))];
}

function buildPrompt(items, allowed, forbidden = []) {
  const lines = items
    .slice(0, 25)
    .map((it) => `- [${it.significance ?? "?"}] ${it.title ?? ""} (${it.source_id})`);
  const parts = [
    "Írj 1-2 tömör, tárgyilagos magyar bekezdést arról, mi jelent meg az elmúlt 24 órában a magyar közélet/gazdaság/kutatás témában, az alábbi tételek alapján.",
    "Ne sorold fel egyesével őket; emeld ki a legfontosabbakat (KIEMELT, majd FONTOS). Kerüld a felesleges bevezetőt. Csak a bekezdés(eke)t add vissza, formázás nélkül.",
    "TÁMASZKODJ KONKRÉT SZÁMOKRA: ahol egy tétel számot vagy százalékot tartalmaz, idézd be PONTOSAN úgy, ahogy a tételben szerepel. SOHA ne találj ki, ne becsülj és ne kerekíts számot — kizárólag az alábbi tételekben ténylegesen szereplő számokat használd. Ha bizonytalan vagy egy számban, inkább hagyd el.",
  ];
  if (allowed.length) {
    parts.push("", "Kizárólag EZEK a számok használhatók (a forrás-címekből, szó szerint):", allowed.join(" · "));
  }
  if (forbidden.length) {
    parts.push("", `FIGYELEM: az előző válasz olyan számo(ka)t tartalmazott, ami NINCS a forrásokban: ${forbidden.join(", ")}. Írd újra a fenti whitelist betartásával; a nem szereplő számokat hagyd el.`);
  }
  parts.push("", ...lines);
  return parts.join("\n");
}

/**
 * @param {Array} items  releváns tételek (title, source_id, significance, freshness)
 * @returns {Promise<{text:string, provider?:string, model?:string}|null>}
 */
export async function synthesize(items, { completeFn, log = [] }) {
  const relevant = items.filter((it) => it.significance); // triázs után jelentőséggel bíró tételek
  if (relevant.length === 0) return null;

  // Engedélyezett számok a forrás-címekből (verbatim a promptba, normalizált az ellenőrzéshez).
  const allowedRaw = [...new Set(relevant.flatMap((it) => numberTokens(it.title)))];
  const allowedSet = new Set(allowedRaw.map(normNum));

  const res = await completeFn("synthesis", buildPrompt(relevant, allowedRaw), { log });
  if (res == null || !res.text?.trim()) return null;

  let unverified = unverifiedNumbers(res.text, allowedSet);
  if (unverified.length === 0) return { text: res.text.trim(), provider: res.provider, model: res.model };

  // EGY újragenerálás a konkrétan kifogásolt számokkal — a modell szinte mindig javít.
  const res2 = await completeFn("synthesis", buildPrompt(relevant, allowedRaw, unverified), { log });
  if (res2 != null && res2.text?.trim()) {
    const unverified2 = unverifiedNumbers(res2.text, allowedSet);
    if (unverified2.length === 0) return { text: res2.text.trim(), provider: res2.provider, model: res2.model };
    // Tartósan igazolatlan → a legjobb próbálkozást adjuk vissza, de AUDITÁLVA (nem néma).
    log.push({ role: "synthesis", status: "WARN", detail: `igazolatlan szám a szintézisben (újragenerálás után is): ${unverified2.join(", ")}` });
    return { text: res2.text.trim(), provider: res2.provider, model: res2.model };
  }
  // A 2. hívás kiesett → az 1. szöveget adjuk, de auditáljuk az igazolatlan számot.
  log.push({ role: "synthesis", status: "WARN", detail: `igazolatlan szám a szintézisben: ${unverified.join(", ")}` });
  return { text: res.text.trim(), provider: res.provider, model: res.model };
}
