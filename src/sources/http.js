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

/** Hibaüzenet normalizálása a source_checks.detail mezőhöz. */
export function describeError(err, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (err?.name === "AbortError") return `időtúllépés (${Math.round(timeoutMs / 1000)}s)`;
  return err?.message ? String(err.message) : String(err);
}
