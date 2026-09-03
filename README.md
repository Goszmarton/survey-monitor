# Survey Monitor

Automatizált magyar közéleti **kutatás- és adatmonitor**. Minden nap egy jelentést
állít elő az előző futás óta megjelent magyar és nemzetközi közvélemény-kutatásokról,
intézeti felmérésekről és hivatalos statisztikai adatközlésekről — determinisztikus
gyűjtéssel, LLM-triázzsal, és **kora esti kézbesítéssel** (email + böngészhető archívum).

**Státusz:** üzemben, önjáró (2026-08-24-től). A fejlesztési fázis **lezárva
2026-08-26** — innentől az alapállapot az üzemeltetés, kód csak tartós hibára változik.

- **Élő jelentés (mindig a legfrissebb):** <https://goszmarton.github.io/survey-monitor/>
- **Független tükör (az email linkje ide mutat):** <https://napihir.duckdns.org/>
- **Az oldalról / hogyan gyűjtünk:** a jelentés fejlécében az `ℹ️ Az oldalról` fül (`info.html`)

Teljes terv: [`docs/ARCHITEKTURA.md`](docs/ARCHITEKTURA.md) · Napi üzemeltetés (az operatív
igazság forrása): [`docs/UZEMELTETES.md`](docs/UZEMELTETES.md).

## Hogyan működik

Minden futás ugyanazt a determinisztikus pipeline-t viszi végig (`src/run.js`):

1. **Gyűjtés** (`src/collect.js`) — **55 aktív forrás** (61 definiált). Az A-kaszt
   determinisztikus fetcherek (RSS / HTML-lista / natív parserek: KSH, MNB, Eurostat,
   Europe Elects, Eurobarometer, Pew), 20 s timeout, böngésző-UA, retry.
2. **Dedup + állapot** (`src/state/db.js`, `src/lib/slug.js`) — SQLite (`state/monitor.db`),
   kanonikus kulcs a duplikátumok ellen, „korábban szerepelt-e" determinisztikusan.
3. **Story-csoportosítás** (`src/lib/storygroup.js`) — ugyanaz a hír több forrásból →
   egy reprezentáns (a leghitelesebb forrás), a többi a „+N forrás" jelölésbe.
4. **Triázs** (`src/triage.js`) — olcsó/ingyenes LLM dönti a relevanciát és a jelentőséget
   (JSON-séma), `data_backed`-kapuval: adat nélküli politikai hír SOHA nem KIEMELT.
5. **Szintézis** (`src/synthesis.js`) — rövid, szám-ellenőrzött összefoglaló bekezdések.
6. **Renderelés + kézbesítés** (`src/report.js`, `src/email.js`, `src/dist.js`) — HTML-jelentés
   → GitHub Pages + tükör; **egy összevont email** (🔴 KIEMELT szekció, ha van; digest;
   📊 Kulcsszámok verbatim a címekből).

**Vezérelvek** (részletek az architektúra-doksiban): determinisztikus, ami az lehet;
becsületes részlegesség; **a jelentés sosem marad el** (degradált, de működő kimenet
provider-kiesésnél is); költségtudatosság (a triázs free-tieren fut).

## Indítás és ütemezés

- **ELSŐDLEGES: szerver-trigger** — a Hetzner-szerver (a tükör hosztja) egy systemd-timerrel
  **16:30 Europe/Budapest**-kor (DST-biztos helyi idő) `curl`-lel `workflow_dispatch`-et küld
  (`scripts/gh-trigger.sh`). Miért: a `workflow_dispatch` pontos, nem függ a scheduled-cron
  kiszámíthatatlan sorállásától.
- **BACKUP: GitHub-cron** `0 16 * * *` (UTC), a szerver-trigger mögé tolva. Csak akkor számít,
  ha a szerver nem lő.
- **Őr (idempotencia):** ha a szerver-trigger ÉS a backup is fut, a `run.js` no-opolja a
  másodikat (`hasCompletedRun`) → **pontosan egy levél**. Kézi „küldj most":
  `workflow_dispatch` **`force=true`** (átlépi az őrt).

