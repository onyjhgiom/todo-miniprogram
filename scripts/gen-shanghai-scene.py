# -*- coding: utf-8 -*-
"""
「深海蓝金 · 上海」场景 v3 —— 夜幕版（对齐效果图）：
A. 页面背景 scene-shanghai.jpg（640x1136）：蓝紫夜幕 + 外滩历史建筑群金色灯火（左）
   + 远处现代天际线（右，隐约）+ 路灯暖光 + 江面金蓝倒影。
B. hero 内嵌 scene-lujiazui-hero.jpg（640x420）：陆家嘴夜景，明珠球粉紫辉光，
   楼群蓝青窗灯，底部水面倒影，左侧渐暗留给文字。
两张图都 base64 注入 utils/scene-bg.ts（'shanghai' / 'shanghaiHero'，可重复运行整段替换）。
"""
import base64
import io
import random
from PIL import Image, ImageDraw, ImageFilter

random.seed(20260929)
W, H = 640, 1136


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(dr, y0, y1, stops, total=None):
    total = total or (y1 - y0)
    for y in range(y0, y1):
        t = (y - y0) / total
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                c = lerp(c0, c1, (t - p0) / (p1 - p0))
                break
        dr.line([(0, y), (W, y)], fill=c)


def inject(name, data):
    b64 = base64.b64encode(data).decode()
    entry = "  '%s':\n    'data:image/jpeg;base64,%s',\n" % (name, b64)
    path = 'miniprogram/utils/scene-bg.ts'
    src = open(path, 'r', encoding='utf-8').read()
    marker = "  '%s':" % name
    if marker in src:
        start = src.index(marker)
        end = src.index("',\n", start) + 3
        src = src[:start] + entry + src[end:]
        print('%s replaced' % name)
    else:
        idx = src.rstrip().rfind('};')
        assert idx > 0
        src = src[:idx] + entry + src[idx:]
        print('%s patched' % name)
    open(path, 'w', encoding='utf-8').write(src)


# =====================================================================
# A. 页面背景：夜幕外滩
# =====================================================================
img = Image.new('RGB', (W, H))
dr = ImageDraw.Draw(img, 'RGBA')

BUND_BASE = 800    # 外滩建筑基线（江面起点）
SKY_END = 700      # 远景天际线基线

# 1) 夜空：蓝 → 蓝紫（比 v2 更夜、带一点紫调）
vgrad(dr, 0, SKY_END, [
    (0.00, (8, 13, 34)),
    (0.30, (15, 26, 58)),
    (0.58, (28, 42, 84)),
    (0.80, (46, 52, 102)),   # 紫调
    (1.00, (64, 62, 112)),
])

# 星子（克制，上半夜空）
for _ in range(90):
    sx = random.randint(0, W)
    sy = random.randint(10, 420)
    a = random.randint(30, 90)
    dr.point([(sx, sy), (sx + 1, sy)], fill=(210, 220, 240, a))

# 2) 远景现代天际线（浦东，右侧，隐约蓝黑 + 少量窗灯）
far = Image.new('RGBA', (W, H), (0, 0, 0, 0))
fd = ImageDraw.Draw(far)
x = -10
while x < W + 10:
    w = random.randint(18, 48)
    h = random.randint(24, 70)
    fd.rectangle([x, SKY_END - h, x + w, SKY_END], fill=(18, 26, 52, 200))
    if random.random() < 0.5:
        fd.rectangle([x + random.randint(2, w - 4), SKY_END - h + 4,
                      x + w - 2, SKY_END - 4], fill=(90, 130, 180, 40))
    x += w + random.randint(3, 12)
far = far.filter(ImageFilter.GaussianBlur(1.4))
img.paste(far, (0, 0), far)
dr = ImageDraw.Draw(img, 'RGBA')

