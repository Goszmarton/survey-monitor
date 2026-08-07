# Kapu-A/B kísérlet — TERV (nem futtatva)

**Dátum:** 2026-08-07
**Státusz:** ⚠️ Csak terv. Egyetlen LLM-hívás sem futott. Ez a jegyzet a kísérlet
*definícióját*, *költségét* és *kiértékelését* rögzíti — a futtatás külön, jóváhagyott lépés.

## 1. A kérdés

A `data_backed`-kapu (spec 1./15.) leszorítja az adat nélküli politikai híreket
FIGYELENDO-ra (KIEMELT/FONTOS csak `data_backed=true` tételre). **Helyes termékdöntés-e**,
vagy értékes, nem-adatközlő tételeket temet el?

**Miért nem elég a meglévő adat (a post-gate toggle ~0-t mér):** a kapu KÉT helyen érvényesül:
- **prompt** (`src/triage.js` 67–70. sor): a modell ÖNCENZÚRÁZ — eleve nem ad FONTOS/KIEMELT-et
  `data_backed=false` tételre;
- **kód** (`gatedSignificance`, backstop): ha a modell mégis adna, a kód levágja.

A 2026-08-06-i mérés: **0 eltérés** raw (`significance_raw`, kapu ELŐTTI) és kapuzott
(`significance`) között 105 triázsolt tételen → a kód-plafon szinte SOHA nem üt be, mert a
prompt már elvégezte a szűrést. Ezért a kód-gate ki/be kapcsolgatása ~0-t mér. **Az igazi
kérdés a PROMPT-öncenzúra**: mit adna a modell, ha NEM mondanánk meg neki a kaput?

## 2. A/B karok

Ugyanaz a determinisztikus prefilter, ugyanaz a batch-elés (batchSize=15), ugyanazok a tételek.

| | **B-kar (kontroll)** | **A-kar (kezelés)** |
|---|---|---|
| prompt | jelenlegi (kapu-szabállyal) | kapu-szabály NÉLKÜL |
| kód-gate | — (nem releváns, lásd lent) | — |
| forrás | **MÁR MEGVAN** a produkciós adatban | ÚJ triázs-futás kell |

**A B-kar nem igényel új hívást:** a produkciós run minden tételre eltárolta a
`significance_raw`-t (kapu ELŐTTI, de a prompt-öncenzúra ALATT született) és a `data_backed`-et.
Ez a kontroll. Csak az **A-kart** kell lefuttatni.

**Az A-kar prompt-diffje** (`src/triage.js` `buildPrompt`, 67–70. sor — a `data_backed`-előfeltétel
kivéve, a jelentőség-kritériumok MARADNAK):
- 67: „JELENTŐSÉG — ~~CSAK data_backed=true tételre adható~~ KIEMELT vagy FONTOS:"
- 68: „KIEMELT — ~~CSAK ha data_backed ÉS:~~ trendforduló, rendkívüli/történelmi érték, …"
- 69: „FONTOS — ~~data_backed,~~ érdemi új országos adat rendkívüli változás nélkül."
- 70: „FIGYELENDO — háttérjellegű. ~~VAGY adat nélküli … PUSZTA POLITIKAI HÍR … KIEMELT SOHA.~~"

Az A-kar TOVÁBBRA IS kéri a `data_backed` mezőt (osztályozáshoz + méréshez), de a jelentőséget
a modell ÉRDEM alapján adja, nem a kapu szerint. Megvalósítás: `buildPrompt`-nak egy `gated`
paraméter (alap: true = jelenlegi); `gated=false` esetén a 67–70. sor a fenti, kapu nélküli
változatra cserél. A `gatedSignificance` kód-plafont az A-karnál NEM alkalmazzuk (a `significance`-t
közvetlenül a modelltől vesszük).

## 3. Korpusz

