import os
from PIL import Image, ImageDraw, ImageFont
ROOT = "/Users/chenxiaoqiang/Projects/Walkaholic"
S = os.path.join(ROOT, "screenshots", "pwa")
OUT = os.path.join(ROOT, "screenshots", "surprise-showcase.png")
ENTRIES = [
    ("public-home.png", "HOME · 惊喜社区入口"),
    ("bury-done.png", "BURY · 埋下"),
    ("seek.png", "SEEK · 附近"),
    ("seek-detail.png", "SEEK · 三阶线索"),
    ("seek-shoot.png", "SEEK · 先拍后看"),
    ("public-seek-compare.png", "MATCH · 复刻对比"),
]
BG=(245,238,226); INK=(23,20,16); INK2=(107,99,87); AMBER=(232,155,76)
def font(sz):
    for p in ["/System/Library/Fonts/Hiragino Sans GB.ttc","/System/Library/Fonts/STHeiti Light.ttc"]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except: pass
    return ImageFont.load_default()
tw, th = 300, 650
gap, margin, header, cols = 24, 40, 120, 3
rows = (len(ENTRIES)+cols-1)//cols
W = margin*2 + cols*tw + (cols-1)*gap
H = header + margin + rows*(th+42) + margin
c = Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(c)
d.text((margin,32),"埋惊喜 · 寻惊喜",font=font(38),fill=INK)
d.text((margin+2,84),"v0.3 · 拍一张照片埋在某个地方，等陌生人来复刻。双方都得点数。",font=font(17),fill=INK2)
d.rectangle([(W-margin-88,40),(W-margin,66)],fill=AMBER)
for i,(n,label) in enumerate(ENTRIES):
    pth=os.path.join(S,n)
    if not os.path.exists(pth): print("skip",n); continue
    img=Image.open(pth).convert("RGB").resize((tw,th),Image.LANCZOS)
    col,row=i%cols,i//cols
    x=margin+col*(tw+gap); y=header+row*(th+42)
    mask=Image.new("L",(tw,th),0)
    ImageDraw.Draw(mask).rounded_rectangle([0,0,tw,th],radius=28,fill=255)
    c.paste(img,(x,y),mask)
    d.text((x+3,y+th+9),label,font=font(15),fill=INK2)
c.save(OUT,quality=92); print("saved",OUT,c.size)