## Kimenetek

- **GitHub Pages:** dátumozott HTML-archívum (`/ÉÉÉÉ/HH/NN.html`) + `index.html` a legfrissebbre,
  perzisztens `archive/`-ból építve (`src/dist.js`), így a régi napok URL-je is 200 marad.
- **Tükör:** `napihir.duckdns.org` (külön Hetzner + Caddy szerver, a repo `archive/`-ját szolgálja
  ki; részletek: memória `duckdns-mirror`).
- **Email:** a `MAIL_TO` címzettekhez, egy összevont levél. Láblécben audit-jelek (⚠️) —
  a jelentést nem állítják meg (ld. `docs/UZEMELTETES.md` §2).
- **Info-fül:** statikus `info.html` — mit/hogyan gyűjtünk, cikk-összevonás, mit látunk.

## Beüzemelés (egyszeri)

### Secrets (repo → Settings → Secrets and variables → Actions)

| Secret | Mi ez |
|---|---|
| `SMTP_USER` | Gmail-cím, amiről a levél megy |
| `SMTP_PASS` | Gmail **app-jelszó** (kétlépcsős azonosítás kell hozzá) |
| `MAIL_TO` | címzettek — **vesszővel** elválasztott lista |
| `ANTHROPIC_API_KEY` | Claude API (audit/szintézis + triázs-tartalék) |
| `GEMINI_API_KEY` | Gemini free tier (triázs elsődleges) |
| `GROQ_API_KEY` | Groq free tier (triázs tartalék) |

Nem Gmail esetén: `SMTP_HOST` / `SMTP_PORT` secretekkel felülírható. A címzett-adminisztráció
(csere, szüneteltetés) részletei: `docs/UZEMELTETES.md`.

### Pages

Repo → Settings → Pages → **Source: GitHub Actions**.

## Lokális futtatás

```bash
npm install
node src/run.js     # jelentés a dist/ mappába; email csak SMTP env-vel
npm test            # regressziós tesztek (node --test)
```

## Szerkezet

```
.github/workflows/monitor.yml   trigger + futás + Pages deploy + hiba-email
scripts/gh-trigger.sh           szerver-oldali PRIMARY indító (workflow_dispatch)
scripts/build-site.mjs          a tükör build-belépője (buildDist CLI-burok)
src/run.js                      napi futás vezérlője + idempotencia-őr
src/collect.js                  gyűjtés-orkesztráció, aktív-forrás logika, végpontok
src/sources/                    fetcherek: rss, htmllist, http, + natív parserek
                                (europeelects, eurobarometer, pew_extract)
src/triage.js  src/audit.js  src/synthesis.js  src/enrich.js   LLM-szerepek
src/llm/                        provider-absztrakció + fallback-lánc (gemini/groq/anthropic)
src/lib/                        slug, freshness, storygroup, feedparse, phaselog
src/report.js                   jelentés + email + info-oldal renderelése
src/dist.js                     archív → dist build (Pages + tükör), info.html
src/state/db.js                 SQLite állapot (node:sqlite)
config/sources.json             forrásregiszter · config/llm.json  szerep → provider-lánc
state/monitor.db                SQLite állapot-DB (a futás visszacommitolja)
docs/ARCHITEKTURA.md            teljes terv és tervezési elvek
docs/UZEMELTETES.md             napi üzemeltetés — az operatív igazság forrása
```

## Fázisok (történet)

F0 csontváz → F1 A-kaszt mag (KSH/Eurostat/MNB + RSS, SQLite, dedup, frissesség) →
F2 LLM-réteg (triázs, fallback-lánc, összevont email) → F3 B-kaszt + rejtett magyar adat +
story-dedup → F4 forrásbővítés (26→55 aktív). **Mind lezárva; a rendszer üzemben van.**
A tervezési elvek és a döntések *miértje* az architektúra- és üzemeltetés-doksikban.
