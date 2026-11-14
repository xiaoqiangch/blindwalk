#!/usr/bin/env python3
"""把 native-*.png（iPhone 18 Pro 模拟器截图）拼成 screenshots/native-showcase.png"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "screenshots")
OUT = os.path.join(SHOTS, "native-showcase.png")
ENTRIES = [
    ("native-home.png", "HOME"),
    ("native-journey.png", "JOURNEY"),
    ("native-reveal.png", "REVEAL"),
    ("native-cards.png", "CARDS"),
    ("native-social.png", "SOCIAL"),
    ("native-profile.png", "PROFILE"),
]
WATCH_ENTRIES = [
    ("native-watch-progress.png", "WATCH · PROGRESS"),
    ("native-watch-hints.png", "WATCH · HINTS"),
    ("native-watch-reveal.png", "WATCH · REVEAL"),
    ("native-watch-mine.png", "WATCH · MINE"),
]
BG = (245, 238, 226)
INK = (23, 20, 16)
INK2 = (107, 99, 87)
AMBER = (232, 155, 76)
FONTS = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
]

def font(size):
    for p in FONTS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def main():
    thumb_w, thumb_h = 300, 652
    gap, margin, header = 24, 40, 118
    cols = 3
    rows = (len(ENTRIES) + cols - 1) // cols
    watch_w, watch_h = 216, 264
    width = margin * 2 + cols * thumb_w + (cols - 1) * gap
    height = header + margin + rows * (thumb_h + 42) + 44 + watch_h + 42 + margin
    canvas = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(canvas)
    d.text((margin, 34), "步迷 Walkaholic", font=font(40), fill=INK)
    d.text((margin + 2, 84), "iOS 原生 App · Xcode 27.2 / iPhone 18 Pro 模拟器实跑截图", font=font(18), fill=INK2)
    d.rectangle([(width - margin - 90, 42), (width - margin, 70)], fill=AMBER)
    for i, (name, label) in enumerate(ENTRIES):
        path = os.path.join(SHOTS, name)
        if not os.path.exists(path):
            print("skip", name); continue
        img = Image.open(path).convert("RGB").resize((thumb_w, thumb_h), Image.LANCZOS)
        col, row = i % cols, i // cols
        x = margin + col * (thumb_w + gap)
        y = header + row * (thumb_h + 42)
        mask = Image.new("L", (thumb_w, thumb_h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, thumb_w, thumb_h], radius=30, fill=255)
        canvas.paste(img, (x, y), mask)
        d.text((x + 4, y + thumb_h + 10), label, font=font(16), fill=INK2)

    # 手表一排
    wy = header + margin + rows * (thumb_h + 42) + 44
    d.text((margin, wy - 30), "Apple Watch · Series 9 (45mm) 模拟器", font=font(16), fill=INK2)
    for i, (name, label) in enumerate(WATCH_ENTRIES):
        path = os.path.join(SHOTS, name)
        if not os.path.exists(path):
            print("skip", name); continue
        img = Image.open(path).convert("RGB").resize((watch_w, watch_h), Image.LANCZOS)
        x = margin + i * (watch_w + gap)
        mask = Image.new("L", (watch_w, watch_h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, watch_w, watch_h], radius=44, fill=255)
        canvas.paste(img, (x, wy), mask)
        d.text((x + 4, wy + watch_h + 8), label, font=font(14), fill=INK2)

    canvas.save(OUT, quality=92)
    print("saved", OUT, canvas.size)

if __name__ == "__main__":
    main()
