# Döntés: szintézis ↔ triázs-rangsor eltérés (2026-08-17)

**Státusz:** ✅ **LEZÁRVA (2026-08-17).** Mérés-alapú döntés-előkészítő, a userrel egyeztetve.

## VERDIKT

**(C) ELFOGADVA** — az eltérés KERETEZÉSE, nem az összehangolás kikényszerítése. A szintézis
(újságírói szaliencia, 24h) és a rangsor (adat-jelentőség, kapuzott, 14 nap) KÜLÖNBÖZŐ kérdésre
válaszol; a kettő közti rés maga a hasznos jel (§4), nem bug.

- **(A) triázs-mérvadó — ELVETVE:** a szintézist a lista prózai visszhangjává fokozná le, és a kapu
  hír-elnyomását a humán összefoglalóba is bevinné → rontja a helyzeti tudatosságot (§3/A).
- **(B) szintézis-mérvadó — ELVETVE (elvi okból):** nem-determinista, nem-auditálható LLM-szerkesztést
  tenne az auditálható rangsor élére — a teljes kapu/`significance_raw` audit-architektúra megfordítása
  (CLAUDE.md 2), nem-reprodukálható jelentés, a hír-adat-infláció visszahozása (§3/B).

A (C) végrehajtása a szekció-címek élesítése — **nevesített hátralévő feladat, ld. §5** (levél-ható,
RED-teszt, külön nap; NEM része ennek a commitnak).

---

