#!/usr/bin/env bash
# Napi monitor — szerver-oldali PRIMARY indító: workflow_dispatch a GitHub Actionsön keresztül.
#
# MIÉRT: a GitHub scheduled cron sorállása kiszámíthatatlan (+18…+78 perc, néha több). A pontos
# napi indításhoz a SZERVER curl-lel dispatchel (16:30 Budapest, systemd-timer), a scheduled cron
# pedig BACKUP-ra tolva (16:00 UTC), a szerver-trigger MÖGÉ. Ha a szerver nem lő (kiesés), a backup
# elkapja. Ha MINDKETTŐ fut, a run.js idempotencia-őre (hasCompletedRun) dedupolja → egy levél.
#
# ELVEK: az owner/repo a git remote-ból jön (nincs hardcode); a PAT egy KÜLÖN fájlból (repóba
# SOHA); HTTP-ellenőrzés (204 = siker), különben exit≠0 → a systemd „failed" + a backup elkapja.
#
# Használat (systemd service-ből, napi userként):
#   REPO_DIR=/home/napi/survey-monitor \
#   TOKEN_FILE=/home/napi/.config/survey-monitor-trigger/token \
#     bash scripts/gh-trigger.sh
#
# Env:
#   REPO_DIR   – a helyi klón (az origin remote innen olvasódik). Alap: e szkript repo-gyökere.
#   TOKEN_FILE – a fine-grained PAT fájlja (600, csak-olvasható). DRY_RUN-ban NEM kell.
#   WORKFLOW   – a workflow fájlneve. Alap: monitor.yml
#   REF        – az indítandó ág. Alap: main
#   DRY_RUN=1  – csak kiírja a slug-ot + a dispatch-URL-t, NEM curl-öz (teszt/ellenőrzés, titok nélkül).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WORKFLOW="${WORKFLOW:-monitor.yml}"
REF="${REF:-main}"

remote_url="$(git -C "$REPO_DIR" remote get-url origin)"
# owner/repo kinyerése HTTPS (https://host/OWNER/REPO(.git)) és SSH (git@host:OWNER/REPO(.git)) alakból:
slug="$(printf '%s' "$remote_url" | sed -E 's#^(https?://[^/]+/|[^@]+@[^:]+:)##; s#\.git$##')"
if ! printf '%s' "$slug" | grep -qE '^[^/]+/[^/]+$'; then
  echo "gh-trigger: nem sikerült owner/repo-t kinyerni a remote-ból: $remote_url" >&2
  exit 2
fi
api="https://api.github.com/repos/${slug}/actions/workflows/${WORKFLOW}/dispatches"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "DRY_RUN: slug=${slug} url=${api} ref=${REF} (nem történt hívás)"
  exit 0
fi

if [ -z "${TOKEN_FILE:-}" ] || [ ! -r "$TOKEN_FILE" ]; then
  echo "gh-trigger: TOKEN_FILE nincs beállítva vagy nem olvasható: ${TOKEN_FILE:-<üres>}" >&2
  exit 3
fi
token="$(cat "$TOKEN_FILE")"

code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${token}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$api" -d "{\"ref\":\"${REF}\"}")"

if [ "$code" = "204" ]; then
  echo "gh-trigger: OK (HTTP 204) — ${slug} workflow_dispatch elindítva (${WORKFLOW}@${REF})."
  exit 0
fi
echo "gh-trigger: HIBA — HTTP ${code} (${slug} ${WORKFLOW}). A GitHub backup-cron elkapja." >&2
exit 1
