# Intézeti források felderítése — TERV (nem végrehajtva)

**Dátum:** 2026-08-05
**Státusz:** ⚠️ **Csak terv.** Egyetlen HTTP-lekérés sem futott le; ez a jegyzet
a *módszert* és a *döntési kritériumot* rögzíti az F3 B-kaszt-szál első allépéséhez.
Amíg a próbák le nem futnak, a `config/sources.json` intézeti besorolása
(`kaszt:"?"` ill. becsült `"B"`) **verifikálatlan**.

**Scope:** a 8 eldöntetlen (`kaszt:"?"`) intézet + az 5 becsült-B hazai intézet.
A nemzetközi források (Pew, Eurobarometer, Ipsos, Europe Elects, Politico PoP)
NEM ebben a körben — azok külön, rejtett-magyar-adat pipeline-nal (ARCHITEKTURA §5).
**Utólag** (2026-08-07/08) a nemzetközi ötöst is felmértük produkciós UA-val; az
eredmény a **Függelék: Nemzetközi ötös**-ben (a fájl végén), hogy ne kelljen újra
felderíteni.

**Vezérelv (az F1-ből örökölve, `SOURCES.md`):** URL-t nem találunk ki. A configba
csak **tényleges lekérdezéssel verifikált** feed/lista kerül; ahol nincs, azt a
bejegyzés kimondja (`status`, `note`), nem pótoljuk tippelt URL-lel. A `feed:null`
ma **„még nem felderített"**-et jelent, NEM „verifikáltan nincs feed"-et.

---

## Célkör (13 hazai intézet)

| id | név | jelenlegi kaszt | regiszterben |
|---|---|---|---|
| median | Medián | `?` | csak név, `feed:null`, **homepage sincs** |
| zavecz | Závecz Research | `?` | " |
| republikon | Republikon | `?` | " |
| publicus | Publicus | `?` | " |
| idea | IDEA | `?` | " |
| 21kutato | 21 Kutatóközpont | `?` | " |
| nezopont | Nézőpont | `?` | " |
| szazadveg | Századvég | `?` | " |
| iranytu | Iránytű | `B` (becslés) | " |
| realpr93 | Real-PR 93 | `B` (becslés) | " |
| opinio | Europion/Opinio | `B` (becslés) | " |
| tarskutato | Magyar Társadalomkutató | `B` (becslés) | " |
| minerva | Minerva | `B` (becslés) | " |

Az 5 becsült-B is a körben van: a becslést verifikálni kell (megerősítés vagy
A-kasztba emelés), nem tényként átvenni.

---

## 1. Próba-sorrend és -létra (intézetenként, az első sikernél megáll)

A bejegyzésekben **nincs tárolt homepage**, ezért a 0. lépés a hivatalos honlap
megállapítása — kereséssel/verifikálva, nem tippelt domainnel.

**Intézetek sorrendje** (a várható érték szerint, nem ábécé): előbb a rendszeresen
pártpreferenciát publikáló nyolcak (median, zavecz, publicus, republikon, idea,
nezopont, szazadveg, 21kutato), utánuk az 5 becsült-B. Indok: a nyolcak
KIEMELT-képes primer adatot hoznak (lásd 4. pont); ott a leggyorsabb a haszon-próba.

**A létra egy intézetre** (F1-módszer: nem elég a HTTP 200, a **törzset** nézzük):

0. **Homepage megállapítása** — hivatalos oldal verifikálva (a soft-404 és a
   parkolt/aggregátor domének kizárva).
