#!/usr/bin/env bash
# Legt die Ausbau-Tickets 13-15 fuer SolarExplorer an.
set -uo pipefail
BOARD=solarexplorer
REPO=/home/cb/Projects/SolarExplorer
S=$REPO/specs

run() { hermes kanban --board "$BOARD" "$@"; }

# title|spec|assignee|retries|turns|priority
TASKS=(
"13 Alle 454 Monde + Physik korrigieren|13_moons_physics.md|free-coder|10|15|0"
"14 Performance: 456 Koerper, LOD, Ringe, Asteroiden|14_render_performance.md|free-coder|10|20|0"
"15 Inhalte + Baum-Navigation + Live-Abnahme|15_content_nav_live.md|free-coder|10|20|1"
)

for row in "${TASKS[@]}"; do
  IFS='|' read -r title spec assignee retries turns prio <<< "$row"
  out=$(run create "$title" \
        --body-file "$S/$spec" \
        --assignee "$assignee" \
        --workspace "dir:$REPO" \
        --max-retries "$retries" \
        --goal --goal-max-turns "$turns" \
        --priority "$prio" \
        --created-by jennifer 2>&1)
  id=$(grep -oE 't_[a-z0-9]+' <<< "$out" | head -1)
  echo "$id  $title"
done
