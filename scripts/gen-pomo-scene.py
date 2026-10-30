# -*- coding: utf-8 -*-
"""
「晴空云海 · 番茄时钟」页面场景背景（对齐参照图）。

产出：
  scripts/pomo-scene.jpg            预览用原图
  miniprogram/subpackages/pomodoro/utils/pomo-bg.ts   供页面内联 background-image 使用

为什么走 base64 而不是 <image> / 本地路径：
  · WXSS 的 background-image **不支持本地文件路径**（iOS 真机必现空白）；
  · <image mode="aspectFill"> 做全屏铺底时与 fixed 层叠配合在部分机型上会闪。
  项目既有做法（utils/scene-bg.ts）就是把场景图 base64 成 data URI 直接写进
  background-image，所有 webview 都稳，这里沿用同一套。

画面（自下而上）：
  暖调薄雾 → 云海 → 远山两层 → 城市天际线（陆家嘴四件套）→ 积云 → 晴空白昼渐变。
整体保持**高明度、低对比**：画面只负责氛围，卡片与圆环负责信息，
所以没有一处深色块，深色文字压在哪些位置都够读。
"""
import base64
import io
import os
import random
from PIL import Image, ImageDraw, ImageFilter

random.seed(20261007)

W, H = 750, 1624
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(SCRIPT_DIR)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(dr, y0, y1, stops, total=None):
    """竖向渐变。stops = [(位置 0~1, RGB), ...]，按整幅高度归一化。"""
    total = total or (y1 - y0)
    for y in range(y0, y1):
        t = (y - y0) / total
        c = stops[-1][1]
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                span = (p1 - p0) or 1
                c = lerp(c0, c1, (t - p0) / span)
                break
        dr.line([(0, y), (W, y)], fill=c)


