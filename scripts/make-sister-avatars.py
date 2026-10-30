# -*- coding: utf-8 -*-
"""
把生成的插画头像处理成小程序头像规格（480x480 JPEG，约 30KB），
写入 miniprogram/subpackages/tools/assets/astro/sisters/。

- 居中裁成正方形（避免人物变形）
- 缩放到 480x480
- JPEG 质量自适应，控制在 ~40KB 内
"""
import glob
import os
import sys

from PIL import Image

SRC_DIR = os.path.join("scripts", "avatar-tmp")
OUT_DIR = os.path.join("miniprogram", "subpackages", "tools", "assets", "astro", "sisters")

# (源图关键词, 输出文件名)
JOBS = [
    ("年轻女艺人", "sister_jujingyi.jpg"),
    ("年轻女歌手", "sister_iu.jpg"),
]

MAX_BYTES = 45 * 1024


def pick_src(keyword: str) -> str:
    cands = sorted(glob.glob(os.path.join(SRC_DIR, "*%s*.png" % keyword)))
    if not cands:
        raise SystemExit("未找到源图：%s" % keyword)
    return cands[-1]


def main() -> None:
    for keyword, out_name in JOBS:
        src = pick_src(keyword)
        im = Image.open(src).convert("RGB")
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        top = max(0, int((h - side) * 0.28))  # 略微上移取景，让脸落在中部
        im = im.crop((left, top, left + side, top + side)).resize((480, 480), Image.LANCZOS)

        out_path = os.path.join(OUT_DIR, out_name)
        data = None
        for q in (90, 86, 82, 78, 74):
            from io import BytesIO
            buf = BytesIO()
            im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
            data = buf.getvalue()
            if len(data) <= MAX_BYTES:
                print("%s: quality=%d bytes=%d" % (out_name, q, len(data)))
                break
        with open(out_path, "wb") as f:
            f.write(data)
        print("written", out_path)


if __name__ == "__main__":
    sys.exit(main())