1. **Autodiscovery (elsődleges, „nem tippelés"):** a homepage `<head>`-jében
   `<link rel="alternate" type="application/rss+xml">` és `…/atom+xml`, továbbá
   nyers `href=".../rss|feed|.xml"` minták kigyűjtése. Ha van → ezt próbáljuk.
2. **CMS-tipikus útvonalak (másodlagos, csak ha az 1. üres):** a legtöbb intézeti
   oldal WordPress → `/feed/`, `/feed/rss2/`, `/?feed=rss2`, `/feed/atom/`,
   `/atom.xml`, illetve `/rss`, `/rss.xml`. Ezek **tippelt útvonalak**, ezért csak
   akkor fogadjuk el, ha a törzs a 2. szekció szerint verifikál (nem elég a 200).
3. **Feed-verifikáció** (minden jelöltre, az F1 lépései):
   - HTTP-státusz + content-type (a `text/html` XML helyett = soft-404 gyanú);
   - gyök-tag: `<rss` / `<feed` (Atom) / `<rdf:RDF`;
   - `<item>`/`<entry>` **darabszám** (`grep -o … | wc -l`, a minifikált feed
     egy sorba tömörül);
   - első tétel **címe + dátuma** — valós, keltezett tartalom-e.
4. **HTML-lista (ha nincs feed):** van-e `/kutatasok`, `/publikaciok`,
   `/elemzesek`, `/hirek` jellegű **listaoldal**, amin: ismétlődő DOM-struktúra,
   keltezett tételek, stabil permalinkek → determinisztikusan parse-olható
   (a meglévő `htmllist.js` best-effort mintája). Ha csak JS-renderelt,
   dátum/permalink nélküli, vagy PDF-only/scrape-blokkolt → nincs gépbarát lista.

---

## 2. Döntési kritérium — A vagy B, számszerűen

A besorolás a **gépi parse-olhatóságon** múlik (ARCHITEKTURA §8: „kinek van
gépbarát listaoldala"), NEM a mennyiségen. A mennyiség külön kérdés (4. pont,
megéri-e). A két tengelyt tartsuk szét.

**A-kaszt (feed)** — MIND teljesül:
- érvényes feed-gyök (rss/atom/rdf), content-type XML;
- **≥ 1 valós `<item>`/`<entry>`**, feloldható linkkel és parse-olható dátummal;
- **nem halott feed:** a legfrissebb tétel dátuma **≤ 180 nap** (élő, nem elhagyott
  stub). Az intézetek ritkán publikálnak, ezért NEM 24h-frissesség a mérce — a
  180 nap csak azt igazolja, hogy a csatorna él.
- „tartalmas" ≠ magas darabszám: az F1-ben 5 tételes feed is OK volt (MNB /rss/7,
  Economx). A darabszámot **metaadatként rögzítjük**, nem küszöbként.

**A-kaszt (HTML-lista)** — nincs feed, de a 1.4 szerinti listaoldal
determinisztikusan parse-olható (stabil struktúra + dátum + permalink).

**B-kaszt (agentikus, F3)** — se feed, se gépbarát lista: JS-render dátum/permalink
nélkül, PDF-only publikációk, vagy Cloudflare/scrape-blokk. Ekkor marad az
`agentic_check` (Haiku→Sonnet, heti mélységű ellenőrzés).

**Élő/friss megkülönböztetés:** külön jelölés, ha a feed érvényes, de a legfrissebb
tétel > 180 nap → `status:"STALE"` (nem A, nem is agentikus prioritás; figyelendő).
Ez a Szabad Európa `RESZLEGES` (üres, de érvényes struktúra) esetének analógja.

---

## 3. Várható kimenet — F1-mintájú verifikált bejegyzés (nem tipp)

Minden intézetre a próba **tényleges eredménye** kerül a `config/sources.json`-ba;
a `note` rögzíti a próbált URL-t, a tételszámot és a lekérés dátumát, hogy a
bejegyzés visszakövethető és verifikált legyen (mint az F1 összesítő tábla).

- **A-kaszt, feed:**
  `{ kaszt:"A", feed:"<verifikált-url>", status:"OK", note:"<N tétel, első cím, 2026-08-xx lekérés>" }`
- **A-kaszt, HTML-lista:**
  `{ kaszt:"A", feed:null, list_url:"<verifikált-url>", status:"OK", note:"HTML-lista, <struktúra-megjegyzés>, 2026-08-xx" }`
- **B-kaszt:**
  `{ kaszt:"B", feed:null, list_url:null, status:"B_AGENTIC", note:"nincs gépbarát feed/lista — <JS-render|PDF-only|blokkolt>, 2026-08-xx" }`
- **STALE:**
  `{ kaszt:"?", feed:"<url>", status:"STALE", note:"érvényes feed, legfrissebb tétel <dátum> (>180 nap)" }`

