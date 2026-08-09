# Beszámoló — F2-fix3 → F3 (2026-07-30 … 2026-08-07)

Mit csináltunk az F2-fix3 javító kör óta, számokkal. A számok a commitolt
`state/monitor.db`-ből és a kódból igazolva (CLAUDE.md 4), nem emlékezetből.

---

## 1. F2-fix3 — a hat javítás (2026-07-30, commit `841a4e9`)

8 napos éles futási adat alapján, mind regressziós teszttel (RED→zöld). A `#N`
számozás a teszt-nevekben visszakövethető.

| # | javítás | lényeg |
|---|---|---|
| **#1** | Cron SLA | `43 3 * * *` → `43 0 * * *` (00:43 UTC). A mért **142–188 perces** GitHub-Actions-késés miatt a levél reggelre érjen. |
| **#2** | Beragadt „hiányzó ítélet" | A missing verdikt NEM ír `triage_json`-t → újrapróbálható marad; a `triage_missing` tétel megjelölve + naplóban a darabszám. Kísérő migráció: `resetStuckMissingVerdicts` (idempotens). |
| **#3** | Cross-source story-dedup | Determinisztikus (LLM nélkül) csoportosítás: token-containment ≥0.5 (≥2 közös) VAGY trigram-dice ≥0.55. **Intézet-guard** kemény szabály a küszöbök fölött. Rep = leghitelesebb forrás, a többi `press_urls`-be. |
| **#4** | `data_backed` kétkapus jelentőség | Adat nélküli politikai hír ≤ FIGYELENDO, **KIEMELT SOHA**; hiányzó `data_backed` konzervatív (mintha false). |
| **#5** | null significance séma | `significance: null` megengedett (type-tömb + null enum); enum-on kívüli string továbbra is bukik. |
| **#6** | `run_attempts` | Aznapi több futás → `runs` 1 sor + `run_attempts` N sor; `finishRun` attemptId nélkül → WARN (nem csendes fallback); `startRun` finishRun nélkül → `finished_at=NULL` (elhasalt futás jelzése). |

