# Survey Monitor

Automatizált magyar közéleti kutatás- és adatmonitor. Minden reggel
**7:00 (Budapest) előtt** emailben érkezik a napi jelentés; az archívum
GitHub Pages-en böngészhető. Teljes terv: `docs/ARCHITEKTURA.md`.

**Jelenlegi fázis: F0 — csontváz.** A kézbesítési lánc működik
(cron → jelentés → Pages → email); az adatgyűjtés az F1-től épül be.

## Beüzemelés (egyszeri, ~15 perc)

### 1. Repo

```bash
# a kicsomagolt mappában:
git init && git add -A && git commit -m "F0: csontváz — workflow, jelentés, email"
gh repo create survey-monitor --public --source . --push
```

Megjegyzés: a GitHub Pages **privát repónál csak fizetős csomagban**
publikus — ezért `--public`. (Alternatíva: privát monitor-repo + külön
publikus output-repo; lásd az architektúra-doksi 11. pontját.)

### 2. Secrets (repo → Settings → Secrets and variables → Actions)

| Secret | Mi ez | Mikor kell |
|---|---|---|
| `SMTP_USER` | Gmail-cím, amiről a levél megy | most (F0) |
| `SMTP_PASS` | Gmail **app-jelszó** (Google-fiók → Biztonság → App-jelszavak; kétlépcsős azonosítás kell hozzá) | most (F0) |
| `MAIL_TO` | hova érkezzen a jelentés | most (F0) |
| `ANTHROPIC_API_KEY` | Claude API | F2-től |
| `GEMINI_API_KEY` | Gemini free tier | F2-től |
| `GROQ_API_KEY` | Groq free tier | F2-től |

Nem Gmail esetén: `SMTP_HOST` és `SMTP_PORT` secretekkel felülírható.

### 3. Pages bekapcsolása

Repo → Settings → Pages → **Source: GitHub Actions**. Ennyi — a
workflow deploy-lépése innentől publikálja a `dist/` tartalmát.

### 4. Első futás

Repo → Actions → `daily-monitor` → **Run workflow**. Siker esetén:
a Pages-oldalon megjelenik a jelentés, és megjön az első email
(`📊 Monitor <dátum> — F0 próbafutás`). Innentől a cron minden hajnalban
fut (03:43 UTC), és a levél 7:00 előtt a postaládában van.

## Lokális futtatás

```bash
npm install
node src/run.js          # jelentés a dist/ mappába; email csak SMTP env-vel
```

## Szerkezet

```
.github/workflows/monitor.yml   cron + futás + Pages deploy + hiba-email
src/run.js                      napi futás vezérlője
src/report.js                   jelentés-renderelő (spec 17–23. pont váza)
src/email.js                    SMTP-küldés + --failure CLI-mód
config/sources.json             forrásregiszter (F1-ben verifikált URL-ekkel)
config/llm.json                 szerep → provider-lánc (F2)
docs/ARCHITEKTURA.md            teljes terv és fázisok
state/                          SQLite állapot-DB helye (F1-től)
```

## Fázisok

F0 csontváz ✅ → F1 KSH/Eurostat/MNB + RSS + állapot/dedup →
F2 LLM-réteg (triázs, fallback-lánc, KIEMELT-email) →
F3 agentikus intézet-ellenőrzés + rejtett magyar adat →
F4 forrásbővítés, publikációs naptár, revíziók.

Részletek és tervezési elvek: `docs/ARCHITEKTURA.md`.
