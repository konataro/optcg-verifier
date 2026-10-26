#!/usr/bin/env python3
"""
Genera los iconos PWA de OPTCG Verifier (sombrero de paja estilizado).

Salida:
    icons/icon-192.png, icons/icon-512.png            (esquina redondeada + fondo transparente)
    icons/icon-maskable-192.png, icons/icon-maskable-512.png  (fondo full-bleed, arte al 78%)

Uso:  python tools/make_icons.py
"""

from pathlib import Path

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"

BG = (13, 17, 23, 255)        # #0d1117
GOLD = (232, 179, 57, 255)    # #e8b339
GOLD_DARK = (154, 111, 22, 255)
RED = (219, 79, 61, 255)      # #db4f3d
WHITE = (240, 240, 240, 255)
DARK = (24, 28, 38, 255)

S = 512  # lienzo base, se escala a 192


def draw_straw_hat(d: ImageDraw.ImageDraw, s: int, scale: float = 1.0) -> None:
    """Dibuja el sombrero de paja centrado en un lienzo `s`.

    scale recorta el arte para el icono maskable (zona segura al 78%).
    """
    cx, cy = s / 2, s / 2 + s * 0.02
    k = scale  # multiplicador de tamaño del arte

    # sombra suave
    d.ellipse([cx - s * 0.30 * k, cy - s * 0.06 * k + s * 0.02,
               cx + s * 0.30 * k, cy + s * 0.06 * k + s * 0.02], fill=(0, 0, 0, 70))

    # brim (ala del sombrero)
    d.ellipse([cx - s * 0.30 * k, cy - s * 0.045 * k,
               cx + s * 0.30 * k, cy + s * 0.075 * k], fill=GOLD, outline=GOLD_DARK, width=max(2, int(s * 0.006)))
    # flecos inferiores del ala
    d.ellipse([cx - s * 0.30 * k, cy - s * 0.010 * k,
               cx + s * 0.30 * k, cy + s * 0.075 * k], fill=GOLD)

    # corona (copa del sombrero)
    d.ellipse([cx - s * 0.135 * k, cy - s * 0.175 * k,
               cx + s * 0.135 * k, cy + s * 0.055 * k], fill=GOLD, outline=GOLD_DARK,
              width=max(2, int(s * 0.006)))

    # banda roja: elipse roja + remate superior dorado
    d.ellipse([cx - s * 0.138 * k, cy - s * 0.062 * k,
               cx + s * 0.138 * k, cy + s * 0.012 * k], fill=RED)
    d.ellipse([cx - s * 0.135 * k, cy - s * 0.096 * k,
               cx + s * 0.135 * k, cy - s * 0.020 * k], fill=GOLD)

    # remate superior de la corona
    d.ellipse([cx - s * 0.098 * k, cy - s * 0.168 * k,
               cx + s * 0.098 * k, cy - s * 0.090 * k], fill=(244, 205, 110, 255))


def draw_star_jolly_roger(d: ImageDraw.ImageDraw, s: int) -> None:
    """Dos estrellitas blancas a los costados como guiño jolly-roger."""
    for sx in (s * 0.16, s * 0.84):
        sy = s * 0.40
        r1, r2 = s * 0.045, s * 0.018
        pts = []
        for i in range(10):
            ang = -3.14159 / 2 + i * 3.14159 / 5
            r = r1 if i % 2 == 0 else r2
            pts.append((sx + r * __import__("math").cos(ang), sy + r * __import__("math").sin(ang)))
        d.polygon(pts, fill=WHITE)


def rounded_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = size / S
    # fondo con esquinas redondeadas
    m = Image.new("L", (size, size), 0)
    dm = ImageDraw.Draw(m)
    rad = int(size * 0.18)
    dm.rounded_rectangle([0, 0, size - 1, size - 1], radius=rad, fill=255)
    bg = Image.new("RGBA", (size, size), BG)
    img.paste(bg, (0, 0), m)

    d = ImageDraw.Draw(img)
    draw_straw_hat(d, size, 1.0)
    draw_star_jolly_roger(d, size)

    # borde dorado interior
    db = ImageDraw.Draw(img)
    db.rounded_rectangle([int(size * 0.028)] * 2 + [size - int(size * 0.028)] * 2,
                         radius=int(size * 0.16), outline=GOLD, width=max(2, int(scale * 6)))
    return img


def maskable_icon(size: int) -> Image.Image:
    """Fondo full-bleed; todo el arte tiene margen a las esquinas (zona segura 78%)."""
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    draw_straw_hat(d, size, 0.72)
    draw_star_jolly_roger(d, size)
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    jobs = [
        ("icon-192.png", rounded_icon(192)),
        ("icon-512.png", rounded_icon(512)),
        ("icon-maskable-192.png", maskable_icon(192)),
        ("icon-maskable-512.png", maskable_icon(512)),
    ]
    for name, im in jobs:
        im.save(OUT / name, "PNG")
        print(f"✔ {OUT / name}")


if __name__ == "__main__":
    main()
