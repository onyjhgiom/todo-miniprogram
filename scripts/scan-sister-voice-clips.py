# -*- coding: utf-8 -*-
"""
扫描本地真人录音，生成 sister-voice-clips.ts 清单。

用法：
    1) 把真人录音放进 miniprogram/subpackages/tools/assets/astro/voices/<姐姐key>/
       姐姐 key：jujingyi / iu / alian / linghe / wanqing
       clipId 约定：greet / closing / warmth1..n / habit1..n
    2) python scripts/scan-sister-voice-clips.py
    3) 生成后，知心姐姐里同一句话会优先播放真人录音（100% 真人声音），
       没有录音的句子自动回落到云端语音合成。

可重复运行：整段重写 LOCAL_CLIPS 字面量，不产生重复条目。
"""
import os
import re
import sys

ROOT = os.path.join("miniprogram", "subpackages", "tools")
VOICE_DIR = os.path.join(ROOT, "assets", "astro", "voices")
OUT_TS = os.path.join(ROOT, "utils", "sister-voice-clips.ts")

SISTER_KEYS = ["jujingyi", "iu", "alian", "linghe", "wanqing"]
# clipId 优先顺序（同名前缀下先放核心句）
CLIP_ORDER = ["greet", "closing"]
EXTS = (".mp3", ".m4a", ".wav", ".aac")

HEADER = '''// subpackages/tools/utils/sister-voice-clips.ts
// 本地真人录音清单（自动生成，请勿手改）
//
// 用途：知心姐姐的「真人语音」优先通道。把真人录音按下面结构放进分包资源目录：
//   miniprogram/subpackages/tools/assets/astro/voices/<姐姐key>/<clipId>.mp3
// 姐姐 key：jujingyi / iu / alian / linghe / wanqing
// clipId 约定：
//   greet      开场白（对应 persona.greet）
//   closing    收尾（对应 persona.closing）
//   warmth1…n  关怀句（对应 persona.warmth 的第 n 条，从 1 开始）
//   habit1…n   生活细节（对应 persona.habit 的第 n 条）
// 放好文件后运行：python scripts/scan-sister-voice-clips.py
// 生成后，同一句话会优先播放真人录音（100% 真人声音），没有录音的句子自动回落到云端合成。

export const LOCAL_CLIPS: Record<string, Record<string, string>> = {
'''


def sort_key(clip_id: str):
    base = re.sub(r"\d+$", "", clip_id)
    if clip_id in CLIP_ORDER:
        return (0, CLIP_ORDER.index(clip_id), 0)
    if base in CLIP_ORDER:
        return (1, CLIP_ORDER.index(base), int(re.sub(r"\D", "", clip_id) or 0))
    return (2, 0, clip_id)


def main() -> None:
    lines = [HEADER]
    total = 0
    for key in SISTER_KEYS:
        d = os.path.join(VOICE_DIR, key)
        if not os.path.isdir(d):
            continue
        clips = {}
        for fn in os.listdir(d):
            stem, ext = os.path.splitext(fn)
            if ext.lower() not in EXTS:
                continue
            clips[stem] = f"/subpackages/tools/assets/astro/voices/{key}/{fn}"
        if not clips:
            continue
        lines.append(f"  '{key}': {{\n")
        for clip_id in sorted(clips.keys(), key=sort_key):
            lines.append(f"    {clip_id}: '{clips[clip_id]}',\n")
            total += 1
        lines.append("  },\n")
    lines.append("};\n")

    with open(OUT_TS, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"written {OUT_TS}, {total} clip(s) found")
    if total == 0:
        print("提示：voices/ 目录下暂无真人录音，全部句子走云端语音合成。")


if __name__ == "__main__":
    sys.exit(main())
