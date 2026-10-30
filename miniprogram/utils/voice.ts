// utils/voice.ts
// 语音能力封装（不依赖任何小程序插件）：
// 1) 本地录音：wx.getRecorderManager 采集 mp3（16k 单声道，适配语音识别）
// 2) 云端转写：录音上传云存储 → 调用 asr 云函数（腾讯云一句话识别）→ 返回文字
// 3) 录音波形：优先 onFrameRecorded 实时振幅，失败则定时器模拟动画
// 4) 播放：录音回放
//
// 相比旧版（WechatSI 同声传译插件）的优势：
//   - 无需在小程序后台添加插件、不占用插件额度
//   - 个人主体小程序同样可用
//   - 云端识别可替换引擎（腾讯云 / 讯飞等），不受插件版本限制
// 配置说明见项目根目录《备忘录语音转写接入说明.md》。

export interface VoiceCallbacks {
  /** 录音与识别全部完成，返回识别文本与音频文件路径 */
  onFinal?: (text: string, filePath: string, durationSec: number) => void;
  /** 中间状态提示（如「正在识别…」） */
  onStatus?: (status: VoiceStatus) => void;
  /** 出错（录音失败 / 识别失败） */
  onError?: (msg: string) => void;
  /** 0~100 实时音量（波形） */
  onVolume?: (vol: number) => void;
}

/** 录音会话状态，供 UI 显示 */
export type VoiceStatus = 'idle' | 'recording' | 'recognizing';

export interface RecorderCallbacks {
  onStop?: (filePath: string, durationSec: number) => void;
  onError?: (msg: string) => void;
  /** 0~100 实时音量（波形） */
  onVolume?: (vol: number) => void;
}

/* ==================== 云端识别可用性 ==================== */

/**
 * 云端识别是否可用。
 * 依赖：已初始化云开发（app.js 中 wx.cloud.init）。
 * 不再依赖插件，因此这里只检查云能力是否就绪。
 */
export function isVoiceAvailable(): boolean {
  try {
    return !!(wx.cloud && typeof wx.cloud.callFunction === 'function');
  } catch (e) {
    return false;
  }
}

/** 兼容旧调用名：旧代码里的 isSIAvailable / refreshSIStatus 现已统一到云端方案 */
export function isSIAvailable(): boolean {
  return isVoiceAvailable();
}

export function refreshSIStatus(): boolean {
  return isVoiceAvailable();
}

/* ==================== 录音权限 ==================== */

export type AuthResult = 'granted' | 'denied' | 'unsupported';

/**
 * 确保拿到录音权限（scope.record）。
 * - 已授权：直接回调 granted
 * - 未询问：调用 wx.authorize 弹窗申请
 * - 已拒绝：引导用户去设置页开启
 * 返回 Promise，便于业务侧在开始录音前 await。
 */
export function ensureRecordAuth(): Promise<AuthResult> {
  return new Promise((resolve) => {
    if (typeof wx.getSetting !== 'function') {
      resolve('unsupported');
      return;
    }
    wx.getSetting({
      success: (res) => {
        const auth = res.authSetting || {};
        const state = auth['scope.record'];
        if (state === true) {
          resolve('granted');
        } else if (state === false) {
          // 曾拒绝过：只能引导去设置页，不能再弹系统授权
          wx.showModal({
            title: '需要麦克风权限',
            content: '录音速记需要使用麦克风。请在设置中开启「录音」权限后重试。',
            confirmText: '去设置',
            cancelText: '取消',
            success: (m) => {
              if (m.confirm) {
                wx.openSetting({
                  success: (s) => {
                    resolve((s.authSetting || {})['scope.record'] === true ? 'granted' : 'denied');
                  },
                  fail: () => resolve('denied')
                });
              } else {
                resolve('denied');
              }
            },
            fail: () => resolve('denied')
          });
        } else {
          // 首次使用：走标准授权弹窗
          wx.authorize({
            scope: 'scope.record',
            success: () => resolve('granted'),
            fail: () => resolve('denied')
          });
        }
      },
      fail: () => resolve('unsupported')
    });
  });
}

/* ==================== 录音（RecorderManager） ==================== */

let recorder: any = null;
let volumeTimer: ReturnType<typeof setInterval> | null = null;
let recordStartAt = 0;

function getRecorder(): any {
  if (recorder) return recorder;
  try {
    recorder = wx.getRecorderManager();
  } catch (e) {
    recorder = null;
  }
  return recorder;
}

/**
 * 开始录音（mp3 / 16k / 单声道，适配语音识别）。
 * 返回是否成功启动。
 */
