// subpackages/tools/utils/sister-voice-clips.ts
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
};
