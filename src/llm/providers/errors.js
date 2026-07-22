// HTTP-hiba → dobható Error a válasz státuszkódjával (a complete() ebből
// képzi a HTTP_<code> fallback-triggert). Titokmaszkolás: a hibarészlet a
// providers_used-ba és a PUBLIKUS jelentés-láblécbe kerülhet, ezért soha nem
// szivároghat ki API-kulcs (query-stringben, Bearer-tokenben, api_key-ben).

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
