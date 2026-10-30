# -*- coding: utf-8 -*-
"""tools 分包二次瘦身：
1. astro/audio 3 个环境音 wav 16bit -> 8bit（96KB -> ~48KB each）
2. bg_star.png / placeholder.png -> PNG 256 色量化
"""
import os, wave
from PIL import Image

ASTRO = r"C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram\miniprogram\subpackages\tools\assets\astro"
AUDIO = os.path.join(ASTRO, "audio")

# 1) wav 16bit -> 8bit unsigned PCM
import struct
for name in ("rain.wav", "forest.wav", "star.wav"):
    p = os.path.join(AUDIO, name)
    w = wave.open(p, "rb")
    n, ch, fr, sw = w.getnframes(), w.getnchannels(), w.getframerate(), w.getsampwidth()
    raw = w.readframes(n)
    w.close()
    if sw != 2:
        print(name, "skip: sampwidth", sw)
        continue
    samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
    # 16bit -> 8bit unsigned
    out = bytes((s >> 8) + 128 for s in samples)
    w8 = wave.open(p, "wb")
    w8.setnchannels(ch)
    w8.setsampwidth(1)
    w8.setframerate(fr)
    w8.writeframes(out)
    w8.close()
    print(name, "->", os.path.getsize(p) // 1024, "KB")

# 2) PNG 量化 256 色
for name in ("bg_star.png", "placeholder.png"):
    p = os.path.join(ASTRO, name)
    im = Image.open(p)
    has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
    before = os.path.getsize(p)
    if has_alpha:
        im = im.convert("RGBA").quantize(colors=256, method=Image.FASTOCTREE)
    else:
        im = im.convert("RGB").quantize(colors=256, method=Image.MEDIANCUT)
    im.save(p, "PNG", optimize=True)
    after = os.path.getsize(p)
    print(name, im.mode, before // 1024, "->", after // 1024, "KB, alpha:", has_alpha)
