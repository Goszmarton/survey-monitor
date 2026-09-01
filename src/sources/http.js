// Közös HTTP-réteg a fetcherekhez: 20s timeout, BÖNGÉSZŐ User-Agent, tranziens-retry,
// injektálható fetchImpl (a tesztek így hálózat nélkül futnak).

// 2026-09-01 (user: 21kutato/policysol „meg kell oldani"): a korábbi bot-UA
// ("survey-monitor/0.1 …") ellen egyes Cloudflare-védett helyek 403-at adtak (bot-heurisztika).
// Böngésző-UA-ra váltunk — semlegesebb, több helyen átmegy; a szerver-renderelt HTML/RSS
// tartalmát ez nem változtatja (nincs JS-végrehajtás nálunk). Ha egy IP/ASN HARD-blokkolt
// (pl. GitHub Actions egress egyes Cloudflare-szabályoknál), az UA önmagában nem elég — azt a
// következő éles futás source_check-je mutatja meg.
export const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const DEFAULT_TIMEOUT_MS = 20_000;

// Tranziens-retry: a napi 56-forrásos söprésben bármely forrás „fetch failed"-elhet átmenetileg
// (DNS/TLS/kapcsolat-reset, rate-limit, 5xx) — egy pár próbálkozás visszahozza (pl. a policysol
// 08-31-i burst-beli fetch failed-je). NEM próbálunk újra: időtúllépést (AbortError — a teljes
// időt korlátozzuk) és DETERMINISZTIKUS státuszt (403/404 stb.). Retry-célok: dobott (nem-Abort)
// hiba + 429/5xx.
export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 500;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Egy GET-lekérés timeouttal. A választ nyersen adja vissza (status + testolvasók),
 * a hívó dönt bytes/text között. Hiba/timeout esetén dob — a fetcher kapja el.
 *
 * A timeout MINDKÉT fázist fedi: a fejléc-megérkezést ÉS a törzs-olvasást. Régen a
 * timert a fejléc után (finally) törölte a kód, mielőtt a hívó a törzset (bytes()/
 * text() → arrayBuffer()/text()) beolvasta — így egy megállt/fojtott body-stream
 * IDŐTLENÜL függött (2026-08-24: webgate volumeA.xlsx a datacenter-IP-ről → a napi
 * futás 30 percig némán beragadt, job-timeout ölte meg). Most az abort-signal a
 * törzs-olvasás alatt is él: minden olvasás ÚJRA felhúzza a timert UGYANAZON a
 * controlleren (a body-stream a fetch signaljára abortál), és a végén törli.
 * @returns {Promise<{status:number, ok:boolean, contentType:string|null, bytes:()=>Promise<Buffer>, text:()=>Promise<string>}>}
 */
export async function httpGet(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, attempts = MAX_ATTEMPTS, retryDelayMs = RETRY_DELAY_MS } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Minden próbálkozás SAJÁT controllere (a fejléc-fázis korlátja); a sikeres próbálkozás
    // controllerét zárja körül a body-olvasó is.
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" },
      });
    } catch (err) {
      clearTimeout(timer);
      // Időtúllépést NEM próbálunk újra (a teljes időt korlátozzuk); minden más dobott hiba
      // (ECONNRESET, „fetch failed", DNS, TLS) TRANZIENS lehet → újrapróbáljuk backoff-fal.
      if (err?.name === "AbortError" || attempt >= attempts) throw err;
      lastErr = err;
      await sleep(retryDelayMs * attempt);
      continue;
    }
    clearTimeout(timer); // fejléc megvan; a törzs-olvasás saját (újra-felhúzott) korlátot kap

    // 429/5xx → tranziens szerver-oldal, újrapróbáljuk; 403/404/egyéb → determinista, visszaadjuk.
    if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
      await sleep(retryDelayMs * attempt);
      continue;
    }

    // A törzs-olvasót UGYANAZZAL a controllerrel korlátozzuk (a body-stream a fetch
    // signaljára abortál) — külön controller nem szakítaná meg az undici stream-jét.
    const readBody = async (consume) => {
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await consume();
      } finally {
        clearTimeout(t);
      }
    };

    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers?.get?.("content-type") ?? null,
      bytes: () => readBody(async () => Buffer.from(await res.arrayBuffer())),
      text: () => readBody(() => res.text()),
    };
  }
  throw lastErr; // elvi ág: a ciklus vagy visszatér, vagy a fenti throw-nál kilép
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
