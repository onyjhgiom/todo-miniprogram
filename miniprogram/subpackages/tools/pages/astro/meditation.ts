// pages/astro/meditation.ts
// 冥想训练：5 主题 + 时长选择 + 倒计时（每分钟换引导词）+ 白噪音伴听 + 打卡统计 + 历史
import { MEDITATIONS, meditationById, Meditation } from '../../utils/astro-data';
import { NS, listAll, addRecord } from '../../utils/astro-store';

interface HistoryItem {
  id: string; label: string; durationLabel: string; timeLabel: string;
}

/** 白噪音选项：16-bit PCM WAV（8kHz 6s 无缝循环），兼容 iOS/Android innerAudioContext */
interface NoiseOpt {
  key: string; label: string; icon: string; src: string;
}
const NOISES: NoiseOpt[] = [
  { key: 'none', label: '无', icon: '🔇', src: '' },
  { key: 'rain', label: '雨声', icon: '🌧️', src: '/subpackages/tools/assets/astro/audio/rain.wav' },
  { key: 'forest', label: '森林', icon: '🌲', src: '/subpackages/tools/assets/astro/audio/forest.wav' },
  { key: 'star', label: '星空', icon: '🌌', src: '/subpackages/tools/assets/astro/audio/star.wav' }
];

/** 当前播放的白噪音实例（模块级：页面卸载时由 onUnload→stopNoise 统一销毁） */
let noiseCtx: WechatMiniprogram.InnerAudioContext | null = null;

/** 冥想/引导词/呼吸脉冲的计时器（模块级，避免 this 自定义属性类型告警，统一在 onUnload 清理） */
let medTimer: ReturnType<typeof setInterval> | undefined;
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
let promptTimer: ReturnType<typeof setTimeout> | undefined;

interface PageData {
  themes: Meditation[];
  medId: string;
  currentName: string;
  currentDesc: string;
  duration: number;
  durations: number[];
  running: boolean;
  paused: boolean;
  remain: number;       // 秒
  total: number;        // 总秒数
  promptsBatch: string[];
  activeIdx: number;
  ringPulse: boolean;
  breathLabel: string;   // 呼吸引导：吸气/呼气
  stats: { totalMinutes: number; totalSessions: number };
  history: HistoryItem[];
  timeText: string;
  noises: NoiseOpt[];
  noiseKey: string;     // 当前白噪音 key（none=关闭）
  noisePlaying: boolean;
}

const BREATH_PHASES = ['吸气', '呼气'];

