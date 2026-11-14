#!/usr/bin/env python3
"""把 screenshots/ 里的单页截图拼成一张展示长图（screenshots/showcase.png）。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "screenshots")
OUT = os.path.join(SHOTS, "showcase.png")

ENTRIES = [
    ("01-home.png", "HOME"),
    ("02-setup.png", "SETUP"),
    ("03-journey.png", "JOURNEY"),
    ("04-reveal.png", "REVEAL"),
    ("05-cards.png", "CARDS"),
    ("06-social.png", "SOCIAL"),
    ("07-profile.png", "PROFILE"),
    ("08-achievements.png", "ACHIEVEMENTS"),
]

BG = (245, 238, 226)
INK = (23, 20, 16)
INK2 = (107, 99, 87)
AMBER = (232, 155, 76)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def main():
    thumb_w, thumb_h = 260, 563  # 390x844 @ 2x -> 780x1688, 缩到 1/3
    gap, margin, header = 26, 44, 128
    cols = 4
    rows = (len(ENTRIES) + cols - 1) // cols
    width = margin * 2 + cols * thumb_w + (cols - 1) * gap
    height = header + margin + rows * (thumb_h + 46) + margin

    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)

    title_font = load_font(44)
    sub_font = load_font(20)
    label_font = load_font(17)

    draw.text((margin, 38), "步迷 Walkaholic", font=title_font, fill=INK)
    draw.text((margin + 2, 92), "散步盲盒 · 交互原型  ·  不看见终点，才看得见路。", font=sub_font, fill=INK2)
    draw.rectangle([(width - margin - 96, 46), (width - margin, 76)], fill=AMBER)

    for i, (name, label) in enumerate(ENTRIES):
        path = os.path.join(SHOTS, name)
        if not os.path.exists(path):
            print("skip missing", name)
            continue
        img = Image.open(path).convert("RGB").resize((thumb_w, thumb_h), Image.LANCZOS)
        col, row = i % cols, i // cols
        x = margin + col * (thumb_w + gap)
        y = header + row * (thumb_h + 46)

        shadow = Image.new("RGBA", (thumb_w + 24, thumb_h + 24), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle([6, 8, thumb_w + 18, thumb_h + 20], radius=34, fill=(23, 20, 16, 30))
        canvas.paste(shadow, (x - 6, y - 6), shadow)

        mask = Image.new("L", (thumb_w, thumb_h), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, thumb_w, thumb_h], radius=28, fill=255)
        canvas.paste(img, (x, y), mask)

        draw.text((x + 4, y + thumb_h + 10), label, font=label_font, fill=INK2)

    canvas.save(OUT, quality=92)
    print("saved", OUT, canvas.size)


if __name__ == "__main__":
    main()
