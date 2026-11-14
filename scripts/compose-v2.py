import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, "screenshots", "v2")
OUT = os.path.join(ROOT, "screenshots", "v2-showcase.png")
ENTRIES = [("home.png","HOME"),("live.png","JOURNEY · 真实定位"),("reveal.png","REVEAL"),
           ("cards.png","CARDS"),("social.png","SOCIAL"),("profile.png","PROFILE")]
BG=(245,238,226); INK=(23,20,16); INK2=(107,99,87); AMBER=(232,155,76)
F=["/System/Library/Fonts/Hiragino Sans GB.ttc"]
def font(sz):
    for p in F:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except: pass
    return ImageFont.load_default()
tw, th = 292, 634
gap, margin, header, cols = 22, 38, 120, 3
rows = (len(ENTRIES)+cols-1)//cols
W = margin*2 + cols*tw + (cols-1)*gap
H = header + margin + rows*(th+40) + margin
c = Image.new("RGB",(W,H),BG); d = ImageDraw.Draw(c)
d.text((margin,30),"步迷 Walkaholic · v0.2",font=font(38),fill=INK)
d.text((margin+2,82),"iOS 原生 · 真实 GPS 旅程 + 手表同步 + UI 对齐 Web 原型（iPhone 18 Pro 模拟器）",font=font(17),fill=INK2)
d.rectangle([(W-margin-86,38),(W-margin,64)],fill=AMBER)
for i,(n,label) in enumerate(ENTRIES):
    p_ = os.path.join(S,n)
    if not os.path.exists(p_): print("skip",n); continue
    img = Image.open(p_).convert("RGB").resize((tw,th), Image.LANCZOS)
    col,row = i%cols, i//cols
    x = margin+col*(tw+gap); y = header+row*(th+40)
    mask = Image.new("L",(tw,th),0)
    ImageDraw.Draw(mask).rounded_rectangle([0,0,tw,th],radius=28,fill=255)
    c.paste(img,(x,y),mask)
    d.text((x+3,y+th+8),label,font=font(15),fill=INK2)
c.save(OUT,quality=92); print("saved",OUT,c.size)
