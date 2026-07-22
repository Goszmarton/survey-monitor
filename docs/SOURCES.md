# Forrás-feedek felderítése és verifikációja (F1)

**Dátum:** 2026-07-22
**Scope:** A-kasztú források — hivatalos statisztika (KSH, Eurostat, MNB) és
a v1 híroldalak. A B-kasztú intézetek és nemzetközi források (F3) nincsenek itt.

## Vezérelv

> URL-t nem találunk ki. A `config/sources.json`-ba csak olyan feed kerül,
> amit **tényleges HTTP-lekérdezéssel** verifikáltunk (spec 24. pont — becsületes
> részlegesség). Ahol nincs használható feed, azt a config kimondja (`status`,
> `note`), nem pótoljuk kitalált URL-lel.

## A felderítés módszere

Minden jelöltet `curl`-lel kértünk le (`User-Agent: survey-monitor/0.1`,
20–25 s timeout, redirect követve), és nem elégedtünk meg a HTTP 200-zal —
a **válasz törzsét** vizsgáltuk, hogy elkerüljük a „soft 404" HTML-oldalakat:

1. **HTTP-státusz + content-type** (`-w "%{http_code} %{content_type}"`).
2. **Feed-alak:** a törzs tartalmaz-e `<rss`, `<feed` (Atom) vagy `<rdf:RDF`
   gyököt.
3. **Tényleges tételszám:** `<item>` / `<entry>` előfordulások **darabszáma**
   (`grep -o … | wc -l`, nem soronkénti számolás — a minifikált feedek egyetlen
   sorba tömörülnek, a soralapú `grep -c` ott 1-et adna).
4. **Első tétel címe** — smoke-test, hogy a feed valós, friss tartalom-e.

A feed-URL-eket **felderítéssel** találtuk meg, nem tippeléssel:

- **Homepage `<link rel="alternate" type="application/rss+xml">`** és nyers
  `href=".../rss|feed|.xml"` minták kigyűjtése.
- Ahol a `/rss` egy **HTML-index** volt (KSH, MNB, Szabad Európa), azt az oldalt
  kértük le, és onnan szedtük ki a tényleges feed-hivatkozásokat.
- A **numerikus / hash-elt** feedeket (MNB `/rss/N`, Szabad Európa `/api/z…`)
  egyenként lekértük, és a `<channel><title>` + tételszám alapján azonosítottuk
  a rovatot.

## Forrásonkénti eredmény

### Hivatalos statisztika

- **KSH** — a `www.ksh.hu/rss` HTML-index; belőle két valós feed:
  `rss/gyorstajekoztatok` (10 tétel, napi statisztikai közlések) és
  `rss/hirek` (5 tétel). **Figyelmeztetés:** a feed `iso-8859-2` kódolású,
  a parse-nál dekódolni kell (UTF-8 feltételezés hibás ékezeteket ad).
- **MNB** — a `www.mnb.hu/rss` numerikus feedeket listáz (`/rss/N`). Mindet
  lekértük, cím + tételszám alapján:

  | ID | Rovat | Tétel |
  |---|---|---|
  | /rss/5 | Hírek | 7147 |
  | /rss/11 | Felügyeleti hírek | 2493 |
  | /rss/10 | Fogyasztóvédelmi hírek | 752 |
  | /rss/12 | Legfrissebb statisztikai kiadványok | 482 |
  | /rss/23 | Piacfelügyelet | 245 |
  | /rss/19 | Zöld | 156 |
  | **/rss/15** | **Sajtószoba** (közlemények, kamatdöntés) | **79** |
  | /rss/17 | MAP hírek | 30 |
  | /rss/21 | Elnök | 14 |
  | **/rss/7** | **Legfrissebb kiadványok** (kiemelt jelentések) | **5** |
  | /rss/1 | Éves jelentés | 1 |

  Kiválasztva: **/rss/15 (Sajtószoba)** elsődleges + **/rss/7 (Legfrissebb
  kiadványok)** — az architektúra „közlemények, kamatdöntés, kiemelt
  jelentések" igényére.