A hivatalos homepage-et is érdemes a bejegyzésbe venni (új `homepage` mező),
hogy a jövőbeli újra-felderítés ne kezdje nulláról.

**Dokumentáció:** az eredménytábla (13 sor, ugyanazok az oszlopok, mint a
`SOURCES.md` A-kaszt táblája: Forrás | Verifikált URL | HTTP | Tétel | Státusz)
ebbe a fájlba kerül a „TERV" fejléc lecserélésével, vagy a `SOURCES.md`-be
külön szekcióként — de csak a próbák tényleges lefutása után.

---

## 4. Mennyiség-becslés — ez dönti el, megéri-e (a legfontosabb)

**Óvatos becslés a publikációs gyakoriságból** (verifikálandó a felderítéskor):

| kör | tétel/hó/intézet (becslés) | aggregált |
|---|---|---|
| 8 pártpreferencia-intézet | ~1–4 (havi pártpref + alkalmi tematikus) | ~15–25/hó |
| 5 becsült-B hazai | ~0–2 (ritkább, kisebb) | ~5–10/hó |
| **összes hazai intézet** | | **~20–35/hó ≈ napi < 1**, választás körül burst |

Nagyságrendileg a **teljes intézeti kör heti ~5–8 primer publikáció** — egybevág a
„heti 5 tétel az egész" megérzéssel.

**Két megszorítás, ami tovább csökkenti a NETTÓ hasznot:**

1. **Duplikáció a sajtóval.** ARCHITEKTURA §8: az intézeti publikációk „jellemzően
   a sajtón keresztül is becsatornázódnak; a B-kaszt biztonsági háló, nem egyetlen
   csatorna." A 08-05-i mérés ezt igazolta: a KIEMELT-listában ott volt „Závecz:
   Tisza 74", „Medián: Öt százalékot esett", „Publicus", „Nézőpont" — a
   híroldal-fetcherek MÁR behozzák. A közvetlen intézeti feed nagyrészt a
   story-dedup által úgyis összevont tételeket adná; a **nettó új** csak az, amit a
   sajtó kihagyott, plusz a primer részlet (teljes táblák, módszertan).

   > **Olvasati figyelmeztetés:** ez a bekezdés **költség-haszon mérés a B-fetcher
   > SÜRGŐSSÉGÉRŐL**, NEM forrás-ejtési indoklás. Egy forrást attól, hogy „a sajtón
   > át is látszik", SOHA nem ejtünk — a sajtón át a kutatás *értelmezését* látjuk,
   > nem a primer közleményt (a dedup(a)+`data_backed` erre épül). A tényleges
   > ejtési/bekötési politika az **ARCHITEKTURA §5 „Forrás-ejtési politika"**-ban van:
   > forrást csak a gépi csatorna hiánya vagy a szervezet megszűnése ejt.
2. **Ez NEM a KIEMELT-aszály megoldása.** A 08-05-i diagnózis szerint a
   FONTOS/KIEMELT-esés a **data_backed-kapu** műve (a sajtóhír `data_backed=false`
   → plafon FIGYELENDO), nem a bevitel hiánya. Az intézeti primer adat viszont
   *pont* `data_backed=true` (számmal bíró felmérés) → aránytalanul KIEMELT-képes.
   Vagyis az intézeti kör értéke **minőségi** (primer forrás, KIEMELT-jogosult
   tételek), nem mennyiségi — de heti ~5 tételnél ez akkor is kis abszolút szám.

**Szinergia a dedup(a)-val:** az intézeti kör értéke nem a darabszám, hanem hogy egy
primer `data_backed=true` intézeti tétel **a meglévő (sajtó-)sztori reprezentánsa
LEHETNE** — a significance-alapú reprezentáns-választás (dedup(a)) épp ezt a primer,
KIEMELT-képes tételt emelné a csoport élére a `data_backed=false` sajtócím helyett.
Ezért a felderítés haszna a **dedup(a) UTÁN nagyobb**: előbb legyen, ami a primer
forrást reprezentánssá teszi, utána éri meg a primer forrást becsatornázni.

