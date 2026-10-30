// subpackages/tools/utils/sister-voice.ts
// 知心姐姐 · 真人语音发送能力
//
// 能力边界（关键设计）：
//   1) 每条语音消息都绑定一份「声音来源」元数据（sister.voice：音色 ID / 音色名 / 引擎 / 语速…），
//      语音条上会显示「谁的音色 · 什么引擎」，不会出现"不知道谁在说话"的情况。
//   2) 语音内容 = 该条消息的正文，朗读前只做**朗读性清洗**（去动作旁白、emoji、韩文等），
//      不增删任何语义 —— 保证"语音与文字在人设上完全一致"。
//   3) 真人录音包优先：若 assets/astro/voices/<姐姐key>/ 下放了真人录音
//      （清单见 sister-voice-clips.ts，由 scripts/scan-sister-voice-clips.py 生成），
//      则同一句优先播真人录音（100% 真人声音）；没有才走云端合成。
//   4) 云端合成走 tts 云函数（腾讯云 TextToVoice）：前端不持有任何密钥。

import type { SisterVoice } from './astro-data';
import { LOCAL_CLIPS } from './sister-voice-clips';

export interface SpeechResult {
  /** 落盘后的本地音频文件（可能多段，按顺序播放） */
  files: string[];
  /** 估算时长（秒），用于语音条长度 */
  durationSec: number;
  /** 实际朗读的文本（已清洗） */
  text: string;
  /** 是否来自本地真人录音包 */
  fromLocalClip: boolean;
}

export interface PlayCallbacks {
  /** 某一段开始播放 */
  onSegment?: (index: number, total: number) => void;
  /** 全部播完 */
  onEnded?: () => void;
  /** 播放出错（文件丢失 / 解码失败） */
  onError?: (msg: string) => void;
}

/* ==================== 可用性 ==================== */

export function isSpeechAvailable(): boolean {
  try {
    return !!(wx.cloud && typeof wx.cloud.callFunction === 'function');
  } catch (e) {
    return false;
  }
}

/* ==================== 朗读文本清洗（与云函数同一套规则） ==================== */

/**
 * 清洗规则只做"念不出来的部分"过滤，保证语音与文字语义一致：
 *   （动作旁白）/ emoji / 韩文日文 / 多余符号 → 去掉
 */
export function cleanForSpeech(text: string): string {
  let t = String(text || '');
  t = t.replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ');
  t = t.replace(/\[[^\]]*\]/g, ' ').replace(/【[^】]*】/g, ' ');
  t = t.replace(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g, '');
  t = t.replace(/[\u3040-\u30FF]/g, '');
  t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  t = t.replace(/[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u2600-\u26FF]/g, '');
  t = t.replace(/[~～^_*=#>`"']/g, ' ');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^[，。！？、；：,.!?;:]+/, '');
  return t.trim();
}

/** 估算朗读时长：中文约 4.2 字/秒，语速参数 0 表示 1.0 倍 */
export function estimateDuration(text: string, speed?: number): number {
  const len = cleanForSpeech(text).length;
  const rate = 4.2 * (1 + (typeof speed === 'number' ? speed : 0) * 0.2);
  return Math.max(1, Math.round((len / Math.max(2.6, rate)) * 10) / 10);
}

/* ==================== 本地真人录音包 ==================== */

/**
 * 取本地真人录音（若存在）。
 * clipId 约定：'greet' | 'closing' | 'warmth1'… 具体见 scripts/scan-sister-voice-clips.py 生成的清单。
 */
export function localClipFor(sisterKey: string, clipId: string): string {
  const bag = (LOCAL_CLIPS as Record<string, Record<string, string>>)[sisterKey];
  if (!bag) return '';
  return bag[clipId] || '';
}

/* ==================== 缓存 ==================== */

const CACHE_KEY = 'sister_voice_cache_v1';
const MAX_CACHE = 60;

interface CacheEntry {
  files: string[];
  dur: number;
  voiceType: number;
  ts: number;
}
type CacheMap = Record<string, CacheEntry>;

function loadCache(): CacheMap {
  try {
    const v = wx.getStorageSync(CACHE_KEY);
    return v && typeof v === 'object' ? (v as CacheMap) : {};
  } catch (e) {
    return {};
  }
}

function saveCache(map: CacheMap): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_CACHE) {
      keys
        .sort((a, b) => map[a].ts - map[b].ts)
        .slice(0, keys.length - MAX_CACHE)
        .forEach((k) => delete map[k]);
    }
    wx.setStorageSync(CACHE_KEY, map);
  } catch (e) {
    /* 忽略：缓存失败不影响播放 */
  }
}

