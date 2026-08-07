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

**Finomított STALE-felmérés (2026-08-07):** zavecz `/feed/` él, de tartalma
2023-09 óta befagyott (a Závecz a sajtón át jön be); **idea** valójában feed
nélküli SPA → B-kaszt; **tarskutato** működő WordPress-feed (2026-01-26, ~193 nap) —
a legjobb jövőbeli aktiválási jelölt. (13 alapból az intézeti kör túlnyomó része
gépbarát; a `granularitás`-csapdák — nap/hó — a `filterSince`-ben kezelve.)

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

*Készült: 2026-08-07. A számok forrása: `state/monitor.db` (origin/main `74c82fc`),
a kód (`origin/main` + a lokális F3-commitok), a git-histó­ria és a regressziós tesztek.*
