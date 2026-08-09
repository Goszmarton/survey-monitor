// Közös HTTP-réteg a fetcherekhez: 20s timeout, udvarias User-Agent,
// injektálható fetchImpl (a tesztek így hálózat nélkül futnak).

export const USER_AGENT = "survey-monitor/0.1 (+https://github.com/Goszmarton/survey-monitor)";
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Egy GET-lekérés timeouttal. A választ nyersen adja vissza (status + testolvasók),
 * a hívó dönt bytes/text között. Hiba/timeout esetén dob — a fetcher kapja el.
 * @returns {Promise<{status:number, ok:boolean, contentType:string|null, bytes:()=>Promise<Buffer>, text:()=>Promise<string>}>}
 */
export async function httpGet(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" },
    });
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers?.get?.("content-type") ?? null,
      bytes: async () => Buffer.from(await res.arrayBuffer()),
      text: async () => res.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A forrás legfrissebb tételének dátuma, GRANULARITÁS-TUDATOSAN — a monthOnly tétel HÓ-szintet
 * (ÉÉÉÉ-HH), minden más NAP-szintet (ÉÉÉÉ-HH-NN) ad. A monthOnly tétel 1-jére van dátumozva,
 * de a nap fiktív (a homepage nem ad napot), ezért nap-pontosságot ott NEM hazudunk. Dátumtalan
 * tétel kimarad; ha egyik sem datált → null. (RSS: valós időbélyeg, monthOnly nincs → nap-szint.)
 * @returns {string|null} ÉÉÉÉ-HH vagy ÉÉÉÉ-HH-NN
 */
export function latestItemDate(items) {
  let best = null;
  for (const it of items ?? []) {
    const t = it?.publishedAt ? Date.parse(it.publishedAt) : NaN;
    if (Number.isNaN(t)) continue;
    if (!best || t > best.t) best = { t, monthOnly: Boolean(it.monthOnly) };
  }
  if (!best) return null;
  const iso = new Date(best.t).toISOString();
  return best.monthOnly ? iso.slice(0, 7) : iso.slice(0, 10);
}

/**
 * Egységes NINCS_UJ napló-detail: darabszám + (ha van datált tétel) a legfrissebb dátuma,
 * gépileg kinyerhetően (`legfr. <dátum>`). Közös rss.js és htmllist.js közt — hogy egy új
 * forrás-típusnál ne felejtődjön el a dátum-rögzítés (a duplikáció ellen).
 */
export function noNewItemsDetail(items) {
  const d = latestItemDate(items);
  return `${(items ?? []).length} tétel, egyik sem újabb${d ? `, legfr. ${d}` : ""}`;
}

/** Hibaüzenet normalizálása a source_checks.detail mezőhöz. */
export function describeError(err, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (err?.name === "AbortError") return `időtúllépés (${Math.round(timeoutMs / 1000)}s)`;
  return err?.message ? String(err.message) : String(err);
}