/** 简单的字符串散列，用作缓存 key */
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '_' + s.length.toString(36);
}

/* ==================== 合成 ==================== */

interface TtsCloudResult {
  /** 云函数返回字段（与 WxCloudCallFunctionResult 兼容，故均为可选） */
  success?: boolean;
  message?: string;
  segments?: string[];
  mime?: string;
}

/** 把底层云调用错误翻译成用户能看懂、知道该做什么的提示 */
export function friendlyTtsError(raw: string): string {
  const s = raw || '';
  if (/-501000|FunctionName|not\s*found|not\s*exist|ECLOUDFUNCTIONNOTFOUND/i.test(s)) {
    return '语音云函数未部署：开发者工具右键 cloudfunctions/tts → 上传并部署';
  }
  if (/SECRET|AuthFailure|Signature|InvalidCredential|UnAuth/i.test(s)) {
    return '语音服务密钥未配置：请在 tts 云函数环境变量填 TENCENT_SECRET_ID / KEY';
  }
  if (/timeout|ECONNRESET|ECONNREFUSED/i.test(s)) return '语音服务网络超时，请稍后再试';
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

/** 是否属于「云函数没部署」类错误（页面据此把语音置为待部署态） */
export function isDeployError(raw: string): boolean {
  return /-501000|FunctionName|not\s*found|not\s*exist|ECLOUDFUNCTIONNOTFOUND/i.test(raw || '');
}

function callTts(text: string, voice: SisterVoice): Promise<string[]> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'tts',
      data: {
        text,
        voiceType: voice.voiceType,
        speed: voice.speed,
        volume: voice.volume,
        sampleRate: voice.sampleRate,
        emotion: voice.emotion || '',
        codec: 'mp3'
      },
      success: (res: { result?: TtsCloudResult }) => {
        const r = res && res.result;
        if (r && r.success && r.segments && r.segments.length) {
          resolve(r.segments);
        } else {
          reject(new Error((r && r.message) || '语音合成失败'));
        }
      },
      fail: (err: { errMsg?: string }) => reject(new Error(friendlyTtsError((err && err.errMsg) || '语音服务调用失败')))
    });
  });
}

function writeBase64File(base64: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    fs.writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(),
      fail: (err: { errMsg?: string }) => reject(new Error((err && err.errMsg) || '音频写入失败'))
    });
  });
}