- **Eurostat** — ⚠️ **nincs verifikált RSS.** A `web/rss/about-rss` oldal csak a
  portál-hubra (`web/rss`) és egy Liferay control-panelre mutat, tényleges
  feed-endpoint nélkül; a news-oldalak RSS-ikonja nem ad kinyerhető feed-URL-t.
  Az Eurostat RSS célzott újralekérése a fejlesztői session-t egyszer beragasztotta,
  ezért **nem tippelünk további endpointot.** A config a `euro-indicators`
  listaoldalt rögzíti (`list_url`, HTTP 200-nal elérhető) **„HTML-parse szükséges"**
  megjegyzéssel — F1-ben célzott HTML-lekérés, vagy F2/B-kaszt.

### Híroldalak

Kilenc oldalnak van tartalmas, verifikált RSS-e. A nem az első tippre találókat
felderítéssel kaptuk meg:

- **Economx** — a homepage nem hirdet feedet; a `/rss`, `/rss.xml`, `/rss/all`
  mind 404. A `/feed` viszont valós RSS.
- **Infostart** — nincs egységes „összes" feed; a `/info/rss` HTML-index
  rovatfeedekre. Kiválasztva a `/24ora/rss/` (gördülő 24 órás összesítő).
- **Népszava** — `/rss` és `/feed` ugyanazt adja; a `/rss`-t rögzítettük.
- **Szabad Európa (RFE/RL)** — ⚠️ **RÉSZLEGES.** Mind a 17 rovatfeed
  (`/api/z…`) érvényes RSS-struktúra, **de a lekéréskor 0 tétel** — a
  „Top Stories" `/api/` is üres. A magyar hír/politika rovat (**Napirenden**,
  `/api/zipymtl-vomx-tpemjtmt`) URL-jét rögzítettük a felhasználói döntés
  szerint, `RESZLEGES` státusszal: F1-ben tolerálni kell az üres választ;
  tartós üresség esetén HTML-fallback vagy B-kaszt.

## Összesítő tábla — forrás → verifikált URL → státusz

| Forrás | Verifikált URL | HTTP | Tétel | Státusz |
|---|---|---|---|---|
| KSH | `https://www.ksh.hu/rss/gyorstajekoztatok` (+ `/rss/hirek`) | 200 | 10 (+5) | ✅ OK (iso-8859-2) |
| Eurostat | `https://ec.europa.eu/eurostat/web/main/news/euro-indicators` (list_url) | 200 | — | ⚠️ NINCS_FEED (HTML-parse) |
| MNB | `https://www.mnb.hu/rss/15` (+ `/rss/7`) | 200 | 79 (+5) | ✅ OK |
| Telex | `https://telex.hu/rss` | 200 | 50 | ✅ OK |
| 444 | `https://444.hu/feed` | 200 | 30 | ✅ OK |
| HVG | `https://hvg.hu/rss` | 200 | 60 | ✅ OK |
| 24.hu | `https://24.hu/feed/` | 200 | 10 | ✅ OK |
| Portfolio | `https://www.portfolio.hu/rss/all.xml` | 200 | 20 | ✅ OK |
| Economx | `https://www.economx.hu/feed` | 200 | 5 | ✅ OK |
| Infostart | `https://infostart.hu/24ora/rss/` | 200 | 20 | ✅ OK |
| Népszava | `https://nepszava.hu/rss` | 200 | 20 | ✅ OK |
| Szabad Európa | `https://www.szabadeuropa.hu/api/zipymtl-vomx-tpemjtmt` | 200 | 0 | ⚠️ RÉSZLEGES (üres feed) |
| Válasz Online | `https://www.valaszonline.hu/feed/` | 200 | 25 | ✅ OK |

**Összegzés:** 13 A-kasztú forrásból **11 tartalmas feed** (✅ OK),
**1 részleges** (Szabad Európa — üres, de verifikált struktúra),
**1 feed nélkül** (Eurostat — HTML-parse szükséges).

> A tételszámok a 2026-07-22-i lekérés pillanatképei; napról napra változnak.
> A cél nem a szám, hanem hogy a feed él és valós tartalmat ad.
