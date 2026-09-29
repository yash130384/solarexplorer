PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer — alle Dateien dort, kein scratch.

AUFGABE: Projektfundament — Vite + TypeScript(strict) + Vitest + Three.js

ERSTELLE GENAU diese Dateien:
1. package.json
2. tsconfig.json
3. vite.config.ts
4. vitest.config.ts
5. .gitignore
6. index.html
7. src/main.ts          (Minimal-Bootstrap, noch keine 3D-Szene)
8. src/vite-env.d.ts

ANFORDERUNGEN:

package.json:
- name "solarexplorer", private: true, type "module"
- scripts: dev, build (tsc --noEmit && vite build), preview, test, test:unit, test:e2e
- dependencies: three
- devDependencies: typescript, vite, vitest, @types/three, jsdom, @playwright/test
- Nutze die aktuellen stabilen Versionen. Wenn du eine Version nicht sicher
  kennst, installiere mit "latest" und uebernimm die echte Version aus der
  generierten package-lock.json in package.json.

tsconfig.json:
- "strict": true
- target ES2022, module ESNext, moduleResolution bundler
- "noUncheckedIndexedAccess": true
- "noImplicitOverride": true
- include: src, tests

vite.config.ts:
- base "./"  (WICHTIG: die App wird unter einem Subpfad served)
- build.outDir "dist"
- server.port 5173
- server.host true (in Docker noetig)

index.html:
- lang="de"
- meta viewport fuer Mobil
- meta description mit "SolarExplorer"
- title "SolarExplorer - Das Sonnensystem zum Erforschen"
- Ein div mit id="app" und ein modularem script fuer /src/main.ts

src/main.ts:
- Importiert NICHTS aus three.js (kommt in spaeteren Tickets)
- Schreibt eine kleine Testzeile in #app damit klar ist, dass der Bootstrap laeuft
- Nutzt TypeScript, strict, keine any

.gitignore:
- node_modules, dist, test-results, playwright-report, .vite

ACCEPTANCE CRITERIA:
- npm install laeuft ohne Fehler durch
- npx tsc --noEmit meldet 0 Fehler
- npm run build erzeugt dist/ mit index.html
- npx vitest run startet und beendet sauber (0 Tests sind OK, aber der Runner
  muss sich nicht aufhaengen)
- package.json nennt keine "latest"-Platzhalter, sondern echte Versionen

WICHTIG:
- KEIN git commit (Reviewer-Freigabe steht aus)
- KEIN Three.js-Code in diesem Ticket. Nur Fundament.
- Zeige am Ende die echte Ausgabe von "npx tsc --noEmit" und "npm run build".