/** 文件是否还在（用户清理缓存后需要重新合成） */
function fileExists(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager();
    fs.access({
      path: filePath,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function userDir(): string {
  try {
    return wx.env.USER_DATA_PATH || '';
  } catch (e) {
    return '';
  }
}

/**
 * 合成姐姐的一条语音（带缓存）。
 * @param text    消息正文
 * @param voice   声音来源（来自姐姐人设）
 * @param opts.clipId    本地真人录音的标识（有则优先使用）
 * @param opts.sisterKey 姐姐 key，用于查本地录音包
 */
export function synthesizeSisterVoice(
  text: string,
  voice: SisterVoice,
  opts?: { clipId?: string; sisterKey?: string; forceCloud?: boolean }
): Promise<SpeechResult> {
  const spoken = cleanForSpeech(text);
  if (!spoken) return Promise.reject(new Error('这条消息没有可朗读的内容'));

  // 1) 本地真人录音包优先（真正的真人声音）
  if (!opts || !opts.forceCloud) {
    const clip =
      opts && opts.sisterKey && opts.clipId ? localClipFor(opts.sisterKey, opts.clipId) : '';
    if (clip) {
      return Promise.resolve({
        files: [clip],
        durationSec: estimateDuration(spoken, voice.speed),
        text: spoken,
        fromLocalClip: true
      });
    }
  }

  if (!isSpeechAvailable()) {
    return Promise.reject(new Error('语音服务未就绪（需先初始化云开发）'));
  }

  const cacheKey = hashText(spoken) + '_' + voice.voiceType;
  const cache = loadCache();

  // 2) 命中缓存且文件仍在：直接复用
  const hit = cache[cacheKey];
  if (hit && hit.files && hit.files.length) {
    return Promise.all(hit.files.map((f) => fileExists(f))).then((oks) => {
      if (oks.every(Boolean)) {
        return { files: hit.files, durationSec: hit.dur, text: spoken, fromLocalClip: false };
      }
      delete cache[cacheKey];
      saveCache(cache);
      return cloudSpeech(spoken, voice, cacheKey, cache);
    });
  }

  return cloudSpeech(spoken, voice, cacheKey, cache);
}

function cloudSpeech(
  spoken: string,
  voice: SisterVoice,
  cacheKey: string,
  cache: CacheMap
): Promise<SpeechResult> {
  return callTts(spoken, voice).then((segments) => {
    const dir = userDir();
    if (!dir) return Promise.reject(new Error('本地文件目录不可用'));
    const tasks = segments.map((b64, i) => {
      const filePath = `${dir}/sister_voice_${cacheKey}_${i}.mp3`;
      return writeBase64File(b64, filePath).then(() => filePath);
    });
    return Promise.all(tasks).then((files) => {
      const dur = estimateDuration(spoken, voice.speed);
      cache[cacheKey] = { files, dur, voiceType: voice.voiceType, ts: Date.now() };
      saveCache(cache);
      return { files, durationSec: dur, text: spoken, fromLocalClip: false };
    });
  });
}

/* ==================== 播放 ==================== */

let player: any = null;
let playingFiles: string[] = [];
let playIndex = 0;
let playCbs: PlayCallbacks | null = null;

function getPlayer(): any {
  if (player) return player;
  try {
    player = wx.createInnerAudioContext();
  } catch (e) {
    player = null;
  }
  return player;
}

/** 顺序播放多段音频；再次调用会打断上一次播放 */
export function playVoiceFiles(files: string[], cbs?: PlayCallbacks): void {
  const p = getPlayer();
  if (!p || !files || !files.length) {
    if (cbs && cbs.onError) cbs.onError('播放器不可用');
    return;
  }
  stopVoice();

  playingFiles = files.slice();
  playIndex = 0;
  playCbs = cbs || null;

  p.onEnded(() => {
    playIndex++;
    if (playIndex < playingFiles.length) {
      if (playCbs && playCbs.onSegment) playCbs.onSegment(playIndex, playingFiles.length);
      try {
        p.src = playingFiles[playIndex];
        p.play();
      } catch (e) {
        if (playCbs && playCbs.onError) playCbs.onError('播放失败');
      }
    } else {
      const cb = playCbs;
      playingFiles = [];
      playCbs = null;
      if (cb && cb.onEnded) cb.onEnded();
    }
  });

  p.onError((err: { errMsg?: string }) => {
    const cb = playCbs;
    playingFiles = [];
    playCbs = null;
    if (cb && cb.onError) cb.onError((err && err.errMsg) || '播放失败');
  });

  if (cbs && cbs.onSegment) cbs.onSegment(0, playingFiles.length);
  try {
    p.src = playingFiles[0];
    p.play();
  } catch (e) {
    if (cbs && cbs.onError) cbs.onError('播放失败');
  }
}

export function stopVoice(): void {
  playingFiles = [];
  playCbs = null;
  try {
    if (player) player.stop();
  } catch (e) {
    /* 忽略 */
  }
}

export function isPlaying(): boolean {
  return playingFiles.length > 0;
}

/* ==================== 声音来源文案 ==================== */

/** 用于语音条的来源标签，如「甜系少女音 · 智小柔（腾讯云 超自然大模型音色）」 */
export function voiceSourceLabel(voice?: SisterVoice): string {
  if (!voice) return '';
  return `${voice.label} · ${voice.voiceName}（${voice.engineName} ${voice.voiceKind}）`;
}

/** 悬浮/详情里的一句话来源说明 */
export function voiceSourceNote(voice?: SisterVoice): string {
  if (!voice) return '';
  return (
    `声音来源：${voice.label}｜音色 ${voice.voiceName}（ID ${voice.voiceType}，${voice.voiceKind}，` +
    `${voice.lang}，${voice.sampleRate / 1000}k）｜引擎 ${voice.engineName}｜${voice.note}`
  );
}
