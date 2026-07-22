// Szintézis (F2, spec 19-20. pont): „Mi jelent meg az elmúlt 24 órában?" —
// 1-2 tömör magyar bekezdés a releváns tételekből. Végső fallback = SKIP:
// ha minden provider kiesik, a complete() null-t ad → a jelentés bekezdés
// nélkül megy ki (sosem marad el).

function buildPrompt(items) {
  const lines = items
    .slice(0, 25)
    .map((it) => `- [${it.significance ?? "?"}] ${it.title ?? ""} (${it.source_id})`);
  return [
    "Írj 1-2 tömör, tárgyilagos magyar bekezdést arról, mi jelent meg az elmúlt 24 órában a magyar közélet/gazdaság/kutatás témában, az alábbi tételek alapján.",
    "Ne sorold fel egyesével őket; emeld ki a legfontosabbakat (KIEMELT, majd FONTOS). Kerüld a felesleges bevezetőt. Csak a bekezdés(eke)t add vissza, formázás nélkül.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * @param {Array} items  releváns tételek (title, source_id, significance, freshness)
 * @returns {Promise<{text:string, provider?:string, model?:string}|null>}
 */
export async function synthesize(items, { completeFn, log = [] }) {
  const relevant = items.filter((it) => it.significance); // triázs után jelentőséggel bíró tételek
  if (relevant.length === 0) return null;

  const res = await completeFn("synthesis", buildPrompt(relevant), { log });
  if (res == null || !res.text?.trim()) return null;
  return { text: res.text.trim(), provider: res.provider, model: res.model };
}
