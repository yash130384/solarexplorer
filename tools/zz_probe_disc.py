#!/usr/bin/env python3
"""Finde die groesste helle Scheibe in /tmp/ab-*.png (Diagnose des Messfelds)."""
import sys
from pathlib import Path


def read_png(path: Path):
    """Minimales PNG-Decoder-Modul laden (zlib + struct, reiner Stdlib)."""
    import struct
    import zlib

    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "kein PNG"
    pos = 8
    width = height = 0
    bitdepth = colortype = 0
    idat = b""
    while pos < len(data):
        length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        chunk = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            width, height, bitdepth, colortype = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
        pos += 12 + length
    assert bitdepth == 8, f"bitdepth {bitdepth}"
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[colortype]
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray(width * height * channels)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if f == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return width, height, channels, out


def write_png(path: Path, width: int, height: int, channels: int, pixels) -> None:
    """Schreibt ein unkomprimiert aufgebautes RGB/RGBA-PNG (nur Diagnose)."""
    import struct
    import zlib

    colour = 2 if channels >= 3 else 0
    raw = bytearray()
    stride = width * channels
    for y in range(height):
        raw.append(0)  # Filter "none"
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    body = b"\x89PNG\r\n\x1a\n"
    body += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, colour, 0, 0, 0))
    body += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    body += chunk(b"IEND", b"")
    path.write_bytes(body)


def main() -> None:
    for name in sys.argv[1:]:
        path = Path(name)
        width, height, channels, pixels = read_png(path)
        lum = [0.0] * (width * height)
        for i in range(width * height):
            o = i * channels
            lum[i] = (
                0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]
            )

        peak = (0, 0, 0)
        for y in range(int(height * 0.15), int(height * 0.95)):
            for x in range(int(width * 0.2), int(width * 0.78)):
                v = lum[y * width + x]
                if v > peak[2]:
                    peak = (x, y, v)

        best_side, best_mean = 24, -1
        for side in range(24, 361, 8):
            half = side // 2
            s = n = 0
            for y in range(-half, half + 1, 2):
                sy = peak[1] + y
                if sy < 0 or sy >= height:
                    continue
                for x in range(-half, half + 1, 2):
                    sx = peak[0] + x
                    if sx < 0 or sx >= width:
                        continue
                    s += lum[sy * width + sx]
                    n += 1
            m = s / n if n else 0
            if m > best_mean:
                best_mean, best_side = m, side

        side = max(16, round(best_side * 0.3))
        bx, by = max(0, peak[0] - side // 2), max(0, peak[1] - side // 2)
        edge = 0.0
        n = 0
        for y in range(by, by + side):
            for x in range(bx, bx + side):
                c = lum[y * width + x]
                if x == bx or y == by or x == bx + side - 1 or y == by + side - 1:
                    continue
                e = (
                    abs(c - lum[y * width + x - 1])
                    + abs(c - lum[y * width + x + 1])
                    + abs(c - lum[(y - 1) * width + x])
                    + abs(c - lum[(y + 1) * width + x])
                ) / 4
                edge += e
                n += 1
        print(
            f"{path.name}: peak=({peak[0]},{peak[1]}) v={peak[2]:.0f} "
            f"bestSide={best_side} mean={best_mean:.1f} "
            f"box={side}@({bx},{by}) detail={edge / max(n, 1):.3f}"
        )
        # Wo liegen die hellen Pixel? Das grenzt Sonne (weiss, rund,
        # HDR) von einem Planeten (farbig) ab.
        hot = [
            (lum[y * width + x], x, y)
            for y in range(0, height, 4)
            for x in range(0, width, 4)
            if lum[y * width + x] > 200
        ]
        hot.sort(reverse=True)
        print(
            f"  helle Pixel (>200): {len(hot) * 16}, top5="
            + ", ".join(f"({x},{y})={v:.0f}" for v, x, y in hot[:5])
        )
        # Mittlere Farbe im gefundenen Feld: ein Planet ist farbig (R und B
        # unterscheiden sich), die Sonne ist weisslich (R ~ G ~ B).
        rs = bs = n2 = 0
        for y in range(by, by + side):
            for x in range(bx, bx + side):
                o = (y * width + x) * channels
                rs += pixels[o]
                bs += pixels[o + 2]
                n2 += 1
        if n2:
            print(
                f"  Feldfarbe R={rs / n2:.0f} B={bs / n2:.0f} "
                f"(R-B={rs / n2 - bs / n2:.0f})"
            )
            # Das gefundene Feld als eigenes Bild ablegen: nur so laesst sich
            # pruefen, ob die Suchroutine wirklich den Koerper oder etwas
            # anderes (Stern, Bahnlinie) erwischt hat.
            side_px = side * 2
            x0 = bx - side // 2
            y0 = by - side // 2
            crop = bytearray(side_px * side_px * channels)
            for y in range(side_px):
                for x in range(side_px):
                    sy, sx = y0 + y, x0 + x
                    if 0 <= sy < height and 0 <= sx < width:
                        src = (sy * width + sx) * channels
                        dst = (y * side_px + x) * channels
                        crop[dst : dst + channels] = pixels[src : src + channels]
            write_png(
                path.with_name(path.stem + "-disc.png"),
                side_px,
                side_px,
                channels,
                crop,
            )

    # Globaler A/B-Vergleich zweier Bilder: wo genau unterscheiden sie sich?
    if len(sys.argv) == 3:
        w1, h1, c1, p1 = read_png(Path(sys.argv[1]))
        w2, h2, c2, p2 = read_png(Path(sys.argv[2]))
        assert (w1, h1) == (w2, h2), "Bildgroessen unterscheiden sich"
        changed = []
        for y in range(h1):
            for x in range(w1):
                a = (y * w1 + x) * c1
                b = (y * w2 + x) * c2
                delta = (
                    abs(p1[a] - p2[b])
                    + abs(p1[a + 1] - p2[b + 1])
                    + abs(p1[a + 2] - p2[b + 2])
                )
                if delta > 3:
                    changed.append((x, y))
        print(
            f"\nA/B: {len(changed)} von {w1 * h1} Pixeln veraendert "
            f"({100 * len(changed) / (w1 * h1):.2f} %)"
        )
        if changed:
            xs = [c[0] for c in changed]
            ys = [c[1] for c in changed]
            print(
                f"  Bereich x {min(xs)}..{max(xs)} (mitte {(min(xs) + max(xs)) / 2:.0f}), "
                f"y {min(ys)}..{max(ys)} (mitte {(min(ys) + max(ys)) / 2:.0f})"
            )


if __name__ == "__main__":
    main()