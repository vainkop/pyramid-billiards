#!/usr/bin/env python3
"""Renders the PNG app icons (no dependencies: a tiny supersampled rasterizer + zlib).

Usage: python3 tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 3  # supersampling per axis


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shapes(full_bleed, scale=None):
    """Icon in a 0..1 coordinate space. Each shape: (test(x, y) -> bool, colour(x, y) -> rgb)."""
    k = scale if scale else (0.8 if full_bleed else 1.0)  # maskable icons keep content inside the safe zone

    def at(x, y):
        return 0.5 + (x - 0.5) * k, 0.5 + (y - 0.5) * k

    def circle(cx, cy, r):
        cx, cy = at(cx, cy)
        r *= k
        return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    def ring(cx, cy, r, w):
        cx, cy = at(cx, cy)
        r, w = r * k, w * k
        return lambda x, y: abs(math.hypot(x - cx, y - cy) - r) <= w / 2

    def shaded(cx, cy, r, inner, outer):
        gx, gy = at(cx - r * 0.3, cy - r * 0.35)
        a, b = hex_rgb(inner), hex_rgb(outer)

        def colour(x, y):
            t = min(1.0, math.hypot(x - gx, y - gy) / (r * 1.5 * k)) ** 1.3
            return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
        return colour

    def felt(x, y):
        t = min(1.0, math.hypot(x - 0.5, y - 0.4) / 0.75)
        a, b = hex_rgb("#1f7a4d"), hex_rgb("#0f3a26")
        return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

    solid = lambda c: (lambda x, y: hex_rgb(c))
    layers = [(lambda x, y: True, felt), (ring(0.5, 0.5, 0.38, 0.02), solid("#d9b36c"))]
    r = 0.085
    for cx, cy in [(0.5, 0.31), (0.41, 0.465), (0.59, 0.465), (0.32, 0.62), (0.5, 0.62), (0.68, 0.62)]:
        layers.append((circle(cx + 0.012, cy + 0.016, r), solid("#0a2417")))
        layers.append((circle(cx, cy, r), shaded(cx, cy, r, "#fffaee", "#b9a882")))
    layers.append((circle(0.5, 0.31, 0.032), solid("#b8322a")))
    return layers


def render(size, full_bleed=False, scale=None):
    layers = shapes(full_bleed, scale)
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    c = (0, 0, 0)
                    for test, colour in layers:
                        if test(x, y):
                            c = colour(x, y)
                    for i in range(3):
                        acc[i] += c[i]
            row += bytes(round(v / SS / SS) for v in acc)
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, size, bleed in [("apple-touch-icon.png", 180, False), ("icon-192.png", 192, False),
                              ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True)]:
        (OUT / name).write_bytes(render(size, bleed))
        print("wrote", name)
    # Android adaptive icon foreground: 108dp canvas, content inside the 66dp safe zone
    android = OUT.parent / "android" / "res" / "mipmap-xxxhdpi"
    android.mkdir(parents=True, exist_ok=True)
    (android / "ic_foreground.png").write_bytes(render(432, True, 0.62))
    print("wrote android foreground")
