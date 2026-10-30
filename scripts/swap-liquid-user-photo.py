# -*- coding: utf-8 -*-
"""
把用户提供的上海日景照片压缩后注入 scene-bg.ts 的 'liquid' 条目（液态金属主题整屏背景）。

- 始终保持原图宽高比（不做 cover 裁切）
- 可重复运行：正则整段替换 'liquid' 条目，不产生重复
- 换图只需改 SRC_IMG 后运行
"""
import base64
import io
import os
import re
import sys

from PIL import Image

# 当前使用的图：853x1844 ≈ 9:19.5（手机全屏比例，上海日景）
SRC_IMG = r"C:\Users\陈乐天\.workbuddy\clipboard-images\clipboard-2026-09-29T09-05-13-877Z-f795469a.jpg"
TS_PATH = os.path.join("miniprogram", "utils", "scene-bg.ts")
KEEP_AS = os.path.join("scripts", "scene-liquid-user.jpg")

MAX_BYTES = 115 * 1024  # base64 前上限，兼顾主包体积
# (目标宽度, 质量) 从高到低尝试，保持原始宽高比
CANDIDATES = ((640, 62), (600, 58), (560, 56), (560, 54), (520, 58), (520, 52))


def encode(target_w: int, quality: int) -> bytes:
    im = Image.open(SRC_IMG).convert("RGB")
    w, h = im.size
    im = im.resize((target_w, round(h * target_w / w)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def main() -> None:
    data = None
    for w, q in CANDIDATES:
        data = encode(w, q)
        if len(data) <= MAX_BYTES:
            print(f"width={w} quality={q} bytes={len(data)} OK")
            break
    else:
        data = encode(480, 52)
        print(f"fallback 480px bytes={len(data)}")

    out_size = Image.open(io.BytesIO(data)).size
    print("final size:", out_size, "ratio", round(out_size[0] / out_size[1], 4))

    b64 = base64.b64encode(data).decode()
    entry = "  'liquid':\n    'data:image/jpeg;base64," + b64 + "',\n"

    src = open(TS_PATH, "r", encoding="utf-8").read()
    pat = re.compile(r"  'liquid':\n    'data:image/jpeg;base64,[A-Za-z0-9+/=]+',\n")
    if pat.search(src):
        src = pat.sub(lambda _: entry, src, count=1)
        action = "replaced"
    else:
        idx = src.rstrip().rfind("};")
        assert idx > 0, "scene-bg.ts 结构异常"
        src = src[:idx] + entry + src[idx:]
        action = "inserted"

    open(TS_PATH, "w", encoding="utf-8").write(src)

    # 成品留档：效果稿脚本直接复用，避免重复压缩
    with open(KEEP_AS, "wb") as f:
        f.write(data)

    print(f"scene-bg.ts {action}, new size: {len(src)}")
    print(f"kept: {KEEP_AS} ({len(data)} bytes)")


if __name__ == "__main__":
    sys.exit(main())