# 3) 外滩历史建筑群（左侧，金色灯火——画面的暖光主体）
bund = Image.new('RGBA', (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(bund)
bx = -8
while bx < 400:
    w = random.randint(34, 66)
    h = random.randint(100, 190)
    top = BUND_BASE - h
    bd.rectangle([bx, top, bx + w, BUND_BASE], fill=(24, 24, 34, 255))      # 剪影体
    # 立面暖光洗刷（灯火把石立面照亮——效果图的「金色外滩」观感）
    bd.rectangle([bx, top, bx + w, BUND_BASE], fill=(120, 88, 52, 92))
    bd.rectangle([bx, top, bx + w, top + h // 3], fill=(150, 110, 62, 60))  # 上段更亮
    # 立面窗灯：密排暖金小窗（外滩夜景的灵魂）
    for wy in range(top + 8, BUND_BASE - 6, 10):
        for wx in range(bx + 4, bx + w - 4, 8):
            if random.random() < 0.9:
                a = random.randint(150, 240)
                bd.rectangle([wx, wy, wx + 4, wy + 5], fill=(242, 192, 116, a))
    # 檐口金线（受光顶缘）
    bd.line([(bx, top), (bx + w, top)], fill=(244, 200, 130, 200), width=2)
    # 穹顶（约 1/4 概率，外滩意象）
    if random.random() < 0.25:
        r = max(8, w // 3)
        bd.pieslice([bx + w // 2 - r, top - r, bx + w // 2 + r, top + r],
                    180, 360, fill=(30, 28, 38, 255))
        bd.arc([bx + w // 2 - r, top - r, bx + w // 2 + r, top + r],
               180, 360, fill=(244, 200, 130, 160), width=2)
    bx += w + random.randint(2, 8)

# 海关钟楼（标志性：塔身 + 时钟面 + 旗杆）
cx = 408
bd.rectangle([cx - 16, BUND_BASE - 210, cx + 16, BUND_BASE], fill=(24, 24, 34, 255))
for wy in range(BUND_BASE - 200, BUND_BASE - 8, 10):
    for wx in range(cx - 12, cx + 10, 8):
        if random.random() < 0.72:
            bd.rectangle([wx, wy, wx + 3, wy + 4], fill=(238, 186, 110, random.randint(110, 210)))
bd.ellipse([cx - 9, BUND_BASE - 236, cx + 9, BUND_BASE - 218], fill=(244, 208, 140, 235))  # 钟面发光
bd.rectangle([cx - 12, BUND_BASE - 244, cx + 12, BUND_BASE - 234], fill=(26, 26, 38, 255)) # 钟层檐
bd.line([(cx, BUND_BASE - 244), (cx, BUND_BASE - 274)], fill=(26, 26, 38, 255), width=3)
bund = bund.filter(ImageFilter.GaussianBlur(0.6))
img.paste(bund, (0, 0), bund)
# 外滩整体灯火晕染（建筑群后方一层暖金 bloom，模拟夜空灯光散射）
bloom = Image.new('RGBA', (W, H), (0, 0, 0, 0))
bld = ImageDraw.Draw(bloom)
bld.rectangle([-30, 640, 430, BUND_BASE + 10], fill=(196, 140, 76, 44))
bld.rectangle([-30, 690, 430, BUND_BASE], fill=(214, 156, 88, 40))
bloom = bloom.filter(ImageFilter.GaussianBlur(26))
img.paste(bloom, (0, 0), bloom)
dr = ImageDraw.Draw(img, 'RGBA')

# 右岸现代楼群（中景，蓝调、稀疏窗灯，与左侧暖金对比）
mid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
md = ImageDraw.Draw(mid)
mx = 470
while mx < W + 20:
    w = random.randint(30, 60)
    h = random.randint(70, 150)
    top = BUND_BASE - h
    md.rectangle([mx, top, mx + w, BUND_BASE], fill=(16, 22, 42, 235))
    for _ in range(random.randint(10, 18)):
        wxl = mx + random.randint(3, max(4, w - 5))
        wyl = top + random.randint(4, max(5, h - 8))
        md.rectangle([wxl, wyl, wxl + 2, wyl + 2],
                     fill=(120, 160, 205, random.randint(50, 120)))
    md.line([(mx + w, top), (mx + w, BUND_BASE)], fill=(150, 140, 180, 90), width=1)
    mx += w + random.randint(6, 20)
mid = mid.filter(ImageFilter.GaussianBlur(0.8))
img.paste(mid, (0, 0), mid)
dr = ImageDraw.Draw(img, 'RGBA')

# 3.5) 右侧中景：可辨识的陆家嘴地标群（明珠/上海中心/环金/金茂，蓝调剪影+灯窗）
LB = Image.new('RGBA', (W, H), (0, 0, 0, 0))
lbd = ImageDraw.Draw(LB)
lb = (14, 22, 44, 245)
# 上海中心（最高，收分折面）
lbd.polygon([(486, BUND_BASE), (548, BUND_BASE), (536, 610), (520, 578), (506, 600)], fill=lb)
for i in range(6):
    yy = 620 + i * 30
    k = (yy - 578) / (BUND_BASE - 578)
    lbd.line([(520 - (1 - k) * 10, yy), (536 + k * 5, yy)], fill=(70, 120, 170, 100), width=1)
lbd.line([(548, BUND_BASE), (536, 610)], fill=(150, 200, 235, 120), width=2)
# 环球金融中心（斜顶+方孔）
lbd.rectangle([558, 640, 594, BUND_BASE], fill=lb)
lbd.polygon([(558, 656), (576, 640), (594, 654), (594, 660)], fill=lb)
lbd.rectangle([571, 668, 581, 690], fill=(44, 66, 100, 255))
lbd.line([(594, BUND_BASE), (594, 654)], fill=(150, 200, 235, 110), width=1)
# 金茂（节节收分）
yy = BUND_BASE
for cx3, w3 in [(618, 30), (622, 25), (626, 20)]:
    lbd.rectangle([cx3 - w3 // 2, yy - 22, cx3 + w3 // 2, yy], fill=lb)
    yy -= 22
lbd.line([(626, yy), (626, yy - 14)], fill=lb, width=2)
# 东方明珠（右侧稍远，球体带粉紫微光）
px2 = 452
pg2 = Image.new('RGBA', (W, H), (0, 0, 0, 0))
pgd2 = ImageDraw.Draw(pg2)
for r, a in [(34, 70), (20, 110)]:
    pgd2.ellipse([px2 - 9 - r, 640 - r, px2 + 9 + r, 640 + r], fill=(210, 110, 190, a))
pg2 = pg2.filter(ImageFilter.GaussianBlur(8))
LB.paste(pg2, (0, 0), pg2)
lbd = ImageDraw.Draw(LB)
pc2 = (26, 30, 58, 245)
lbd.line([(px2, BUND_BASE), (px2, 686)], fill=pc2, width=3)
lbd.line([(px2 - 8, BUND_BASE), (px2 - 2, 712)], fill=pc2, width=2)
lbd.line([(px2 + 8, BUND_BASE), (px2 + 2, 712)], fill=pc2, width=2)
lbd.ellipse([px2 - 10, 710, px2 + 10, 728], fill=pc2)
lbd.ellipse([px2 - 7, 714, px2 + 7, 725], fill=(206, 100, 180, 200))
lbd.ellipse([px2 - 6, 672, px2 + 6, 684], fill=pc2)
lbd.ellipse([px2 - 4, 674, px2 + 4, 682], fill=(222, 120, 196, 220))
lbd.line([(px2, 672), (px2, 650)], fill=pc2, width=2)
LB = LB.filter(ImageFilter.GaussianBlur(0.6))
img.paste(LB, (0, 0), LB)
dr = ImageDraw.Draw(img, 'RGBA')

# 4) 路灯（右岸，暖光球 + 光晕——效果图的点睛；远处再补两盏小的）
LP = Image.new('RGBA', (W, H), (0, 0, 0, 0))
lpd = ImageDraw.Draw(LP)
lx = 576
lpd.line([(lx, BUND_BASE - 4), (lx, BUND_BASE - 150)], fill=(30, 30, 44, 255), width=4)
lpd.line([(lx, BUND_BASE - 150), (lx - 14, BUND_BASE - 160)], fill=(30, 30, 44, 255), width=3)
lpd.ellipse([lx - 22, BUND_BASE - 172, lx - 6, BUND_BASE - 156], fill=(250, 214, 140, 255))
for r, a in [(64, 70), (110, 40), (170, 22)]:
    lpd.ellipse([lx - 14 - r, BUND_BASE - 164 - r, lx - 14 + r, BUND_BASE - 164 + r],
                fill=(244, 196, 120, a))
LP = LP.filter(ImageFilter.GaussianBlur(2))
img.paste(LP, (0, 0), LP)
dr = ImageDraw.Draw(img, 'RGBA')

# 远处小灯柱（江岸节奏感，左中右各一，弱光晕）
for sx, sy, r in [(240, BUND_BASE - 96, 26), (360, BUND_BASE - 88, 20), (620, BUND_BASE - 104, 22)]:
    dr.line([(sx, BUND_BASE - 4), (sx, sy)], fill=(24, 24, 36, 255), width=2)
    dr.ellipse([sx - 4, sy - 6, sx + 4, sy + 2], fill=(240, 200, 130, 230))
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd2 = ImageDraw.Draw(g)
    gd2.ellipse([sx - r, sy - r, sx + r, sy + r], fill=(240, 196, 120, 46))
    g = g.filter(ImageFilter.GaussianBlur(6))
    img.paste(g, (0, 0), g)
dr = ImageDraw.Draw(img, 'RGBA')

# 5) 黄浦江：暗蓝底 + 外滩金色倒影（强）+ 右侧蓝倒影（弱）
vgrad(dr, BUND_BASE, H, [
    (0.00, (30, 44, 74)),
    (0.14, (20, 32, 58)),
    (0.50, (10, 20, 40)),
    (1.00, (5, 10, 22)),
])
refl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
rd = ImageDraw.Draw(refl)
# 金色倒影柱（外滩灯火方向 x<420，密、长、暖）
for sx in range(16, 420, 26):
    y = BUND_BASE + 4
    while y < BUND_BASE + random.randint(180, 320):
        seg = random.randint(10, 30)
        off = random.randint(-6, 6)
        fade = max(0.12, 1 - (y - BUND_BASE) / 340)
        a = int(random.randint(30, 62) * fade)
        rd.rectangle([sx + off, y, sx + off + random.randint(3, 6), y + seg],
                     fill=(236, 182, 106, a))
        y += seg + random.randint(5, 14)
# 钟面金倒影（醒目一道）
for k in range(6):
    yy = BUND_BASE + 6 + k * 22
    a = int(90 * (1 - k / 6))
    rd.rectangle([cx - 6, yy, cx + 6, yy + 12], fill=(246, 204, 132, a))
# 蓝色倒影（右半，天光与冷楼）
for sx in range(440, W, 34):
    y = BUND_BASE + 6
    while y < BUND_BASE + random.randint(120, 220):
        seg = random.randint(8, 24)
        off = random.randint(-5, 5)
        fade = max(0.12, 1 - (y - BUND_BASE) / 260)
        a = int(random.randint(22, 46) * fade)
        rd.rectangle([sx + off, y, sx + off + random.randint(2, 5), y + seg],
                     fill=(110, 150, 200, a))
        y += seg + random.randint(6, 16)
# 江面碎光
for _ in range(160):
    rx = random.randint(0, W)
    ry = random.randint(BUND_BASE + 8, H - 16)
    ln = random.randint(5, 26)
    warm = random.random() < (0.75 if rx < 430 else 0.25)
    fade = max(0.18, 1 - (ry - BUND_BASE) / (H - BUND_BASE))
    col = (238, 186, 112, int(random.randint(24, 64) * fade)) if warm else \
          (122, 162, 210, int(random.randint(16, 48) * fade))
    rd.line([(rx, ry), (rx + ln, ry)], fill=col, width=1)
refl = refl.filter(ImageFilter.GaussianBlur(2.6))
img.paste(refl, (0, 0), refl)
dr = ImageDraw.Draw(img, 'RGBA')

# 游船（江面点睛：深色船身 + 两层暖金舷窗，航灯微红；船下拖出金色倒影）
ship = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sd2 = ImageDraw.Draw(ship)
SY2 = 918
SX2 = 210
sd2.polygon([(SX2, SY2 - 16), (SX2 + 128, SY2 - 16), (SX2 + 118, SY2), (SX2 + 10, SY2)],
            fill=(10, 12, 22, 255))                                   # 船身
sd2.rectangle([SX2 + 14, SY2 - 34, SX2 + 108, SY2 - 16], fill=(16, 18, 30, 255))  # 上层
sd2.rectangle([SX2 + 30, SY2 - 46, SX2 + 88, SY2 - 34], fill=(16, 18, 30, 255))   # 驾驶层
for wy in (SY2 - 27, SY2 - 39):
    for wx in range(SX2 + 22, SX2 + 100, 9):
        sd2.rectangle([wx, wy, wx + 4, wy + 5], fill=(244, 196, 118, 235))  # 舷窗
sd2.ellipse([SX2 + 56, SY2 - 54, SX2 + 64, SY2 - 46], fill=(120, 200, 235, 200))  # 顶灯
sd2.ellipse([SX2 + 4, SY2 - 22, SX2 + 9, SY2 - 17], fill=(230, 90, 80, 220))      # 航灯
ship = ship.filter(ImageFilter.GaussianBlur(0.5))
img.paste(ship, (0, 0), ship)
dr = ImageDraw.Draw(img, 'RGBA')
# 船的倒影（暖金短柱，随波抖动）
sref = Image.new('RGBA', (W, H), (0, 0, 0, 0))
srd = ImageDraw.Draw(sref)
for k in range(7):
    yy = SY2 + 4 + k * 10
    a = int(70 * (1 - k / 7))
    srd.rectangle([SX2 + 24 + random.randint(-4, 4), yy, SX2 + 104 + random.randint(-4, 4), yy + 5],
                  fill=(240, 192, 116, a))
sref = sref.filter(ImageFilter.GaussianBlur(2))
img.paste(sref, (0, 0), sref)
dr = ImageDraw.Draw(img, 'RGBA')

# 薄雾（江面与天际线交界处的轻雾带，蓝白低透，柔化衔接）
mist = Image.new('RGBA', (W, H), (0, 0, 0, 0))
md2 = ImageDraw.Draw(mist)
for y0, h0, a in [(SKY_END - 26, 44, 26), (BUND_BASE - 10, 52, 34), (BUND_BASE + 46, 40, 22)]:
    for _ in range(9):
        mw = random.randint(160, 420)
        mx0 = random.randint(-80, W - 40)
        md2.ellipse([mx0, y0, mx0 + mw, y0 + h0], fill=(150, 170, 205, random.randint(a // 2, a)))
mist = mist.filter(ImageFilter.GaussianBlur(12))
img.paste(mist, (0, 0), mist)

# 滨岸步道栏杆剪影（近岸一条深色横带 + 细栏杆，增加真实纵深）
dr.rectangle([0, BUND_BASE - 6, W, BUND_BASE + 2], fill=(8, 12, 24, 255))

# 6) 顶部压暗（导航/标题可读）
dark = Image.new('RGBA', (W, H), (0, 0, 0, 0))
dd = ImageDraw.Draw(dark)
for y in range(0, 240):
    dd.line([(0, y), (W, y)], fill=(6, 10, 24, int(96 * (1 - y / 240))))
dark = dark.filter(ImageFilter.GaussianBlur(4))
img.paste(dark, (0, 0), dark)

out = io.BytesIO()
img.save(out, 'JPEG', quality=60, optimize=True)
dataA = out.getvalue()
print('page JPEG bytes:', len(dataA))
with open('scripts/scene-shanghai.jpg', 'wb') as f:
    f.write(dataA)
# ⚠️ 'shanghai' 页面背景已于 2026-09-29 换成用户提供的实景照片
# （scripts/swap-shanghai-user-photo.py 注入）。此处不再写回，
# 避免重跑本脚本时把程序化绘制的旧图覆盖掉用户照片。
# inject('shanghai', dataA)

# =====================================================================
# B. hero 内嵌：陆家嘴夜景（640x420，左暗右城，明珠球粉紫辉光）
# =====================================================================
HW, HH = 640, 420
himg = Image.new('RGB', (HW, HH))
hdr = ImageDraw.Draw(himg, 'RGBA')

WLINE = 356  # 水面线
vgrad(hdr, 0, WLINE, [
    (0.00, (9, 14, 36)),
    (0.34, (16, 27, 60)),
    (0.66, (30, 40, 84)),
    (1.00, (52, 50, 100)),   # 城市后方紫晕
])

# 城市辉光（楼群背后的紫蓝光晕）
glow = Image.new('RGBA', (HW, HH), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for r, a in [(240, 30), (170, 44), (110, 60)]:
    gd.ellipse([450 - r, 240 - r, 450 + r, 240 + r], fill=(70, 70, 150, a))
glow = glow.filter(ImageFilter.GaussianBlur(24))
himg.paste(glow, (0, 0), glow)
hdr = ImageDraw.Draw(himg, 'RGBA')

body = (12, 20, 42)
# 远排楼
fx = 250
while fx < HW + 10:
    w = random.randint(16, 40)
    h = random.randint(40, 110)
    hdr.rectangle([fx, WLINE - h, fx + w, WLINE], fill=(15, 24, 48, 230))
    fx += w + random.randint(2, 8)

# 上海中心（最高，收分）
hdr.polygon([(470, WLINE), (536, WLINE), (524, 120), (508, 84), (494, 108)], fill=body)
hdr.line([(536, WLINE), (524, 120)], fill=(120, 200, 235, 150), width=2)
for i in range(7):
    yy = 130 + i * 30
    k = (yy - 84) / (WLINE - 84)
    hdr.line([(508 - (1 - k) * 12, yy), (524 + k * 6, yy)], fill=(60, 110, 150, 110), width=1)
# 环球金融中心（斜顶方孔）
hdr.rectangle([552, 150, 592, WLINE], fill=body)
hdr.polygon([(552, 168), (572, 150), (592, 166), (592, 172)], fill=body)
hdr.rectangle([566, 180, 578, 206], fill=(40, 60, 95))
hdr.line([(592, WLINE), (592, 166)], fill=(120, 200, 235, 130), width=2)
# 金茂（节节收分）
yy = WLINE
for cx2, w2 in [(606, 40), (610, 34), (614, 28), (617, 22)]:
    hdr.rectangle([cx2 - w2 // 2, yy - 26, cx2 + w2 // 2, yy], fill=body)
    yy -= 26
hdr.line([(617, yy), (617, yy - 18)], fill=body, width=2)

# 东方明珠（粉紫辉光球体——hero 的视觉焦点）
PX = 452
pg = Image.new('RGBA', (HW, HH), (0, 0, 0, 0))
pgd = ImageDraw.Draw(pg)
for r, a in [(70, 60), (46, 95), (28, 140)]:
    pgd.ellipse([PX - 15 - r, 150 - r, PX + 15 + r, 150 + r], fill=(226, 110, 200, a))
pg = pg.filter(ImageFilter.GaussianBlur(10))
himg.paste(pg, (0, 0), pg)
hdr = ImageDraw.Draw(himg, 'RGBA')
pc = (30, 30, 58)
hdr.line([(PX, WLINE), (PX, 236)], fill=pc, width=4)
hdr.line([(PX - 11, WLINE), (PX - 3, 262)], fill=pc, width=2)
hdr.line([(PX + 11, WLINE), (PX + 3, 262)], fill=pc, width=2)
hdr.ellipse([PX - 14, 238, PX + 14, 266], fill=pc)
hdr.ellipse([PX - 10, 244, PX + 10, 260], fill=(214, 96, 186, 220))      # 下球辉光
hdr.ellipse([PX - 9, 140, PX + 9, 158], fill=pc)
hdr.ellipse([PX - 7, 143, PX + 7, 155], fill=(236, 130, 210, 235))       # 上球辉光
hdr.line([(PX, 140), (PX, 108)], fill=pc, width=2)
hdr.ellipse([PX - 2, 103, PX + 2, 110], fill=(236, 130, 210, 200))

# 楼群窗灯（蓝青为主 + 少量暖）
for _ in range(220):
    wx = random.randint(260, HW - 4)
    wy = random.randint(90, WLINE - 6)
    cool = random.random() < 0.72
    col = (110, 190, 230, random.randint(50, 150)) if cool else (240, 190, 120, random.randint(50, 140))
    hdr.rectangle([wx, wy, wx + random.choice([1, 2]), wy + 1], fill=col)

# 水面：暗蓝 + 青金倒影
vgrad(hdr, WLINE, HH, [
    (0.00, (26, 40, 70)),
    (0.40, (12, 22, 44)),
    (1.00, (5, 10, 24)),
])
hr = Image.new('RGBA', (HW, HH), (0, 0, 0, 0))
hd = ImageDraw.Draw(hr)
for sx, col in [(452, (216, 110, 190)), (502, (90, 160, 210)), (556, (90, 160, 210)),
                (604, (90, 160, 210)), (380, (90, 160, 210)), (330, (240, 190, 120))]:
    y = WLINE + 3
    while y < WLINE + random.randint(40, 70):
        seg = random.randint(6, 16)
        off = random.randint(-4, 4)
        fade = max(0.15, 1 - (y - WLINE) / 80)
        a = int(random.randint(30, 60) * fade)
        hd.rectangle([sx + off, y, sx + off + 3, y + seg], fill=col + (a,))
        y += seg + random.randint(4, 10)
for _ in range(60):
    rx = random.randint(0, HW)
    ry = random.randint(WLINE + 4, HH - 6)
    a = random.randint(20, 50)
    hd.line([(rx, ry), (rx + random.randint(4, 18), ry)],
            fill=(130, 170, 215, a) if random.random() < 0.6 else (236, 180, 120, a), width=1)
hr = hr.filter(ImageFilter.GaussianBlur(2))
himg.paste(hr, (0, 0), hr)

# 左侧渐暗（文字区可读性）
lshade = Image.new('RGBA', (HW, HH), (0, 0, 0, 0))
lsd = ImageDraw.Draw(lshade)
for x in range(0, 300):
    a = int(150 * (1 - x / 300))
    lsd.line([(x, 0), (x, HH)], fill=(8, 14, 32, a))
lshade = lshade.filter(ImageFilter.GaussianBlur(6))
himg.paste(lshade, (0, 0), lshade)

out = io.BytesIO()
himg.save(out, 'JPEG', quality=62, optimize=True)
dataB = out.getvalue()
print('hero JPEG bytes:', len(dataB))
with open('scripts/scene-lujiazui-hero.jpg', 'wb') as f:
    f.write(dataB)
inject('shanghaiHero', dataB)
