# -*- coding: utf-8 -*-
"""压缩小程序真人头像：分包超限修复
1. 删除 sisters 目录遗留的 5 张重名 PNG 副本（与 jpg 内容相同，纯冗余）
2. 5 张姐姐头像 1024px PNG内容 -> 480x480 JPEG q80，直接覆盖 sister_*.jpg
3. 小助手头像（项目根 assets/）-> 480x480 JPEG q85 -> miniprogram/assets/helper-avatar.jpg
"""
import os
from PIL import Image

ROOT = r"C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram"
SISTERS = os.path.join(ROOT, "miniprogram", "subpackages", "tools", "assets", "astro", "sisters")
HELPER_SRC = os.path.join(ROOT, "assets", "helper-avatar.jpg")
HELPER_DST = os.path.join(ROOT, "miniprogram", "assets", "helper-avatar.jpg")

TARGET = 480
removed = []

# 1) 删除遗留重名 PNG
for name in os.listdir(SISTERS):
    if name.startswith("真实摄影风格") and name.lower().endswith(".png"):
        p = os.path.join(SISTERS, name)
        os.remove(p)
        removed.append(name)

def compress(src, dst, quality):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    if max(w, h) > TARGET:
        im = im.resize((TARGET, TARGET), Image.LANCZOS)
    im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
    return os.path.getsize(dst)

report = []
# 2) 压缩 5 张姐姐头像（覆盖原路径）
for f in sorted(os.listdir(SISTERS)):
    if f.startswith("sister_") and f.endswith(".jpg"):
        p = os.path.join(SISTERS, f)
        size = compress(p, p, 80)
        report.append((f, size))

# 3) 小助手头像 -> miniprogram/assets/
hsize = compress(HELPER_SRC, HELPER_DST, 85)

print("removed PNG duplicates:", len(removed))
for r in removed:
    print("  -", r)
print("compressed sisters:")
total = 0
for name, sz in report:
    total += sz
    print(f"  {name}: {sz/1024:.1f} KB")
print(f"sisters total: {total/1024:.1f} KB")
print(f"helper avatar: {hsize/1024:.1f} KB -> {HELPER_DST}")
