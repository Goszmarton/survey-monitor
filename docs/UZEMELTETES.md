# Survey Monitor — Üzemeltetési leírás

**Státusz:** üzemben, önjáró (2026-08-24-től)
**Ritmus:** cron **08:43 UTC** (`.github/workflows/monitor.yml`), levél **~09:20–10:00 UTC**
**Ez a fájl az operatív igazság forrása.** A `docs/ARCHITEKTURA.md` a „hogyan épül fel",
ez a „hogyan üzemel naponta". A fejlesztési naplók (memória-fájlok, `docs/DONTES-*`,
`docs/SOURCES-*`, `docs/BESZAMOLO*`) TÖRTÉNET — a döntések *miértje*, nem napi teendő.

---

## 0. Rendszerkép — mi fut, mikor, hova

Minden nap 08:43 UTC-kor egy GitHub Actions futás (`monitor.yml`) végigméri a forrásokat,
LLM-mel triázsol, jelentést renderel, kiteszi GitHub Pages-re, és emailt küld. A futás a
végén visszacommitolja az állapotot (`state/monitor.db`) a `main`-re.

| Artefakt | Hol |
|---|---|
| Élő jelentés (mindig a legfrissebb) | `https://goszmarton.github.io/survey-monitor/` |
| Aznapi archív | `https://goszmarton.github.io/survey-monitor/ÉÉÉÉ/HH/NN.html` |
| Napi digest email | a `MAIL_TO` címzettekhez |
| 🔴 KIEMELT email | külön levél, CSAK ha aznap volt KIEMELT tétel |
| Futási napló | GitHub → Actions → „monitor" workflow |
| Állapot (DB) | `state/monitor.db` a repo `main` ágán (a futás commitolja) |

### Levél-adminisztráció — a leggyakoribb valódi kérés

A címzettek a **`MAIL_TO` GitHub Actions secret**-ben vannak (repo → Settings → Secrets and
variables → Actions → `MAIL_TO`). A rendszer nodemailer-en, Gmail SMTP-vel küld
(`SMTP_USER`/`SMTP_PASS` secret, `smtp.gmail.com:465`).

