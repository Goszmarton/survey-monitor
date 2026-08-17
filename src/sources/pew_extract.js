// Pew — az EGYETLEN valódi agentikus B-forrás (§1). A felfedezés RSS-ből kész (fixture,
// title_filter), de a magyar adat a cikk ADATTÁBLÁJÁBAN rejlik → a szám-kinyerés a valódi
// ügynök-munka. Itt kell a grounding-verifikáció (§2) + az injektált-adapter tesztminta.
//
// HÁROM réteg (§3), ebből KETTŐ determinisztikusan RED-teszthető:
//  1. determinista héj: `Hungar`-pre-grep — ha nincs magyar említés, az EGÉSZ agentikus ág
//     kimarad (0 LLM). A legolcsóbb kvóta-guard (§5).
//  2. LLM-határ (injektált adapterrel): a modell HÁRMAST ad soronként.
//  3. grounding-verifikáció (§2): a KÓD determinisztikusan ellenőrzi, hogy a szó szerinti idézet
//     (normalizálás után) BENNE van-e a letöltött dokumentumban. Ha nincs → a tétel ELVETVE
//     (a modell hallucinált). A veszélyes hibamódot — fabrikált magyar szám — RED-teszthetővé teszi.
//
// STÁTUSZ: a kinyerés-réteg + grounding-guard KÉSZ; a pew-aktiválás (a triázson FELÜLI kinyerés
// bekötése, külön provider-lánccal + burst-előméréssel, §5) későbbi, levél-ható lépés.

// A modell kimeneti szerződése: HÁRMAS soronként (nem csak egy szám).
export const EXTRACT_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["ertek", "szo_szerinti_idezet", "tabla_vagy_szekcio_fejlec"],
    properties: {
      ertek: { type: "string" },
      szo_szerinti_idezet: { type: "string" },
      tabla_vagy_szekcio_fejlec: { type: "string" },
    },
  },
};

// Determinista pre-grep: a `Hungar` prefix fedi a Hungary/Hungarian/Hungarians alakokat (a pew
// angol). Ha nincs találat → 0 LLM-hívás. (A magyar-nyelvű forrásoknál a "Magyar" is ide vehető,
// de a pew angol; a prefix szándékosan szűk, hogy ne triggereljen álpozitívra.)
export function hasHungarianData(text) {
  return /Hungar/i.test(String(text ?? ""));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Grounding-normalizálás: entity-feloldás + whitespace-összevonás (a tördelés/entity-eltérés ne
// okozzon hamis elvetést). Kis-nagybetűt MEGTARTJA — a "szó szerinti idézet" verbatim, a
// szigorúbb (case-sensitive) illesztés jobb fabrikáció-detekció.
export function normalizeForGrounding(s) {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

/**
 * Grounding-guard: a hármas idézete (normalizálva) substringként jelen van-e a (már normalizált)
 * dokumentumban. Üres idézet → false (grounding nélkül nem tárolható).
 */
export function isGrounded(triple, normalizedDoc) {
  const q = normalizeForGrounding(triple?.szo_szerinti_idezet ?? "");
  if (q === "") return false;
  return normalizedDoc.includes(q);
}

function buildPrompt(document) {
  return [
    "Egy nemzetközi közvélemény-kutatási riport szövegéből MAGYAR (Hungary) vonatkozású adatokat nyersz ki.",
    "MINDEN kinyert adathoz add meg pontosan ezt a hármast:",
    "  - ertek: a magyar érték (pl. \"45%\", \"1,2 millió\"),",
    "  - szo_szerinti_idezet: a forrásszöveg SZÓ SZERINTI részlete, ami az értéket tartalmazza (ne fogalmazd át!),",
    "  - tabla_vagy_szekcio_fejlec: a tábla vagy szekció fejléce, ahonnan az érték származik.",
    "SOHA ne találj ki értéket: ha egy szám nincs a szövegben szó szerint, NE add meg. A szó szerinti idézetet a rendszer ellenőrzi a forrásszövegben.",
    "Válaszolj KIZÁRÓLAG egy JSON-tömbbel, elemenként {ertek, szo_szerinti_idezet, tabla_vagy_szekcio_fejlec}.",
    "",
    "--- RIPORT SZÖVEGE ---",
    document,
  ].join("\n");
}

/**
 * A teljes kinyerés-réteg. Determinista kapu → LLM-határ → grounding-verifikáció.
 * @param {object} p
 * @param {string} p.document        a letöltött riport szövege
 * @param {function} p.completeFn    (role, prompt, {schema, log}) → {data}|null
 * @param {Array} [p.log]
 * @returns {Promise<{items:Array, rejected:Array, llmCalled:boolean}>}
 */
export async function extractHungarianData({ document, completeFn, log = [] }) {
  // Réteg 1: determinista pre-grep — nincs magyar → 0 LLM.
  if (!hasHungarianData(document)) return { items: [], rejected: [], llmCalled: false };

  // Réteg 2: LLM-határ.
  const res = await completeFn("extract", buildPrompt(document), { schema: EXTRACT_SCHEMA, log });
  if (res == null) return { items: [], rejected: [], llmCalled: true };

  // Réteg 3: grounding-verifikáció — a fabrikált (nem grounded) tételek ELVETVE, láthatóan.
  const normDoc = normalizeForGrounding(document);
  const items = [], rejected = [];
  for (const t of res.data) (isGrounded(t, normDoc) ? items : rejected).push(t);
  return { items, rejected, llmCalled: true };
}
