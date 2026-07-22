// Frissességi státusz — tisztán kód, a futás pillanatában számolva (spec 14. pont).
// A published_at (ha ismert) vagy a first_seen_at az alap. Órát-percet sosem
// találunk ki: ha a forrás nem adja a publikációs időt, a first_seen_at vezérel.

const H = 3600 * 1000;

const toMs = (v) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));

/**
 * @returns {"UJ_24H"|"H24_48"|"KORABBI"|"KIHAGYOTT_MOST"}
 * KIHAGYOTT_MOST = a publikáció >48h, de a tételt EBBEN a futásban láttuk először
 * (⚠️ korábban kihagyott, most azonosított). Ehhez runStartedAt szükséges.
 */
export function computeFreshness({ publishedAt, firstSeenAt, now, runStartedAt } = {}) {
  const nowMs = toMs(now);
  const pub = toMs(publishedAt);
  const seen = toMs(firstSeenAt);
  const runStart = toMs(runStartedAt);

  const newThisRun = runStart != null && seen != null && seen >= runStart;

  // Ha van publikációs idő, az az elsődleges tengely.
  if (pub != null) {
    const pubAge = nowMs - pub;
    if (pubAge > 48 * H && newThisRun) return "KIHAGYOTT_MOST";
    if (pubAge <= 24 * H) return "UJ_24H";
    if (pubAge <= 48 * H) return "H24_48";
    return "KORABBI";
  }

  // Publikációs idő nélkül a first_seen_at vezérel.
  const seenAge = nowMs - (seen ?? nowMs);
  if (seenAge <= 24 * H) return "UJ_24H";
  if (seenAge <= 48 * H) return "H24_48";
  return "KORABBI";
}