- **Címzettet cserélni / hozzáadni:** a `MAIL_TO` secret értékét írod át. Formátum:
  **vesszővel** elválasztott lista (`a@x.hu, b@y.hu`). A guard (`src/email.js`
  `parseRecipients`) trimmeli a szóközöket, dobja az üres tagokat; pontosvesszőt is elfogad,
  de a láblécben ⚠️-t jelez („használj vesszőt"); a @-nélküli gyanús címet MEGTARTJA, de
  jelzi (nincs néma dobás).
- **Levelet szüneteltetni** (a jelentés és a Pages menjen tovább, csak email ne):
  a `MAIL_TO`-t (vagy `SMTP_USER`/`SMTP_PASS`-t) ürítsd/töröld → `buildTransport` `null`-t
  ad, email nem megy, de a futás és a Pages változatlan.
- **Az egész napi futást leállítani:** a `.github/workflows/monitor.yml`-ben a
  `schedule` (`- cron: "43 8 * * *"`) kivétele/kommentelése, vagy a workflow letiltása az
  Actions felületen. (A manuális `workflow_dispatch` így is elérhető marad.)

---

## 1. Napi minimum-ellenőrzés — *NEM fejlesztési verifikáció*

Három pipa annak, aki csak **látni akarja, hogy egészséges** — kód és DB nélkül:

- ☐ **Levél megjött** (~09:20–10:00 UTC).
- ☐ **Pages 200** — a **gyökér-URL** (`…/survey-monitor/`) él. (Az aznapi archív-URL is 200,
  de a gyökér a mérvadó — az mindig a legfrissebb.)
- ☐ **Audit-lábléc WARN-jai** — a levél/Pages láblécében van-e ⚠️. Ha igen → §2.

Ha mind a három OK → **nincs teendő**. A rendszer nem küld „zöld futás"-riportot; a
**hallgatás a jó hír** (becsületes részlegesség: a napló magától igaz).

---

## 2. A három audit-jel — jelentés és teendő

Mindhárom jel **levél-semleges**: a láblécben látszik, de NEM állítja meg a jelentést
(3. vezérelv — a jelentés sosem marad el).

| Jel (lábléc ⚠️) | Mit jelent | Mikor tüzel | Teendő |
|---|---|---|---|
| **groq HTTP_404** | a groq-modell deprecated (megszűnt az endpoint) | a groq-hívások 404-et adnak | modell-ID frissítése `config/llm.json`-ban a groq aktuális modelljére; addig a lánc anthropic-ra (fizetős) esik — ld. lenti jel |
| **fizetős fallback >2 batch** | az anthropic (fizetős) vitte a triázs >2 batch-ét → a két ingyenes réteg (gemini+groq) egyszerre gyenge | anthropic-batch szám > 2 | nézd meg melyik ingyenes réteg esett ki (kvóta? tranziens 503/429?). Nem azonnali beavatkozás, de ha tartós → provider-kvóták |
| **lánc-sorrend <50% (③)** | az elsődleges provider (gemini) az OK-batch-ek <50%-át vitte — **néma degradáció**, amit a másik két jel nem lát | primary-share < 50% | 1–2 nap → tranziens, magától rendeződik. **„Tartós" = ≥3 egymást követő nap <50%** → §2 alatti döntési lépés (NEM automatikus csere) |

**③ első éles tüzelése (2026-08-22):** gemini 503×12 → az OK-batch-ek 1/13 = 8%-a ment
gemini-n → WARN. Ez a jel pontosan azért van, mert a gemini 503 (≠404) a groq-404-jelet és
a fizetős-fallback-jelet is elkerülhette volna. A 08-22-i tüzelés helyes, nem hiba.

**Mért trend:** 08-21 = 23%, 08-22 = 8%, 08-23 = 15% — mindhárom <50%. **A „tartós" küszöb
(≥3 egymást követő nap) tehát 2026-08-23-ra MÁR teljesült** — de a helyes teendő NEM
mechanikus provider-csere:

1. **Állapítsd meg a MIÉRT-et** a láblécből: ha a primary **503/429**-cel esik ki
   (kvóta/overload — ez a jelenlegi eset, gemini szaturált), az a fallback-lánc *tervezett*
   működése (groq átveszi). Ha **404** (deprecation), az a groq-jel, más teendő.
2. **Provider-sorrend csere** (`config/llm.json` → `roles.triage.chain`, a fallbacket előre)
   **CSAK akkor javít, ha a fallbacknek TARTÓS TPM-headroomja van.** A groq TPM viszont
   **szűk** (a `tokens_remaining` margó 08-23-on 458-ig esett, közel a 12k/perc fojtáshoz) —
   így a groq-first a burst-plafonba ütközne, 429-eket okozva. **A jelenlegi adaton a csere
   ellenjavallt.**
3. **Amíg a groq megbízhatóan átveszi a terhet és a jelentés hibátlan (mint 08-21…23),
   a helyes teendő: SEMMI** — a WARN itt a fallback-lánc *sikerét* jelzi, nem működési hibát.
   Beavatkozás (primary kvóta emelése / harmadik ingyenes provider / sorrend-csere) csak
   akkor, ha a fallback is fogy (③ mellett fizetős-fallback >2 jel is tüzel).

---

## 3. Tudatosan elfogadott viselkedés — *NE hibának nézd*

Mérési hivatkozással, hogy három hónap múlva se tűnjön regressziónak:

- **KIEMELT 14-napos ablak: a mechanizmus FRISSÍT — az azonosság adat-szegénység, nem beragadás.**
  Ha nincs friss tétel (`UJ_24H=0`), a lista változatlant ismétel (az ablak kigördül); de amint
  friss KIEMELT jön, azonnal beépül. *Mérés: 2026-08-20/21 = 11, 08-22/23 = 10 — négy egybevágó
  `UJ_24H=0` nap (adat-szegénység); majd **2026-08-24: friss KIEMELT érkezett (`UJ_24H`-KIEMELT = 1),
  a lista 10→9 (egy régi kigördült, egy friss belépett)** → a mechanizmus bizonyítottan frissít, nem
  ragad be.* Termékdöntés (a KIEMELT a 14 nap legfontosabbjait tartja), nem hiba.
- **Dedup viselkedése ABLAKMÉRET-FÜGGŐ — tudatos kompromisszum** (CLAUDE.md 5: a hamis
  összevonás egy fontos tételt a rep alá temet ≫ megmaradt duplikátum):
  - **Normál napi ablakon: precision-erős / recall-gyenge.** *Két counterfactual igazolta,
    hogy a baseline (`harness([])`) alatt IS bont, tehát NEM a ② name-hub flip túlbontása:
    Baka-hármas 2026-08-21, Vitézy-négyes 2026-08-22.* Ha ugyanaz a sztori több soron
    jelenik meg `+N` nélkül, az recall-hiány, nem elrontott merge.
  - **Nagy klaszterek esetén megjelennek OVER-MERGE-ek numerikus és név-hidakon.** *Mérés:
    2026-08-24 kétnapos ablak (126 merge / 284 tag): akkugyár +11 HÁROM sztorit fúzionál a
    „bírságot kapott"/„225 milliós" hídon (Debrecen CATL + Iváncsa + eMAG GVH-bírság); Posta
    +10 a „nagy"/„Nagy"/„magyar" hídon (Posta-vezér-menesztés + idegen tételek).* **Eltemetett
    KIEMELT NINCS** — a beolvadt idegen tételek FIGYELENDO/FONTOS (a drága hibamód nem sült el).
  - **A kiváltó kétnapos ablak INCIDENS-EREDETŰ** (a 08-24-i hang miatt maradt el az aznapi
    futás → a #47 két nap tételét egyszerre hozta), **nem normál üzem.** Egynapos ablakon a
    híd-tokenek ritkábban láncolnak át sztori-határon.
- **A levél elolvasása önálló ellenőrzési csatorna.** Nem hangulat, hanem mért: az elmúlt
  három nap mindhárom megfigyelése (Vitézy-négyes, Baka-hármas, KIEMELT-ismétlés) **a
  levélből tűnt fel elsőként** — nem tesztből és nem DB-ből. A minimum-ellenőrzés (§1)
  elég az „egészséges-e" kérdésre; de aki átfutja a levél tartalmát, olyan mintázatot lát,
  amit egyik automata jel sem fog meg.
- **Synthesis ↔ triázs rangsor tervezetten diszjunkt** (C döntés, `docs/DONTES-SZINTEZIS-VS-RANGSOR.md`):
  a „📰 Napi narratíva" szekció szerkesztői (újságírói szaliencia), a „📊 Adatjelentőség
  szerint, kapuzott" adatjelentőségi. A kettő eltérhet — ez szándék, nem inkonzisztencia.
  **De a diszjunkció NEM állandó szerkezeti szakadék, hanem a napi hírhelyzet függvénye:**
  adat-gazdag napon a két szekció fedésbe kerül (pl. 2026-08-23 mindkettő Paksot vitte). Ne
  számíts állandó eltérésre — hol elválik, hol egybeesik, a nap tartalmától függően.
- **B2 (eurobarometer) 2026-08-24 óta PARKOLVA** (az aktiválás visszavonva). Az első éles
  B2-futás 30 percig némán beragadt (fojtott `volumeA.xlsx` body-download a datacenter-IP-ről,
  időtlen törzs-olvasás), a job-timeout ölte meg, a levél elmaradt — ld. §6. A gyök-ok
  javítva (`http.js` törzs-timeout + workflow step-timeout/`cancelled()`-ág); az **adapter-kód
  és a registry érintetlen**, az újraaktiválás egyetlen `status`-flip lesz, **külön napon**,
  miután a fix élesben legalább egy tiszta futással bizonyított ÉS a webgate-letöltés a
  datacenter-IP-ről (Actions) verifikált. Addig a napi levél a B2 nélküli, ismert-jó körön megy.
  *Reaktiválási kapu **1. feltétel TELJESÜLT** 2026-08-24: a kézi futás #47 (run 32751426091) a
  http-fixszel TISZTA lement — 15m41s (< a 25 perces step-timeout), 27 forrás, levél kiment,
  Pages+archív 200, a step-timeout/`cancelled()`-ág NEM tüzelt. A **2. feltétel** (volumeA.xlsx
  a datacenter-IP-ről) még külön mérés.*

---

## 4. Amit tudatosan elhagytunk

Nem félbehagyott feladatok — lezárt döntések, indoklással:

- **Historikus backfill** — a napi ág kezeli a jövőbeli EE-pollokat (a `filterSinceDay`
  nap-granularitása a jövőbeli pollt átengedi); a backfill kizárólag a 2026-08-11-i
  Europiont mentené, egyetlen aggregát pollt, ami 08-25-re kigördül az ablakból → nem éri
  meg egy külön ág kockázata.
- **pew** — a „külön provider-lánc" premisszája **mérésen megdőlt**: a gemini-first lánc két
  napja gyakorlatilag néma (23% → 8% share), tehát nincs szabad kapacitás egy külön láncra.
- **21-token kollízió policy-fix** — mért **blast-radius 0** (2 kontaminált tétel, 0 valódi
  cross-intézet hamis merge); a `standalone_sources` strukturális kerülőút elég.
- **Dinamikus hub-kritérium / üres-intézet-osztály** — nincs mért haszon a jelenlegi
  forráskörön.
- **① `decompose_min_component` 30→20** — a ② name-hub token teljesen lefedte, külön
  paraméter-hangolás fölösleges.
- **Dedup over-merge tuning (numerikus token-drop + „nagy"/„Nagy" hub-token)** — a 08-24-i
  nagy-klaszter over-merge-ek (§3) kézenfekvő ellenszere, DE **kétélű, mérés nélkül nem
  shippelhető:** a numerikus token gyakran a sztori LÉNYEGE, nem zaj (a „225 milliós" épp a
  bírság azonosítója → drop-ja false SPLITet okozna a valódi eMAG-parafrázisok közt); a „nagy"
  pedig poliszém melléknév — ugyanaz a csapda, ami miatt a „magyar" kimaradt az a2 name-hub
  listából (hub-tokenként legitim merge-eket bontana). A kiváltó ablakméret egyszeri
  (incidens-eredetű), a drága hibamód (eltemetett KIEMELT) nem sült el → nem éri meg a
  kockázat. Ha visszatérő nagy-ablak lenne, korpusz-mérés után újranyitható.
- **KIEMELT-freshness / rendezési sorrend** — termék-kérdés (mit mutasson elöl), nem hiba.
- **politico + 21kutato** — datacenter-ASN blokk (Actions + Hetzner 403, lakossági IP 200);
  rezidens runner kellene. Jelenleg kézi laptop-fetch, újranyitás ha lakossági futtató-
  környezet vagy heti kadencia.

---

## 5. Ismert környezeti tételek

- **Gmail MCP token lejárt** — csak akkor számít, ha a levelet MCP-n keresztül akarod
  olvasni/kezelni; újra-auth kell. A **kézbesítést NEM érinti** (az nodemailer/SMTP-n megy).
- **`/doctor` npm prefix warning** — kozmetikai, nincs funkcionális hatás.
- **`szazadveg` feed HTTP 500 — ISMÉTLŐDŐ** (2026-08-22 ÉS 08-23, két egymást követő nap →
  NEM tranziens). Szerver-oldali (5xx) hiba, nem a mi oldalunkon; egyetlen forrás hibája nem
  dönti el a futást (a `source_checks` láthatóan `HIBA`-ként naplózza — nincs néma eltűnés).
  Teendő: ha tartósan áll, a `config/sources.json` szazadveg-bejegyzésének felülvizsgálata
  (feed-URL változott? végleg megszűnt? → `HIBA_TARTOS`/`MEGSZUNT` státusz, hogy a napló
  pontos legyen). Addig figyelendő — ha magától rendeződik, ez a sor törölhető.

---

## 6. Hibaelhárítás dióhéjban — *ha a §1 minimum-ellenőrzés bukik*

Az §1–5 azt írja le, mi a normális; ez az egyetlen rész, ami akkor segít, amikor nem az.

- **Levél nem jött** → GitHub → Actions → „monitor" run státusza. Ha a run sikeres, de nincs
  levél: `MAIL_TO`/`SMTP_*` secret (ürült? elgépelt?), a lábléc MAIL_TO-guard ⚠️-je. Ha a run
  bukott: a lépés-log.
- **Pages 404 a gyökéren** → deploy-gap (a Pages-backend néha késik; nézd a „deploy" job-ot,
  van natív retry). **Fontos apróság:** az archív-URL az **`archive` prefix NÉLKÜL** él:
  `…/survey-monitor/ÉÉÉÉ/HH/NN.html` — a `buildDist` a másoláskor lestrippeli az `archive`
  könyvtárat. A `…/survey-monitor/archive/…` MINDIG 404, ez nem hiba.
- **A levél megjött (vagy elmaradt), de a Pages a TEGNAPit mutatja** → a run **a DB-commit
  ELŐTT állt le** (a `node src/run.js` lépés beragadt/időtúllépett → a job cancelled, és a
  DB-commit + Pages-artifact + deploy MIND skipped). Ilyenkor **a GHA-run STÁTUSZA a mérvadó,
  nem a deploy-lépés**: Actions → a run zöld-e? Ha „cancelled" / a „Napi futás" lépés elakadt,
  a Pages azért mutat régit, mert aznap nem is épült új. (2026-08-24: egy időtlen body-stream
  30 percig némán függött; azóta van egy-hívásos törzs-timeout (`http.js`) + step-timeout(25)
  a futás-lépésen + `cancelled()`-ág a hiba-emailen, így egy ilyen beragadás már NEM néma.)
- **A „Napi futás" lépés a step-timeout közelébe kerülhet — a hajtóerő NEM a tételszám,
  hanem a per-batch költség.** *KORÁBBI HIPOTÉZIS (2026-08-25 reggel, ELVETVE): „a wall-clock
  ~lineáris a tételszámmal". A 08-25-i futás CÁFOLTA: a „Napi futás" 22m20s volt (a 25 perces
  step-timeout ~2m40s margóján belül — near-miss), MIKÖZBEN a triázs-batchszám 13 = pontosan
  annyi, mint a 8m57s-es 08-23-i napon. A per-batch wall-clock triplázódott (08-23: 41s/batch
  → 08-25: 103s/batch), a batch-szám lapos maradt → a tételszám NEM batchen keresztül hat.*
  A batch-szünet (`triage.js`) token-alapú (mért tok/batch ÷133,3 ≈30s), napok közt ~azonos;
  a provider-láncban nincs backoff (`complete.js`). A tripla wall-clock legvalószínűbb oka a
  teljesen kieső elsődleges provider (08-25: gemini 0/13, minden batch 503→groq round-tripet
  fizetett) és/vagy egy lassú collect-fázis — **de amíg a run.js nem írt fázis-időbélyeget, ez
  nem volt lokalizálható.** *ESZKÖZ (shippelve 2026-08-25, `phaselog.js` + `run.js`): a futás
  most fázisonként (`collect` / `triázs+szintézis` / `render+dedup` / `email`) kiír egy
  `⏱ fázis "…": …s` sort a Napi-futás-logba — a következő lassú futásnál a fázis azonnal
  látszik.* **Teendő:** ha a „Napi futás" a 25 perc közelébe ér, a Napi-futás-logból olvasd ki,
  MELYIK fázis vitte az időt: ha triázs (provider-kiesés) → §2/provider-kvóták; ha collect →
  forrás-timeout. Átmeneti tűzoltás bármelyik esetben a **step-timeout megemelése** (`monitor.yml`
  → `timeout-minutes`), NEM a pipeline vak hibakeresése. (A tételszám/kimaradt-nap hatását külön
  még nem tudtuk tisztán mérni — a 08-24/08-25 mind incidens-eredetű átfedő ablak volt; az első
  tiszta összehasonlító adatpont a 08-26 normál egynapos ablak.)
- **Minden provider kiesett** → a jelentés **degradáltan akkor is megjön** (3. vezérelv), a
  lábléc jelzi melyik réteg esett ki. Nincs azonnali teendő; ha tartós → provider-kvóták.
- **Forrás HIBA/RESZLEGES a naplóban** → egyetlen forrás hibája nem dönti el a futást; a
  `source_checks` napló láthatóan rögzíti (nincs néma eltűnés). Tranziens → magától rendeződik.
