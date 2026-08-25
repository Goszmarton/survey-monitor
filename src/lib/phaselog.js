// Fázis-időbélyeg a run.js orchesztrátorhoz — levél-semleges (csak stdout, a napló).
//
// TANULSÁG (2026-08-24 néma-beragadás + 2026-08-25 lokalizálhatatlan 22 perc): a run.js
// NÉMA volt a collect-kezdet és a "Jelentés kész" közt (0 fázis-időbélyeg). Emiatt a
// 08-25-i futásnál — ahol a "Napi futás" lépés 22m20s volt (a 25 perces step-timeout
// ~2m40s margóján belül), MIKÖZBEN a triázs-batchszám 13 = a 9 perces 08-23-mal AZONOS —
// NEM volt visszakereshető, MELYIK fázis (collect / triázs+szintézis / render+dedup /
// email) vitte az időt. A per-batch wall-clock triplázódott (41s→103s), a batch-szám
// lapos maradt → a §6 "lineáris a tételszámmal" hipotézist a mérés cáfolta, de lokalizálni
// nem lehetett. Ez a helper egy egységes, gépi-parse-olható egy soros fázis-jelet ad, hogy
// a KÖVETKEZŐ lassú futásnál a fázis azonnal azonosítható legyen a Napi-futás-logból.
//
// Formátum (stabil, ne törd meg — a jövőbeli log-elemzés erre a mintára épülhet):
//   ⏱ fázis "<label>": <mp 1 tizedessel>s

export function phaseLine(label, elapsedMs) {
  const secs = (Math.max(0, elapsedMs) / 1000).toFixed(1);
  return `⏱ fázis "${label}": ${secs}s`;
}