def cloud_layer(boxes, blur, fill, cap=255):
    """若干椭圆先并成**实心**形状，再模糊边缘，最后按 cap 压上限贴回。

    【为什么不能直接画半透明椭圆】直接画 alpha≈100 的椭圆，重叠区会叠到更亮、
    单个椭圆的边沿只有一层 → 云看起来是「空心环 + 灰描边」。正确做法是：
    形状实心 → 模糊出软边 → 统一压到目标透明度，云才是「软边实心白」。
    """
    mask = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(mask)
    for (x0, y0, x1, y1, _a) in boxes:
        md.ellipse([x0, y0, x1, y1], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(blur))
    if cap < 255:
        mask = mask.point(lambda v: min(255, v * cap // 255))
    lay = Image.new('RGBA', (W, H), fill + (0,))
    lay.putalpha(mask)
    return lay


def puff(cx, cy, w, h, alpha, blobs=7, blur=None):
    """生成一朵蓬松积云的椭圆组合（alpha 作为最终透明度上限）。"""
    boxes = [(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, alpha)]
    for _ in range(blobs):
        rw = random.uniform(0.28, 0.62) * w
        rh = random.uniform(0.5, 1.15) * h
        bx = cx + random.uniform(-0.42, 0.42) * w
        by = cy - random.uniform(0.05, 0.42) * h
        boxes.append((bx - rw / 2, by - rh / 2, bx + rw / 2, by + rh / 2, alpha))
    return boxes, blur or max(3.0, w * 0.035)


# =====================================================================
# 1) 天空底：晴昼蓝 → 近地暖白（右上更暖，夕阳方向）
# =====================================================================
img = Image.new('RGB', (W, H), (255, 255, 255))
dr = ImageDraw.Draw(img, 'RGBA')

# 【必须整幅铺满】只画到 SKY_BOTTOM 会在该行留下一条硬缝
# （上半走渐变、下半还是初始白底）。渐变的「近地暖白」端值就是画面中段的底色，
# 一路铺到底即可，底部再由 0.90H 起的收白层覆盖。
vgrad(dr, 0, H, [
    (0.00, (106, 156, 224)),
    (0.10, (128, 174, 231)),
    (0.24, (162, 198, 237)),
    (0.40, (194, 216, 241)),
    (0.55, (220, 229, 240)),
    (0.68, (240, 236, 232)),
    (0.80, (250, 243, 231)),
    (1.00, (254, 246, 233)),
])
SKY_BOTTOM = int(H * 0.72)  # 只有语义含义：天空雾霭与山峦的分界参考线

# 右上方暖阳：一层极淡的金色径向（参照图右侧有夕阳感）
sun = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(sun)
for r, a in [(300, 34), (210, 46), (130, 62), (72, 84)]:
    sd.ellipse([W * 0.86 - r, H * 0.20 - r, W * 0.86 + r, H * 0.20 + r],
               fill=(255, 226, 176, a))
sun = sun.filter(ImageFilter.GaussianBlur(40))
img.paste(sun, (0, 0), sun)
dr = ImageDraw.Draw(img, 'RGBA')

# =====================================================================
# 2) 城市天际线（陆家嘴四件套，远景，蓝灰剪影）
# =====================================================================
CITY_BASE = int(H * 0.585)
city = Image.new('RGBA', (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(city)
SIL = (92, 116, 152)
SIL_D = (72, 94, 130)

# 左中一圈普通楼群（低矮、整齐）
bx = -6
while bx < W + 10:
    bw = random.randint(14, 34)
    bh = random.randint(16, 52)
    cd.rectangle([bx, CITY_BASE - bh, bx + bw, CITY_BASE], fill=SIL_D + (188,))
    bx += bw + random.randint(2, 9)

# 上海中心（最高、收分折面）
cd.polygon([(392, CITY_BASE), (444, CITY_BASE), (436, CITY_BASE - 126),
            (424, CITY_BASE - 152), (412, CITY_BASE - 128)], fill=SIL + (216,))
cd.line([(444, CITY_BASE), (436, CITY_BASE - 126)], fill=(196, 216, 240, 150), width=2)

# 环球金融中心（斜顶 + 方孔）
cd.rectangle([452, CITY_BASE - 108, 486, CITY_BASE], fill=SIL + (216,))
cd.polygon([(452, CITY_BASE - 92), (469, CITY_BASE - 108), (486, CITY_BASE - 94),
            (486, CITY_BASE - 88)], fill=SIL + (216,))
cd.rectangle([465, CITY_BASE - 76, 474, CITY_BASE - 56], fill=(150, 176, 208, 190))

# 金茂大厦（节节收分）
yy = CITY_BASE
for cxx, ww in [(512, 30), (515, 25), (518, 20), (521, 15)]:
    cd.rectangle([cxx - ww // 2, yy - 20, cxx + ww // 2, yy], fill=SIL + (216,))
    yy -= 20
cd.line([(521, yy), (521, yy - 12)], fill=SIL + (216,), width=2)

# 东方明珠（三球塔，参照图最醒目的地标）
PX = 356
cd.line([(PX, CITY_BASE), (PX, CITY_BASE - 74)], fill=SIL_D + (226,), width=3)
cd.line([(PX - 9, CITY_BASE), (PX - 3, CITY_BASE - 56)], fill=SIL_D + (226,), width=2)
cd.line([(PX + 9, CITY_BASE), (PX + 3, CITY_BASE - 56)], fill=SIL_D + (226,), width=2)
cd.ellipse([PX - 11, CITY_BASE - 90, PX + 11, CITY_BASE - 68], fill=(150, 176, 210, 224))
cd.ellipse([PX - 17, CITY_BASE - 34, PX + 17, CITY_BASE - 2], fill=(150, 176, 210, 216))
cd.line([(PX, CITY_BASE - 90), (PX, CITY_BASE - 108)], fill=SIL_D + (226,), width=2)
cd.ellipse([PX - 2, CITY_BASE - 114, PX + 2, CITY_BASE - 108], fill=(160, 186, 218, 214))

# 右侧再补两座现代塔（层次）
for cxx, ww, hh in [(600, 34, 86), (648, 28, 62), (700, 40, 96)]:
    cd.rectangle([cxx, CITY_BASE - hh, cxx + ww, CITY_BASE], fill=SIL_D + (196,))
    cd.line([(cxx + ww, CITY_BASE - hh), (cxx + ww, CITY_BASE)],
            fill=(200, 220, 244, 120), width=1)
city = city.filter(ImageFilter.GaussianBlur(1.1))
img.paste(city, (0, 0), city)
dr = ImageDraw.Draw(img, 'RGBA')

# 城市后方的晨光晕（把天际线托起来，避免剪影显得脏）
bloom = Image.new('RGBA', (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(bloom)
bd.rectangle([-40, CITY_BASE - 150, W + 40, CITY_BASE + 26], fill=(255, 244, 224, 86))
bloom = bloom.filter(ImageFilter.GaussianBlur(34))
img.paste(bloom, (0, 0), bloom)
dr = ImageDraw.Draw(img, 'RGBA')

# =====================================================================
# 3) 云海：城市脚下的一整片云（参照图最关键的氛围元素）
# =====================================================================
# 城市脚下的一整片云海（把城市托起来）
sea = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sea_boxes = []
for _ in range(44):
    cw = random.randint(190, 440)
    cy = random.randint(CITY_BASE - 34, CITY_BASE + 118)
    cx = random.randint(-90, W + 20)
    ch = random.randint(36, 92)
    sea_boxes.append((cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2, 0))
sea = cloud_layer(sea_boxes, 22, (255, 255, 255), cap=178)
img.paste(sea, (0, 0), sea)
dr = ImageDraw.Draw(img, 'RGBA')

# =====================================================================
# 4) 远山两层（蓝紫低对比，压在云海下沿；锯齿状山脊才像山）
# =====================================================================
def ridge(y_base, amp, color, alpha, blur, seed, n=24):
    rnd = random.Random(seed)
    pts = []
    x = 0
    while x < W:
        step = rnd.randint(26, 86)
        x = min(W, x + step)
        # 相邻峰高低错落，造出尖锐山脊
        h = amp * (0.30 + 0.70 * rnd.random())
        pts.append((x, y_base - h))
    pts = [(0, y_base + 20)] + pts + [(W, y_base + 20)]
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    ld.polygon(pts, fill=color + (alpha,))
    return lay.filter(ImageFilter.GaussianBlur(blur))


img.paste(ridge(int(H * 0.745), 132, (126, 144, 190), 150, 1.7, 7), (0, 0),
          ridge(int(H * 0.745), 132, (126, 144, 190), 150, 1.7, 7))
img.paste(ridge(int(H * 0.815), 150, (104, 122, 172), 178, 1.2, 23), (0, 0),
          ridge(int(H * 0.815), 150, (104, 122, 172), 178, 1.2, 23))
dr = ImageDraw.Draw(img, 'RGBA')

# 两层山之间的雾带：否则两排山脊之间会露出一条暖调横带，像沙丘
mist_boxes = []
for _ in range(22):
    cw = random.randint(320, 600)
    cy = random.randint(int(H * 0.77), int(H * 0.87))
    cx = random.randint(-140, W + 40)
    ch = random.randint(40, 86)
    mist_boxes.append((cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2, 0))
mist = cloud_layer(mist_boxes, 30, (255, 255, 255), cap=196)
img.paste(mist, (0, 0), mist)
dr = ImageDraw.Draw(img, 'RGBA')

# 山体下沿再接一层云，让山「从云里长出来」
lowsea = Image.new('RGBA', (W, H), (0, 0, 0, 0))
lsd = ImageDraw.Draw(lowsea)
for _ in range(34):
    cw = random.randint(300, 560)
    cy = random.randint(int(H * 0.82), int(H * 0.94))
    cx = random.randint(-140, W + 40)
    ch = random.randint(64, 132)
    lsd.ellipse([cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2],
                fill=(255, 255, 255, random.randint(140, 220)))
lowsea = lowsea.filter(ImageFilter.GaussianBlur(32))
img.paste(lowsea, (0, 0), lowsea)
dr = ImageDraw.Draw(img, 'RGBA')

# 画面底部收白（底部导航与卡片都压在这里，需要最亮最干净）
vgrad(dr, int(H * 0.90), H, [
    (0.00, (251, 252, 255)),
    (0.45, (252, 253, 256)),
    (1.00, (246, 248, 253)),
], total=H - int(H * 0.90))

# =====================================================================
# 5) 天空积云（参照图上半部有几朵轮廓清楚的云）
#    两遍：先一层低透大云铺氛围，再一层稍实的小云定轮廓。
#    透明度刻意压在 150 以下 —— 云压过 0.6 就会变成硬边白块，很假。
# =====================================================================
SKY_CLOUDS = [
    (110, 196, 210, 46, 92),
    (628, 286, 192, 40, 84),
    (418, 132, 148, 30, 74),
    (232, 404, 176, 36, 96),
    (676, 486, 208, 42, 88),
    (58, 572, 186, 38, 90),
    (498, 596, 236, 46, 104),
    (300, 268, 158, 32, 70),
    (742, 128, 132, 28, 66),
]
for (cx, cy, cw, ch, alpha) in SKY_CLOUDS:
    boxes, blur = puff(cx, cy, cw * 1.35, ch * 1.7, alpha, blobs=8)
    lay = cloud_layer(boxes, blur, (255, 255, 255), cap=alpha)
    img.paste(lay, (0, 0), lay)
    dr = ImageDraw.Draw(img, 'RGBA')

# 极淡的高层卷云（拉长的低透薄片，给天空一点层次，不抢戏）
for _ in range(7):
    cy = random.randint(60, 520)
    cx = random.randint(0, W)
    cw = random.randint(220, 420)
    ch = random.randint(14, 30)
    wisp = cloud_layer([(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2, 0)],
                       16, (255, 255, 255), cap=random.randint(40, 66))
    img.paste(wisp, (0, 0), wisp)

# 顶部轻纱（让状态栏 / 标题区更干净，文字对比度更稳）
veil = Image.new('RGBA', (W, H), (0, 0, 0, 0))
vd = ImageDraw.Draw(veil)
for y in range(0, int(H * 0.20)):
    a = int(48 * (1 - y / (H * 0.20)))
    vd.line([(0, y), (W, y)], fill=(255, 255, 255, a))
veil = veil.filter(ImageFilter.GaussianBlur(10))
img.paste(veil, (0, 0), veil)

# =====================================================================
# 输出
# =====================================================================
out = io.BytesIO()
img.save(out, 'JPEG', quality=72, optimize=True, progressive=True)
data = out.getvalue()
print('scene JPEG bytes:', len(data), '(%.1f KB)' % (len(data) / 1024))

with open(os.path.join(SCRIPT_DIR, 'pomo-scene.jpg'), 'wb') as f:
    f.write(data)

b64 = base64.b64encode(data).decode()
ts = '''// subpackages/pomodoro/utils/pomo-bg.ts
// 番茄时钟页面场景背景（base64 data URI，由 scripts/gen-pomo-scene.py 生成，请勿手改）。
//
// 【为什么是 base64 而不是本地图片路径】
// WXSS 的 background-image 不支持本地文件路径（iOS 真机直接空白），
// <image> 全屏铺底与 fixed 层叠在部分机型上会闪。项目既有做法（utils/scene-bg.ts）
// 就是把场景图 base64 成 data URI 内联进 background-image，所有 webview 都稳。
//
// 【改图流程】改 scripts/gen-pomo-scene.py → 重跑脚本 → 本文件被整段覆盖。
//
// 图幅 750×1624（即设计稿 rpx 坐标系），内容：晴昼天空 + 积云 + 远山 +
// 陆家嘴天际线 + 云海，整体高明度低对比，只负责氛围，不抢卡片与圆环。

/** 番茄时钟场景背景 data URI */
export const POMO_BG: string =
  'data:image/jpeg;base64,%s';
''' % b64

dst = os.path.join(PROJ, 'miniprogram', 'subpackages', 'pomodoro', 'utils', 'pomo-bg.ts')
with open(dst, 'w', encoding='utf-8') as f:
    f.write(ts)
print('wrote', dst, os.path.getsize(dst), 'bytes')
