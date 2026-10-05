#!/usr/bin/env bash
# TÜKÖR-PROXY feed-letöltő (2026-10-05). A Hetzner-tükörszerveren fut (systemd-timer); letölti
# azokat a feedeket, amiket a Cloudflare a GitHub-runner datacenter-ASN-jéről BLOKKOL (403/fetch
# failed), de a Hetznerről ELÉR (mérve: telex 200, policysol 200 a szerverről; 21kutato 403 — az
# marad halasztva). A letöltött tartalmat a webroot cache-ébe írja, ahonnan a Caddy kiszolgálja
# (napihir.duckdns.org/cache/…), és az Actions-futás ONNAN olvassa (a napihir elérhető Actions-ből).
#
# FAIL-SAFE: a letöltés ÁTMENETI fájlba megy, és CSAK siker esetén cserél (mv) — egy hibás/üres
# letöltés NEM írja felül a régi cache-t (inkább egy nap régi, mint üres/hibás). A build-site.mjs
# nem-törlő, így a cache/ túléli a tükör-újraépítést.
#
# Használat (systemd-ből, napi userként):  bash scripts/mirror-feeds.sh
# Env: CACHE_DIR (alap: /srv/napihir/cache)

set -u
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
CACHE="${CACHE_DIR:-/srv/napihir/cache}"
mkdir -p "$CACHE"
rc=0

# Nyers letöltés (abszolút linkű feedhez, pl. telex RSS): tmp → mv csak sikernél.
fetch_raw() { # url outfile
  local url="$1" out="$2" tmp
  tmp="$(mktemp)"
  if curl -fsS -A "$UA" --max-time 30 "$url" -o "$tmp" && [ -s "$tmp" ]; then
    mv "$tmp" "$out"; chmod 644 "$out"   # az mktemp 0600-at ad → a Caddy (más user) nem olvasná (403); világolvashatóvá tesszük
    echo "OK   $url -> $out ($(wc -c <"$out") B)"
  else
    rm -f "$tmp"; echo "HIBA $url (a régi cache marad)" >&2; rc=1
  fi
}

# Letöltés + gyökér-relatív linkek abszolutizálása egy adott hosztra (scrape-oldalhoz, pl. policysol):
# a href="/… és src="/… → az abszolút host elé fűzve, hogy a parser (ami a tükör-URL ellen oldana
# fel) helyes eredeti-oldali linket adjon.
fetch_abs() { # url outfile absbase
  local url="$1" out="$2" base="$3" tmp
  tmp="$(mktemp)"
  if curl -fsS -A "$UA" --max-time 30 "$url" -o "$tmp" && [ -s "$tmp" ]; then
    sed -e "s|href=\"/|href=\"${base}/|g" -e "s|src=\"/|src=\"${base}/|g" "$tmp" > "$out"
    chmod 644 "$out"   # világolvasható, hogy a Caddy (más user) kiszolgálhassa
    echo "OK   $url -> $out ($(wc -c <"$out") B, abszolutizálva: $base)"; rm -f "$tmp"
  else
    rm -f "$tmp"; echo "HIBA $url (a régi cache marad)" >&2; rc=1
  fi
}

fetch_raw "https://telex.hu/rss" "$CACHE/telex.xml"
fetch_abs "https://www.policysolutions.hu/hu/elemzesek" "$CACHE/policysol.html" "https://www.policysolutions.hu"

exit $rc
