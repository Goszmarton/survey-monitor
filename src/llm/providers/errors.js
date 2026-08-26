// HTTP-hiba → dobható Error a válasz státuszkódjával (a complete() ebből
// képzi a HTTP_<code> fallback-triggert). Titokmaszkolás: a hibarészlet a
// providers_used-ba és a PUBLIKUS jelentés-láblécbe kerülhet, ezért soha nem
// szivároghat ki API-kulcs (query-stringben, Bearer-tokenben, api_key-ben).

// Per-hívás időkorlát az LLM-adapterekre (bounded, nem az undici-default ~perc).
// OK (2026-08-26 step-timeout bukás): a bare `fetch` timeout NÉLKÜL a beragadó, tartósan
// degradált gemini-kapcsolatot batchenként az undici-defaultig lógatta → a triázs 25 perc
// alatt sem végzett. 30s bőven elég egy egészséges triázs/szintézis-hívásra (jellemzően
// <15s), de 13 batchen át is korlátos: gemini-hang 13×30s ≈ 6,5 perc, a ~9 perces alapra
// rakva ~14,5 perc < 25 perces step-limit. (A lánc ismételt gemini-bukását tovább vághatná
// egy circuit-breaker — dokumentálva UZEMELTETES §4, nem implementált: a timeout maga elég.)
export const LLM_TIMEOUT_MS = 30_000;

/** Kulcs-szerű részletek maszkolása tetszőleges szövegben. */
export function redactSecrets(str) {
  return String(str ?? "")
    .replace(/([?&](?:key|api_key|apikey)=)[^&\s"']+/gi, "$1***")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1***")
    .replace(/(x-goog-api-key["':\s]+)[^\s"',}]+/gi, "$1***");
}

export async function httpError(res, provider) {
  let detail = "";
  try { detail = (await res.text())?.slice(0, 200) ?? ""; } catch { /* ignore */ }
  const msg = redactSecrets(`${provider} HTTP ${res.status}: ${detail}`);
  return Object.assign(new Error(msg), { status: res.status });
}
