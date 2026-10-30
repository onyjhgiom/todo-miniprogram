# -*- coding: utf-8 -*-
"""
用用户提供的真人照片替换知心姐姐头像（480x480 JPEG，<=45KB）。

用法：改 PHOTOS 里的源图路径后运行：
    python scripts/set-sister-avatars-from-photos.py

裁剪策略：竖版人像照按「人脸通常落在高度 28% 附近」估算取景偏移，
让裁切后的正方形里人脸位于中心偏上位置；再统一缩到 480x480 并压到 45KB 以内。
"""
import os
import sys
from io import BytesIO

from PIL import Image

PHOTOS = [
    # (源图, 输出文件名，姐姐 key)
    (r"C:\Users\陈乐天\Downloads\IMG_0268(20260929-175458).PNG", "sister_jujingyi.jpg"),
    (r"C:\Users\陈乐天\Downloads\IMG_0259(20260929-174402).PNG", "sister_iu.jpg"),
]

OUT_DIR = os.path.join("miniprogram", "subpackages", "tools", "assets", "astro", "sisters")
KEEP_DIR = os.path.join("scripts", "avatar-src")
MAX_BYTES = 45 * 1024
SIDE = 480
# 估算：人脸中心在画面高度的 28% 处；裁切后面部希望落在窗口的 38% 位置
FACE_Y_RATIO = 0.28
FACE_TARGET = 0.38


def square_crop(im: Image.Image) -> Image.Image:
    w, h = im.size
    side = min(w, h)
    if w > h:
        left = (w - side) // 2
        return im.crop((left, 0, left + side, side))
    face_y = FACE_Y_RATIO * h
    top = int(face_y - FACE_TARGET * side)
    top = max(0, min(top, h - side))
    left = (w - side) // 2
    return im.crop((left, top, left + side, top + side))


def main() -> None:
    os.makedirs(KEEP_DIR, exist_ok=True)
    for src, out_name in PHOTOS:
        if not os.path.exists(src):
            print("跳过（源图不存在）：%s" % src)
            continue
        im = Image.open(src).convert("RGB")
        orig_size = im.size
        im = square_crop(im).resize((SIDE, SIDE), Image.LANCZOS)

        data = None
        for q in (90, 86, 82, 78, 74, 70):
            buf = BytesIO()
            im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
            data = buf.getvalue()
            if len(data) <= MAX_BYTES:
                print("%s: %s -> %dx%d quality=%d bytes=%d"
                      % (out_name, orig_size, SIDE, SIDE, q, len(data)))
                break

        out_path = os.path.join(OUT_DIR, out_name)
        with open(out_path, "wb") as f:
            f.write(data)
        # 源图留档，便于日后重裁剪
        with open(os.path.join(KEEP_DIR, out_name.replace(".jpg", "_src" + os.path.splitext(src)[1])), "wb") as f:
            f.write(open(src, "rb").read())
        print("written", out_path)


if __name__ == "__main__":
    sys.exit(main())
