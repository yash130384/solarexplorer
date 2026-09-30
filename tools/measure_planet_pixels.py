"""Miest Streuung und Mittelwert im Planetenausschnitt der Sichtscreenshots.

Ein einfarbiges Material hat eine Standardabweichung nahe 0; eine
Equirectangular-Textur mit Wolkenbaendern liegt deutlich darueber. Damit ist
am Bild selbst erkennbar, ob die Textur ankommt.
"""

import sys

from PIL import Image


def analyze(path: str, crop: tuple[float, float, float, float]) -> tuple[str, ...]:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    box = image.crop(
        (
            int(width * crop[0]),
            int(height * crop[1]),
            int(width * crop[2]),
            int(height * crop[3]),
        )
    )
    pixels = list(box.getdata())
    count = len(pixels)
    average = tuple(sum(p[channel] for p in pixels) // count for channel in range(3))
    lumas = [0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in pixels]
    mean = sum(lumas) / count
    sigma = (sum((value - mean) ** 2 for value in lumas) / count) ** 0.5
    return (
        f"{path.split('/')[-1]:24s} avg RGB={average} "
        f"lum mean={mean:6.1f} sigma={sigma:5.1f} "
        f"min={min(lumas):5.1f} max={max(lumas):5.1f}"
    )


if __name__ == "__main__":
    for line in sys.argv[1:]:
        print(analyze(line, (0.34, 0.2, 0.66, 0.8)))
