# Forrás-felmérés — 2026-08-07 (verifikált próba)

**Státusz:** ✅ Tényleges HTTP-próba lefutott (szemben a `SOURCES-INTEZETEK-FELDERITES.md`
tervvel). **Aktiválás és `sources.json`-írás NEM történt** — az külön lépés. Ez a jegyzet
a 9 forrás mai állapotát rögzíti, hogy holnap ne kelljen újra kideríteni.

**Módszer:** a **produkciós fetcher User-Agentjével** (`survey-monitor/0.1
(+https://github.com/Goszmarton/survey-monitor)`, `src/sources/http.js`) — NEM a Node
alapértelmezettjével. Ez lényeges: a Politico más UA-nak blokkot ad, a produkciósnak 200-at.
Mérce: HTTP-státusz, content-type, feed-gyök, `<item>`/`<entry>` szám, legfrissebb dátum.
STALE-határ: 180 nap (ma = 2026-08-07 → 2026-02-08 előtt = STALE).

## A 9 forrás

| forrás | kind | próbált URL | HTTP | root | tétel | legfrissebb | megállapítás |
|---|---|---|---|---|---|---|---|
| **publicus** | intezet | `publicus.hu/feed/` (+ `/fooldal/feed/`, `/blog/category/blog/feed/`) | 200 | rss | **1** | 2026-07-31 | Feed csak 1 BLOG-tételt ad; a 4 júliusi KUTATÁST (07-31/27/24/23) egyik feed sem → **feed NEM reprezentálja a forrást → HTML-lista kell** |
| **szazadveg** | intezet | `szazadveg.hu/feed/` | 200 | rss | **0** | (üres) | A fő `/feed/` ÜRES … |
| **szazadveg** | intezet | `szazadveg.hu/cikkek/feed/` | 200 | rss | 10 | 2026-08-03 (4 nap) | …a **`/cikkek/feed/`** viszont **ÉLŐ A-feed** (10 tétel) |
| **realpr93** | intezet | `realpr93.hu/feed/` | 200 | rss | 10 | 2026-02-09 (**179 nap**) | **ÉLŐ WordPress A-feed**, épp a 180-as határ ALATT (határeset-friss) |
| **nezopont** | intezet | `nezopont.hu/hu/tevekenysegeink/osszes-kozlemeny?format=feed&type=rss` | **200** | — | 0 | — | **SOFT-404:** a body `<error><code>404</code></error>` — rossz/elavult útvonal, NEM „nincs feed" |
| **ipsos** | nemzetkozi | `ipsos.com/hu-hu/rss.xml` | 200 | rss | 20 | 2025-11-27 (**253 nap**) | **STALE** (>180) — pontosan a honlapon látott 2025-11-27 |
| **pew** | nemzetkozi | `pewresearch.org/feed/` | 200 | rss | 100 | 2026-08-06 (0 nap) | **ÉLŐ A-feed**, de általános (túlnyomó US) tartalom; magyar relevancia = „rejtett magyar adat" (ritka), nem magyar-specifikus |
| **politico** | nemzetkozi | `politico.eu/europe-poll-of-polls/` | **200** | HTML | — | — | **NEM blokkol** (produkciós UA), de `text/html` interaktív oldal → **nincs feed** |
| **eurobarometer** | nemzetkozi | (nincs URL a regiszterben) | — | — | — | — | Szándékosan URL nélküli — agentikus B-körbe szánva, lásd lent |

## Regiszter-ütközések (kódból igazolva, `config/sources.json`)

1. **`realpr93` `kaszt: "B"` → TÉVES.** Élő WordPress A-feed (10 tétel, 2026-02-09).
   A B-besorolás megalapozatlan; determinista feed-fetcherrel bekötendő (dátum a
   permalinkben `/ÉÉÉÉ/HH/NN/` is elérhető). Csak határeset-friss (179 nap).
2. **`publicus` / `nezopont` / `szazadveg` `feed: null` → FELDERÍTETLENSÉG, nem verifikált hiány.**
   A regiszter fejléc-kommentje kimondja: *„feed: verifikált elsődleges RSS (null = nincs
   használható feed)"* — ez **túlállít** (CLAUDE.md 2: a komment többet mond az adatnál).
   A mai próba cáfolja: szazadvegnek VAN élő feedje (`/cikkek/feed/`), publicusnak van feed
   (de nem reprezentatív), a nezopont a megadott URL-en soft-404. A `null` itt „még nem
   felderített"-et jelent, nem „verifikáltan nincs"-et.

## Csapdák és pontosítások (a bekötéshez fontos)

- **szazadveg: `/feed/` ÜRES vs `/cikkek/feed/` ÉLŐ.** A fő WordPress-feed 0 tételt ad; a
  tartalom a `/cikkek/feed/`-en van (10 tétel, 2026-08-03). Bekötésnél a `/cikkek/feed/` a
  helyes URL — a naiv `/feed/` „RESZLEGES/üres"-nek látszana.
- **nezopont: SOFT-404 PARSER-CSAPDA.** A megadott Joomla-URL **HTTP 200**-at ad, de a body
  `<?xml …><error><code>404</code><message>Az oldal nem található</message></error>`. Egy naiv
  fetcher ezt **„0 tétel"-nek** (RESZLEGES) látná, holott az útvonal HIBÁS — más
  `?format=feed`-menüpont vagy HTML-lista kell. A státuszkód nem elég, a törzset nézni kell.
- **publicus: a feed nem reprezentál.** Mindhárom hirdetett feed (`/feed/`, `/fooldal/feed/`,
  `/blog/category/blog/feed/`) 0–1 BLOG-tételt ad; a júliusi 4 kutatás (07-31/27/24/23) egyikben
  sincs. A WP-feed csak a blog-poszttípust fedi. → **HTML-lista a járható út**, nem a feed.
- **eurobarometer: szándékosan URL nélküli, NEM hiba.** `kind=nemzetkozi`, a rejtett-magyar-adat
  / agentikus B-pipeline-ba szánva (`SOURCES-INTEZETEK-FELDERITES.md:10`, `ARCHITEKTURA.md:325`).
  Az Eurobarometer az EU közvélemény-kutatása (Bizottság) ≠ Eurostat (EU-statisztika, már
  bekötött A-forrás). Nem duplikátum és nem rossz név.
- **politico: 200, nem blokk.** A produkciós UA-val `HTTP 200` jön (más UA-val blokk) → a
  helyes indoklás a besorolásban **„nincs feed"** (a `/europe-poll-of-polls/` interaktív
  HTML/JS-oldal), NEM „blokkol".

## Összegzés a holnapi döntéshez (aktiválás külön lépés)

| kategória | forrás |
|---|---|
| aktiválható A-feed | **szazadveg** (`/cikkek/feed/`), **realpr93** (határeset-friss) |
| A, de HTML-lista (nem feed) | **publicus** (a feed nem reprezentál) |
| bekötendő URL kideríthető | **nezopont** (a megadott soft-404, jó útvonal kell) |
| STALE | **ipsos** (253 nap) |
| nem magyar-specifikus / agentikus kör | **pew** (élő, de US), **eurobarometer** (agentikus), **politico** (HTML, nincs feed) |