**Miért kellett MOST dönteni:** hetek óta „tervezési döntés, nem bugfix" címkével nyitva, és az
**E2 (europeelects aktiválás) UTÁN nehezebb**: akkor élő poll-tételeken kellene átállítani, és a
poll-adat épp a leginkább érintett eset (ld. §5, „Miért most").

**Módszer:** mérés előbb, nem elmélet. Forrás: a 08-16-i rendert archív (`archive/2026/08/16.html`
— az EGYETLEN teljesen renderelt nap, mert az F4-B archív 08-16-tól gyűlik) + a `state/monitor.db`
08-16-i állapota. **Korlát (CLAUDE.md 4/5): a szintézis-szöveg SEHOL nem perzisztál** (a `runs`
táblának nincs ilyen oszlopa) → a szerkesztői eltérés csak 1 renderelt napra mérhető közvetlenül;
a DB az utolsó futás (08-16) eloszlását adja. A „mit emel ki a szintézis" alább kulcsszó-heurisztika
a szövegen (közelítő, és a dedup ELŐTTI sztori-szatelliteket felduzzasztja — ez maga is tanulság).

---

## 1. Mekkora a jelenség, milyen irányban? (mérve, 08-16)

**Két, SZERKEZETILEG különböző bemenet:**

| | szintézis bemenete | rangsor (rendezés) bemenete |
|---|---|---|
| kód | `enrich.js:56` `relevantFresh` | `report.js:101` `sortItems` |
| halmaz | UJ_24H & relevant & !missing, **dedup ELŐTT** | MINDEN látható (report) / UJ_24H reprezentánsok (digest), **dedup UTÁN** |
| 08-16 méret | **80 tétel** (2 KIEMELT, 22 FONTOS, 56 FIGYELENDO) | 905 KIEMELT/FONTOS (14-napos ablak) |

**Eltérés-forrás 1 — STRUKTURÁLIS (a Pages-jelentésben):** a rangsor-csúcs (905 KIEMELT/FONTOS)
**97%-a KORABBI** (881/905: 797 FONTOS+68 KIEMELT KORABBI, 13+3 H24_48) → a szintézis (csak UJ_24H)
**SOHA nem látja.** A Pages-riportban a szintézis-bekezdés és a jelentőségi táblák halmaza gyakorlatilag
diszjunkt: a bekezdés „utolsó 24 óra", a táblák „14 napos jelentőségi tábla". Ez tervezett (a szekció
címe „Mi jelent meg az utolsó 24 órában?"), de azt jelenti, hogy szintézis≠rangsor itt SZERKEZETI, nem
összehangolással javítható.

**Eltérés-forrás 2 — SZERKESZTŐI (a napi levélben, ahol MINDKÉT halmaz UJ_24H):** irány egyértelmű és
rendszeres:
- **A szintézis FELHOZ adat nélküli, de a nap narratíváját uraló FIGYELENDO-sztorikat.** 08-16: a vezető
  bekezdés az **M3-as busztragédia** (KIEMELT #1 — ITT egyezik a rangsorral, mert az áldozatszám miatt
  data_backed), DE a 2. bekezdés a Paks-fenékküszöb, Alkotmánybíróság/Tisza, Brüsszel-korrupció, Kőszegi
  erdőtűz, Samsung-Göd köré épül — ezek `data_backed=false` → a kapu FIGYELENDO-ra húzta → a rangsor
  aljára. A heurisztika **27 FIGYELENDO** UJ_24H tételt jelöl „szintézis felhozta"-ként (az 56-ból), de
  ezek NAGY RÉSZE ugyanannak a 3-4 sztorinak a dedup-előtti szatellitje (részvétnyilvánítás, videó,
  áldozatszám külön forrásokból) — a szintézis a sztorit EGYSZER említi.
- **A szintézis ELEJT data_backed FONTOS/KIEMELT tételeket.** 08-16: a **22 FONTOS UJ_24H-ból 14-et NEM
  emel ki** (energiabiztonság-tetők, budapesti rakodási díj, tengerek melegedése, Óbudai Gázgyár,
  200 ezer tonna szennyezett talaj a Dunánál, NKA-rendberakás, kártyás-fizetés-kimaradás, pakisztáni
  diákok, MMR-vakcina-cáfolat, stb.), és a **„Több éves csúcson a dízelár" KIEMELT** tételt sem említi.

**Összegzés az irányról:** a **szintézis az ÚJSÁGÍRÓI SZALIENCIA** felé húz (mi a nap nagy sztorija,
adat nélkül is), a **rangsor az ADAT-JELENTŐSÉG** felé (a kapu a hírt lehúzza, az adatot felhozza).

---

## 2. Jelenlegi viselkedés a kódban — melyik nyer, hol dől el?

**EGYIK SEM „nyer" — mert nem ütköznek: külön UI-szekcióban renderelnek.** Nincs kódút, ahol az egyik
felülírná a másikat.

- **Rangsor:** `sortItems` (`report.js:101`) — jelentőség-elsődleges (`SIGNIF.rank`), majd frissesség,
  majd `published_at`. Determinista. Hajtja: a Pages-táblákat (minden látható), a digest-listát (UJ_24H
  reprezentánsok), a KIEMELT-levelet.
- **Szintézis:** `synthesize` (`synthesis.js`) — LLM-próza a `relevantFresh`-ből; a prompt kéri: „emeld
  ki a legfontosabbakat (KIEMELT, majd FONTOS)". Szabad szerkesztői kimenet. Renderel: a `.synth`
  bekezdés a „24h" szekcióban (`report.js:276`, `renderDigest:382`).
- **A pivot a KAPU** (`gatedSignificance`, `triage.js`): a `data_backed=false` hírt FIGYELENDO-ra húzza
  a RANGSORBAN, de a szintézis-LLM a kaput FIGYELMEN KÍVÜL hagyja (szaliencia szerint emel ki). Innen az
  eltérés iránya. A jelentőséget a triázs dönti; a szintézis kiemelését az LLM (`synthesis.js:26`); a
  sorrendet a `sortItems`. Három különböző döntési pont, egy közös bemeneti jelentőség-címkével.

---

## 3. Három lehetséges döntés — és mit veszítünk mindegyikkel

**(A) A triázs a mérvadó** — a szintézist kössük a jelentőség-sorrendhez (pl. csak KIEMELT/FONTOS
menjen a szintézis bemenetébe; vagy utó-ellenőrzés, hogy a vezető mondat a top-tételről szóljon).
→ **Veszteség:** elvész az újságírói „mi a nap nagy sztorija" vezetés. 08-16-on a szintézis NEM a
busztragédia-narratívával vezetne, csak a KIEMELT egysorossal. A szintézis a rangsor prózai
visszamondásává válik — kevesebb infó. A kapu hír-elnyomása BESZIVÁROGNA a próza-összefoglalóba: egy
nagy, adat nélküli hír (választás, katasztrófa) által uralt napon a levél összefoglalója apró
adattételekről szólna → rossz helyzeti tudatosság a humán olvasónak.

**(B) A szintézis a mérvadó** — a rangsort igazítsuk a szintézis kiemeléséhez (a szintézis-említett
tételek feljebb).
→ **Veszteség:** elvész az adat-jelentőségi fegyelem ÉS az auditálható, determinista rangsor. Egy
nem-determinista, nem-auditálható, sorrend-halluciációra hajlamos LLM-ítélet hajtaná a rangsort —
ez az EGÉSZ kapu/`significance_raw` audit-architektúra megfordítása (CLAUDE.md 2). A jelentés
nem-reprodukálható lenne, és pont a hír-adat-inflációt hozná vissza, amit a kapu kizár. **Elvi okból
kizárt egy determinista adat-monitorban.**

**(C) Az eltérés jelölése/keretezése** — mindkét mechanizmus marad függetlenül, de a viszony
EXPLICIT: a szintézis-szekció = „napi narratíva (újságírói kiemelés, 24h)", a táblák = „adatjelentőség
szerint (kapuzott, 14 nap)". Opcionális könnyű jel: ha a szintézis vezető sztorija kapuzott
(FIGYELENDO/`data_backed=false`), az a „hír-nehéz, adat-könnyű nap" markere.
→ **Veszteség:** minimális — becsületes és olcsó. Egyik lencsét sem áldozza fel. Az egyetlen „ár", hogy
nem OLDJA FEL a feszültséget (de a feszültség legitim, nem bug). Kis UI-komplexitás. (A teljes
„eltérés-flag" strukturált szintézis-kimenetet kívánna — melyik tételt vezeti —, ami ma szabad próza;
ez KÉSŐBBI finomítás, most nem kell.)

---

## 4. Van-e eset, ahol az eltérés HASZNOS jel? — IGEN, ez a kulcs

Az eltérés MAGA a jel, nem a hiba:
- **Amikor a szintézis felhoz valamit, amit a rangsor eltemet (FIGYELENDO):** azt jelöli, hogy „a nap
  uralkodó híre mögött nincs kemény adat" — pontosan a kapu dolga, láthatóvá téve. 08-16: a
  busztragédia + Paks + Alkotmánybíróság uralta a hírfolyamot, de nagyrészt adatmentes politika/esemény
  → az eltérés megmutatja, hogy a nap „hír-nehéz, adat-könnyű" volt.
- **Amikor a rangsor felhoz KIEMELT/FONTOS adatot, amit a szintézis figyelmen kívül hagy** (dízelár,
  14 FONTOS tétel): azt jelöli, hogy „jelentős adat, ami nem került be a hír-narratívába" — a monitor
  EGYEDI értéke (a sajtó által aluljátszott adat elkapása).

A két lencse KOMPLEMENTER: szintézis = „miről beszél mindenki", rangsor = „mit mondanak a számok". A
kettő KÖZTI RÉS szerkesztőileg értelmes.

---

## 5. Javaslat + indoklás

**Javaslat: (C) — az eltérés keretezése, NEM az összehangolás kikényszerítése.**

Indoklás:
1. A két mechanizmus KÜLÖNBÖZŐ kérdésre válaszol (narratíva-szaliencia vs adat-jelentőség) — az egyik
   másikhoz kötése egy legitim lencsét semmisít meg.
2. A (B) elvileg kizárt: nem-determinista LLM-szerkesztést tenne az auditálható rangsor élére,
   megfordítva a teljes kapu/`significance_raw` designt (CLAUDE.md 2).
3. Az (A) a szintézist a lista prózai visszhangjává fokozza le, és a kapu hír-elnyomását a humán
   összefoglalóba is beviszi → rontja a helyzeti tudatosságot.
4. Az eltérés HASZNOS jel (§4) → a helyes lépés láthatóvá tenni, nem megszüntetni.

### HÁTRALÉVŐ FELADAT — SZEKCIÓ-CÍM-ÉLESÍTÉS (a (C) végrehajtása)

**Nevesített, önálló feladat — NEM „minimál lépés" a szövegben, hogy ne csússzon el. Levél-ható →
KÜLÖN nap, RED-teszttel (a digest+report+KIEMELT MINDKÉT render-ágának tesztje kell — [[f3-plan]]
tanulság). Most NEM implementálva.**

A két szekció címének élesítése, hogy a viszony explicit legyen a humán olvasónak:
- **Szintézis-szekció** (`report.js` „24h" `<h2>` + `renderDigest`): jelenlegi „Mi jelent meg az utolsó
  24 órában?" → **„📰 Napi narratíva (utolsó 24 óra)"**.
- **Táblák-szekció** (`report.js` „tablak" `<h2>`): jelenlegi „Tételek jelentőség szerint" →
  **„📊 Adatjelentőség szerint, kapuzott"**.

RED-teszt: a renderelt digest ÉS report a helyes új címeket tartalmazza (a régi szöveg NINCS jelen).
Kimenet CSAK a két címben változik → egyébként bájtazonos. **KÉSŐBBI, opcionális finomítás** (nem
ez a feladat): strukturált „vezető-sztori-flag" (a kapuzott vezetés kijelölése) — strukturált
szintézis-kimenetet kíván, külön döntés.

**Miért most, az E2 ELŐTT (a user keretezése):** E2 után az europeelects poll-sorok data_backed=true
KIEMELT/FONTOS-ként lépnek be → a TÁBLÁKBAN helyesen felülre rangsorolódnak (ez a cél, ez a domén magja),
DE aggregátor-frissítések (~heti 1-2), ritkán a nap hír-narratívája → a szintézis (UJ_24H, szaliencia)
gyakran figyelmen kívül hagyja őket. Vagyis **E2 után az eltérés NŐ.** A (C) most eldöntve azt jelenti,
hogy E2 nem kíván újrahangolást: a poll-adat jelentőség szerint helyesen rangsorolódik, a szintézis
narratíva-lencse marad — az eltérés VÁRT és keretezett, nem regresszió. (A) vagy (B) mellett E2
átdolgozást kényszerítene: a poll-adat vagy a szintézist torzítaná, vagy a rangsort.

---

*Készült: 2026-08-17. Forrás: `archive/2026/08/16.html` (N=1 renderelt nap — a szintézis nem perzisztál,
CLAUDE.md 4/5 becsületes részlegesség), `state/monitor.db` 08-16 állapot, a repo kódja (`synthesis.js`,
`report.js:101` sortItems, `enrich.js:56`, `triage.js` gatedSignificance). Kapcsolódó:
`ARCHITEKTURA.md` §7, `run.js` notCovered (rendezési sorrend: freshness vs significance — KÜLÖN kérdés).*
