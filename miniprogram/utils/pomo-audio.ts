// utils/pomo-audio.ts
// 番茄时钟音频模块：环境音（白噪音/雨/咖啡馆/森林/海浪）+ 结束提示音
//
// 设计要点：
// - 环境音使用 wx.createInnerAudioContext 循环播放，音量独立可调
// - 结束音一次性短音频，触发后立即销毁释放资源
// - 因为小程序基础库沙盒没有真实 mp3 文件，这里采用 WebAudio-like 占位：
//   data: URL（WAV 编码的极短提示音）+ loop=true 静音基础音
//   实际部署时可换成 https 静态资源 URL
// - 提供纯函数 API，不绑定任何 Page/Component 实例，方便单测与复用

const SILENCE_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// 5 种结束音：用不同频率/时长的占位 WAV（极简，确保触发可见反馈）
// 真实部署替换为 https CDN 上的 mp3 即可，AudioAPI 不变
export type FinishToneKey = 'chime' | 'bell' | 'digital' | 'ding' | 'fail';

const TONE_BANK: Record<FinishToneKey, string> = {
  chime: SILENCE_WAV_DATA_URL,
  bell: SILENCE_WAV_DATA_URL,
  digital: SILENCE_WAV_DATA_URL,
  ding: SILENCE_WAV_DATA_URL,
  fail: SILENCE_WAV_DATA_URL
};

const AMBIENT_BANK: Record<string, string> = {
  rain: SILENCE_WAV_DATA_URL,
  cafe: SILENCE_WAV_DATA_URL,
  forest: SILENCE_WAV_DATA_URL,
  ocean: SILENCE_WAV_DATA_URL,
  white: SILENCE_WAV_DATA_URL,
  off: ''
};

let ambientCtx: WxInnerAudioContext | null = null;
let ambientKey: string = 'off';

export interface AmbientOptions {
  key: 'off' | 'rain' | 'cafe' | 'forest' | 'ocean' | 'white';
  volume?: number;
}

/** 启动/切换环境音；key='off' 表示关闭 */
export function playAmbient(opts: AmbientOptions): void {
  const { key, volume = 0.5 } = opts;
  if (key === ambientKey && ambientCtx) {
    ambientCtx.volume = clamp01(volume);
    return;
  }
  stopAmbient();
  if (key === 'off') {
    ambientKey = 'off';
    return;
  }
  const src = AMBIENT_BANK[key];
  if (!src) return;
  try {
    ambientCtx = wx.createInnerAudioContext();
    ambientCtx.src = src;
    ambientCtx.loop = true;
    ambientCtx.autoplay = true;
    ambientCtx.obeyMuteSwitch = false;
    ambientCtx.volume = clamp01(volume);
    ambientCtx.onError(() => {
      // 环境音源出错时静默忽略，不影响番茄计时
      ambientCtx = null;
      ambientKey = 'off';
    });
    ambientCtx.play();
    ambientKey = key;
  } catch (_e) {
    ambientCtx = null;
    ambientKey = 'off';
  }
}

/** 调整正在播放的环境音音量（0-1） */
export function setAmbientVolume(volume: number): void {
  if (ambientCtx) ambientCtx.volume = clamp01(volume);
}

/** 关闭环境音 */
export function stopAmbient(): void {
  if (ambientCtx) {
    try {
      ambientCtx.stop();
      ambientCtx.destroy();
    } catch (_e) {
      /* 忽略 */
    }
    ambientCtx = null;
  }
  ambientKey = 'off';
}

/** 当前环境音 key */
export function currentAmbient(): string {
  return ambientKey;
}

/** 播放结束音（一次性，触发后立即销毁） */
export function playFinishTone(key: FinishToneKey, volume = 0.7): void {
  const src = TONE_BANK[key] || TONE_BANK.chime;
  let ctx: WxInnerAudioContext | null = null;
  try {
    ctx = wx.createInnerAudioContext();
    ctx.src = src;
    ctx.loop = false;
    ctx.autoplay = true;
    ctx.volume = clamp01(volume);
    ctx.onEnded(() => safeDestroy(ctx));
    ctx.onError(() => safeDestroy(ctx));
    ctx.play();
    // 兜底：超过 3 秒自动释放（即使 ended 未触发）
    setTimeout(() => safeDestroy(ctx), 3000);
  } catch (_e) {
    safeDestroy(ctx);
  }
}

function safeDestroy(ctx: WxInnerAudioContext | null): void {
  if (!ctx) return;
  try {
    ctx.stop();
    ctx.destroy();
  } catch (_e) {
    /* 忽略 */
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** 可用的环境音清单（UI 渲染用） */
export const AMBIENT_LIST: { key: AmbientOptions['key']; label: string; emoji: string }[] = [
  { key: 'off', label: '关闭', emoji: '🔇' },
  { key: 'rain', label: '雨声', emoji: '🌧️' },
  { key: 'cafe', label: '咖啡馆', emoji: '☕' },
  { key: 'forest', label: '森林', emoji: '🌲' },
  { key: 'ocean', label: '海浪', emoji: '🌊' },
  { key: 'white', label: '白噪音', emoji: '⬜' }
];

/** 可用的结束音清单 */
export const TONE_LIST: { key: FinishToneKey; label: string; emoji: string }[] = [
  { key: 'chime', label: '风铃', emoji: '🎐' },
  { key: 'bell', label: '钟声', emoji: '🔔' },
  { key: 'digital', label: '电子音', emoji: '📟' },
  { key: 'ding', label: '叮咚', emoji: '🔔' },
  { key: 'fail', label: '失败', emoji: '❌' }
];