**Döntési kapu a felderítés UTÁN (rangsoroláshoz):** számoljuk ki a becsült
**nettó új, KIEMELT-képes tétel/hét**-et (a sajtó-dedup levonása után). Ha ez a
teljes körre **< ~3–5/hét**, akkor:
- az A-kasztba eső intézeteknél a determinista feed-fetcher olcsó → érdemes
  (kis kód, kis költség, tiszta primer forrás), de **nem sürgős**;
- a B-kasztba esőknél az agentikus ellenőrzés ára (kód-komplexitás + napi
  $0,01–0,04 × forrás + web-search-hívások) **nem térül meg** ilyen hozamnál →
  **halasztandó**, nem az F3 első fixe.

**Következtetés a rangsorhoz:** az intézeti felderítés maga olcsó és tanulságos
(eldönti a 13 besorolást, verifikálja a „becsült B"-ket) — ez **elvégezhető**.
De a belőle épülő fetcherek a dedup(a) reprezentáns-fix és a kapu-A/B (3b) MÖGÉ
sorolandók: azok a meglévő, napi ~200 releváns tételen javítanak láthatóságot és
KIEMELT-pontosságot, míg az intézeti kör heti ~5 tétellel bővít. A felderítést
érdemes megcsinálni a besorolás tisztázásáért; a fetchereket csak ott megépíteni,
ahol a nettó KIEMELT-képes hozam a döntési kaput átlépi.

---

## Függelék: Nemzetközi ötös — felmérés (2026-08-07/08, produkciós UA)

A fájl fő törzse a **hazai** intézeti kört méri fel; a nemzetközi ötös eredetileg
külön (rejtett-magyar-adat) pipeline-ba tartozott (fenti Scope). Utólag ezeket is
lekérdeztük produkciós UA-val — az eredményt itt rögzítjük, hogy ne kelljen újra
felderíteni. **Mind az öt `NEM_AKTIVALT` marad**, de az indok mostantól konkrét. A
per-forrás részletek a `config/sources.json` note-jaiban; az ejtési/bekötési elv az
**ARCHITEKTURA §5 „Forrás-ejtési politika"**-ban.

| id | csatorna (2026-08) | miért nem aktivált | melyik ejtési/nyitott-kategória |
|---|---|---|---|
| **pew** | WordPress `/feed/` **ÉL**, 100 tétel, NAPI (legfr. 2026-08-06) | van csatorna, de ~minden tétel amerikai; szűretlenül ELÁRASZTANÁ a korpuszt, a magyar-hangolt `triage.json` kulcsszavak angol címekre nem illeszkednek | **NYITOTT: szűrés-mechanizmus** (nem parser) — angol relevancia-szűrő kell |
| **ipsos** | `/hu-hu/rss.xml` **ÉL**, 20 tétel | a magyar (hu-hu) ág LASSÚ: legfr. 2025-11-27 (~255 nap). A STALE-kor és a `kind:nemzetkozi` sem ejtő ok, a csatorna él → A(feed), mint tarskutato | **BEKÖTVE 2026-08-09** (kaszt B→A, `revisit: if-republishes`); a gzip-választ az undici transzparensen kibontja (ellenőrizve, nem hiba) |
| **eurobarometer** | szándékosan URL nélkül | közvéleménykutatás-riportok (PDF/HTML), determinista feed nélkül; a magyar minta a rejtett-magyar-adat kétlépcsős pipeline-ba tartozik. **NEM azonos az Eurostattal** (az bekötött A) | **agentikus B** (rejtett-magyar-adat) |
| **europeelects** | HALOTT végpont | nincs élő gépi csatorna | **ejtő ok: csatorna-hiány** |
| **politico_pop** | `/europe-poll-of-polls/` HTTP 200 (nem blokkol), de INTERAKTÍV HTML | kliens-oldali render, nincs determinista feed / parse-olható lista | **ejtő ok: csatorna-hiány** |

**Összegzés (frissítve 2026-08-09):** az **ipsos BEKÖTVE** (kaszt B→A, `hu-hu/rss.xml`),
ezzel az ötösből a valódi jövőbeli munka **egy**: pew (angol relevancia-szűrő, NYITOTT
tervezési kérdés — nem parser). Három determinista úton nem köthető: eurobarometer
(agentikus B, PDF/HTML), europeelects és politico_pop (csatorna-hiány).
