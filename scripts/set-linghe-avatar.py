# -*- coding: utf-8 -*-
"""用用户提供的 IMG_0277 照片生成张凌赫头像（480x480，替换苏念）。
可重复运行：直接覆盖输出文件。"""
import io, os, glob, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # todo-miniprogram
SRC_GLOB = r'C:\Users\陈乐天\Downloads\IMG_0277*'
OUT = os.path.join(ROOT, 'miniprogram', 'subpackages', 'tools', 'assets', 'astro', 'sisters', 'sister_linghe.jpg')

srcs = glob.glob(SRC_GLOB)
assert srcs, 'IMG_0277 源图不存在'
src = srcs[0]
im = Image.open(src).convert('RGB')
w, h = im.size
# 方裁：以宽为边，人脸偏上取景（顶部留白 28%）
side = w
top = int((h - side) * 0.28)
top = max(0, min(top, h - side))
im2 = im.crop((0, top, side, top + side)).resize((480, 480), Image.LANCZOS)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
im2.save(OUT, 'JPEG', quality=82)
print('AVATAR_OK', os.path.basename(src), im.size, '->', os.path.basename(OUT), im2.size, os.path.getsize(OUT), 'B')
