# CLAUDE.md — munkamód

A projekt leírása: `docs/ARCHITEKTURA.md`. Ez a fájl arról szól, **hogyan** dolgozz itt.

## Szabályok

1. **Minden viselkedésmódosításhoz regressziós teszt** — akkor is, ha a hiba
   nem dob kivételt (a csendes hibák a legdrágábbak). A teszt a hibás
   viselkedést reprodukálja, mielőtt a fixet megírod.

2. **Nincs csendes eltűnés.** Ha egy komment vagy terv ígér valamit (pl. „a
   jelentésben megjelölve szerepel"), az implementációnak teljesítenie kell —
   vagy a komment változzon. Kód és szándék nem térhet el némán.

3. **Egy javítás nem kész a felhalmozott állapot rendezése nélkül.** A kódfix
   megakadályozza az ÚJ hibás sorokat; a MÁR meglévő hibás adatot külön,
   idempotens migráció rendezi. (Tanulság: 105 beragadt tétel.)

4. **Állítást csak a DB-ből vagy a kódból igazolva, sose emlékezetből.** A git
   remote-tracking ref (`origin/*`) nem a remote valódi állapota — `git fetch`
   nélkül nem hivatkozunk rá.

5. **Költség-aszimmetriánál a becsületes részlegesség nyer.** Ahol az egyik
   hibamód sokkal drágább (hamis összevonás = elrejtett fontos tétel >>
   megmaradt duplikátum), ott a láthatóság és becsületesség számít, nem a
   szebb szám. Lásd ARCHITEKTURA.md 1–3. vezérelv.

6. **A `state/monitor.db`-t érintő lépés mindig külön, látható migráció.**
   Adat-migrációt ne futtass az éles DB-re jóváhagyás nélkül; demonstráld
   másolaton, és mondd meg a pontos érintett darabszámot. (Séma-additív
   `CREATE TABLE IF NOT EXISTS` / `ensureColumn`, ami a normál futásban
   idempotensen self-applyol, nem számít adat-migrációnak.)

## Tesztek

`npm test` (`node --test`). Regressziós teszt a `test/` alatt, a forrás
szerkezetét tükrözve.
