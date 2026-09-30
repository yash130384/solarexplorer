#!/bin/sh
# Erzeugt die Triebwerks-Loop und die UI-Klicktoene aus den CC0-Quellen von Kenney.
# Quellen (beide CC0 1.0, beide frei downloadbar):
#   https://kenney.nl/assets/sci-fi-sounds
#   https://kenney.nl/assets/interface-sounds
#
# Aufruf:  sh tools/make_audio.sh <verzeichnis-mit-den-entpackten-kits>
# Beispiel:
#   mkdir -p /tmp/kenney && cd /tmp/kenney
#   curl -LO https://kenney.nl/media/pages/assets/sci-fi-sounds/<hash>/kenney_sci-fi-sounds.zip
#   ... entpacken -> /tmp/kenney/sci-fi-sounds/{Audio,License.txt}
#   sh tools/make_audio.sh /tmp/kenney
#
# Das Skript erwartet unter <verzeichnis> genau diese zwei Ordner:
#   sci-fi-sounds/Audio/spaceEngine_001.ogg          Triebwerk-Loop
#   sci-fi-sounds/Audio/spaceEngineSmall_001.ogg    ruhiger Kinder-Loop
#   interface-sounds/Audio/click_001.ogg            UI-Klick
#   interface-sounds/Audio/confirmation_001.ogg      Bestaetigung
# und schreibt 8 Dateien + 2 Lizenztexte nach public/media/audio/.
#
# Ausgabe: OGG (Original) und MP3 (Fallback fuer Safari < 18.4, das Ogg nicht
# dekodieren kann) — beide bedient von derselben Quelle, also identisch klingend.
set -e

SRC="${1:-}"
if [ -z "$SRC" ]; then
  echo "Aufruf: sh tools/make_audio.sh <verzeichnis-mit-den-entpackten-kits>" >&2
  echo "Siehe den Kommentar am Dateianfang fuer Download und Pfadstruktur." >&2
  exit 1
fi

REPO=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
DST="$REPO/public/media/audio"
F=${FFMPEG:-ffmpeg}

command -v "$F" >/dev/null 2>&1 || {
  echo "ffmpeg nicht gefunden. Setze FFMPEG=/pfad/zu/ffmpeg oder installiere ffmpeg." >&2
  exit 1
}

# Kit-Ordner heissen im Download "Sci-Fi Sounds"/"Interface Sounds" — beide
# Spielarten akzeptieren, damit der Aufruf nicht an einem Leerzeichen scheitert.
find_kit() {
  for candidate in "$1" "$1/sci-fi-sounds" "$1/Sci-Fi Sounds" "$1/interface-sounds" "$1/Interface Sounds"; do
    if [ -d "$candidate/Audio" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

SCIFI=$(find_kit "$SRC/sci-fi-sounds") || SCIFI=$(find_kit "$SRC/Sci-Fi Sounds") || {
  echo "Kein Sci-Fi-Sounds-Kit unter $SRC (erwartet <dir>/Audio/*.ogg)" >&2
  exit 1
}
IFACE=$(find_kit "$SRC/interface-sounds") || IFACE=$(find_kit "$SRC/Interface Sounds") || {
  echo "Kein Interface-Sounds-Kit unter $SRC (erwartet <dir>/Audio/*.ogg)" >&2
  exit 1
}

mkdir -p "$DST"

# --- Triebwerk: Loop-Kandidat spaceEngine_001 (Anfang -8.5 dB, Ende -8.3 dB RMS)
#     -> Pegel am Anschluss nahezu gleich, loopt also ohne Sprung.
#     spaceEngineSmall_001 (-17.9 / -17.5 dB) ist der ruhigere Kinder-Loop.
$F -hide_banner -v error -y -i "$SCIFI/Audio/spaceEngine_001.ogg" \
   -c:a libvorbis -q:a 3 "$DST/triebwerk.ogg"
$F -hide_banner -v error -y -i "$SCIFI/Audio/spaceEngine_001.ogg" \
   -c:a libmp3lame -b:a 80k "$DST/triebwerk.mp3"

$F -hide_banner -v error -y -i "$SCIFI/Audio/spaceEngineSmall_001.ogg" \
   -c:a libvorbis -q:a 3 "$DST/triebwerk_leise.ogg"
$F -hide_banner -v error -y -i "$SCIFI/Audio/spaceEngineSmall_001.ogg" \
   -c:a libmp3lame -b:a 80k "$DST/triebwerk_leise.mp3"

# --- Klick: click_001 (100 ms) fuer Navigation/Auswahl
$F -hide_banner -v error -y -i "$IFACE/Audio/click_001.ogg" \
   -c:a libvorbis -q:a 3 "$DST/klick.ogg"
$F -hide_banner -v error -y -i "$IFACE/Audio/click_001.ogg" \
   -c:a libmp3lame -b:a 80k "$DST/klick.mp3"

# --- Bestaetigung: confirmation_001 (290 ms) fuer Quiz-Antwort / Moduswechsel
$F -hide_banner -v error -y -i "$IFACE/Audio/confirmation_001.ogg" \
   -c:a libvorbis -q:a 3 "$DST/bestaetigung.ogg"
$F -hide_banner -v error -y -i "$IFACE/Audio/confirmation_001.ogg" \
   -c:a libmp3lame -b:a 80k "$DST/bestaetigung.mp3"

cp "$SCIFI/License.txt" "$DST/License-Kenney-SciFiSounds.txt"
cp "$IFACE/License.txt" "$DST/License-Kenney-InterfaceSounds.txt"

ls -la "$DST"
