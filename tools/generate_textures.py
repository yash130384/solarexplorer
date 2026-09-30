#!/usr/bin/env python3
"""Prozedurale Textur-Generator fuer SolarExplorer.

Erzeugt pro Himmelskoerper eine Equirectangular-Map (2:1) als PNG unter
``public/media/textures/<bodyId>.png``. Die Texturen sind bewusst *prozedural*
statt heruntergeladen: keine Lizenzfragen, keine Laufzeit-CDN-Abhaengigkeit,
vollstaendig offline reproduzierbar.

Nutzung::

    python3 tools/generate_textures.py            # erzeugt fehlende Texturen
    python3 tools/generate_textures.py --force     # ueberschreibt vorhandene
    python3 tools/generate_textures.py --list      # nur Planen-Tabelle zeigen

Determinismus: jeder Koerper hat einen festen Seed (CRC32 der Body-ID), es
wird kein ``random.seed()`` global und niemals ``Math.random`` aehnliches
verwendet. Zwei Laeufe erzeugen byte-identische PNGs.
"""

from __future__ import annotations

import argparse
import math
import os
import struct
import sys
import zlib
from dataclasses import dataclass, field
from typing import Callable, Iterable, Sequence

try:  # optional, nur fuer schnellere PNG-Ausgabe
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover - Pillow ist optional
    Image = None  # type: ignore

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# public/ ist Vites publicDir: die PNGs werden 1:1 nach dist/ kopiert und sind
# zur Laufzeit ueber ./media/textures/<id>.png erreichbar (stabiler Pfad, kein Hash).
OUT_DIR = os.path.join(ROOT, "public", "media", "textures")

RGB = tuple[int, int, int]


# --------------------------------------------------------------------------
# Minimaler, abhaengigkeitsfreier PNG-Writer (nur stdlib)
# --------------------------------------------------------------------------
def write_png(path: str, width: int, height: int, pixels: bytearray) -> None:
    """Schreibt 8-Bit-RGB-PNG (color type 2) ohne externe Abhaengigkeiten.

    :param path: Zielpfad.
    :param width: Bildbreite in Pixeln.
    :param height: Bildhoehe in Pixeln.
    :param pixels: RGB-Bytes, Laenge ``width * height * 3``.
    """
    expected = width * height * 3
    if len(pixels) != expected:
        raise ValueError(f"pixel buffer mismatch: {len(pixels)} != {expected}")

    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def write_png_file(path: str, width: int, height: int, pixels: bytearray) -> None:
    """PNG schreiben; nutzt Pillow falls verfuegbar, sonst den stdlib-Writer."""
    if Image is not None:
        Image.frombytes("RGB", (width, height), bytes(pixels)).save(
            path, "PNG", optimize=True
        )
    else:
        write_png(path, width, height, pixels)