export function startRecord(cbs: RecorderCallbacks): boolean {
  const rm = getRecorder();
  if (!rm) {
    if (cbs.onError) cbs.onError('录音功能不可用');
    return false;
  }
  recordStartAt = Date.now();
  try {
    rm.onStart(() => {
      /* noop */
    });
    rm.onStop((res: { tempFilePath: string; duration?: number }) => {
      stopVolumeSimulator();
      const dur = res && res.duration ? res.duration / 1000 : (Date.now() - recordStartAt) / 1000;
      if (cbs.onStop) cbs.onStop(res.tempFilePath, dur);
    });
    rm.onError((err: { errMsg: string }) => {
      stopVolumeSimulator();
      if (cbs.onError) cbs.onError((err && err.errMsg) || '录音失败');
    });
    // 实时波形：优先真振幅
    try {
      rm.onFrameRecorded((res: { frameBuffer: ArrayBuffer }) => {
        if (!cbs.onVolume || !res || !res.frameBuffer) return;
        try {
          const arr = new Int16Array(res.frameBuffer);
          let peak = 0;
          for (let i = 0; i < arr.length; i += 16) {
            const v = Math.abs(arr[i]);
            if (v > peak) peak = v;
          }
          cbs.onVolume(Math.min(100, Math.round((peak / 32767) * 140)));
        } catch (e) {
          /* ignore */
        }
      });
      rm.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, format: 'mp3', frameSize: 4 });
    } catch (e) {
      // 部分环境不支持 frameSize，退回普通录音 + 模拟波形
      rm.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, format: 'mp3' });
      startVolumeSimulator(cbs);
    }
    return true;
  } catch (e) {
    if (cbs.onError) cbs.onError('录音启动失败');
    return false;
  }
}

export function stopRecord(): void {
  stopVolumeSimulator();
  try {
    if (recorder) recorder.stop();
  } catch (e) {
    /* ignore */
  }
}

function startVolumeSimulator(cbs: RecorderCallbacks): void {
  stopVolumeSimulator();
  volumeTimer = setInterval(() => {
    if (cbs.onVolume) cbs.onVolume(20 + Math.round(Math.random() * 60));
  }, 150);
}

function stopVolumeSimulator(): void {
  if (volumeTimer) {
    clearInterval(volumeTimer);
    volumeTimer = null;
  }
}

/* ==================== 云端转写 ==================== */

/**
 * 上传录音文件到云存储，返回 fileID。
 * 云存储路径：voice/{时间戳}-{随机}.mp3
 */
export function uploadVoiceFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = (filePath.match(/\.(\w+)$/) || [, 'mp3'])[1];
    const cloudPath = `voice/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res: { fileID: string }) => resolve(res.fileID),
      fail: (err: any) => reject(new Error((err && err.errMsg) || '录音上传失败'))
    });
  });
}

export interface AsrResult {
  text: string;
  raw?: any;
}

/**
 * 调用 asr 云函数，把云存储里的录音转成文字。
 * @param fileID 云存储文件 ID
 * @param durationMs 录音时长（毫秒），用于识别参数校验
 */
export function recognizeVoice(fileID: string, durationMs?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'asr',
      data: { fileID, durationMs: durationMs || 0 },
      success: (res: { result?: any }) => {
        const r = res && res.result;
        if (r && r.success && typeof r.text === 'string') {
          resolve(r.text);
        } else {
          reject(new Error((r && r.message) || '语音识别失败'));
        }
      },
      fail: (err: any) => reject(new Error((err && err.errMsg) || '语音识别服务调用失败'))
    });
  });
}

/**
 * 一站式语音会话：录音 → 上传 → 云端识别。
 *
 * 用法（按住/点击两种交互由业务侧控制）：
 *   const session = startVoiceSession({ onFinal, onError, onVolume, onStatus });
 *   // 结束后：
 *   session.stop();
 *
 * 回调时序：onStatus('recording') → (可选 onVolume…) → session.stop()
 *          → onStatus('recognizing') → onFinal(text, filePath, duration) | onError(msg)
 */
export function startVoiceSession(cbs: VoiceCallbacks): { stop: () => void } | null {
  if (!isVoiceAvailable()) {
    if (cbs.onError) cbs.onError('云端识别服务未就绪');
    return null;
  }

  let stopped = false;
  let durationMs = 0;

  const ok = startRecord({
    onVolume: cbs.onVolume,
    onStop: (filePath, durationSec) => {
      durationMs = Math.round(durationSec * 1000);
      if (cbs.onStatus) cbs.onStatus('recognizing');
      // 上传 → 识别
      uploadVoiceFile(filePath)
        .then((fileID) => recognizeVoice(fileID, durationMs))
        .then((text) => {
          if (cbs.onFinal) cbs.onFinal(text || '', filePath, durationSec);
          if (cbs.onStatus) cbs.onStatus('idle');
        })
        .catch((err: Error) => {
          // 识别失败仍把录音文件回传，便于业务侧保存「待转写」片段
          if (cbs.onFinal) cbs.onFinal('', filePath, durationSec);
          if (cbs.onError) cbs.onError(err && err.message ? err.message : '语音识别失败');
          if (cbs.onStatus) cbs.onStatus('idle');
        });
    },
    onError: (msg) => {
      if (cbs.onError) cbs.onError(msg);
      if (cbs.onStatus) cbs.onStatus('idle');
    }
  });

  if (!ok) return null;
  if (cbs.onStatus) cbs.onStatus('recording');

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      stopRecord();
    }
  };
}

/* ==================== 播放 ==================== */

export function createPlayer(): any {
  try {
    return wx.createInnerAudioContext();
  } catch (e) {
    return null;
  }
}