**A 105-ös migráció eredménye:** a `triage_json LIKE '%hiányzó ítélet%'` mintára
105 beragadt tétel volt; a `resetStuckMissingVerdicts` visszaállította őket.
**2026-08-05-i utómérés: 0 ragadt tétel, `triage_json IS NULL` sincs — tartja.**
A kódfix (#2) megakadályozza az ÚJ ragadást, a migráció a meglévőt rendezte
(CLAUDE.md 3: kódfix + külön idempotens migráció).

---

## 2. A 2026-08-05-i élesmérés tanulsága — a kapu a PROMPTBAN van

A commitolt DB-ből, az F2-fix3 után pár nappal:

- **A FONTOS-összeomlás a `data_backed`-kapu műve, nem a bevitel.** Azonos-forrás
  kontroll: a **hvg 60 cikk/nap változatlan, de FONTOS-hozama 16→1** a kapu (#4)
  élesedése körül. Az eurostat/ksh a FONTOS/KIEMELT ~0%-át adja.
- **A begyűjtött mennyiség „felezése" optikai** — nem forráshiba, nem szűrő-változás:
  (a) az eurostat katalógus-RSS backfillje lecsengett (07-30: 197 új → 08-03: 0),
  (b) a kései/kézi futás lerövidíti a rá következő nap `since`-ablakát.
- **KÖVETKEZTETÉS:** a kapu KÉT helyen érvényesül — a **promptban** (a modell
  öncenzúráz) és a **kódban** (backstop). A 2026-08-06-i mérés: **0 eltérés**
  raw (`significance_raw`) és kapuzott között 105 tételen → a kód-plafon szinte
  soha nem üt be, mert a prompt már szűrt. Ezért a kapu-hatás valódi méréséhez a
  PROMPT A-ágát kell futtatni (lásd `docs/KAPU-AB-KISERLET.md`).

---

## 3. dedup(a) — reprezentáns-választás (commit `1b5da67`, 2026-08-06)

A bug **félrekeretezés** volt, nem kihagyás: a `groupSig` felhúzta a rep
significance-MEZŐJÉT a legerősebbre (a badge KIEMELT lett), DE a rep IDENTITÁSA
(cím/url) a kind-nyertes FONTOS/FIGYELENDO tagé maradt → a KIEMELT-sztori
rutinnak hangzó cím alatt jelent meg. **Fix:** a rep a legmagasabb significance-ű
tag (significance elsődleges kulcs).

**Mérés (2026-08-07, 1647 tétel, 141 többtagú csoport):** **29 rep-váltás**, ebből
**18 significance-emelő** (pl. `FIGYELENDO Duna-vízállás → KIEMELT`), 11 same-tier
tiebreak (ártalmatlan). **0 új sztori, 0 méretváltozás** (a csoportosítás bájtazonos,
csak a rep identitása mozdul).

---

## 4. dedup(b) + C-star — a láncolódó mega-blob (commitok `1ffb566`, `cfffa67`)

**dedup(b) Eurostat-eset** (`title_generic_tokens`, 2026-08-06): a `euro`/`area`
generikus tokenek külön config-kulcsba; a 6 euro-area közlemény szétválik (9 pár,
0 kár). Az aug. eleji ablakban láthatatlan (nincs euro-area klaszter).

**C-star — a rendszerszintű mega-blob** (2026-08-07): a hub-tokenek (szereplőnevek:
`magyar péter`, `orbán viktor`; `paks`/`duna`) a containment-ágon KÜLÖNBÖZŐ
sztorikat láncoltak egy blobbá — **318 tag, 1.88% élsűrűség** (vékony hidak). A
naiv C-star 38 valódi parafrázist is szétárvázott; a **dice-repair** (dice≥0.55-ös
al-csoportok visszaegyesítése) 0-ra viszi.

**Mérés (2026-08-07):** **blob 318→22**, csoportszám 1053→1201, **0 megtört
dice-jogos pár**, 10 erős-containment residual. Levélhatás: a digest (UJ_24H) 107→115
(+8), de a **standalone KIEMELT-levél 24→28 (+4)** — a blob **két primer intézeti
kutatást** (Publicus, Medián, `data_backed=true`) + a Paks-leállást rejtette a
„Magyar Péter" hub-tokenen át. A fix un-burying-eli a legértékesebb primer tételeket.

---

## 5. Forrásbővítés — a hazai intézeti kör (F3)

**Felderítés (2026-08-06, valódi HTTP):** a 13 hazai intézet gépi parse-olhatósága
felmérve. Eredmény: **6 élő RSS-feed** (median, publicus, nezopont, szazadveg,
iranytu, realpr93), **4 HTML-lista** (republikon, 21kutato, opinio-sitemap, minerva),
**3 STALE** (zavecz, idea, tarskutato). **A pollster-mag NEM igényel agentikus
B-fetchert** — a drága `agentic_check` a nemzetközi/rejtett-magyar körre marad.

**Bekötve — forrásszám 13 → 17 (élesben) → 19 (queue):**
- `median`, `iranytu` — A(feed), élő RSS (commit `c991bc3`, pusholva).
- `21kutato`, `republikon` — A(HTML-lista), per-source parser (`5d6a67a`, `b4c176b`, pusholva).
- `minerva` — A(HTML-lista), havi `ÉÉÉÉHH.html` + `monthOnly` (`565e3e2`, queue).
- `opinio` — A(sitemap), kétlépcsős `lastmod`-szűrt headline-backfill (`962e74f`, queue).

**Finomított STALE-felmérés (2026-08-07):** zavecz `/feed/` él, de a tartalom-feed
2023-09 óta befagyott → NINCS használható gépi csatorna (NEM azért kint, mert a sajtón
át látszik — az a kutatás értelmezése, nem a primer közlemény); **idea** valójában feed
nélküli SPA (JS-render) → B-kaszt; **tarskutato** működő WordPress-feed (2026-01-26) —
**bekötve 2026-08-09** (§11), a határ-fölötti STALE-kor nem ejtő ok, a csatorna él és ingyen
van. (13 alapból az intézeti kör túlnyomó része gépbarát; a `granularitás`-csapdák — nap/hó
— a `filterSince`-ben kezelve.)

---

## 6. A két incidens és a tanulságuk

**(1) run.js SyntaxError (2026-07-31, fix `2dbead5`).** Egy notCovered-stringben
egy EGYENES idézőjel lezárta a JS literált → `SyntaxError`, a `node src/run.js`
az éles `workflow_dispatch`-nél bukott. **Miért nem fogta az `npm test`:** egyetlen
teszt sem parse-olja a `run.js` top-level-jét (a tesztek a MAGOT importálják).
**Tanulság + guard:** `test/entrypoint_syntax` `node --check`-eli a workflow által
KÖZVETLENÜL futtatott belépőpontokat (run.js, email.js, reset-stuck) — az egész
szintaxis-hiba-osztályt fogja. (Ezért használunk azóta „magyaros" idézőjelet a
stringekben, és `node --check`-elünk commit előtt.)

**(2) Pages-deploy timeout (2026-08-06, notCovered `636ac9a`).** A kézi
`workflow_dispatch` Pages-deployja 10m 3s-nél timeoutolt (`deploy-pages@v4`
default 600000 ms) → piros job + hiba-email. **De a levél KIMENT előtte, és a
DB-visszacommit a Pages-lépés ELŐTT van → adatvesztés NINCS**, csak az archívum
késett. **Tanulság:** rendelkezésre-állási, nem korrektségi kérdés; a
workflow-szintű `concurrency` guard NEM fedi a github-pages környezet saját
deploy-sorát. (A rákövetkező cron `success`, egyszeri eset volt.)

---

## 7. Mi maradt

- **kapu-A/B (data_backed):** megtervezve (`docs/KAPU-AB-KISERLET.md`) — a PROMPT
  A-ágát kell ~105 tételen futtatni (~$0.003), a kontroll már megvan a
  `significance_raw`-ban. Futtatás külön, jóváhagyott lépés.
- **`cost_estimate`:** szándékosan inert — token-számlálás nincs bekötve, üresen
  maradna. Ha kell: a provider-válaszok token-usage-ét összegezni futásonként.
- **`press_urls` / merge-auditálhatóság:** a per-tétel `items.press_urls`
  perzisztált, DE a story-csoport tagsága (`_pressUrls`) csak report-időben
  számolódik — a DB-ből egy hamis összevonás csak a naplózott DARABSZÁMBÓL
  követhető, a KONKRÉT tagokból nem. Egy audit-igényhez a csoport-tagságot
  perzisztálni kellene.
- **opinio:** ✅ ma bekötve (2026-08-07) — ezzel mind a 4 A(HTML-lista) intézet kész.
- **C-star residual:** 10 erős-containment pár leválik; mérlegelendő lokális-IDF
  hub-detekcióval csökkenteni.
- **3b/3c gate finomítás, a Paks-sztori HU/EN cross-nyelvi dedup** — kisebb tételek.

---

## 8. Holnapi futás — ELŐRE RÖGZÍTETT várt számok (push ELŐTT)

A 7 F3-commit (minerva, C-star, STALE, opinio + 2 doc) holnap, a 08-08 00:43 UTC
cronnal megy ki. A `since` a legutolsó futás kezdete = **2026-08-07T03:39Z**
(→ sinceDay 08-07, sinceMonth augusztus). Az alábbi számokat MOST rögzítjük, hogy
holnap ne legyenek utólag hangolhatók.

| mérőszám | VÁRT érték | HIBÁT jelezne |
|---|---|---|
| **minerva** új tétel (1. futás) | **0** — legfrissebb permalink 202604 (április), a `monthOnly` szűrő sinceMonth=augusztus alá esik | **>0** = burst (a monthOnly szűrő nem fog) |
| **opinio** új tétel (1. futás) | **0** — legfrissebb lastmod 2026-08-05 < sinceDay 08-07 (dateOnly), **0 post-lekérés** | **>2** vagy sok post-lekérés = a lastmod-szűrés kimaradt |
| **forrásszám** (lábléc/`source_checks`) | **19** (15 feed + 4 HTML/sitemap) | **≠19** = a minerva/opinio nem töltődött be |
| **C-star max sztori-csoport** | **~15–25** (a 08-07-i kohézív Paks-mag 22 volt, azóta hűl) | **>50** = a blob visszaállt / a C-star nem fut |
| **C-star összes csoport** | **~1150–1250** (08-07: 1201) | drasztikus eltérés (pl. <900) = grouping-hiba |
| **KIEMELT-levél** (KIEMELT rep) | **~24–30** (08-07: 28; a blob-szétbontás un-burying-je benne) | **<10** (összeomlás) vagy **>45** (robbanás) = kapu/dedup-hiba |
| **digest-levél sztori** (UJ_24H) | **~90–125** (08-07: 115; hír-volumen-függő, ~+8 a C-star-tól) | **>200** (≈duplázódás) = a blob-szétbontás túlfut a levélbe |

**Fontos keret:** a C-star számai a 08-07-i ablakon mértek; a holnapi 14-napos
ablak ~13/14-ben átfed, ezért a számok KÖZELIek, de nem azonosak (a korpusz
sodródik, a Paks-sztori hűl). A `minerva=0`, `opinio=0`, `forrásszám=19`
**determinisztikus** (a since-logikából + configból számolt), a C-star-tartomány
becslés. **A leglényegesebb egyetlen ellenőrzés: nincs 50+ tagú sztori-csoport** —
ez igazolja, hogy a mega-blob nem tért vissza.

**Amit NEM várunk (hiba-jelek egyben):** (a) burst a minerva/opinio-nál (>2 tétel);
(b) 50+ tagú csoport a levélben/riportban; (c) forrásszám ≠ 19; (d) KIEMELT
összeomlás ~0-ra vagy robbanás 45+ fölé; (e) `HIBA` státusz a minerva/opinio
`source_checks`-ben (opinio: EGY post-lekérés bukása OK, de a sitemap-HIBA nem az).

---

## 9. szazadveg + realpr93 feed-aktiválás — ELŐRE RÖGZÍTETT várt számok (2026-08-08, push ELŐTT)

Két A-feed intézet bekötve `rss.js`-en, **0 kód** (csak regiszter + fixture-teszt).
A forrásszám ezzel **19 → 21**. A `since` holnap a MAI futás kezdetéhez kötött
(2026-08-08 02:35 UTC), tehát mindkét forrás legfrissebb tétele a since ELŐTTI.

| jel | várt (2026-08-09) | hibajel |
|---|---|---|
| **szazadveg** új tétel | **~0** — legfrissebb 2026-08-03 < since (08-08); OK_NINCS_UJ, „10 tétel, egyik sem újabb". (1–2 friss OK, ha közben publikál — élő forrás, NEM hiba.) | **HIBA** vagy **RESZLEGES/üres feed** = rossz URL-t kötöttünk (a `/cikkek/feed/` helyett a fő `/feed/`); **~10 „friss"** = a since/dátum-parse elromlott |
| **realpr93** új tétel | **0** — legfrissebb 2026-02-09 (180 nap) ≪ since; OK_NINCS_UJ, „10 tétel, egyik sem újabb" | **HIBA** = WordPress-feed leállt; **>0 burst** = dátum-parse hiba (a pubDate nem olvasódik) |
| **forrásszám** (`source_checks`) | **21** (17 feed + 4 HTML/sitemap) | **≠21** = az aktiválás nem érvényesült (JSON/kaszt) |
| **KIEMELT / digest** | **változatlan** a két forrástól (mindkettő ~0 új) | érdemi ugrás e két `source_id`-től = váratlan burst |

**A legfontosabb egyetlen ellenőrzés:** mindkét forrás `OK_NINCS_UJ` státusszal, a
detailben a **10-es feed-tételszámmal** — ez igazolja, hogy a LEKÉRÉS megtörtént
(a fetch él), csak nincs a since-nél újabb tétel. `HIBA`/`RESZLEGES` bármelyiknél =
az aktiválás a lekérés szintjén bukott.

**Keret:** holnap EGYSZERRE landol a cron-átállás (08:43 UTC, ~32h egyszeri szélesebb
since-ablak) ÉS a két új forrás. Szétszálazható: a két forrás 2 új `OK_NINCS_UJ` sor +
forrásszám 21; a cron a levél KÉSŐBBI (≈14:21 CEST) érkezése. A szélesebb ablak e két
forrás régi tételeit NEM hozza be (mind jóval a 08-08 02:35-ös ablakkezdet előtti).

---

## 10. publicus HTML-parser aktiválás — ELŐRE RÖGZÍTETT várt számok (2026-08-08, push ELŐTT)

A publicus feedje NEM reprezentál (a júliusi primer kutatások kimaradnak), ezért a
`/blog/category/blog/` HTML-lista, új per-source parser (`extractPublicus`). VEGYES
granularitás: 25 fő-listás cikk pontos dátummal (dateOnly), + 3 big-grid KIEMELT
(a 3 legfrissebb kutatás, csak itt) HAVI dátummal az upload-útvonalból (monthOnly).
Forrásszám **21 → 22**. Külön pushol, a hatás a **holnaputáni (≈2026-08-10)** levélben
látszik, izoláltan a 08-09-i cron+szazadveg/realpr93 verifikációtól.

| jel | várt (≈2026-08-10, az első publicus-os futás) | hibajel |
|---|---|---|
| **publicus** új tétel | **~0** — a fixture 28 cikke mind ≤ 2026-07-31 (a 3 kiemelt monthOnly = 2026-07), a since ELŐTTI; `OK_NINCS_UJ`, „28 tétel, egyik sem újabb". (1–2 friss OK, ha közben új kutatást tesz ki — élő forrás, ez a CÉL.) | **RESZLEGES** („nincs kinyerhető cikk-link") = a Newspaper-markup változott / parser tört; **~28 „friss" burst** = a since/dátum-parse elromlott |
| **forrásszám** (`source_checks`) | **22** (17 feed + 5 HTML/sitemap) | **≠22** = az aktiválás nem érvényesült |
| **KIEMELT / digest** | **változatlan** a publicustól (~0 új) | érdemi ugrás e `source_id`-től = váratlan burst |

**A legfontosabb egyetlen ellenőrzés:** `OK_NINCS_UJ`, a detailben **28-as
lista-tételszámmal** — a lekérés+parse megtörtént, csak nincs friss. `RESZLEGES`/`HIBA`
= a lekérés vagy a parse bukott.

**Ha közben ÚJ kutatás jön:** egy augusztusi *fő-listás* tétel pontos dátummal (dateOnly)
frissként jelenik meg; egy augusztusi *kiemelt* (monthOnly 2026-08) átmegy a sinceMonth-on,
DE a hó-eleji dátumozás miatt a frissesség KORABBI-nak látszhat (a monthOnly ismert
költsége, mint minervánál) — a tétel akkor sem VÉSZ el, csak nem kap UJ_24H-t. Ez nem hiba.

**Napi-egy-változás:** a publicus KÜLÖN pushal a szazadveg/realpr93-tól, hogy a 08-10-i
levélben a hatása tisztán elváljon. A nezopont ma CSAK felmérve (nincs feed — Joomla-feed
site-szinten kikapcsolva, mind soft-404; HTML-lista parse-olható, legfrissebb 2026-04-13),
parser + aktiválás külön menet.

## 11. nezopont HTML-parser aktiválás — ELŐRE RÖGZÍTETT várt számok (2026-08-09, push ELŐTT)

A hazai kör utolsó felmért forrása. Joomla/Gantry, NINCS feed (mind az 5 `?format=feed`
út soft-404: HTTP 200 + `<error><code>404`), ezért HTML-lista: `/hu/tevekenysegeink/osszes-kozlemeny`.
Per-source parser (`htmllist.js/extractNezopont`): `g-array-item` kártyák, cím+permalink
a `<h2 class=g-item-title><a href>`, dátum a kártya `<span class=g-array-item-date>`
ÉÉÉÉ.HH.NN. (dateOnly). A mai mentett listaoldal: **28 kártya → 24 EGYEDI közlemény**
(a kiemelt widget 4 cikket megismétel → URL-dedup), legfrissebb **2026-04-13**. (A tegnapi
„18" csak a `kozvelemeny-kutatasok` alrovat becslése volt; a parser MINDEN közleményt hoz.)

**Új a fetcher-viselkedésben (CLAUDE.md 1, regressziós teszttel):** a soft-404-et a
`fetchNew` mostantól **HIBA**-ként könyveli (nem 0 tételként) — tegnapi tanulság, minden
HTML-lista forrásra érvényes.

| jel | várt (≈2026-08-10, az első nezopont-os futás) | hibajel |
|---|---|---|
| **nezopont** új tétel | **~0** — mind a 24 közlemény ≤ 2026-04-13 (118 napja néma), a since ELŐTTI; `OK_NINCS_UJ`, „24 tétel, egyik sem újabb". (Ha újra publikál → magától megjelenik, `revisit: if-republishes`.) | **HIBA** („soft-404…") = a Joomla-lekérés bukott (a fő kockázat, a Joomla ingatag); **RESZLEGES** = a Gantry-markup változott / parser tört; **burst** = a since/dátum-parse elromlott |
| **forrásszám** (`source_checks`) | **24** — lásd lentebb | **≠24** = az aktiválás nem érvényesült |
| **KIEMELT / digest** | **változatlan** a nezoponttól (~0 új) | érdemi ugrás e `source_id`-től = váratlan burst |

**tarskutato feed-aktiválás (2026-08-09, ugyanebben a batchben):** működő WordPress
`/feed/` (10 keltezett tétel, legfrissebb 2026-01-26), 0 kód (rss.js, mint realpr93).
Határ FÖLÖTTI STALE (~195 nap), de a STALE-kor NEM ejtő ok — a csatorna él és ingyen van
(elvi rögzítés, lásd ARCHITEKTURA). Várt a 08-10-i futásban: **~0 új** (mind ≤ 2026-01-26,
a since ELŐTTI) → `OK_NINCS_UJ`, „10 tétel, egyik sem újabb". Hibajel: `HIBA` = a feed
elérhetetlen; **burst** = a since elromlott.

**Forrásszám-reconciliáció (felülírja §10 izolált 22-jét):** a nezopont a felhasználó
utasítására a publicusszal, a revisit-sémával ÉS a tarskutato-aktiválással **együtt**
pushal a mai 08-09-i verifikáció után. Így a **08-10-i levél 24 forrás** lesz, benne HÁROM
először megjelenő aktiválás — publicus, nezopont ÉS tarskutato —, **mindhárom függetlenül
~0 új** (mind a since-ablak ELŐTTI, dormant). A napi-egy-változás elve nem sérül érdemben:
mindhárom tesztelt, dormant, ~0-új aktiválás; a batch a felhasználó explicit döntése.

**A legfontosabb egyetlen ellenőrzés:** `nezopont OK_NINCS_UJ`, a detailben **24-es
lista-tételszámmal** — a lekérés+parse megtörtént, csak nincs friss. `HIBA` (soft-404) /
`RESZLEGES` = a lekérés vagy a parse bukott, NEM „0 új" (a soft-404-guard épp ezt teszi
láthatóvá).

---

*Készült: 2026-08-07 (8. szakasz), kiegészítve 2026-08-08 (9–10. szakasz) és 2026-08-09
(11. szakasz). A számok forrása: `state/monitor.db`, a kód, a git-histó­ria, a regressziós
tesztek és a verifikált forrás-próbák (mentett fixture-ök a `test/fixtures/` alatt).*