Page<PageData>({
  data: {
    themes: MEDITATIONS,
    medId: 'breath',
    currentName: '呼吸静心',
    currentDesc: '回归呼吸，安住当下',
    duration: 5,
    durations: [3, 5, 10, 15],
    running: false,
    paused: false,
    remain: 0, total: 0,
    promptsBatch: [],
    activeIdx: -1,
    ringPulse: false,
    breathLabel: '深呼吸',
    stats: { totalMinutes: 0, totalSessions: 0 },
    history: [],
    timeText: '00:00',
    noises: NOISES,
    noiseKey: 'none',
    noisePlaying: false
  },

  /** 页面卸载：销毁白噪音音频实例并清理计时器，避免残留播放/空 setData */
  onUnload() {
    this.stopNoise();
    if (medTimer) clearInterval(medTimer);
    if (promptTimer) clearTimeout(promptTimer);
    if (pulseTimer) clearTimeout(pulseTimer);
  },

  onHide() {
    // 切后台/离页时暂停白噪音，回页自动恢复（冥想倒计时本身继续走）
    if (noiseCtx && this.data.noisePlaying) noiseCtx.pause();
  },

  onShow() {
    if (noiseCtx && this.data.noisePlaying) noiseCtx.play();
    this.applyTheme();
    this.applyStats();
    this.applyHistory();
  },

  applyTheme() {
    const m = meditationById(this.data.medId);
    if (!m) return;
    this.setData({ medId: m.id, currentName: m.name, currentDesc: m.desc, promptsBatch: m.prompts });
  },

  applyStats() {
    const list = listAll<{ id: string; minutes: number; createdAt: number; label: string }>(NS.meditationLog);
    const total = list.reduce((s, r) => s + r.minutes, 0);
    this.setData({ stats: { totalMinutes: total, totalSessions: list.length } });
  },

  applyHistory() {
    const list = listAll<{ id: string; label: string; minutes: number; createdAt: number }>(NS.meditationLog).slice(0, 30);
    list.sort((a, b) => b.createdAt - a.createdAt);
    this.setData({
      history: list.map((h) => ({
        id: h.id,
        label: h.label,
        durationLabel: h.minutes + ' 分钟',
        timeLabel: relTime(h.createdAt)
      }))
    });
  },

  onPickTheme(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (id === this.data.medId) return;
    if (this.data.running) {
      wx.showToast({ title: '冥想进行中，请先结束', icon: 'none' });
      return;
    }
    const m = meditationById(id);
    if (!m) return;
    this.setData({ medId: id, currentName: m.name, currentDesc: m.desc, promptsBatch: m.prompts });
  },

  onPickDuration(e: WechatMiniprogram.TouchEvent) {
    const d = e.currentTarget.dataset.dur as number;
    if (d === this.data.duration) return;
    if (this.data.running) {
      wx.showToast({ title: '冥想进行中', icon: 'none' });
      return;
    }
    this.setData({ duration: d });
  },

  /** 切换环境白噪音：点「无」或再次点击当前项即停止，点其它项切换循环播放 */
  onPickNoise(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.noiseKey && this.data.noisePlaying) {
      this.stopNoise();
      this.setData({ noiseKey: 'none', noisePlaying: false });
      return;
    }
    if (key === 'none') {
      this.stopNoise();
      this.setData({ noiseKey: 'none', noisePlaying: false });
      return;
    }
    this.stopNoise();
    const opt = NOISES.find((n) => n.key === key);
    if (!opt || !opt.src) return;
    const ctx = wx.createInnerAudioContext();
    ctx.src = opt.src;
    ctx.loop = true;      // 6s 素材无缝循环
    ctx.volume = 0.6;
    ctx.obeyMuteSwitch = false;  // iOS 静音键下也可播放（此前无声的主因之一）
    ctx.onError(() => {
      wx.showToast({ title: '音频播放失败，请重试', icon: 'none' });
      this.setData({ noiseKey: 'none', noisePlaying: false });
    });
    ctx.play();
    noiseCtx = ctx;
    this.setData({ noiseKey: key, noisePlaying: true });
  },

  /** 停止并销毁当前白噪音实例 */
  stopNoise() {
    if (noiseCtx) {
      noiseCtx.stop();
      noiseCtx.destroy();
      noiseCtx = null;
    }
  },

  onStartMed() {
    if (this.data.running) return;
    const total = this.data.duration * 60;
    const self = this as unknown as { promptIdx?: number };
    self.promptIdx = -1;
    this.setData({ running: true, paused: false, total, remain: total, timeText: this.fmtTime(total), activeIdx: -1, breathLabel: '吸气' });
    this.tickPrompt();
    medTimer = setInterval(() => {
      const r = (this.data.remain || 0) - 1;
      if (r <= 0) {
        this.setData({ remain: 0, timeText: '00:00' });
        this.onEndMed();
        return;
      }
      // 呼吸节奏引导：每 4 秒 吸气/呼气 交替（按已进行时间计算，暂停后不错位）
      const elapsed = total - r;
      const phase = BREATH_PHASES[Math.floor(elapsed / 4) % BREATH_PHASES.length];
      if (phase !== this.data.breathLabel) {
        this.setData({ remain: r, timeText: this.fmtTime(r), breathLabel: phase, ringPulse: true });
        if (pulseTimer) clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => this.setData({ ringPulse: false }), 900);
      } else {
        this.setData({ remain: r, timeText: this.fmtTime(r) });
      }
    }, 1000);
  },

  onPauseMed() {
    if (!this.data.running || this.data.paused) return;
    if (medTimer) { clearInterval(medTimer); medTimer = undefined; }
    if (promptTimer) { clearTimeout(promptTimer); promptTimer = undefined; }
    this.setData({ paused: true, breathLabel: '休息一下' });
  },

  onResumeMed() {
    if (!this.data.running || !this.data.paused) return;
    this.setData({ paused: false });
    this.tickPrompt();
    medTimer = setInterval(() => {
      const r = (this.data.remain || 0) - 1;
      if (r <= 0) { this.setData({ remain: 0, timeText: '00:00' }); this.onEndMed(); return; }
      const elapsed = this.data.total - r;
      const phase = BREATH_PHASES[Math.floor(elapsed / 4) % BREATH_PHASES.length];
      if (phase !== this.data.breathLabel) {
        this.setData({ remain: r, timeText: this.fmtTime(r), breathLabel: phase, ringPulse: true });
        if (pulseTimer) clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => this.setData({ ringPulse: false }), 900);
      } else {
        this.setData({ remain: r, timeText: this.fmtTime(r) });
      }
    }, 1000);
  },

  onEndMed() {
    if (medTimer) { clearInterval(medTimer); medTimer = undefined; }
    if (promptTimer) { clearTimeout(promptTimer); promptTimer = undefined; }
    if (pulseTimer) { clearTimeout(pulseTimer); pulseTimer = undefined; }
    // 按实际完成的时长打卡（中途结束不再按计划时长虚报）
    const elapsed = this.data.total - this.data.remain;
    const minutes = Math.floor(elapsed / 60);
    if (minutes >= 1) {
      addRecord(NS.meditationLog, {
        id: '',
        label: this.data.currentName,
        minutes,
        duration: minutes
      } as unknown as { id: string; label: string; minutes: number; duration: number });
      this.applyStats();
      this.applyHistory();
    }
    this.setData({ running: false, paused: false, activeIdx: -1, breathLabel: '深呼吸' });
    wx.vibrateShort({ type: 'medium' });
    wx.showToast({ title: minutes >= 1 ? '本次冥想结束 🙏' : '下次坚持 1 分钟以上再打卡哦', icon: 'none', duration: 2200 });
  },

  /** 每 12 秒切换一段引导词（暂停时停止轮换，恢复后续接） */
  tickPrompt() {
    const self = this as unknown as { promptIdx?: number };
    self.promptIdx = ((self.promptIdx || 0) + 1) % Math.max(1, this.data.promptsBatch.length);
    this.setData({ activeIdx: self.promptIdx });
    if (!this.data.running || this.data.paused) return;
    promptTimer = setTimeout(() => this.tickPrompt(), 12000);
  },

  fmtTime(s: number): string {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return (m < 10 ? '0' + m : '' + m) + ':' + (r < 10 ? '0' + r : '' + r);
  }
});

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
  if (d < 30 * 86400_000) return Math.floor(d / 86400_000) + ' 天前';
  const date = new Date(ts);
  return date.getFullYear() + '-' + ((date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1)) + '-' + ((date.getDate() < 10 ? '0' : '') + date.getDate());
}