**Egy nap ~105 triázsolt tétele elég** (nem kell napokig gyűjteni — a kérdés a prompt-viselkedés,
nem a ritka esemény). Rögzített, reprodukálható halmaz: egy kiválasztott `runId` (pl. `2026-08-06`,
a mért 105-ös nap) tételei a `state/monitor.db`-ből — `title` + `summary` — pontosan azok, amiket a
produkciós run triázsolt. Így az A-kar és a tárolt B-kar UGYANAZON a tétel-halmazon fut
(item-szintű párosítás `canonical_key`-en).

## 4. Költségbecslés

105 tétel / 15 = **7 batch**, csak az A-kar:
- input ≈ 7 × ~1700 token (rendszer-utasítás ~500 + 15 tételsor ~1200) ≈ **~12k token**
- output ≈ 7 × ~750 token (15 × ~50 token JSON) ≈ **~5k token**
- provider: `gemini-flash-latest` (elsődleges), `groq/llama-3.3-70b` fallback.
- gemini-flash díjszabással (~$0.075/1M in, ~$0.30/1M out): **~$0.003**; ret/fallback-kal is
  **jóval $0.05 alatt**. Gyakorlatilag ingyenes. (A B-kar 0 Ft — meglévő adat.)

## 5. Hova kerül az eredmény — NEM a produkciós DB-be

Az A-kar kimenete **külön artefaktba**, a `state/monitor.db`-t NEM érinti:
`state/experiments/kapu-ab-<runId>.json` (vagy scratch), soronként
`{ canonical_key, title, a_significance, a_data_backed, b_significance_raw, b_gated, b_data_backed }`.
A produkciós triage_json/significance oszlopok VÁLTOZATLANOK. (CLAUDE.md 6: a DB-t érintő lépés
külön, látható migráció — itt nincs ilyen, az artefakt független fájl.)

## 6. Mit mérünk

**Elsődleges — a kapu tényleges elnyomása:** hány tétel, ahol
`a_significance ∈ {KIEMELT, FONTOS}` DE `b_gated = FIGYELENDO` (azaz a kapu — prompt VAGY kód —
leszorította). Ez a prompt-öncenzúra + kód-plafon EGYÜTTES hatása, amit a post-gate toggle nem lát.
Bontás: hány KIEMELT→FIGYELENDO, hány FONTOS→FIGYELENDO; `data_backed=false` mellett.

**Másodlagos — a prompt-öncenzúra izolálva:** `a_significance` vs `b_significance_raw` (mindkettő
kapu ELŐTTI, de B a kapu-prompt alatt). Az eltérés = tisztán a prompt-utasítás hatása a modellre.

**Kvalitatív — a döntés lényege:** a leszorított tételek kézi átnézése: HAMIS elnyomás (valódi
fontos, adatra nem támaszkodó hír — pl. „Leáll a Paksi Atomerőmű", ami esemény, nem kutatás) vs
HELYES plafon (megalapozatlan sajtó-spekuláció). ~10–20 tétel, gyors.

## 7. Döntési kritérium

- Ha a leszorított tételek zöme **HELYES plafon** (adat nélküli spekuláció) → a kapu jó, marad.
- Ha érdemi hányad **HAMIS elnyomás** (fontos esemény-hír FIGYELENDO-ra esve) → a kapu túl durva;
  mérlegelendő egy HARMADIK jelentőség-tengely (pl. „esemény-jelentőség" a data_backed mellett),
  hogy a Paks-típusú fontos, de nem-adatközlő hír ne essen FIGYELENDO-ra.
- A döntést a szám + a kvalitatív minta EGYÜTT hozza; a kapu módosítása külön, tesztelt változás.

## 8. Kapcsolódó

- `src/triage.js` — `buildPrompt`, `gatedSignificance`, `ungatedSignificance`
- 3a (significance_raw mentése): a B-kar kontrollját ez tette lehetővé (auditálhatóság).
- notCovered (`src/run.js`): „Kapu-hatás A/B (data_backed)" tétel — ez a jegyzet annak a terve.
