# -*- coding: utf-8 -*-
"""
把用户制作的 hero 背景图压缩后替换 scene-bg.ts 里的 'shanghaiHero' 条目。

hero 卡实际渲染尺寸（750rpx 设计稿）：
- 宽 = 750 - 页面左右内边距 24*2 = 702rpx
- 高 ≈ 368rpx（greet 41 + title 54 + sub 48 + 间距 30 + 统计条 129 + 上下内边距 66）
- 比例 ≈ 702:368 ≈ 1.9:1，背景用 cover 填充 → 源图请按 1.9:1 制作

本脚本会把任意源图**居中裁切到 1.9:1**（与 CSS cover 的显示结果一致），
再压到 ≤115KB 后整段替换 'shanghaiHero' 条目。可重复运行。

用法：SRC_IMG = r"你的图片路径" 后运行。
"""
import base64
import io
import os
import re
import sys

from PIL import Image

# 用户制作的 hero 图：1733x907，比例 1.9107 ≈ 目标 1.9076（几乎零裁切）
SRC_IMG = r"C:\Users\陈乐天\.workbuddy\clipboard-images\clipboard-2026-09-29T08-50-37-327Z-2938d61f.jpg"
TS_PATH = os.path.join("miniprogram", "utils", "scene-bg.ts")
KEEP_AS = os.path.join("scripts", "scene-hero-user.jpg")

HERO_RATIO = 702 / 368          # ≈ 1.907
MAX_BYTES = 115 * 1024          # base64 前上限（hero 图比整屏背景小，留更足余量）
CANDIDATES = ((1404, 70), (1404, 64), (1120, 68), (1120, 62), (960, 60), (840, 58))


def encode(target_w: int, quality: int) -> bytes:
    im = Image.open(SRC_IMG).convert("RGB")
    # 居中裁切到 1.9:1（等价于 CSS cover 的显示结果）
    w, h = im.size
    if w / h > HERO_RATIO:                       # 太宽 → 裁左右
        cw = int(h * HERO_RATIO)
        x0 = (w - cw) // 2
        im = im.crop((x0, 0, x0 + cw, h))
    else:                                        # 太高 → 裁上下
        ch = int(w / HERO_RATIO)
        y0 = (h - ch) // 2
        im = im.crop((0, y0, w, y0 + ch))
    if im.size[0] > target_w:
        im = im.resize((target_w, round(target_w / HERO_RATIO)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def main() -> None:
    data = None
    for w, q in CANDIDATES:
        try:
            data = encode(w, q)
        except FileNotFoundError:
            print(f"源图不存在: {SRC_IMG}")
            return 1
        if len(data) <= MAX_BYTES:
            print(f"width={w} quality={q} bytes={len(data)} OK")
            break
    else:
        data = encode(720, 54)
        print(f"fallback 720px bytes={len(data)}")

    b64 = base64.b64encode(data).decode()
    entry = "  'shanghaiHero':\n    'data:image/jpeg;base64," + b64 + "',\n"

    src = open(TS_PATH, "r", encoding="utf-8").read()
    pat = re.compile(r"  'shanghaiHero':\n    'data:image/jpeg;base64,[A-Za-z0-9+/=]+',\n")
    if pat.search(src):
        src = pat.sub(lambda _: entry, src, count=1)
        action = "replaced"
    else:
        idx = src.rstrip().rfind("};")
        assert idx > 0, "scene-bg.ts 结构异常"
        src = src[:idx] + entry + src[idx:]
        action = "inserted"

    open(TS_PATH, "w", encoding="utf-8").write(src)
    with open(KEEP_AS, "wb") as f:
        f.write(data)

    print(f"scene-bg.ts {action}, new size: {len(src)}")
    print(f"kept: {KEEP_AS} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
