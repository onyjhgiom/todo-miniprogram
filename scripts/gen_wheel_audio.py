# -*- coding: utf-8 -*-
"""生成万能转盘的三个轻量音效（16bit PCM WAV，16kHz 单声道，总计 <50KB）。

  tick.wav     滴答：指针扫过扇区边界，25ms 短脉冲
  ding.wav     叮：  停下时的提示音，0.45s 铃声（880 + 1320Hz 叠加衰减）
  confetti.wav 撒花：0.7s 噪声爆发 + 上行滑音，配合彩带动画

运行：python scripts/gen_wheel_audio.py
"""
import math
import os
import random
import struct
import wave

RATE = 16000
OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'miniprogram', 'subpackages', 'tools', 'assets', 'wheel', 'audio'
)


def write(name, samples):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    # 削波保护
    data = []
    for s in samples:
        v = max(-1.0, min(1.0, s))
        data.append(int(v * 32000))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack('<%dh' % len(data), *data))
    print('%s  %.1f KB  %.0f ms' % (name, os.path.getsize(path) / 1024.0, len(data) * 1000.0 / RATE))


def tick():
    """25ms 滴答：1.6kHz 方波脉冲 + 极快衰减，尾部带一点噪声让声音更「机械」"""
    n = int(RATE * 0.025)
    out = []
    for i in range(n):
        t = i / RATE
        env = math.exp(-t * 190.0)
        sq = 1.0 if math.sin(2 * math.pi * 1600 * t) >= 0 else -1.0
        noise = (random.random() * 2 - 1) * 0.25
        out.append((sq * 0.75 + noise) * env * 0.6)
    return out


def ding():
    """0.45s 铃声：880 / 1320 / 1760Hz 三音叠加，指数衰减"""
    n = int(RATE * 0.45)
    out = []
    for i in range(n):
        t = i / RATE
        env = math.exp(-t * 6.0) * (1.0 - math.exp(-t * 400.0))
        s = (
            math.sin(2 * math.pi * 880 * t) * 0.6
            + math.sin(2 * math.pi * 1320 * t) * 0.3
            + math.sin(2 * math.pi * 1760 * t) * 0.15
        )
        out.append(s * env * 0.75)
    return out


def confetti():
    """0.7s 撒花：白噪爆发（带通感）+ 上行滑音，尾巴轻快"""
    n = int(RATE * 0.7)
    out = []
    last = 0.0
    for i in range(n):
        t = i / RATE
        env = math.exp(-t * 4.2) * (1.0 - math.exp(-t * 120.0))
        white = random.random() * 2 - 1
        # 一阶高通，去掉低频轰鸣，听起来更像「纸屑哗啦」
        hp = white - last
        last = white
        # 上行滑音 660 → 1320Hz
        f = 660 + 660 * min(1.0, t / 0.35)
        tone = math.sin(2 * math.pi * f * t) * 0.25
        out.append((hp * 0.55 + tone) * env * 0.7)
    return out


if __name__ == '__main__':
    random.seed(20260920)
    write('tick.wav', tick())
    write('ding.wav', ding())
    write('confetti.wav', confetti())
