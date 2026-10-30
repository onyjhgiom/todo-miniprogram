# -*- coding: utf-8 -*-
"""用 IMG_0275 替换 IU 头像：智能方裁（人脸偏上取景）→ 480x480"""
import io
from PIL import Image

SRC = r'C:\Users\陈乐天\Downloads\IMG_0275(20260929-181234).PNG'
DST = r'C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram\miniprogram\subpackages\tools\assets\astro\sisters\sister_iu.jpg'

im = Image.open(SRC).convert('RGB')
W, H = im.size
side = min(W, H)
# 竖版照片：人脸通常在上 1/3，从偏上位置取方框
top = int((H - side) * 0.28) if H > W else 0
left = int((W - side) * 0.5) if W > H else 0
im2 = im.crop((left, top, left + side, top + side)).resize((480, 480), Image.LANCZOS)
im2.save(DST, 'JPEG', quality=84, optimize=True)
import os
print('IU_OK', os.path.getsize(DST), 'B')
