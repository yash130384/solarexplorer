#!/usr/bin/env python3
"""Prueft die erzeugten Texturen: PNG-Validitaet, Groesse, Farbstatistik.

Nutzt Pillow, falls vorhanden (dekodiert alle PNG-Filter), sonst den
eingebetteten Decoder, der Filter 0 (None) des eigenen Writers versteht.
"""

import os
import struct
import sys
import zlib

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None

DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "src", "assets", "textures")


def _decode_raw(raw: bytes, width: int, height: int):
    """Dekodiert PNG-Scanlines mit Filter 0 (eigener Writer) zu RGB-Bytes."""
    stride = width * 3
    out = bytearray()
    for y in range(height):
        start = y * (stride + 1)
        if raw[start] != 0:
            raise ValueError(f"unerwarteter PNG-Filter {raw[start]}")
        out += raw[start + 1:start + 1 + stride]
    return bytes(out)


def read_png(path: str):
    """Liest Groesse und mittlere RGB-Farbe einer PNG-Datei.

    :param path: Pfad zur PNG.
    :returns: (breite, hoehe, (r, g, b)).
    """
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("keine PNG-Signatur")
    pos = 8
    width = height = 0
    idat = bytearray()
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        crc = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0]
        if zlib.crc32(tag + chunk) & 0xFFFFFFFF != crc:
            raise ValueError(f"CRC-Fehler im Chunk {tag!r}")
        if tag == b"IHDR":
            width, height, depth, ctype = struct.unpack(">IIBB", chunk[:10])
            if depth != 8 or ctype != 2:
                raise ValueError(f"unerwartetes Format depth={depth} type={ctype}")
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
        pos += 12 + length

    if Image is not None:
        from PIL import ImageStat
        with Image.open(path) as img:
            img.load()
            w, h = img.size
            mean = ImageStat.Stat(img.convert("RGB")).mean
        return w, h, (int(mean[0]), int(mean[1]), int(mean[2]))

    pixels = _decode_raw(zlib.decompress(bytes(idat)), width, height)
    totals = [0, 0, 0]
    count = width * height
    for i in range(0, len(pixels), 3):
        totals[0] += pixels[i]
        totals[1] += pixels[i + 1]
        totals[2] += pixels[i + 2]
    return width, height, (totals[0] // count, totals[1] // count, totals[2] // count)


def main() -> int:
    """Prueft alle Texturen und gibt Farbkennzeichen aus.

    :returns: 0 wenn alle Plausibilitaetspruefungen bestehen, sonst 1.
    """
    files = sorted(f for f in os.listdir(DIR) if f.endswith(".png"))
    print(f"{len(files)} PNGs in {DIR}  (Decoder: {'Pillow' if Image else 'stdlib'})\n")
    print(f"{'datei':<16}{'groesse':>10}{'dim':>12}   mittlere RGB-Farbe")
    means = {}
    for name in files:
        path = os.path.join(DIR, name)
        width, height, mean = read_png(path)
        means[name[:-4]] = mean
        size = os.path.getsize(path)
        print(f"{name:<16}{size/1024:>8.1f}K{width:>6}x{height:<5}   ({mean[0]:>3},{mean[1]:>3},{mean[2]:>3})")

    print("\n--- Plausibilitaet: ist der Koerper an seiner Farbe erkennbar? ---")
    erde = means["erde"]
    jup = means["jupiter"]
    sonne = means["sonne"]
    neptun = means["neptun"]
    mond = means["mond"]
    mars = means["mars"]
    checks = [
        ("Erde:   Ozean/Kontinent-Balance, blau-dominiert (B > R, G > R)", erde[2] > erde[0] and erde[1] > erde[0]),
        ("Jupiter: beige-braune Baender (R > G > B, R > 150)", jup[0] > jup[1] > jup[2] and jup[0] > 150),
        ("Sonne:  orange-weiss (R > 200, R > G > B)", sonne[0] > 200 and sonne[0] > sonne[1] > sonne[2]),
        ("Mars:   rostrot (R > G, R > B, R > 140)", mars[0] > mars[1] and mars[0] > mars[2] and mars[0] > 140),
        ("Neptun: tiefblau (B > R)", neptun[2] > neptun[0]),
        ("Mond:   neutral grau (max - min < 45)", max(mond) - min(mond) < 45),
    ]
    failed = 0
    for label, ok in checks:
        print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
        if not ok:
            failed += 1
    if len(files) < 16:
        print(f"  [FAIL] nur {len(files)} PNGs, gefordert sind mindestens 16")
        failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
