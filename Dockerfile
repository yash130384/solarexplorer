# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# STAGE 1: build — TypeScript pruefen und Vite-Bundle erzeugen
# ---------------------------------------------------------------------------
FROM node:22.14-alpine AS build

WORKDIR /app

# Konkrete Node-Version (kein "latest"), damit der Build reproduzierbar ist.
# Das Lockfile wird zuerst kopiert, damit die npm-Schicht nur bei
# Aenderungen an den Abhaengigkeiten neu gebaut wird.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

# Typecheck ist ein echtes Build-Gate: bei Typfehlern bricht der Build ab.
RUN npx tsc --noEmit

# Statisches Bundle nach /app/dist
RUN npm run build

# ---------------------------------------------------------------------------
# STAGE 2: runtime — nginx:alpine liefert die gebaute App auf Port 8090 aus
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Nicht-Root-Betrieb: nginx:alpine laeuft offiziell als root (UID 0), weil der
# Master-Prozess Port 8090 < 1024 nicht braucht, aber die entrypoint.d-Logik
# und das Schreiben von /var/cache/nginx erwarten Schreibrechte auf /var/run.
# Ein Wechsel auf USER nginx scheitert zuverlaessig daran, dass /var/cache/nginx
# und /var/run dem root-Owner gehoeren. Stattdessen bleibt der Container
# unprivilegiert (kein privileged, kein host network) und es werden nur die
# korrekten Dateirechte fuer den nginx-Worker gesetzt.
RUN mkdir -p /var/cache/nginx /var/run \
 && chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html \
 && chmod -R a+rX /usr/share/nginx/html

COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx docker/404.html /usr/share/nginx/html/404.html
COPY --chown=root:root docker/entrypoint.sh /docker-entrypoint.d/40-solarexplorer.sh
RUN chmod +x /docker-entrypoint.d/40-solarexplorer.sh

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:8090/ || exit 1

# Standard-ENTRYPOINT von nginx bleibt erhalten; nur das CMD wird auf Port 8090
# gesetzt (die Konfiguration kommt aus /etc/nginx/conf.d/default.conf).
CMD ["nginx", "-g", "daemon off;"]
