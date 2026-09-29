#!/bin/sh
# SolarExplorer — Startskript fuer nginx:alpine
#
# Wird von /docker-entrypoint.d/ aufgerufen, bevor nginx startet.
# Prueft, ob das gebaute Frontend wirklich im Image liegt, und startet
# anschliessend nginx im Vordergrund.
#
# Ohne Argumente (Aufruf ueber docker-entrypoint.d): nur pruefen, der
# nginx-Entrypoint startet den Server anschliessend mit dem CMD.
# Mit Argumenten (manueller Start): nginx hier selbst starten.

set -eu

HTML_DIR="/usr/share/nginx/html"
INDEX_FILE="${HTML_DIR}/index.html"

if [ ! -f "${INDEX_FILE}" ]; then
    echo "FEHLER: SolarExplorer kann nicht starten." >&2
    echo "FEHLER: Die Datei ${INDEX_FILE} fehlt im Image." >&2
    echo "HINWEIS: Wurde 'npm run build' ausgefuehrt und liegt das Ergebnis in ${HTML_DIR}?" >&2
    exit 1
fi

# Dateirechte fuer den nginx-Worker sicherstellen (siehe Kommentar im Dockerfile).
chown -R nginx:nginx "${HTML_DIR}" 2>/dev/null || true
chmod -R a+rX "${HTML_DIR}"

echo "SolarExplorer: Frontend gefunden unter ${HTML_DIR}, nginx startet auf Port 8090."

# Direktaufruf (z. B. docker run ... sh /docker-entrypoint.d/40-solarexplorer.sh nginx)
if [ "$#" -gt 0 ]; then
    exec nginx -g 'daemon off;'
fi
