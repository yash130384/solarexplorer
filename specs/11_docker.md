PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: 01-10 fertig, App laeuft.

AUFGABE: Docker — Build, nginx, Compose, Port 8090

ERSTELLE GENAU:
1. Dockerfile
2. .dockerignore
3. docker-compose.yml
4. nginx.conf
5. docker/entrypoint.sh

--- Dockerfile ---
Mehrstufig, auf alpine/slim:
  STAGE 1 "build":
    - node:XX-alpine
    - COPY package.json package-lock.json* ./
    - npm ci   (wenn kein Lockfile: npm install)
    - COPY . .
    - RUN npx tsc --noEmit
    - RUN npm run build
  STAGE 2 "runtime":
    - nginx:alpine
    - COPY --from=build /app/dist /usr/share/nginx/html
    - COPY nginx.conf /etc/nginx/conf.d/default.conf
    - COPY docker/entrypoint.sh /docker-entrypoint.d/40-solarexplorer.sh
    - EXPOSE 8090
    - HEALTHCHECK mit wget auf /
    - ENTRYPOINT Standard von nginx beibehalten, aber CMD anpassen
- Non-root User ist bei nginx:alpine nicht direkt moeglich, nutze stattdessen
  korrekte Dateirechte. Erklaere die Entscheidung im Kommentar.
- Nutze eine konkrete Node-Version, kein "latest".

--- nginx.conf ---
  - listen 8090
  - root /usr/share/nginx/html
  - gzip an (text/css, application/javascript, application/json, image/svg+xml)
  - location /: try_files $uri $uri/ /index.html
    (fuer Single-Page-App: Deep-Links funktionieren)
  - Cache-Header:
      /assets/*  -> immutable, 1 Jahr
      *.html     -> no-cache
  - Security-Header:
      X-Content-Type-Options nosniff
      X-Frame-Options SAMEORIGIN
      Referrer-Policy strict-origin-when-cross-origin
  - Eine schoene 404-Seite fuer unbekannte Pfade

--- docker-compose.yml ---
  services:
    solarexplorer:
      build: .
      container_name: solarexplorer
      ports: ["8090:8090"]
      restart: unless-stopped
      healthcheck:
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:8090/"]
        interval: 30s
        timeout: 5s
        retries: 3
        start_period: 10s
      environment:
        TZ: Europe/Berlin
      logging:
        driver: json-file
        options: { max-size: "10m", max-file: "3" }
  KEIN privileged, KEIN host network, KEINE host-volumes.
  KEIN expose von unnoetigen Ports.

--- .dockerignore ---
  node_modules, dist, .git, tests/e2e, test-results, playwright-report,
  *.md (ausser AGENTS.md), .env*, .vscode, .idea

--- docker/entrypoint.sh ---
  - Prueft ob /usr/share/nginx/html/index.html existiert
  - Gibt eine klare deutsche Fehlermeldung aus und beendet sich, wenn nicht
  - Sonst: fuehrt nginx -g 'daemon off;' aus
  - chmod +x setzen

ACCEPTANCE CRITERIA:
- docker compose build laeuft durch OHNE Fehler (zeige die Ausgabe)
- docker compose up -d laeuft, Container ist healthy
- curl -s http://localhost:8090/ liefert HTML mit "SolarExplorer"
- curl -sI http://localhost:8090/ zeigt die Security-Header
- Ein unbekannter Pfad liefert die 404-Seite (nicht 500)
- KEIN Port 80 oder 443 belegt; alles auf 8090
- docker compose down funktioniert sauber

WICHTIG:
- KEIN git commit
- Port 8090 ist fest vorgegeben (3000/8000 sind auf dem Host belegt!)
- Loesche den Container am Ende wieder mit "docker compose down",
  ABER lasse das Image gebaut (das ist der Beweis)
- Zeige alle Kommando-Ausgaben echt
