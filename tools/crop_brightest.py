"""Schneidet die hellste Region aus einem Screenshot heraus.

Der Planet steht nicht immer in der Bildmitte (die Kamera folgt dem
Schiff), deshalb wird zuerst das hellste 120x120-Quadrat gesucht. Das
Ergebnis wird als `<name>-crop.png` neben der Eingabe geschrieben und ist
zum Anschauen gedacht.
"""

import sys

from PIL import Image


def brightest_crop(path: str, size: int) -> str:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    step = 10
    box_size = max(4, size // max(1, width // (width // 4)))
    best_mean = -1.0
    best = (0, 0)
    for y in range(0, height - box_size, step):
        for x in range(0, width - box_size, step):
            region = image.crop((x, y, x + box_size, y + box_size))
            pixels = list(region.get_flattened_data())
            mean = sum(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in pixels) / len(pixels)
            if mean > best_mean:
                best_mean = mean
                best = (x, y)
    crop = image.crop(
        (
            max(0, best[0] - size // 2),
            max(0, best[1] - size // 2),
            min(width, best[0] + size // 2 + box_size),
            min(height, best[1] + size // 2 + box_size),
        )
    )
    out = path.replace(".png", "-crop.png")
    crop.save(out)
    return f"{out} @ {best} box={box_size} mean={best_mean:.1f}"


if __name__ == "__main__":
    for argument in sys.argv[1:]:
        print(brightest_crop(argument, 400))
