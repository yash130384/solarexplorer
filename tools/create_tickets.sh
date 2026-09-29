#!/usr/bin/env bash
# Legt alle SolarExplorer-Cards auf dem Board an.
# Aufruf:  bash /home/cb/Projects/SolarExplorer/tools/create_tickets.sh
# Gibt am Ende die erzeugten Task-IDs aus (fuer das Verlinken).
set -uo pipefail

BOARD=solarexplorer
REPO=/home/cb/Projects/SolarExplorer
S=/home/cb/Projects/SolarExplorer/specs

# title|specfile|assignee|retries|goal_turns|priority
TASKS=(
"01 Projektfundament: Vite + TypeScript strict + Vitest|01_foundation.md|free-coder|10|12|0"
"02 Physikalische Datenbasis: Sonne, 8 Planeten, 11 Monde|02_bodies_data.md|free-coder|10|12|0"
"03 Kern-Mathematik: Groessen- und Distanz-Skalierung|03_core_scale.md|free-coder|10|12|0"
"04 Kern-Mathematik: Kepler-Umlaufbahnen und Zeit|04_core_orbital.md|free-coder|10|12|0"
"05 Lerninhalte: Kindtexte, Vergleiche, 15 Quizfragen|05_facts_quiz.md|free-coder|10|12|1"
"06 3D-Szene: Three.js, Sterne, Planeten, Umlaufbahnen|06_scene_3d.md|free-coder|10|15|1"
"07 Raumschiff: Modell, Steuerung, Kamera-Follow|07_ship_controls.md|free-coder|10|15|1"
"08 Benutzeroberflaeche: HUD, Info-Panel, Navigation, Quiz|08_ui.md|free-coder|10|15|1"
"09 Integration: alles in src/app.ts und src/main.ts verdrahten|09_integration.md|free-coder|10|15|1"
"10 Realistische Texturen: prozedural erzeugt, offline|10_textures.md|free-coder|10|15|2"
"11 Docker: Build, nginx, Compose auf Port 8090|11_docker.md|free-coder|10|15|2"
"12 Tests und Dokumentation: E2E, README, Qualitaets-Gate|12_tests_docs.md|free-qa|10|15|2"
)

for row in "${TASKS[@]}"; do
  IFS='|' read -r title spec assignee retries turns prio <<< "$row"
  out=$(hermes kanban --board "$BOARD" create "$title" \
        --body-file "$S/$spec" \
        --assignee "$assignee" \
        --workspace "dir:$REPO" \
        --max-retries "$retries" \
        --goal --goal-max-turns "$turns" \
        --priority "$prio" \
        --created-by jennifer 2>&1)
  id=$(grep -oE 't_[a-z0-9]+' <<< "$out" | head -1)
  body_len=$(sqlite3 ~/.hermes/kanban/boards/$BOARD/kanban.db \
             "SELECT length(COALESCE(body,'')) FROM tasks WHERE id='$id';")
  printf '%-14s body=%-6s %s\n' "$id" "$body_len" "$title"
done
