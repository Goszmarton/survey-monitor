# B-kaszt (#5 agentikus ág) — forrásfelmérés, 2026-08-15

**Státusz:** TERVEZÉS, nem implementáció. Ez a dokumentum a négy B-kaszt-forrás
tényleges hozzáférési felületét **méréssel** (nem feltételezéssel) rögzíti, és a
nem determinisztikus ág tesztelhetőségének tervezési kérdését válaszolja meg.

**Módszer:** a fetch-ek a **laptopról** mentek (lakossági IP → 200 mindenhol, szemben
a datacenter-ASN Cloudflare-blokkokkal, ld. [[21kutato]]). UA: Chrome-desktop. Minden
állítás alatt az élő HTTP-mérés (státusz/content-type/méret) áll, nem emlékezet.

---

## 1. Hozzáférési felület — forrásonként, mérve

| Forrás | Felület (mért) | Determinisztikus? | Ügynök kell? |
|---|---|---|---|
| **europeelects** | ASAPOP-widget `storage.googleapis.com/asapop-website-20220812/_widgets/tables/hu.html` → **tiszta `<table>`** (`<thead>`: Fieldwork Period · Polling Firm · Commissioner(s) · Sample Size · TISZA · Fidesz–KDNP · MH · DK · MKKP…). 200, text/html, 15,6 KB. | **IGEN** — tábla-parse, mint a meglévő `htmllist` | **NEM** |
| **politico_pop** | ~~324 KB HTML, % nincs a DOM-ban, nincs wp-json poll-endpoint~~ **← ez a sor 08-16-án MÉRTEN HIBÁS volt.** A HTML tartalmaz `data-code="HU-parliament"`-et és wp-json route-referenciákat. A valódi felület: **`politico.eu/wp-json/politico/v1/poll-of-polls/HU-parliament` → HTTP 200, 1,4 MB `application/json`** (csupasz `curl`, 0 fejléc; NEM CF-blokkolt — a 403 csak a `?pl-ajax=` proxy-úton volt). Tartalma: `parties` (21 kód→név), `polls` (595 egyedi kutatás: dátum·intézet·mintaméret·párt-%), `trends.kalmanSmooth`/`kalman` (4511 pont, a poll-of-polls aggregátum), `results`, `events`. A **% MÉGIS determinista** (measure:"p"); nem a DOM-ban, hanem a JSON-ban. | **IGEN** (JSON-parse, mint europeelects) | **NEM** |
| **pew** | RSS `pewresearch.org/feed/` 200, application/rss+xml, 100 cikk — **a felfedezés MÁR integrált** (van fixture: `pew_hungary_archive.xml`, `title_filter`). A 100 címből **0** említ magyart → a magyar adat a cikkek **adattábláiban** rejlik, nem a metaadatban. | felfedezés IGEN, **kinyerés NEM** | **IGEN** (a kinyerés) |
| **eurobarometer** | ~~SPA, nincs API, /api/* 404, PDF-only~~ **← 08-16-án MÉRTEN HIBÁS (kétszer is).** (a) A `europa.eu/eurobarometer` bundle lazy-chunkja adja: `urlRootApi="/eurobarometer/api/"` + REST (`survey/get/latest`, `survey/get/one?id=X`, `deliverable/download/file`), mind 200 csupasz curl. (b) A `survey/get/one` ad `openDataPublicationUrl`-t → **`data.europa.eu` (Piveau-platform)**, ott `api/hub/search/datasets/{id}` (200, JSON) → **6 XLSX + 1 ZIP disztribúció, NULLA PDF ezen a csatornán**. A `volumeA.xlsx` (377 KB, 78 munkalap, kérdésenként) letölthető csupasz curl-lel (`webgate.ec.europa.eu/ebsm/…/download?key=…`), és **a HU-oszlop (V) gépileg olvasható**: pl. QA1-re HU N=1020, Yes=0,78 / No=0,22 (EU27=0,66/0,34). | **IGEN — TELJESEN** (JSON-API a felfedezéshez + strukturált XLSX a számokhoz, PDF-parse NÉLKÜL) | **NEM** |

**Kulcs-részeredmény: a négyből kettő NEM igazán agentikus.**

- Az **europeelects determinisztikus** (tiszta ASAPOP-tábla) → **ki kell venni a #5-ből** és
  sima A-kasztos forrásként shippelni, amikor a kvóta engedi (ld. §5). Nem ügynök-ügy.
- A **politico SEM ügynök-ügy — de nem is halott: determinista JSON-endpoint** (08-16-i mérés,
  ld. a táblát fent). A `wp-json/.../poll-of-polls/HU-parliament` route a teljes idősort adja
  (% is), csupasz GET-tel. → **kiveendő a #5-ből, europeelects-tel egy tekintet alá** (mindkettő
  determinista poll-tábla/JSON, LLM nélkül). **DE: az Actions-ASN próba 403/403 (2026-08-16,
  `politico-probe.yml`)** — bare 5547 B, UA 5696 B, mindkettő CF-challenge (a MIN_OK_BYTES küszöb
  jól fogta). Ugyanaz a datacenter-ASN minta, mint a 21kutatónál → **a politico kézi/parkolt ág.**
  **FONTOS: ez a FUTTATÓKÖRNYEZETRE vonatkozik, nem a csatornára** — a wp-json JSON-API él és
  teljes, lakossági IP-ről (200, 1,4 MB). Ha lesz lakossági/rezidens futtatókörnyezet, azonnal
  aktiválható.
- **Az agentikus ág EGYEDÜL a pew-re szűkül (08-16 véglegesítve).** Az eurobarometer is
  determinista lett — a négyből HÁROM (europeelects, politico, eurobarometer) determinista,
  LLM-mentes csatorna.
  - **eurobarometer (08-16, TELJESEN tisztázva):** nem csak a felfedezés, a **számok is**
    determinisztikusak. Lánc: `eurobarometer/api/survey/get/one?id=X` → `openDataPublicationUrl`
    → `data.europa.eu/api/hub/search/datasets/{id}` (Piveau, JSON) → `distributions[]` (6 XLSX)
    → `volumeA.xlsx` letöltés (csupasz curl) → **XLSX-parse, a V oszlop = HU** minden kérdésnél.
    PDF-parse és LLM NÉLKÜL. (A HU-specifikus Country-results PDF is elérhető, de fölöslegessé
    válik.) Figyelem: a letöltő-`key` a hub-API-ból jön futásidőben (nem drótozható); és az
    `openDataPublicationUrl` megléte survey-függő (a standard EP/EB-hullámoknál megvan).
  - **pew — EZ marad az egyetlen valódi agentikus forrás:** a felfedezés RSS-ből kész (fixture
    van), de a magyar adat a cikk adattáblájában rejlik → a szám-kinyerés a valódi ügynök-munka,
    itt kell a grounding-verifikáció (§2) + az injektált-adapter tesztminta.

---

## 2. A grounding-verifikáció — önálló, forrás-független elv

**Ez a felmérés legmaradandóbb hozadéka; NEM pew-specifikus.** Minden agentikus kinyerésre áll,
a pew-n túl az eurobarometerre és bármely jövőbeli B-kaszt-forrásra.

**Az elv:** egy agentikus kinyerés kimenete SOHA nem csak egy szám, hanem egy **hármas**:

```
{ ertek, szo_szerinti_idezet, tabla_vagy_szekcio_fejlec }
```

A **kódunk determinisztikusan ellenőrzi**, hogy a `szo_szerinti_idezet` (normalizálás után:
whitespace/entity) **substringként BENNE van-e a letöltött dokumentumban**. Ha nincs → a tételt
**elvetjük, nem tároljuk** (a modell hallucinált).

**Miért ez a lényeg:**

- A **veszélyes hibamódot — fabrikált magyar szám — determinisztikusan RED-tesztelhetővé teszi.**
  Injektált adapter „kitalált" értéket ad, aminek idézete nincs a fixture-ben → az assert
  megköveteli az elvetést. Ez sima unit-teszt, nem modell-eval.
- **Forrás-független:** ugyanaz a guard fut pew-n, eurobarometeren, bárhol. Egyszer megírva,
  minden agentikus ág örökli.
- **Illeszkedik a munkamódhoz:** CLAUDE.md 2 (nincs néma fabrikáció — a hamis szám hangosan
  elvész, nem csúszik be) és 5 (becsületes részlegesség — bizonytalanság → jelöl, nem kitalál).
- **Residual (amit a grounding NEM fed):** a **recall** — talált-e MINDEN valós magyar sort.
  Ezt nem a guard, hanem az arany-fixture eval méri (§3). A grounding a *precizitást*
  (fabrikáció-mentesség) garantálja determinisztikusan, a recallt nem.

---

## 3. Nem determinisztikus ág tesztelése (a fő tervezési kérdés)

Van rá jó válasz: az ügynöki ág **három rétege**, ebből kettő determinisztikusan RED-tesztelhető.

1. **Determinisztikus héj (fetch + jelölt-kinyerés):** a mentett oldal-fixture-ből a gyanús
   adattábla/szekció kiszedése. Sima fixture-teszt, mint a `test/sources/*`.
   *Determinisztikus pre-szűrő:* a letöltött szövegben `Hungar` grep — ha nincs, az egész
   agentikus ág kimarad (0 LLM-hívás). Ez a legolcsóbb kvóta-guard (ld. §5).
2. **LLM-határ, injektált adapterrel:** a meglévő `complete(role, prompt, {schema})` +
   `adapters({...})` minta (`complete.test.js`). Nem a modell okosságát teszteljük, hanem hogy
   séma-valid válaszra jól tárolunk, séma-invalidra / megtagadásra degradálunk (a beépített
   `SCHEMA_RETRY`/fallback, `complete.js`). Determinisztikus.
3. **Grounding-verifikáció (§2):** determinisztikus fabrikáció-guard, RED-teszthető.

**Amit becsületesen NEM lehet unit-tesztelni:** a **recall** (modell-minőség, nem
kód-korrektség). Ehhez **arany-fixture eval** kell: mentett valós riportok ismert magyar
értékekkel, időnként a valódi modellen futtatva, precizitás/recall mérve — NEM blokkoló
unit-teszt. „Ha nincs rá jó válasz, az is eredmény": itt a válasz az, hogy a **precizitás
determinisztikusan garantálható (grounding), a recall csak evallal figyelhető** — a kettőt nem
szabad összemosni.

---

## 4. Kadencia (mérve, ahol lehetett)

- **europeelects:** ASAPOP fieldwork-dátumok: 2026-07-22/27, 07-22/24, 07-13/20, 07-10/12 →
  **~1–2 HU-kutatás/hét.** Folyamatos aggregátor, nem napi.
- **politico_pop:** ~heti frissülés.
- **pew:** globális riportok magyar sorral → **évi néhány, bursty.** (21kutato-tanulság: a ritka
  forrásnál a napi fetch értelmetlen → feed-alapú felfedezés + esemény-vezérelt kinyerés.)
- **eurobarometer:** standard EB **évi 2×** + alkalmi speciál → **alacsony.**

→ Csak az europeelects/politico indokol napi ütemet; a pew/eurobarometer feed/esemény-vezérelt.

---

## 5. Költség/kvóta — a mai 5×429 + 5×503 fényében

**Kiinduló állapot (08-15 éles, DB-ből):** a triázs-lánc gemini-ága **szaturált** —
státusz-eloszlás HTTP_503:5 / OK:16 / HTTP_429:5, a groq viszi a triázst. A kötő korlát a
**batch-SZÁM (rate limit)**, nem a token.

**A groq-újrakalibráció NEM csak a backfill és az europeelects blokkolója — a pew agentikus
kinyerés is a triázson FELÜL hív.**

- **Determinisztikus források (europeelects, politico):** 0 saját LLM-hívás, DE több tétel →
  **több triázs-batch** → közvetlenül nyomják a szaturált gemini-kvótát. Az europeelects heti
  több HU-poll + EU-kontextus érdemi batch-többlet → **a legkockázatosabb a kvótára**, ezért
  csak a groq-újramérés UTÁN.
- **pew agentikus kinyerés (a triázson FELÜL, riport-napokon burstyn, ÉPP a triázzsal
  versengve):**

  **Nagyságrendi becslés egy pew-riport feldolgozására:**
  - felfedezés: **0** extra (RSS már megvan);
  - determinisztikus `Hungar`-pre-grep a letöltött szövegen: **0** LLM — ha nincs találat, az
    egész ág kimarad;
  - ha van magyar találat: **~1–5 kinyerés-hívás/riport** (a magyar sort tartalmazó
    táblák/szekciók száma szerint), plusz a kinyert tétel **+1 triázs-batch**.
  - Napi átlag ~0 (ritka riportok), de **report-napon burst ~1–5 hívás**, a triázs-ablakban.

  **Belefér-e a mai 5×429+5×503 mellett? — NEM tudom megbízhatóan megbecsülni, ezért:
  MÉRENDŐ AZ IMPLEMENTÁCIÓ ELŐTT.** A becslés két ismeretlenen bukik: (a) hány pew-cikk/nap
  cross-national jelölt (`Hungar`-pre-grep után), (b) hány magyar-táblás szekció riportonként.
  **Kötelező előmérés:** dry-run az utolsó ~N pew-riporton — hány megy át a pre-grepen, és
  szekciónként hány kinyerés-hívás lenne. Amíg ez nincs, az uncontrolled burst a szaturált
  triázs-ablakban **valós regressziós kockázat** (több 429/503, a napi levél triázsa sérülhet).

  **Kockázatcsökkentők (implementációkor):** (1) a `Hungar`-pre-grep mint kemény kapu (a legtöbb
  riporton 0 hívás); (2) a kinyerés **külön provider-láncra** (pl. groq/anthropic, ne a
  gemini-first triázs-láncra), hogy ne ugyanabból a szaturált kvótából egyen; (3) a kinyerés
  **időzítése a triázstól elkülönítve** (pl. a triázs után, vagy külön lépésben), hogy ne
  versengjenek ugyanabban a rate-limit-ablakban.

**Összegzés:** a kvóta ma **közös szűk keresztmetszet** a backfill, az europeelects ÉS a pew
agentikus kinyerés számára is → a groq-plafon újramérése mindhárom előfeltétele.

### 5.1 groq-plafon — az újramérés eredménye (2026-08-15) ⚠️ ELAVULT (a modell leállt 08-16 — ld. az 5.2 előtti bannert)

**Path 1 (headerök) bejött, a header-mérés megírva (commit `d244087`, pusholva):** a groq minden
válaszban visszaadja az `x-ratelimit-*` fejléceket (request=NAPI, token=PERCES limit); az
`openai_compat` adapter normalizálja, a `complete()` a `providers_used`-be fűzi (levél-semleges).
**Dokumentált free-tier baseline (`llama-3.3-70b-versatile`): RPM 30 / RPD 1000 / TPM 12 000 / TPD
100 000** — a kötő korlát a **TPM/TPD (token)**, nem az RPD (kérésszám).

**A napi batch-plafon becslése — és a fő bizonytalanság:**

| token/batch | napi plafon (TPD 100k ÷) | értelmezés |
|---|---|---|
| **~2 794** (MÉRT, 08-15 OK-batch átlag) | **~35 batch/nap** | van headroom a mai ~13–16 batch fölött |
| **~5 600** (KONZERVATÍV: a `:102` fehér folt miatt a `maxSchemaRetries=1` → akár 2× a valós token) | **~18 batch/nap** | **nagyjából a MAI terhelés maga → lehet, hogy nincs is headroom** |

A `:102` köztes séma-retry ma már **naplózott** (`SCHEMA_RETRY`, count látszik), de a retry
TOKEN-költségét a bejegyzés nem hordozza → a valós token/batch a mért és a konzervatív KÖZÖTT van.
**Ezt a 08-16-i header-mérés dönti el közvetlenül:** a `tokens_remaining`/`tokens_limit` élő adat a
TÉNYLEGES fogyasztást tükrözi (a retry-tokeneket is), így a mért-vs-konzervatív kérdést megkerüli.
**Tervezési következmény, amíg a 08-16 header nincs meg: a konzervatív ~18 batch/nap-pal számolj →
a headroom feltételezetten ~0, azaz a backfill/europeelects/pew NEM indítható, amíg a header nem
igazolja a valós plafont.**

> ⚠️ **ELAVULT (2026-08-17): a teljes §5.1–5.2 groq-elemzés egy MÁR NEM LÉTEZŐ modellre vonatkozik.**
> A `llama-3.3-70b-versatile`-t a Groq **2026-08-16-án leállította** (docs/deprecations, megerősítve:
> 08-16 még 11 OK batch, 08-17 **13×HTTP_404 „model does not exist"**). Az ITT rögzített minden szám
> — **12000 TPM / 100000 TPD / ~2616 tok/batch / ~35–38 batch/nap / a P0-képlet ÷200 paramétere** —
> erre a modellre igaz, és **NEM vihető át** az új modellre méretlenül. A P0 **15s padló MARAD**
> (általános biztonsági korlát), de a **token/batch ÷ (TPM/60)** képlet TPM-paramétere ÚJRAMÉRENDŐ.
>
> **Groq hivatalos migrációs cél (docs):** `openai/gpt-oss-120b` (a legközelebbi képesség/méret,
> 131K kontextus, 65K max completion) VAGY `qwen/qwen3.6-27b`. FIGYELEM: a `llama-3.1-8b-instant` is
> LEÁLLT 08-16-án (→ `openai/gpt-oss-20b`), tehát a naiv „kisebb Llama" fallback SEM él.
>
> **AMIT AZ ÚJ MODELLEN ÚJRA KELL MÉRNI (élő header, nem dokumentáció — a memóriából dolgozni itt
> bizonyítottan veszélyes):**
> 1. **free-tier RPM/RPD/TPM/TPD** az `x-ratelimit-*` headerből (a docs rate-limit oszlopa nem
>    egyértelműen free-tier; a másodlagos blogok elavultak);
> 2. **tényleges tok/batch** az új modellen (a 15 tételes triázs-batchre) → a napi batch-plafon és a
>    **P0 break-even szünet = tok/batch ÷ (TPM/60)** újraszámolása (ha pl. a free TPM 8000, akkor
>    ÷133,3 → ~20s a 2600 tok/batchnél, ami a 15s padló FÖLÉ kerül → a padló már nem elég);
> 3. **KIEMELT/FONTOS/FIGYELENDO kalibráció** — a jelentőség-eloszlás modell-függő (08-17: a haiku-
>    fallback 0 raw-KIEMELT-et adott 65 friss tételre, szemben a groq korábbi 2-3/nap-jával). Az új
>    groq-modell raw-KIEMELT arányát össze kell vetni a régi groq-éval ÉS a haikuéval.
>
> **Config-váltás CSAK a fenti mérések + közös döntés után** (a modellválasztás nem config-csere:
> a triázs-kalibráció modell-függő). A lenti §5.1–5.2 történeti referenciaként marad.

### 5.2 groq-plafon — az ELSŐ ÉLES HEADER-MÉRÉS (2026-08-16) → blokkoló feloldva ⚠️ ELAVULT (ld. fent)

A 08-16-i futás `providers_used`-je 11 groq OK-batchet tartalmaz mért `ratelimit`-tel. Baseline
igazolva: `requests_limit=1000` (RPD), `tokens_limit=12000` (TPM). **MÉRT token/batch: átlag 2 616**
(1757–3052), és **0 SCHEMA_RETRY** a futásban → a `:102`-alapú konzervatív ~5600/„~18 batch"
**nem materializálódott. A MÉRT ~35–38 batch/nap az igaz.**

**A kötő korlát KETTŐS, és a kettő MÁSHOGY viselkedik — ez a fő tanulság:**

| korlát | mért érték (08-16) | státusz |
|---|---|---|
| **TPD (napi token)** | 28 781 / 100 000 = **29%** | **BŐ** — itt van headroom |
| **TPM (perces token)** | `tokens_remaining` **2740/12000**-ig süllyedt a run-on belül | **SZŰK** — közel a fojtáshoz (429 nem lett, mert a futás rövid) |
| RPD (napi kérés) | 999→989 = 10/1000 | irreleváns |

**Következmény: az új források NEM ragaszthatók a meglévő batch-lökethez.** A politico/europeelects
folyamatos volumen-többlete ugyanabba a futásba esne, és a **per-run TPM-burst-öt** növelné (pont
azt, ami már közel van a limithez), miközben a napi TPD-t alig érintené.

**TERVEZÉSI SZABÁLY (forrás-aktiváláshoz): a triázs-batchek IDŐBELI SZÉTHÚZÁSA a feltétel, nem a
napi keret megléte.** A számítás:

- TPM utántöltési ráta = 12 000 token / 60 s = **200 token/s**.
- Break-even szünet két batch közt (a `tokens_remaining` nem csökken tartósan) =
  2 616 ÷ 200 = **~13,1 s**. Ennél sűrűbben → a vödör ürül (elég hosszú futásnál 429); ritkábban →
  visszatöltődik.
- Fenntartható ráta = 12 000 ÷ 2 616 = **4,6 batch/perc** a plafon; **cél ~3–4 batch/perc
  (≥ 15–20 s szünet)** a tartalékért.
- Ma az átlag ~10,7 s/batch volt (14 batch ~2,5 perc alatt) — a küszöb ALATT; azért nem 429-elt,
  mert rövid a futás. Több forrásnál a futás hosszabb → a szünetet KÉNYSZERÍTENI kell.
- **Ugyanez áll a pew bursty terhelésére:** riport-napokon a triázson FELÜLI kinyerés-hívások
  szintén ≥ ~13 s (cél 15–20 s) széthúzással, vagy a triázs-batchek közé interleave-elve.

Általános alak: **min. szünet (s) ≥ token_per_batch ÷ 200**; a token/batch a `providers_used`
`usage.total_tokens` mezőjéből folyamatosan mérhető (ha nő, a szünetet arányosan növelni).

---

## 6. Javaslat — sorrend (a userrel egyeztetve, 2026-08-15)

1. **pew ELSŐNEK** — nem a legkönnyebb, hanem ami a #5 tényleges célját (rejtett magyar adat)
   a legkisebb kockázattal validálja: a felfedezés kész, van fixture, csak a kinyerés-réteg
   épül → tiszta hely a grounding-verifikáció (§2) + injektált-adapter minta kipróbálására;
   egyedi érték (a több-országos táblák magyar sora sehol máshol); alacsony+bursty kvóta; és a
   mai `title_filter` épp KIZÁRJA a nem-magyar-című pew-cikkeket → ez a réteg tölti be a
   vakfoltot. **Előfeltétel: a §5 pew-burst előmérése + a groq-újrakalibráció.**
2. **europeelects a kvóta UTÁN** — determinisztikus A-forrásként (ASAPOP-tábla parse), NEM a
   #5 részeként. Kapuk: a groq-plafon FELOLDVA (§5.2), marad a batch-széthúzás (§5.2) + az
   **Actions-ASN próba** (`bkaszt-asn-probe.yml`, host `storage.googleapis.com`) — a politico
   403/403 után egyik determinista forrás Actions-elérhetősége sem feltételezhető.
3. **politico → DETERMINISZTIKUS csatorna, DE Actions-ból BLOKKOLT (08-16) → kézi/parkolt ág.**
   A `wp-json/.../poll-of-polls/HU-parliament` JSON él lakossági IP-ről (595 kutatás + kalman),
   de az Actions-ASN próba **403/403 (CF-challenge)**, mint a 21kutatónál. A blokk a
   futtatókörnyezet, nem a csatorna → csak lakossági/rezidens runnerrel aktiválható.
4. **eurobarometer ~~a pew-tapasztalat UTÁN~~ → DETERMINISZTIKUS A-forrás (08-16 véglegesítve)** —
   NEM agentikus. A számok strukturált XLSX-ben (`data.europa.eu` Piveau-API → `volumeA.xlsx`,
   HU=V oszlop), PDF-parse és LLM nélkül. Az europeelects/politico mellé kerül: determinista,
   kvóta UTÁN. Az egyetlen agentikus forrás a pew maradt. (Építési megjegyzés: a letöltő-key
   futásidőben a hub-API-ból; az `openDataPublicationUrl` megléte survey-függő — hiányában a
   HU-Country-results PDF a fallback, az az egyetlen pont, ahol PDF-parse kellhet.) **Kapu: az
   Actions-ASN próba HÁROM külön hostra** (`bkaszt-asn-probe.yml`: `europa.eu`, `data.europa.eu`,
   `webgate.ec.europa.eu` — külön ASN-ek/WAF-ok lehetnek); a politico 403/403 után ez sem
   feltételezhető, mérendő aktiválás előtt.

**Vezérlő kényszer marad:** egyszerre EGY viselkedésváltozás/nap a napi levélben.

---

## 7. Implementációs sorrend (2026-08-16, F4-felderítés lezárva)

**Aktiválható: europeelects + eurobarometer.** politico kézi ág (403, runtime), pew agentikus
(későbbre). **Sorrend: europeelects ELSŐ, eurobarometer MÁSODIK.**

**Miért europeelects elsőnek:** (1) a legegyszerűbb — egyetlen host, egyetlen tiszta HTML-`<table>`
(ASAPOP-widget), a meglévő `htmllist`-adapter mintájára parse-olható; (2) a legrelevánsabb+leggyakoribb
(magyar pártpreferencia = a domén magja, folyamatos frissülés); (3) ez fekteti le a
**determinista-B-forrás mintát** (fetch-adapter → parse → dedup-integráció → TPM-tudatos ütemezés),
amit az eurobarometer utána újrahasznál. Az eurobarometer XLSX-parse + több-hostos lánca több munka →
a bizonyított mintára épüljön.

### ELDÖNTVE (2026-08-16): (b) — determinista beemelés + fail-closed validáció + LLM csak a jelentőségre

**A kérdés:** a poll-sorok eleve `data_backed=true`, `kind=kutatas` — hogyan viszonyuljanak az
LLM-triázshoz? (a) teljes LLM-triázs soronként (drága, TPM); (b) determinista beemelés + LLM csak a
jelentőségre; (c) több sor EGY LLM-hívásba kötegelve.

**Döntés: (b).** Indoklás — és a döntő tengely NEM „van-e LLM-ellenőrzés", hanem „mit ellenőriz":

1. **A sémavalidáció ALAKOT ellenőriz, nem HELYESSÉGET.** A (c) LLM-kimenete séma-validáláson megy át,
   ami típust/formát néz — egy hihető, de HIBÁS szám (átnevezett oszlop → rossz párthoz kötött érték)
   ÁTMEGY rajta. A strukturált poll-adatra épített determinista validátor viszont HELYESSÉG-plauzibilitást
   is ellenőriz (%-összeg, tartomány, dátum) → **szigorúan erősebb, mint a (c) séma-védelme.**
2. **A (b) teljesen kizárja a szám-halluciációt.** A számok bájtról bájtra a forrástáblából, kód-oldali
   parse-szal jönnek, LLM-et SOSEM érintenek. Ez ugyanaz a garancia, amit a pew-nél grounding-verifikációval
   (§2) építünk — itt INGYEN adódik, mert a forrás MÁR strukturált.
3. **A (c) egy ÚJ kockázatot VEZET BE:** az LLM újraírja a számokat → halluciáció a számokon, pont az,
   amit máshol kerülünk. Ez önmagában kizárja a (c)-t egy determinista forrásnál.
4. **Fail-closed guard → a formátumváltozás LÁTHATÓ, nem néma rossz adat** (CLAUDE.md 1./2.).
5. TPM: a (b) bónusza (alig terheli), de NEM ez a döntő érv.

**A determinista validációs réteg (fail-closed, minden guardhoz RED teszt valós fixture-rel):**
a beemelés CSAK akkor enged tételt, ha MIND teljesül; bármelyik bukása → a forrás az adott futásban
KIMARAD + látható naplósor (SKIPPED_VALIDATION), nem néma beengedés és nem néma eldobás:
- **Fejléc/oszlop-assert:** a várt `<thead>` címkék megléte és pozíciója (Fieldwork Period · Polling
  Firm · Commissioner · Sample Size + a párt-oszlopok). Átnevezés/átrendezés → bukás.
- **%-összeg sanity:** a párt-százalékok összege ~100 (pl. 90–110, tűrve a kerekítést + egyéb/bizonytalan).
  Elkapja az oszlop-eltolást, tizedes-hibát (0,61 vs 61), rossz párthoz kötést.
- **Érték-tartomány:** minden párt-% ∈ [0, 100].
- **Mintaméret-plauzibilitás:** numerikus, józan sávban (pl. 300–5000). Elkapja az oszlop-eltolást.
- **Dátum-plauzibilitás:** a fieldwork-dátum parse-olható és józan ablakban (nem 1900, nem messze jövő).
- **Sor-sanity:** ≥ 1 poll (nem üres/megváltozott shell).

**A jelentőség (KIEMELT/FONTOS/FIGYELENDO):** LLM CSAK a MÁR RÖGZÍTETT számokra (grounded — a modell
címkéz, nem állít elő értéket → nem ronthatja az adatot); ez a hívás kötegelhető (több poll egy hívásban),
így a TPM-terhelés minimális. Alternatíva/finomítás: szabály-alapú jelentőség (trend-törés az előző
aggregátumhoz mérve) — determinista, de ez későbbi lépés; az alap a grounded-significance-LLM.

### Lépések (minden lépés: RED teszt VALÓS fixture-rel ELŐBB — CLAUDE.md 1.)

**IMPLEMENTÁCIÓS ÁLLAPOT (2026-08-17): a négy LEVÉL-SEMLEGES lépés SHIPPELVE, TDD-vel
(RED előbb, valós fixture), 243 teszt zöld.** P0 (`0b94b45`), E1 (`f031760`), B1 (`d7271dd`),
pew-kinyerés (`91d3f9b`). A két AKTIVÁLÁS (E2, B2) NEM ma — azok levél-hatók, külön napokra esnek.

**P0 — TPM-tudatos batch-szünet a triázs-hurokban (LEVÉL-SEMLEGES, ELSŐNEK) — ✅ SHIPPELVE `0b94b45`:**
`triage.js`: a batchek KÖZT `max(15s padló, mért token/batch ÷ 200)` szünet, a token/batch a
completeFn logba fűzött `usage.total_tokens`-éből; injektálható `sleepFn`. RED: sleepFn-spy
(token-alapú szünet / usage-nélküli padló / egy-batch=nincs-szünet). Kimenet bájtazonos.
a triázs-hurok minimum-késleltetése két batch közt (mért `token/batch` ÷ 200, vagy fix konzervatív
~15 s). RED teszt: injektált óra/sleep-spy, a hurok ≥ küszöböt vár batchek közt. Kimenet BÁJTAZONOS →
levél-semleges. **Ez ELŐBB kell, mint bármely volumen-növelő aktiválás** (különben az első aktiválás
429-et kockáztat). *(Ha az (b)/(c) út miatt a determinista források nem adnak új batchet, P0 akkor is
ship-elendő általános biztonsági korlátként — a pew burst miatt úgyis kell.)*

**E1 — europeelects adapter + parser + FAIL-CLOSED validátor + fixture-tesztek (LEVÉL-SEMLEGES) — ✅ SHIPPELVE `f031760`:**
`src/sources/europeelects.js`: `parseEuropeElects` (tiszta HTML-tábla → 50 poll, párt-%, mintaméret,
fieldwork — a számok bájtra a forrásból), `validateEuropeElects` (6 guard), `fetchNew` (fail-closed:
guard-bukás → `SKIPPED_VALIDATION`, 0 tétel). Valós fixture `europeelects_hu.html` (15641 B, bájtazonos
a 08-16 ASN-próbával); a 6 guard MINDEGYIKE külön RED-teszt egy célzott mutációval (fejléc-átnevezés,
69%→9%/169%, mintaméret 50, dátum 1899, üres tbody → a helyes guard-név). A forrás MÉG NEM aktív
(sources.json érintetlen). Levél-semleges. **Mért bounds a valós fixture-ön:** %-összeg 93–101,
mintaméret 1000–3332 → a [90,110]/[300,5000] sávok biztonságosak.

**E2 — europeelects AKTIVÁLÁS (ez a nap EGYETLEN levél-ható változása):**
`status: OK`, a tételek belépnek a triázs→kapu→jelentés folyamba. Verifikáció: batch-szám + TPM-headroom
(a P0-szünet tartja), a jelentés mutatja az europeelects-tételeket, dedup ép (nem olvad hamisan a
sajtó-tételekkel — [[f2-fix-round-decisions]] intézet-guard), kapu helyes. *(Felhalmozott állapot —
CLAUDE.md 3.: az aktiválás a MAI ablak polljait húzza be; a historikus poll-backfill KÜLÖN, idempotens
migráció, jóváhagyással.)*

**B1 — eurobarometer fetch-lánc + XLSX-parser + fixture-tesztek (LEVÉL-SEMLEGES) — ✅ SHIPPELVE `d7271dd`:**
`src/sources/eurobarometer.js`: lánc-feloldó tiszta függvények (`pickLatestSurvey`, `openDataUrlOf`,
`datasetIdFromOpenDataUrl`, `volumeADownloadUrl`) + `resolveVolumeA` orchesztrátor (injektálható
fetchImpl). **XLSX-olvasás SAJÁT ZIP+inflate-tel** (nincs xlsx-lib): `unzipXlsx` (EOCD → central
directory bejárás, `node:zlib.inflateRawSync` deflate + stored), `parseWorksheet` (inline-string +
numerikus cella), `sheetFileMap`, `findCountryColumn`. A **V oszlop = "HU"** kiválasztás külön tesztelt
(V9="HU", V10=1020, V13=0.78 a valós volumeA.xlsx-ből). Valós fixture-ök: survey_latest, survey_one_3752,
odp_dataset, volumeA.xlsx (377 KB). A letöltő-key futásidőben a hub-API-ból; `openDataPublicationUrl`
hiányában a HU-Country-results PDF a fallback (későbbi). Nem aktív. Levél-semleges.

**pew — agentikus kinyerés-réteg + grounding-verifikáció (LEVÉL-SEMLEGES) — ✅ SHIPPELVE `91d3f9b`:**
`src/sources/pew_extract.js`: a §3 három rétege — (1) `hasHungarianData` determinista `Hungar`-pre-grep
kapu (0 LLM, ha nincs magyar); (2) LLM-határ (`extractHungarianData`, injektálható completeFn, hármas-séma);
(3) `isGrounded`/`normalizeForGrounding` grounding-guard (§2): a szó szerinti idézet whitespace/entity-
normalizált jelenléte a dokumentumban → fabrikált szám ELVETVE, láthatóan (`rejected`). A fabrikáció-guard
RED-tesztelve (hihető-de-hamis hármas idézete nincs a dokumentumban → elvetés). A pew-AKTIVÁLÁS (külön
provider-lánc + a §5 burst-előmérés) későbbi.

**B2 — eurobarometer AKTIVÁLÁS (egy külön nap EGYETLEN levél-ható változása):**
esemény-vezérelt (új survey megjelenésekor). A grounding-verifikáció (§2) itt is áll a kinyert
számokra.

### Ütemezési összefoglaló (napi EGY levél-ható változás + §5.2 TPM-szünet)
P0 (semleges) → E1 (semleges) → **E2 (levél-ható, 1 nap)** → megfigyelés/verifikáció →
B1 (semleges) → **B2 (levél-ható, másik nap)**. A levél-semleges lépések halmozhatók, a két aktiválás
(E2, B2) külön napokon. A TPM-szünetet a P0 kényszeríti; a token/batch a `usage`-ből folyamatosan
mérendő, és ha nő, a szünet arányosan.

---

*Készült: 2026-08-15. Forrás: élő laptop-fetch (lakossági IP), a 08-15 éles futás DB-je
(`state/monitor.db`), és a repo kódja. Kapcsolódó: [[f3-plan-and-measurements]] (#5 F4-hátralék),
[[deploy-pipeline-ordering]], `docs/SOURCES-INTEZETEK-FELDERITES.md` (A/B döntési minta).*

*2026-08-16 kiegészítés: a politico_pop sor tisztázva — a % NEM halott, hanem determinista
JSON-endpointon él (`wp-json/politico/v1/poll-of-polls/HU-parliament`, 200, 1,4 MB, csupasz GET).
A 08-15-i „nincs wp-json poll-endpoint" állítás mérten hibás volt (nem lett megmérve). A politico
ezzel az europeelects mellé sorolódik: determinista, LLM-mentes, kvóta UTÁN, Actions-ASN-próbával.*

*2026-08-16 kiegészítés (groq élő mérés + ASN-próbák): a groq-plafon blokkoló FELOLDVA (§5.2, mért
2616 tok/batch, ~35–38 batch/nap, TPD 29% → van headroom), DE a kötő korlát KETTŐS: a TPM (perces)
szűk → forrás-aktiváláshoz a batch-széthúzás a feltétel (≥ ~13 s, cél 15–20 s / batch), nem a napi
keret. Actions-ASN próbák EREDMÉNYE: politico **403/403 = blokkolt** (kézi ág, a CSATORNA él lakossági
IP-ről); **europeelects + eurobarometer (4 host): 4/4 ELÉRHETŐ** (`bkaszt-asn-probe.yml`, 2026-08-16):
europeelects 200/15641 B, eb-api 200/7215 B, eb-odp 200/143313 B, eb-webgate 200/377142 B — a méretek
BÁJTRA egyeznek a laptopos méréssel → nem csak elérhető, UGYANAZT az adatot adja Actions-ból is; a
webgate-key élt (stale-eset nem állt elő). **AZ AKTIVÁLHATÓ B-KASZT = europeelects + eurobarometer**
(mindkettő determinisztikus ÉS Actions-elérhető). **F4 minden felderítési kérdése ezzel lezárult.**
Az implementációs sorrend: §7.*

*2026-08-16 kiegészítés: az eurobarometer sor is tisztázva — a bundle lazy-chunkjának felderítése
(nem tippelés) feltárta az `urlRootApi="/eurobarometer/api/"`-t és a valódi REST-útvonalakat
(`survey/get/latest`, `survey/get/one`, `deliverable/download/file`). Mind 200 csupasz curl-lel;
a discovery+fetch determinista, a HU-specifikus Country-results PDF letöltése is (id=107321,
7,1 MB, 200). A 08-15-i „nincs API, csak PDF-agentikus, fetch nehéz" állítás így hibás volt: a
fetch triviális, csak a PDF→szám kinyerés agentikus. Tanulság (mint a politicónál): a bundle
FELDERÍTÉSE — lazy-chunk + `urlRootApi` — hozza meg az eredményt, nem a `/api/*` tippelés.*

*2026-08-16 kiegészítés (a nyitva hagyott szál lezárva): az `openDataPublicationUrl` szál
végigvíve — a `data.europa.eu` szintén Piveau-SPA, a `data/app.*.js` bundle adja a valódi API-t
(`api/hub/search/datasets/{id}`). Az EB050EP dataset disztribúciói: **6 XLSX + 1 ZIP, NULLA PDF.**
A `volumeA.xlsx` (78 munkalap, kérdésenként kereszttábla) csupasz curl-lel letöltve; a **V oszlop
= HU**, gépileg olvasható szám- és arányértékekkel (QA1: HU N=1020, Yes=0,78). → az eurobarometer
NEM csak a felfedezésben, a SZÁMOKBAN is determinista, PDF-parse nélkül. **Következmény: az
agentikus ág egyedül a pew-re szűkül.** Ugyanaz a tanulság harmadszor: a bundle felderítése
(Piveau `api/hub/*`) hozta meg, nem a CKAN-tippelés.*