# --------------------------------------------------------------------------
# Deterministischer Zufall + Value-Noise
# --------------------------------------------------------------------------
class Rng:
    """Kleiner deterministischer PRNG (SplitMix64), unabhaengig von `random`."""

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFFFFFFFFFF

    def next_u32(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
        return (z ^ (z >> 31)) & 0xFFFFFFFF

    def random(self) -> float:
        """Float in [0, 1)."""
        return self.next_u32() / 4294967296.0

    def uniform(self, low: float, high: float) -> float:
        return low + (high - low) * self.random()

    def randint(self, low: int, high: int) -> int:
        """Integer in [low, high]."""
        return low + int(self.random() * (high - low + 1))

    def choice(self, items: Sequence):
        return items[self.randint(0, len(items) - 1)]


def seed_for(body_id: str) -> int:
    """Stabiler 32-Bit-Seed aus der Body-ID (CRC32, prozessunabhaengig)."""
    return zlib.crc32(body_id.encode("utf-8")) & 0xFFFFFFFF


def _smooth(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


class ValueNoise:
    """Kachelbares Value-Noise (in X Richtung) mit bilinearer Interpolation."""

    def __init__(self, rng: Rng, nx: int, ny: int) -> None:
        self.nx = nx
        self.ny = ny
        self.grid = [rng.random() for _ in range(nx * ny)]

    def at(self, ix: int, iy: int) -> float:
        """Gitterwert mit Wrap in x und Clamp in y."""
        x = ix % self.nx
        y = iy
        if y < 0:
            y = 0
        elif y > self.ny:
            y = self.ny
        return self.grid[y * self.nx + x]

    def sample(self, u: float, v: float) -> float:
        """Noise an Position (u, v), beide in [0, 1] (v wird geklemmt)."""
        fx = u * self.nx
        fy = v * self.ny
        x0 = math.floor(fx)
        y0 = math.floor(fy)
        tx = _smooth(fx - x0)
        ty = _smooth(fy - y0)
        a = self.at(int(x0), int(y0))
        b = self.at(int(x0) + 1, int(y0))
        c = self.at(int(x0), int(y0) + 1)
        d = self.at(int(x0) + 1, int(y0) + 1)
        top = a + (b - a) * tx
        bottom = c + (d - c) * tx
        return top + (bottom - top) * ty


class Fbm:
    """Fraktales Value-Noise (mehrere Oktaven) mit optionaler Domain-Warp."""

    def __init__(
        self,
        rng: Rng,
        base_nx: int = 8,
        base_ny: int = 4,
        octaves: int = 5,
        gain: float = 0.5,
        lacunarity: float = 2.0,
    ) -> None:
        self.layers: list[tuple[ValueNoise, float]] = []
        self.total = 0.0
        nx, ny = base_nx, base_ny
        amp = 1.0
        for _ in range(octaves):
            self.layers.append((ValueNoise(rng, nx, ny), amp))
            self.total += amp
            amp *= gain
            nx = int(nx * lacunarity)
            ny = max(1, int(ny * lacunarity))

    def sample(self, u: float, v: float) -> float:
        """Summe der Oktaven, normalisiert auf [0, 1]."""
        value = 0.0
        for noise, amp in self.layers:
            value += amp * noise.sample(u, v)
        return value / self.total


# --------------------------------------------------------------------------
# Farb-Hilfsfunktionen
# --------------------------------------------------------------------------
def mix(a: RGB, b: RGB, t: float) -> RGB:
    """Lineare Mischung zweier RGB-Farben.

    :param a: Startfarbe.
    :param b: Zielfarbe.
    :param t: Mischanteil von ``b`` in [0, 1].
    :returns: Gemischte Farbe.
    """
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return (
        int(a[0] + (b[0] - a[0]) * t),
        int(a[1] + (b[1] - a[1]) * t),
        int(a[2] + (b[2] - a[2]) * t),
    )


def shade(color: RGB, factor: float) -> RGB:
    """Farbe multiplikativ aufhellen (factor > 1) oder abdunkeln (< 1)."""
    return (
        max(0, min(255, int(color[0] * factor))),
        max(0, min(255, int(color[1] * factor))),
        max(0, min(255, int(color[2] * factor))),
    )


def ramp(stops: Sequence[tuple[float, RGB]], t: float) -> RGB:
    """Farbverlauf anhand von Stopps ``[(pos, color), ...]`` (pos aufsteigend)."""
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            span = p1 - p0
            local = 0.0 if span <= 0 else (t - p0) / span
            return mix(c0, c1, local)
    return stops[-1][1]


# --------------------------------------------------------------------------
# Bild-Klasse: schreibt direkt in einen RGB-Bytebuffer
# --------------------------------------------------------------------------
class Canvas:
    """Einfacher RGB-Puffer mit ein paar Maloperationen."""

    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        self.data = bytearray(width * height * 3)

    def set(self, x: int, y: int, color: RGB) -> None:
        """Schreibt einen Pixel; x wrappt, y wird geklemmt."""
        x = x % self.width
        y = max(0, min(self.height - 1, y))
        idx = (y * self.width + x) * 3
        self.data[idx] = color[0]
        self.data[idx + 1] = color[1]
        self.data[idx + 2] = color[2]

    def get(self, x: int, y: int) -> RGB:
        """Liest einen Pixel; x wrappt (Equirectangular-Naht), y wird geklemmt."""
        x = x % self.width
        y = max(0, min(self.height - 1, y))
        idx = (y * self.width + x) * 3
        return (self.data[idx], self.data[idx + 1], self.data[idx + 2])

    def blend(self, x: int, y: int, color: RGB, alpha: float) -> None:
        """Alpha-Blend eines Pixels (alpha in [0, 1])."""
        if alpha <= 0.0:
            return
        if alpha >= 1.0:
            self.set(x, y, color)
            return
        x = x % self.width
        y = max(0, min(self.height - 1, y))
        idx = (y * self.width + x) * 3
        inv = 1.0 - alpha
        self.data[idx] = int(self.data[idx] * inv + color[0] * alpha)
        self.data[idx + 1] = int(self.data[idx + 1] * inv + color[1] * alpha)
        self.data[idx + 2] = int(self.data[idx + 2] * inv + color[2] * alpha)

    def mean_color(self) -> RGB:
        """Durchschnittsfarbe (fuer Plausibilitaetskontrolle)."""
        total = [0, 0, 0]
        count = self.width * self.height
        step = 3
        for i in range(0, len(self.data), step):
            total[0] += self.data[i]
            total[1] += self.data[i + 1]
            total[2] += self.data[i + 2]
        return (total[0] // count, total[1] // count, total[2] // count)


def lat_of(y: int, height: int) -> float:
    """Geografische Breite in Grad fuer Bildzeile ``y`` (oben = +90)."""
    return 90.0 - (y / max(1, height - 1)) * 180.0


def lon_of(x: int, width: int) -> float:
    """Laengengrad in Grad fuer Bildspalte ``x`` (-180 .. 180)."""
    return (x / width) * 360.0 - 180.0


def lat_stretch(y: int, height: int) -> float:
    """Verzerrt v so, dass Features an den Polen nicht gestaucht werden."""
    lat = lat_of(y, height)
    # aequatornah: v ~ 0.5, Pole: v -> 0 bzw. 1
    return 0.5 - 0.5 * math.cos(math.radians(lat))


# --------------------------------------------------------------------------
# Maloperationen
# --------------------------------------------------------------------------
def draw_crater(canvas: Canvas, cx: float, cy: float, radius: float, rng: Rng) -> None:
    """Zeichnet einen Krater mit hellem Rand und dunklem Schatten.

    :param canvas: Zielbild.
    :param cx: Mittelpunkt in Pixeln (x, darf ausserhalb liegen -> Wrap).
    :param cy: Mittelpunkt in Pixeln (y).
    :param radius: Radius in Pixeln.
    :param rng: deterministischer Zufall fuer Schattenrichtung.
    """
    if radius < 1.0:
        return
    r = int(radius) + 3
    x0 = int(cx) - r
    x1 = int(cx) + r
    y0 = max(0, int(cy) - r)
    y1 = min(canvas.height - 1, int(cy) + r)
    sun = rng.uniform(0.0, math.tau)
    sx = math.cos(sun) * 0.45
    sy = math.sin(sun) * 0.45
    rim = rng.uniform(0.16, 0.34)
    floor_tone = rng.uniform(0.55, 0.8)
    for y in range(y0, y1 + 1):
        dy = (y + 0.5) - cy
        for x in range(x0, x1 + 1):
            dx = ((x + 0.5) - cx)
            if abs(dx) > r or abs(dy) > r:
                continue
            d = math.hypot(dx, dy) / radius
            if d > 1.05:
                continue
            base = canvas.get(x, y)
            factor = 1.0
            if d > 0.82:
                factor += rim * (1.0 - abs(d - 0.91) / 0.09)  # heller Rand
            elif d < 0.7:
                factor = floor_tone + 0.2 * d
            # Schattenseite
            if d < 0.98:
                lit = (dx * sx + dy * sy) / radius
                if lit < 0.0:
                    factor -= 0.3 * min(1.0, -lit)
            canvas.set(x, y, shade(base, max(0.25, factor)))


def draw_blob(
    canvas: Canvas,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    color: RGB,
    alpha: float,
    rng: Rng,
    softness: float = 0.45,
) -> None:
    """Weicher, leicht verrauschter Farbklecks (Sturm/Maria/Polkappe)."""
    r = int(max(rx, ry)) + 2
    for y in range(max(0, int(cy - ry) - r), min(canvas.height, int(cy + ry) + r)):
        for x in range(int(cx - rx) - r, int(cx + rx) + r):
            dx = ((x + 0.5) - cx) / rx
            dy = ((y + 0.5) - cy) / ry
            d = math.hypot(dx, dy)
            if d > 1.0:
                continue
            edge = 1.0 - d
            jitter = 0.75 + 0.5 * rng.random()
            a = alpha * (edge ** (1.0 / max(0.05, softness))) * jitter
            canvas.blend(x, y, color, min(1.0, a))


def draw_oval(canvas: Canvas, cx: float, cy: float, rx: float, ry: float, color: RGB, alpha: float) -> None:
    """Kratzige, scharf begrenzte Ellipse (z. B. Grosser Roter Fleck)."""
    for y in range(max(0, int(cy - ry) - 1), min(canvas.height, int(cy + ry) + 2)):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx = ((x + 0.5) - cx) / rx
            dy = ((y + 0.5) - cy) / ry
            d = math.hypot(dx, dy)
            if d > 1.0:
                continue
            canvas.blend(x, y, color, alpha * min(1.0, (1.0 - d) * 6.0 + 0.35))


def draw_line(
    canvas: Canvas,
    x0: float,
    y0: float,
    points: Iterable[tuple[float, float]],
    color: RGB,
    alpha: float,
    width: float,
) -> None:
    """Zeichnet eine Linie durch gegebene Stützpunkte (fuer Europa-Risse)."""
    pts = list(points)
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        steps = max(2, int(math.hypot(bx - ax, by - ay) * 2))
        for i in range(steps + 1):
            t = i / steps
            px = ax + (bx - ax) * t
            py = ay + (by - ay) * t
            wr = int(width) + 1
            for y in range(max(0, int(py - wr)), min(canvas.height, int(py + wr + 1))):
                for x in range(int(px - wr), int(px + wr + 1)):
                    d = math.hypot(x + 0.5 - px, y + 0.5 - py)
                    if d > width:
                        continue
                    canvas.blend(x, y, color, alpha * (1.0 - d / max(0.5, width)))


# --------------------------------------------------------------------------
# Koerper-Definition
# --------------------------------------------------------------------------
@dataclass
class BodySpec:
    """Beschreibung eines Koerpers und seiner Textur."""

    body_id: str
    kind: str
    width: int = 1024
    height: int = 512
    colors: dict = field(default_factory=dict)
    craters: int = 0
    crater_max: int = 26
    blurs: int = 0
    notes: str = ""


BODY_SPECS: list[BodySpec] = [
    BodySpec(
        "sonne", "star", colors={"hot": (255, 250, 214), "mid": (255, 196, 66), "cool": (214, 96, 18)},
        blurs=6, notes="Granulation + Sonnenflecken (Umbra/Penumbra)",
    ),
    BodySpec("merkur", "cratered", width=1024, height=512,
             colors={"base": (148, 143, 136), "dark": (78, 74, 70)},
             craters=900, crater_max=34, notes="dicht kraeterig, dunkle Einschlaege"),
    BodySpec("venus", "venus", colors={"a": (238, 205, 128), "b": (196, 141, 70), "c": (247, 233, 190)},
             blurs=16, notes="wirkselnde Wolkenbaender Y-Form"),
    BodySpec("erde", "earth", colors={"deep": (10, 42, 96), "shallow": (34, 106, 176), "land": (86, 122, 58),
                                       "desert": (176, 154, 96), "ice": (240, 246, 252)},
             blurs=10, notes="Ozeane, Kontinente, Polkappen, Wolken"),
    BodySpec("mars", "mars", colors={"base": (193, 110, 63), "dark": (122, 66, 42), "ice": (238, 238, 232)},
             craters=520, crater_max=22, blurs=14, notes="rostrot, dunkle Flecken, helle Polkappen"),
    BodySpec("jupiter", "jupiter", colors={"zone": (226, 200, 162), "belt": (166, 106, 70), "white": (244, 236, 216),
                                          "red": (198, 78, 52)},
             blurs=18, notes="Streifen + Grosser Roter Fleck"),
    BodySpec("saturn", "saturn", colors={"zone": (232, 216, 168), "belt": (198, 176, 128), "white": (246, 240, 214)},
             blurs=10, notes="blass-gelbe, weiche Streifen"),
    BodySpec("uranus", "uranus", colors={"base": (168, 226, 234), "band": (150, 208, 222), "white": (214, 244, 246)},
             blurs=5, notes="blass-cyan, sehr gleichmaessig"),
    BodySpec("neptun", "neptune", colors={"deep": (32, 62, 156), "band": (58, 104, 200), "white": (232, 242, 255)},
             blurs=9, notes="tiefblau, weisse Wirbel"),
    BodySpec("titan", "titan", colors={"a": (222, 158, 66), "b": (198, 128, 48), "c": (238, 196, 122)},
             blurs=8, notes="orange, dunstig (N2-Dunstschleier)"),
    BodySpec("io", "io", colors={"a": (226, 208, 74), "b": (244, 234, 160), "c": (188, 96, 52)},
             blurs=26, notes="gelb-orange, sehr fluessig (Vulkan-Pits)"),
    BodySpec("europa", "europa", colors={"base": (232, 224, 206), "line": (166, 88, 66)},
             blurs=4, notes="beige-weiss, sehr glatt, rote Linien"),
    BodySpec("ganymede", "cratered", width=512, height=256,
             colors={"base": (140, 132, 124), "dark": (96, 90, 86), "light": (186, 180, 172)},
             craters=420, crater_max=20, blurs=20, notes="grau mit hellen/dunklen Flecken"),
    BodySpec("kallisto", "cratered", width=512, height=256,
             colors={"base": (86, 78, 72), "dark": (52, 46, 42), "light": (132, 122, 112)},
             craters=1100, crater_max=26, blurs=8, notes="dunkel, stark kraeterig"),
    BodySpec("mond", "maria", colors={"base": (150, 146, 138), "highland": (178, 174, 166), "mare": (86, 84, 82)},
             craters=700, crater_max=24, blurs=14, notes="grau, krueterig, dunkle Maria"),
    BodySpec("triton", "triton", colors={"base": (232, 214, 214), "pink": (222, 176, 176), "white": (246, 240, 240)},
             blurs=10, notes="rosa-weiss, sehr glatt"),
    BodySpec("mimas", "cratered", width=512, height=256,
             colors={"base": (156, 154, 150), "dark": (104, 100, 96)}, craters=280, crater_max=30,
             notes="schlichtes graues Krater-Monster"),
    BodySpec("enceladus", "enceladus", width=512, height=256,
             colors={"base": (222, 226, 230), "dark": (170, 176, 184), "light": (246, 248, 250)},
             craters=220, crater_max=20, blurs=6, notes="sehr hell, Bruchlinien (Tigerrisse)"),
    BodySpec("phobos", "cratered", width=256, height=128,
             colors={"base": (108, 98, 88), "dark": (58, 50, 44)}, craters=200, crater_max=18,
             notes="schlichtes graues Krater-Monster"),
    BodySpec("deimos", "cratered", width=256, height=128,
             colors={"base": (122, 112, 100), "dark": (70, 62, 56)}, craters=140, crater_max=18,
             notes="schlichtes graues Krater-Monster"),
]


# --------------------------------------------------------------------------
# Textur-Generatoren je Typ
# --------------------------------------------------------------------------
def base_fbm(rng: Rng, nx: int = 8, ny: int = 4, octaves: int = 5) -> Fbm:
    return Fbm(rng, base_nx=nx, base_ny=ny, octaves=octaves)


def render_star(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Sonne: Granulation, heisse Kerne, Sonnenflecken."""
    c = spec.colors
    gran = base_fbm(rng, 16, 8, 6)
    supergran = base_fbm(rng, 4, 2, 3)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            n = gran.sample(u, v)
            big = supergran.sample(u, v)
            t = 0.30 * n + 0.70 * big
            color = ramp([(0.0, c["cool"]), (0.42, c["mid"]), (1.0, c["hot"])], 0.15 + 0.9 * t)
            canvas.set(x, y, color)
    # Sonnenflecken: dunkle Kerne mit weichem Rand
    for _ in range(rng.randint(5, 9)):
        cy = rng.uniform(0.15, 0.85) * canvas.height
        lat = lat_of(int(cy), canvas.height)
        # Flecken gibt es nur in den mittleren Breiten
        if abs(lat) > 45:
            continue
        cx = rng.uniform(0, canvas.width)
        rx = rng.uniform(0.02, 0.05) * canvas.width
        ry = rx * rng.uniform(0.35, 0.7)
        draw_blob(canvas, cx, cy, rx * 1.5, ry * 1.5, (150, 70, 20), 0.35, rng, softness=0.7)
        draw_blob(canvas, cx, cy, rx, ry, (86, 38, 12), 0.75, rng, softness=0.9)


def render_cratered(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Gesteinskoerper: Noise-Grundton, Flecken, Krater."""
    c = spec.colors
    fbm = base_fbm(rng, 8, 4, 6)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = fbm.sample(u, v)
            color = mix(c["base"], c["dark"], 0.35 * (1.0 - t) + 0.25 * t)
            canvas.set(x, y, color)
    # helle/dunkle Flecken (Ganymede, Callisto, Enceladus)
    for _ in range(spec.blurs):
        color = c.get("light", shade(c["base"], 1.18))
        draw_blob(
            canvas,
            rng.uniform(0, canvas.width),
            rng.uniform(0.05, 0.95) * canvas.height,
            rng.uniform(0.04, 0.14) * canvas.width,
            rng.uniform(0.03, 0.10) * canvas.height,
            color,
            rng.uniform(0.15, 0.4),
            rng,
        )
    # Krater, mit Pol-Verdichtung
    for i in range(spec.craters):
        cy = rng.uniform(0, canvas.height)
        polar = min(1.0, abs(lat_of(int(cy), canvas.height)) / 75.0)
        radius = rng.uniform(2.0, spec.crater_max * (0.5 + 0.5 * polar))
        draw_crater(canvas, rng.uniform(0, canvas.width), cy, radius, rng)


def render_maria(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Erdmond: helles Hochland + dunkle Maria."""
    c = spec.colors
    fbm = base_fbm(rng, 10, 5, 6)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = fbm.sample(u, v)
            canvas.set(x, y, mix(c["base"], c["highland"], t))
    # Maria: grosse, dunkle, weich begrenzte Becken auf der Vorderseite
    mare_fbm = base_fbm(rng, 5, 3, 4)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            m = mare_fbm.sample(u, v)
            if m > 0.56:
                alpha = min(1.0, (m - 0.56) / 0.14)
                canvas.blend(x, y, c["mare"], alpha * 0.9)
    for _ in range(10):
        draw_blob(canvas, rng.uniform(0, canvas.width), rng.uniform(0.15, 0.85) * canvas.height,
                  rng.uniform(0.05, 0.12) * canvas.width, rng.uniform(0.04, 0.09) * canvas.height,
                  c["mare"], rng.uniform(0.3, 0.55), rng, softness=0.8)
    for i in range(spec.craters):
        cy = rng.uniform(0, canvas.height)
        polar = min(1.0, abs(lat_of(int(cy), canvas.height)) / 75.0)
        draw_crater(canvas, rng.uniform(0, canvas.width), cy,
                    rng.uniform(2.0, spec.crater_max * (0.5 + 0.5 * polar)), rng)


def render_venus(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Venus: dichter Dunst, Y-foermige Wolkenwirbel."""
    c = spec.colors
    fbm = base_fbm(rng, 6, 3, 4)
    warp = base_fbm(rng, 4, 2, 3)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = 0.7 * fbm.sample(u, v) + 0.3 * warp.sample(u, v)
            canvas.set(x, y, mix(c["b"], c["a"], t))
    for _ in range(spec.blurs):
        color = rng.choice([c["a"], c["c"]])
        cy = rng.uniform(0.1, 0.9) * canvas.height
        draw_blob(canvas, rng.uniform(0, canvas.width), cy,
                  rng.uniform(0.10, 0.28) * canvas.width,
                  rng.uniform(0.04, 0.10) * canvas.height,
                  color, rng.uniform(0.12, 0.3), rng, softness=0.6)
    # Pol-Wirbel
    for pole_y in (0.06 * canvas.height, 0.94 * canvas.height):
        draw_blob(canvas, canvas.width * 0.5, pole_y, canvas.width * 0.22,
                  canvas.height * 0.10, c["c"], 0.28, rng, softness=0.5)


def render_earth(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Erde: Ozeane, Kontinente, Wuesten, Polkappen, Wolken."""
    c = spec.colors
    land_fbm = base_fbm(rng, 5, 3, 6)
    detail = base_fbm(rng, 16, 8, 5)
    cloud_fbm = base_fbm(rng, 7, 4, 5)
    cloud_mask = Fbm(rng, base_nx=3, base_ny=2, octaves=3)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        lat = lat_of(y, canvas.height)
        alat = abs(lat)
        for x in range(canvas.width):
            u = x / canvas.width
            h = land_fbm.sample(u, v)
            h = h + 0.22 * (detail.sample(u, v) - 0.5)
            # Ozean
            if h < 0.5:
                depth = (0.5 - h) / 0.5
                color = mix(c["shallow"], c["deep"], min(1.0, depth * 1.35))
            else:
                land_t = min(1.0, (h - 0.5) / 0.22)
                elev = 0.6 * detail.sample(u * 1.7, v)
                green = mix(c["land"], c["desert"], max(0.0, (lat - 8) / 26) * 0.55 + 0.25 * land_t)
                color = mix(green, c["ice"], min(1.0, land_t * 0.55 * (0.4 + elev)))
            # Polkappen
            ice = (alat - 66.0) / 12.0 + 0.35 * (detail.sample(u, v) - 0.5)
            if ice > 0:
                color = mix(color, c["ice"], min(1.0, ice))
            # Wolken
            band = 0.5 + 0.5 * math.cos(math.radians(lat * 2.2))
            cl = cloud_fbm.sample(u, v) * (0.55 + 0.65 * band)
            gate = cloud_mask.sample(u, v)
            if cl * gate > 0.34:
                color = mix(color, (250, 250, 252), min(0.88, (cl * gate - 0.34) * 3.4))
            canvas.set(x, y, color)
    # suedamerikanische Wolken-Spirale als typischer Wirbel
    draw_blob(canvas, canvas.width * 0.30, canvas.height * 0.72, canvas.width * 0.09,
              canvas.height * 0.05, (252, 252, 254), 0.4, rng, softness=0.5)


def render_mars(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Mars: Rostrot, dunkle Albedo-Flecken, helle Polkappen, Krater."""
    c = spec.colors
    fbm = base_fbm(rng, 7, 4, 6)
    dark_fbm = base_fbm(rng, 4, 2, 4)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        lat = lat_of(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = fbm.sample(u, v)
            color = mix(c["dark"], c["base"], 0.25 + 0.85 * t)
            d = dark_fbm.sample(u, v)
            if d > 0.56:
                color = mix(color, shade(c["dark"], 0.85), min(1.0, (d - 0.56) * 3.0))
            ice = (abs(lat) - 72.0) / 10.0 + 0.3 * (t - 0.5)
            if ice > 0:
                color = mix(color, c["ice"], min(1.0, ice))
            canvas.set(x, y, color)
    for _ in range(spec.blurs):
        draw_blob(canvas, rng.uniform(0, canvas.width), rng.uniform(0.1, 0.9) * canvas.height,
                  rng.uniform(0.05, 0.15) * canvas.width, rng.uniform(0.03, 0.08) * canvas.height,
                  shade(c["dark"], 0.9), rng.uniform(0.2, 0.45), rng, softness=0.6)
    for i in range(spec.craters):
        cy = rng.uniform(0, canvas.height)
        draw_crater(canvas, rng.uniform(0, canvas.width), cy, rng.uniform(2.0, spec.crater_max), rng)


def render_banded_giant(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Gasriesen (Jupiter/Saturn): Zonen, Baelter, Wirbel."""
    c = spec.colors
    warp = base_fbm(rng, 5, 3, 4)
    fine = base_fbm(rng, 14, 7, 5)
    bands = spec.body_id in ("jupiter",)
    band_freq = 13.0 if bands else 8.0
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        lat = lat_of(y, canvas.height)
        # Zonen/Baelter als Sinus mit domain-warped Breite
        for x in range(canvas.width):
            u = x / canvas.width
            w = (warp.sample(u, v) - 0.5) * (0.10 if bands else 0.05)
            s = math.sin(math.radians((lat + w * 40.0) * band_freq))
            f = fine.sample(u, v)
            t = 0.5 + 0.5 * s
            t = min(1.0, max(0.0, t + (f - 0.5) * 0.35))
            if spec.body_id in ("uranus",):
                color = mix(c["band"], c["base"], 0.4 + 0.6 * f)
            else:
                color = mix(c["belt"], c["zone"], t)
                if t > 0.82:
                    color = mix(color, c["white"], (t - 0.82) / 0.18 * 0.8)
            canvas.set(x, y, color)
    # weisse Wirbel / Stürme
    for _ in range(spec.blurs):
        cy = rng.uniform(0.18, 0.82) * canvas.height
        base_tone = c.get("zone") or c.get("base") or (255, 255, 255)
        color = c.get("white") or shade(base_tone, 1.15)
        draw_blob(canvas, rng.uniform(0, canvas.width), cy,
                  rng.uniform(0.04, 0.12) * canvas.width,
                  rng.uniform(0.015, 0.05) * canvas.height,
                  color, rng.uniform(0.25, 0.5), rng, softness=0.5)
    if spec.body_id == "jupiter":
        # Grosser Roter Fleck bei ~22 Grad Sued
        lat = -22.0
        y = int((90.0 - lat) / 180.0 * (canvas.height - 1))
        draw_oval(canvas, canvas.width * 0.34, y, canvas.width * 0.075,
                  canvas.height * 0.055, c["red"], 0.88)
        draw_oval(canvas, canvas.width * 0.34, y, canvas.width * 0.055,
                  canvas.height * 0.040, shade(c["red"], 1.12), 0.6)


def render_neptune(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Neptun: tiefblau mit hellen Wolkenbändern und Wirbel."""
    c = spec.colors
    fbm = base_fbm(rng, 6, 3, 5)
    fine = base_fbm(rng, 16, 8, 4)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        lat = lat_of(y, canvas.height)
        band = 0.5 + 0.5 * math.sin(math.radians(lat * 6.0))
        for x in range(canvas.width):
            u = x / canvas.width
            t = 0.65 * fbm.sample(u, v) + 0.35 * fine.sample(u, v)
            color = mix(c["deep"], c["band"], 0.25 + 0.75 * (t * 0.6 + band * 0.4))
            canvas.set(x, y, color)
    # weisse Hoehenwolken
    for _ in range(spec.blurs):
        cy = rng.uniform(0.25, 0.75) * canvas.height
        draw_blob(canvas, rng.uniform(0, canvas.width), cy,
                  rng.uniform(0.05, 0.14) * canvas.width,
                  rng.uniform(0.02, 0.05) * canvas.height,
                  c["white"], rng.uniform(0.35, 0.6), rng, softness=0.5)
    # dunkler Wirbel
    draw_oval(canvas, canvas.width * 0.62, canvas.height * 0.60, canvas.width * 0.05,
              canvas.height * 0.035, shade(c["deep"], 0.75), 0.5)


def render_uranus(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Uranus: blass-cyan, sehr gleichmaessig, leichte Wolkenstreifen."""
    render_banded_giant(spec, canvas, rng)


def render_haze(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Titan/Triton: weicher Dunst, wenige klare Strukturen."""
    c = spec.colors
    # Titan nutzt a/b/c (orange), Triton base/pink/white (rosa) — beide verstaendlich
    low = c.get("b") or c.get("base") or (200, 200, 200)
    high = c.get("a") or c.get("pink") or (240, 240, 240)
    cap = c.get("c") or c.get("white") or shade(high, 1.1)
    fbm = base_fbm(rng, 5, 3, 5)
    soft = base_fbm(rng, 11, 6, 4)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        lat = lat_of(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = 0.6 * fbm.sample(u, v) + 0.4 * soft.sample(u, v)
            color = mix(low, high, 0.25 + 0.75 * t)
            if abs(lat) > 55:
                color = mix(color, cap, min(1.0, (abs(lat) - 55) / 25.0))
            canvas.set(x, y, color)
    for _ in range(spec.blurs):
        draw_blob(canvas, rng.uniform(0, canvas.width), rng.uniform(0.15, 0.85) * canvas.height,
                  rng.uniform(0.06, 0.16) * canvas.width,
                  rng.uniform(0.04, 0.10) * canvas.height,
                  shade(cap, 1.05), rng.uniform(0.12, 0.3), rng, softness=0.8)


def render_io(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Io: fluessige Schwefel-Vulkanfarben mit dunklen Pitten."""
    c = spec.colors
    fbm = base_fbm(rng, 9, 5, 5)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = fbm.sample(u, v)
            canvas.set(x, y, ramp([(0.0, c["c"]), (0.4, c["a"]), (1.0, c["b"])], t))
    for _ in range(spec.blurs):
        pick = rng.random()
        if pick < 0.4:
            color = shade(c["c"], 0.85)  # Vulkan-Pit
            rx = rng.uniform(0.005, 0.016) * canvas.width
            ry = rx
        elif pick < 0.75:
            color = c["b"]
            rx = rng.uniform(0.04, 0.12) * canvas.width
            ry = rng.uniform(0.02, 0.06) * canvas.height
        else:
            color = (246, 246, 226)
            rx = rng.uniform(0.01, 0.03) * canvas.width
            ry = rx * 0.7
        draw_blob(canvas, rng.uniform(0, canvas.width), rng.uniform(0.05, 0.95) * canvas.height,
                  rx, ry, color, rng.uniform(0.2, 0.5), rng, softness=0.55)


def render_europa(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Europa: sehr glatte Eisoberflaeche mit roten Risslinien."""
    c = spec.colors
    fbm = base_fbm(rng, 4, 2, 4)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = fbm.sample(u, v)
            canvas.set(x, y, mix(c["base"], shade(c["base"], 0.9), t))
    for _ in range(spec.blurs):
        draw_blob(canvas, rng.uniform(0, canvas.width), rng.uniform(0.1, 0.9) * canvas.height,
                  rng.uniform(0.03, 0.09) * canvas.width,
                  rng.uniform(0.02, 0.06) * canvas.height,
                  (250, 250, 246), rng.uniform(0.1, 0.25), rng, softness=0.7)
    # Risslinien (Chaos + Linea)
    for _ in range(26):
        y = rng.uniform(0.05, 0.95) * canvas.height
        pts = []
        x = rng.uniform(0, canvas.width)
        for _ in range(rng.randint(4, 8)):
            pts.append((x, y))
            x += rng.uniform(0.05, 0.14) * canvas.width
            y += rng.uniform(-0.06, 0.06) * canvas.height
        draw_line(canvas, pts[0][0], pts[0][1], pts[1:], c["line"],
                  rng.uniform(0.35, 0.7), rng.uniform(0.8, 2.2))
    for _ in range(6):
        cx = rng.uniform(0, canvas.width)
        cy = rng.uniform(0.1, 0.9) * canvas.height
        rr = rng.uniform(0.02, 0.05) * canvas.width
        for i in range(7):
            a = i / 7.0 * math.tau
            draw_line(canvas, cx, cy,
                      [(cx + math.cos(a + k / 5.0 * 0.7) * rr * 1.6,
                        cy + math.sin(a + k / 5.0 * 0.7) * rr * 1.6) for k in range(6)],
                      c["line"], 0.45, 1.2)


def render_enceladus(spec: BodySpec, canvas: Canvas, rng: Rng) -> None:
    """Enceladus: helle Eisoberflaeche, Krater + Tigerrisse am Pol."""
    c = spec.colors
    fbm = base_fbm(rng, 5, 3, 4)
    for y in range(canvas.height):
        v = lat_stretch(y, canvas.height)
        for x in range(canvas.width):
            u = x / canvas.width
            t = fbm.sample(u, v)
            canvas.set(x, y, mix(c["base"], c["light"], 0.35 + 0.65 * t))
    for i in range(spec.craters):
        draw_crater(canvas, rng.uniform(0, canvas.width), rng.uniform(0, canvas.height),
                    rng.uniform(2.0, spec.crater_max), rng)
    for _ in range(5):
        cx = rng.uniform(0, canvas.width)
        cy = rng.uniform(0, 1.0) * canvas.height
        pts = [(cx + k * canvas.width * 0.05, cy + math.sin(k) * canvas.height * 0.02) for k in range(6)]
        draw_line(canvas, pts[0][0], pts[0][1], pts[1:], (150, 178, 196), 0.4, 1.4)


def _height_canvas(
    spec: BodySpec, width: int, height: int, seed_offset: int = 0,
) -> Canvas:
    """Hoehenfeld aus FBM-Noise (deterministisch).

    :param spec: Koerper-Beschreibung.
    :param width: Ausgabebreite in Pixeln.
    :param height: Ausgabehoehe in Pixeln.
    :param seed_offset: Offset fuer den Seed (verschiedene Maps nutzen
       unterschiedliche Offsets, damit sie nicht identisch sind).
    :returns: Graustufen-Canvas (Hoehe als Intensitaet).
    """
    rng = Rng(seed_for(spec.body_id) + seed_offset)
    fbm = base_fbm(rng, 8, 4, 6)
    canvas = Canvas(width, height)
    for y in range(height):
        v = lat_stretch(y, height)
        for x in range(width):
            u = x / width
            h = fbm.sample(u, v)
            gray = int(max(0, min(255, h * 255)))
            canvas.set(x, y, (gray, gray, gray))
    return canvas


def height_canvas(spec: BodySpec) -> Canvas:
    """Hoehenfeld aus FBM-Noise (deterministisch, unabhaengig vom Farb-Renderer).

    Wird als Zwischenschritt fuer Normal- und Rauheitskarten genutzt.

    :param spec: Koerper-Beschreibung.
    :returns: Graustufen-Canvas (Hoehe als Intensitaet).
    """
    return _height_canvas(spec, spec.width, spec.height, 0)


def render_normal_map(spec: BodySpec) -> Canvas:
    """Normal map aus dem Hoehenfeld (Sobel-Filter).

    Encodiert die Oberflaechennormalen als RGB: R=x, G=y, B=z der
    Tangenten-Raum-Normalen. Helleraue Bereiche (Beruege/Kraterend)
    erzeugen erkennbare Relief-Strukturen im Normalen-Map.

    Wird in halber Aufloesung erzeugt (Noeheitskarte braucht nicht
    die volle Farb-Resolution) und per nearest-neighbor skaliert.

    :param spec: Koerper-Beschreibung.
    :returns: Canvas mit Normal-Map-Pixeln.
    """
    half_w = max(1, spec.width // 2)
    half_h = max(1, spec.height // 2)
    height = _height_canvas(spec, half_w, half_h, 100)
    # Height data as flat list for fast direct access
    h_data = [height.get(x, y)[0] for y in range(half_h) for x in range(half_w)]

    def h_at(x: int, y: int) -> float:
        x = x % half_w
        y = max(0, min(half_h - 1, y))
        return h_data[y * half_w + x] / 255.0

    # Build normal map at half resolution first
    half_canvas = Canvas(half_w, half_h)
    strength = 2.0
    for y in range(half_h):
        for x in range(half_w):
            left = h_at(x - 1, y)
            right = h_at(x + 1, y)
            up = h_at(x, y - 1)
            down = h_at(x, y + 1)
            dx = (right - left) * strength
            dy = (down - up) * strength
            nx = -dx
            ny = -dy
            nz = 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx /= length
            ny /= length
            nz /= length
            r = int(max(0, min(255, (nx * 0.5 + 0.5) * 255)))
            g = int(max(0, min(255, (ny * 0.5 + 0.5) * 255)))
            b = int(max(0, min(255, (nz * 0.5 + 0.5) * 255)))
            half_canvas.set(x, y, (r, g, b))

    # Scale up to full resolution (nearest-neighbor)
    canvas = Canvas(spec.width, spec.height)
    for y in range(spec.height):
        src_y = min(half_h - 1, max(0, int(y * half_h / spec.height)))
        for x in range(spec.width):
            src_x = min(half_w - 1, max(0, int(x * half_w / spec.width)))
            canvas.set(x, y, half_canvas.get(src_x, src_y))
    return canvas


def render_roughness_map(spec: BodySpec) -> Canvas:
    """Rauheitskarte: hell = rau, dunkel = glatt.

    Grundwert je nach Koerpertyp + Fein-Noise-Variation.
    Wird in halber Aufloesung erzeugt (Rauheit veraendert sich
    langsam genug, dass Halbierung sichtbar reicht).

    :param spec: Koerper-Beschreibung.
    :returns: Canvas mit Rauheitswerten (Graustufe).
    """
    base_roughness = {
        "cratered": 0.7, "maria": 0.5, "venus": 0.6, "earth": 0.5,
        "mars": 0.7, "jupiter": 0.4, "saturn": 0.35, "uranus": 0.3,
        "neptune": 0.35, "titan": 0.4, "triton": 0.3, "io": 0.6,
        "europa": 0.25, "enceladus": 0.2, "star": 0.8,
    }.get(spec.kind, 0.5)
    half_w = max(1, spec.width // 2)
    half_h = max(1, spec.height // 2)
    rng = Rng(seed_for(spec.body_id) + 1)
    fbm = base_fbm(rng, 8, 4, 5)
    half_canvas = Canvas(half_w, half_h)
    for y in range(half_h):
        v = lat_stretch(y, half_h)
        for x in range(half_w):
            u = x / half_w
            n = fbm.sample(u, v)
            roughness = base_roughness + (n - 0.5) * 0.3
            roughness = max(0.0, min(1.0, roughness))
            gray = int(roughness * 255)
            half_canvas.set(x, y, (gray, gray, gray))
    # Scale up to full resolution (nearest-neighbor)
    canvas = Canvas(spec.width, spec.height)
    for y in range(spec.height):
        src_y = min(half_h - 1, max(0, int(y * half_h / spec.height)))
        for x in range(spec.width):
            src_x = min(half_w - 1, max(0, int(x * half_w / spec.width)))
            canvas.set(x, y, half_canvas.get(src_x, src_y))
    return canvas


RENDERERS: dict[str, Callable[[BodySpec, Canvas, Rng], None]] = {
    "star": render_star,
    "cratered": render_cratered,
    "maria": render_maria,
    "venus": render_venus,
    "earth": render_earth,
    "mars": render_mars,
    "jupiter": render_banded_giant,
    "saturn": render_banded_giant,
    "uranus": render_uranus,
    "neptune": render_neptune,
    "titan": render_haze,
    "triton": render_haze,
    "io": render_io,
    "europa": render_europa,
    "enceladus": render_enceladus,
}


def render(spec: BodySpec) -> Canvas:
    """Rendert die Textur eines Koerpers.

    :param spec: Koerper-Beschreibung.
    :returns: Fertiges Canvas.
    """
    rng = Rng(seed_for(spec.body_id))
    canvas = Canvas(spec.width, spec.height)
    renderer = RENDERERS.get(spec.kind, render_cratered)
    renderer(spec, canvas, rng)
    return canvas


# --------------------------------------------------------------------------
# Ringtexturen (radialer Alpha-Verlauf, 1 x N Pixel)
# --------------------------------------------------------------------------
# Die Ringe werden in `src/scene/Rings.ts` als `THREE.DataTexture` mit
# `RingGeometry` kombiniert: die UV laeuft dort radial von 0 (innen) nach 1
# (aussen). Ein 1 x N-Streifen mit Alphawerten passt genau darauf.
#
# Dieselben Parameter stehen in `RING_SPECS` in `src/scene/Rings.ts`. Wer sie
# hier aendert, muss sie dort nachziehen — sonst weichen Bild und Modell ab.

#: (body_id, farbe, opazitaet, luecken) je Ringplanet.
#: Luecken sind (von, bis) relativ zum Radiusintervall 0..1.
RING_SPECS: list[tuple[str, RGB, float, list[tuple[float, float]]]] = [
    ("jupiter", (156, 143, 122), 0.18, [(0.0, 0.3), (0.5, 0.62)]),
    ("saturn", (216, 196, 154), 0.85, [(0.11, 0.25), (0.39, 0.45), (0.7, 0.78), (0.92, 0.96)]),
    ("uranus", (159, 191, 196), 0.12, [(0.45, 0.56)]),
    ("neptun", (138, 163, 200), 0.14, [(0.4, 0.52)]),
]

#: Breite des Ringstreifens in Pixeln.
RING_WIDTH = 256

#: Breite des weichen Uebergangs an den Lueckenraendern, in Pixeln.
RING_EDGE_SOFTNESS_PX = 2


def write_png_rgba(path: str, width: int, height: int, pixels: bytearray) -> None:
    """Schreibt 8-Bit-RGBA-PNG (color type 6) ohne externe Abhaengigkeiten.

    :param path: Zielpfad.
    :param width: Bildbreite in Pixeln.
    :param height: Bildhoehe in Pixeln.
    :param pixels: RGBA-Bytes, Laenge ``width * height * 4``.
    """
    if Image is not None:
        Image.frombytes("RGBA", (width, height), bytes(pixels)).save(path, optimize=True)
        return
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def render_ring(color: RGB, opacity: float, gaps: Sequence[tuple[float, float]],
                width: int = RING_WIDTH) -> bytearray:
    """Rendert den radialen RGBA-Verlauf eines Rings.

    Deterministisch: der einzige "Zufall" ist ein sinusfoermiger Streifen, der
    aus ``t`` berechnet wird — zwei Laeufe liefern byte-identische PNGs.

    :param color: Grundfarbe des Rings.
    :param opacity: Grunddeckkraft (0..1).
    :param gaps: Luecken als (von, bis) relativ zum Radiusintervall 0..1.
    :param width: Breite des Streifens in Pixeln.
    :returns: RGBA-Bytes, Laenge ``width * 4``.
    """
    if width < 2:
        raise ValueError(f"Ringtextur braucht Breite >= 2, ist aber {width}.")
    pixels = bytearray(width * 4)
    for x in range(width):
        t = x / (width - 1)
        in_gap = False
        soft = 1.0
        for start, end in gaps:
            if start <= t <= end:
                in_gap = True
                soft = 0.0
                break
            edge = min(abs(t - start), abs(t - end)) * (width - 1)
            if edge < RING_EDGE_SOFTNESS_PX:
                soft = min(soft, edge / RING_EDGE_SOFTNESS_PX)
        radial = 0.7 + 0.3 * t
        alpha = 0 if in_gap else int(255 * opacity * radial * soft)
        streak = 0.85 + 0.15 * math.sin(t * 47.0)
        pixels[x * 4 + 0] = min(255, int(color[0] * streak))
        pixels[x * 4 + 1] = min(255, int(color[1] * streak))
        pixels[x * 4 + 2] = min(255, int(color[2] * streak))
        pixels[x * 4 + 3] = alpha
    return pixels


def generate_ring_textures(force: bool = False) -> int:
    """Schreibt ``ring_<planet>.png`` fuer alle vier Ringplaneten.

    :param force: vorhandene Dateien ueberschreiben.
    :returns: Anzahl geschriebener Dateien.
    """
    ring_dir = os.path.join(OUT_DIR, "rings")
    os.makedirs(ring_dir, exist_ok=True)
    written = 0
    for body_id, color, opacity, gaps in RING_SPECS:
        path = os.path.join(ring_dir, f"ring_{body_id}.png")
        if os.path.exists(path) and not force:
            continue
        write_png_rgba(path, RING_WIDTH, 1, render_ring(color, opacity, gaps))
        written += 1
    return written


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def human_size(num_bytes: int) -> str:
    """Formatiert Bytes als KiB/MiB."""
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KiB"
    return f"{num_bytes / (1024 * 1024):.2f} MiB"


def main(argv: Sequence[str] | None = None) -> int:
    """CLI-Einstieg.

    :param argv: optionale Argumentliste (aus sys.argv wenn None).
    :returns: Exit-Code.
    """
    parser = argparse.ArgumentParser(
        description="Erzeugt prozedurale Equirectangular-Texturen (offline, deterministisch)."
    )
    parser.add_argument("--force", action="store_true",
                        help="vorhandene PNGs ueberschreiben")
    parser.add_argument("--list", action="store_true", help="nur Koerper-Tabelle zeigen")
    parser.add_argument("--only", action="append", default=None,
                        help="nur diese Body-IDs (mehrfach moeglich)")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.list:
        for spec in BODY_SPECS:
            print(f"{spec.body_id:<12} {spec.kind:<9} {spec.width}x{spec.height}  {spec.notes}")
        return 0

    specs = BODY_SPECS
    if args.only:
        wanted = set(args.only)
        specs = [s for s in BODY_SPECS if s.body_id in wanted]
        if not specs:
            print(f"Keine Koerper gefunden fuer: {sorted(wanted)}", file=sys.stderr)
            return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Pillow: {'ja' if Image is not None else 'nein (stdlib PNG-Writer)'}")
    print(f"Zielverzeichnis: {OUT_DIR}")
    print(f"PNG-Encoder: {'Pillow' if Image is not None else 'zlib (stdlib)'}")
    print("-" * 78)

    written = 0
    skipped = 0
    for spec in specs:
        path = os.path.join(OUT_DIR, f"{spec.body_id}.png")
        if os.path.exists(path) and not args.force:
            size = os.path.getsize(path)
            print(f"  {spec.body_id:<12} uebersprungen (existiert, {human_size(size)})")
            skipped += 1
            continue
        canvas = render(spec)
        write_png_file(path, spec.width, spec.height, canvas.data)
        size = os.path.getsize(path)
        mean = canvas.mean_color()
        print(
            f"  {spec.body_id:<12} {spec.width:>4}x{spec.height:<4} "
            f"{human_size(size):>9}  Ø-RGB=({mean[0]:>3},{mean[1]:>3},{mean[2]:>3})  seed={seed_for(spec.body_id)}"
        )
        written += 1

        # Rougheits- und Normal-Map erzeugen
        for suffix, renderer_fn in (("_roughness", render_roughness_map), ("_normal", render_normal_map)):
            map_path = os.path.join(OUT_DIR, f"{spec.body_id}{suffix}.png")
            if os.path.exists(map_path) and not args.force:
                continue
            map_canvas = renderer_fn(spec)
            write_png_file(map_path, spec.width, spec.height, map_canvas.data)

    print("-" * 78)
    print(f"{written} geschrieben, {skipped} uebersprungen, "
          f"{len(os.listdir(OUT_DIR))} Dateien in public/media/textures/")

    rings = generate_ring_textures(force=args.force)
    print(f"{rings} Ringtextur(en) in public/media/textures/rings/ "
          f"({'--force' if args.force else 'nur fehlende'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
