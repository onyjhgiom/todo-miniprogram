// pages/astro/sisterChat.ts
// 知心姐姐：高情商陪伴式对话（本地模板 + 情绪识别 + 细节共情，无后端 LLM）
// 回复 = 时间问候(概率) + 细节共情 + 主题回应 + 温柔建议 + 关怀收尾 + 引导倾诉(概率)
// 组合池足够大且记录上轮结果，保证每次回答都不同
//
// 2026-09-29 升级：
//   1) 前两位姐姐替换为鞠婧祎 / 李知恩（IU），并为每位姐姐配置**专属语气池**
//      （openers / empathy / advice / closings / fillers），说话像本人而不是同一套模板；
//   2) 新增真人语音发送：姐姐可以发语音（每条都标注声音来源），用户也可以按住发真人录音。
import {
  SISTER_TOPICS, SISTER_MOODS, SISTERS, SisterPersona, SisterVoice, DEFAULT_SISTER_KEY
} from '../../utils/astro-data';
import { NS, listAll, addRecord, clearNamespace } from '../../utils/astro-store';
import {
  estimateDuration, isDeployError, isSpeechAvailable, playVoiceFiles, stopVoice,
  synthesizeSisterVoice, voiceSourceLabel, voiceSourceNote
} from '../../utils/sister-voice';
import { ensureRecordAuth, startVoiceSession } from '../../../../utils/voice';

/**
 * 语音来源元数据（每条语音消息都带，用于在气泡上标明"这是谁的声音"）
 * 注意：这里连合成参数一起存下来 —— 消息生成后用哪个音色/语速朗读就固定了，
 * 之后切换姐姐也不会用新姐姐的声音去念旧姐姐的话。
 */
interface VoiceMeta {
  /** 归属姐姐 key（本地真人录音包按它查找） */
  sisterKey: string;
  label: string;
  engineName: string;
  voiceName: string;
  voiceType: number;
  kind: string;
  note: string;
  speed: number;
  volume: number;
  sampleRate: number;
  emotion?: string;
  /** 是否用了本地真人录音包 */
  fromLocalClip?: boolean;
}

interface MsgAudio {
  files: string[];
  durationSec: number;
}

interface ChatMsg {
  id: string; from: 'user' | 'ai'; text: string; mood?: string; ts: number;
  /** 姐姐消息：发送当时的头像快照（切换姐姐后历史气泡仍显示当时的姐姐） */
  avatar?: string;
  /** 语音消息：音频文件（姐姐语音按需合成；用户语音为录音文件） */
  audio?: MsgAudio;
  /** 语音来源标注 */
  voice?: VoiceMeta;
}

interface PageData {
  topics: typeof SISTER_TOPICS;
  moods: typeof SISTER_MOODS;
  sisters: SisterPersona[];
  sisterKey: string;
  sister: SisterPersona;
  topic: string;
  mood: string;
  draft: string;
  messages: ChatMsg[];
  lastMsgId: string;
  switchOpen: boolean;
  typing: boolean;
  inputFocused: boolean;
  placeholder: string;
  /* ===== 语音能力状态 ===== */
  /** 云语音是否可用 */
  voiceReady: boolean;
  /** 当前姐姐的语音来源文案（资料卡用） */
  voiceLabel: string;
  /** 自动朗读姐姐回复 */
  autoVoice: boolean;
  /** 正在合成/播放的消息 id */
  voiceBusyId: string;
  /** 语音状态提示 */
  voiceTip: string;
  /** 正在录音（按住说话） */
  recording: boolean;
  /** 录音秒数 */
  recordSec: number;
  /** 录音音量 0~100（波形） */
  recordVol: number;
  /** 语音条/录音波形柱（wxml 里避免用数组字面量，统一放在 data） */
  waveBars: number[];
  /** 运行时录音会话（不入 data，不参与渲染） */
  voiceSession?: { stop: () => void } | null;
  /** 运行时录音计时器 */
  recordTimer?: ReturnType<typeof setInterval> | null;
}

function getSister(key: string): SisterPersona {
  return SISTERS.find((s) => s.key === key) || SISTERS[0];
}

/** 取姐姐语音配置（可能为空） */
function voiceOf(s: SisterPersona): SisterVoice | undefined {
  return s.voice;
}

/* ================= 高情商回复素材池 ================= */
// 时间问候（40% 概率开头，增强真人感）
const TIME_OPENERS = [
  '早上好呀 ☀️',
  '下午好呀 🌤️',
  '晚上好呀 🌙',
  '看到你的消息啦 💌'
];
// 细节共情：把用户话里的关键词温柔地接住
const ECHO_PREFIX = [
  '我听到你说的',
  '你提到了',
  '我能感觉到你说的',
  '关于你讲到的'
];
const ECHO_FOLLOW = [
  '，这确实不容易。',
  '，一定让你心里很不是滋味吧。',
  '，谢谢你愿意告诉我这些。',
  '，我会认真听的。'
];
// 各主题的深度回应（每池 >= 6，反复不重样）
const TOPIC_RESPONSES: Record<string, string[]> = {
  love: [
    '感情里的纠结，常常不是因为不爱，而是因为太想好好爱了。',
    '两个人相处，最怕的不是吵架，而是有话不说、有结不解。',
    '被拒绝不等于被否定，可能只是两个人的节奏暂时没对上。',
    '先爱自己，是所有值得的关系都绕不开的第一步。',
    '真正的在乎，不是把对方绑在身旁，而是愿意为彼此留出空间。',
    '如果你愿意，可以把让你难受的那个瞬间描述给我听，我们一起看看。'
  ],
  study: [
    '学不进去的时候，往往是心累了，不是你不努力。',
    '不专注未必是懒，可能只是害怕结果不够好。',
    '学习是一场长跑，今天的小停顿不会改变大方向。',
    '那些看似平凡的一天，正是你默默积累的日子。',
    '把大目标切成小步骤，你会发现自己比想象中更能坚持。',
    '压力大的时候，允许自己慢一点，也是一种进步。'
  ],
  doubt: [
    '自我怀疑不是你的缺点，它只是内心在小心翼翼地保护你。',
    '你不需要等变得足够好，才被允许快乐和被爱。',
    '当你觉得“我不行”的时候，往往是要求自己太高了。',
    '真正的自信，是承认不确定，却依然选择往前走。',
    '别人眼里的你，常常比你眼里的自己更值得欣赏。',
    '价值不靠一次性证明，而靠每一天的自我认可慢慢累积。'
  ],
  relation: [
    '人际关系里的小别扭，很多时候只是因为没有被真正听见。',
    '你不必让每个人都满意，学会拒绝也是在保护自己的边界。',
    '真正的朋友会接住你的坦诚，而不是用它来评价你。',
    '先照顾好自己的情绪，才有余力温柔地对待别人。',
    '有些关系走远不代表你不好，只是方向不同了。',
    '把想说的话慢慢说清楚，比憋在心里反复内耗更有力量。'
  ],
  other: [
    '愿意说出来，本身就是很勇敢的一件事。',
    '情绪没有对错，它只是在提醒你某些需要被看见了。',
    '不用急着给每个问题找到答案，被好好倾听本身就有疗愈力。',
    '混乱的时候，反而是重新看清自己的好时机。',
    '此刻的你不需要振作，安静待一会儿也没关系。',
    '你不是一个人，我就在这里陪着你。'
  ]
};
// 温柔建议（部分主题可复用，池大一点）；姐姐有专属 advice 时优先用专属的
const SUGGESTIONS = [
  '如果愿意，可以先写下此刻最强烈的感受，只给自己看。',
  '试试做三次很慢很深的呼吸，让身体先安顿下来。',
  '今天可以只做一件让心里舒服的小事，不必更多。',
  '找一个信得过的朋友，把这件事说出来试试。',
  '把手机放远一点，给自己十五分钟完全安静的时间。',
  '睡前把手放在心口，轻轻告诉自己：我接受现在的我。',
  '给自己倒杯温水，先照顾一下身体的需要。'
];
// 关怀收尾（每轮不同）
const CLOSINGS = [
  '无论如何，你都在被温柔对待着。',
  '你不需要独自扛下所有。',
  '我会一直在这里，慢慢听你说完。',
  '累了就休息，天塌下来明天再说。',
  '愿这份晚安，替你盖上柔软的被子。',
  '你正在被这个世界默默爱着。'
];
// 引导倾诉（50% 概率追加一句）
const FOLLOWUPS = [
  '愿意多和我说一点吗？',
  '如果有想继续说的，我都在。',
  '这件事发生多久了？想聊聊的话可以继续。',
  '那当时你的第一反应是什么？',
  '需要我给你一些具体的建议吗？'
];
// 特殊快速回应
const THANKS_REPLIES = [
  '不客气，能陪你说说话我也很安心 💗',
  '谢谢你愿意相信我，这是我最珍视的部分。',
  '任何时候想找人说说话，我都会在。'
];

Page<PageData>({

  /** 点击头像：全屏查看照片（wx.previewImage 基础库 2.14.0+ 支持代码包路径） */
  onPreviewAvatar(e: any) {
    const url = ((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) || '') as string;
    if (!url) return;
    wx.previewImage({
      current: url,
      urls: [url],
      fail: () => wx.showToast({ title: '预览失败，请升级微信', icon: 'none' })
    });
  },
  data: {
    topics: SISTER_TOPICS,
    moods: SISTER_MOODS,
    sisters: SISTERS,
    sisterKey: DEFAULT_SISTER_KEY,
    sister: getSister(DEFAULT_SISTER_KEY),
    topic: 'other',
    mood: '',
    draft: '',
    messages: [],
    lastMsgId: '',
    switchOpen: false,
    typing: false,
    inputFocused: false,
    placeholder: '/subpackages/tools/assets/astro/sisters/sister_jujingyi.jpg',
    voiceReady: false,
    voiceLabel: '',
    autoVoice: false,
    voiceBusyId: '',
    voiceTip: '',
    recording: false,
    recordSec: 0,
    recordVol: 0,
    waveBars: [1, 2, 3, 4, 5, 6, 7, 8]
  },

  onLoad() {
    const ready = isSpeechAvailable();
    let auto = false;
    try {
      auto = wx.getStorageSync('sister_auto_voice') === true;
    } catch (_e) {
      auto = false;
    }
    this.setData({
      voiceReady: ready,
      autoVoice: auto,
      voiceLabel: voiceSourceLabel(voiceOf(this.data.sister))
    });
  },

  onShow() {
    this.applyHistory();
  },

  onUnload() {
    stopVoice();
  },

  onHide() {
    stopVoice();
  },

  applyHistory() {
    const list = listAll<{ id: string; messages: ChatMsg[]; topic: string; mood: string; sisterKey: string }>(NS.sisterChat).slice(0, 1);
    const cur = list[0];
    if (cur && Array.isArray(cur.messages) && cur.messages.length > 0) {
      const key = cur.sisterKey && SISTERS.some((s) => s.key === cur.sisterKey) ? cur.sisterKey : DEFAULT_SISTER_KEY;
      const messages = cur.messages.map((m) => {
        // 姐姐语音不持久化音频文件（本地缓存路径会在清理后失效），播放时按需重新合成；
        // 用户录音保留路径，失效时播放会给出提示。
        if (m.from === 'ai' && m.audio) return { ...m, audio: { files: [], durationSec: m.audio.durationSec } };
        return m;
      });
      this.setData({
        messages,
        topic: cur.topic,
        mood: cur.mood || '',
        sisterKey: key,
        sister: getSister(key),
        voiceLabel: voiceSourceLabel(voiceOf(getSister(key))),
        lastMsgId: messages[messages.length - 1].id
      });
    } else {
      this.setData({ messages: this.greeting() });
    }
  },

  greeting(): ChatMsg[] {
    const s = this.data.sister;
    const m = this.makeMsg('ai', s.greet);
    m.voice = this.voiceMetaOf(s);
    m.audio = { files: [], durationSec: estimateDuration(s.greet, (s.voice || ({} as SisterVoice)).speed) };
    return [m];
  },

  /** 生成一条带唯一 id 的消息（姐姐消息快照发送当时的头像） */
  makeMsg(from: 'user' | 'ai', text: string, mood?: string): ChatMsg {
    return {
      id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      from, text, mood, ts: Date.now(),
      avatar: from === 'ai' ? this.data.sister.avatar : undefined
    };
  },

  /** 由姐姐人设生成语音来源元数据（含合成参数，保证"这条消息用谁的声音"固定） */
  voiceMetaOf(s: SisterPersona): VoiceMeta | undefined {
    const v = s.voice;
    if (!v) return undefined;
    return {
      sisterKey: s.key,
      label: v.label,
      engineName: v.engineName,
      voiceName: v.voiceName,
      voiceType: v.voiceType,
      kind: v.voiceKind,
      note: v.note,
      speed: v.speed,
      volume: v.volume,
      sampleRate: v.sampleRate,
      emotion: v.emotion
    };
  },

  /** 由消息上的来源元数据还原合成参数（找不到就回落当前姐姐） */
  voiceParamsOf(msg: ChatMsg): SisterVoice | null {
    const vm = msg.voice;
    if (!vm) return null;
    return {
      label: vm.label,
      engine: 'tencent-tts',
      engineName: vm.engineName,
      voiceType: vm.voiceType,
      voiceName: vm.voiceName,
      voiceKind: vm.kind,
      lang: '',
      sampleRate: vm.sampleRate,
      speed: vm.speed,
      volume: vm.volume,
      emotion: vm.emotion,
      note: vm.note
    };
  },

  onPickTopic(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ topic: key });
  },

  onPickMood(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ mood: this.data.mood === key ? '' : key });
  },

  onInputDraft(e: WechatMiniprogram.InputEvent) {
    this.setData({ draft: e.detail.value });
  },

  onInputFocus() {
    this.setData({ inputFocused: true });
  },

  onInputBlur() {
    // 稍微延迟，避免发送时按钮点击与失焦样式冲突
    setTimeout(() => this.setData({ inputFocused: false }), 80);
  },

  onClearDraft() {
    this.setData({ draft: '' });
  },

  onSend() {
    const txt = (this.data.draft || '').trim();
    if (!txt || this.data.typing) return;
    this.pushMsg(this.makeMsg('user', txt, this.data.mood));
    this.setData({ draft: '', typing: true });
    // 模拟“姐姐正在输入”，增强真实陪伴感
    setTimeout(() => {
      this.aiReply(txt);
      this.setData({ typing: false });
    }, 900);
  },

  pushMsg(m: ChatMsg) {
    const arr = this.data.messages.slice();
    arr.push(m);
    this.setData({ messages: arr, lastMsgId: m.id }, () => this.saveSession(arr));
  },

  /** 就地更新某条消息（用于语音文件回填 / 播放态） */
  patchMsg(id: string, patch: Partial<ChatMsg>) {
    const arr = this.data.messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.setData({ messages: arr }, () => this.saveSession(arr));
  },

  /* ==================== 语音：姐姐发语音 ==================== */

  /** 点击语音条：播放 / 停止（没有音频时先合成） */
  onTapVoice(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg) return;
    if (this.data.voiceBusyId === id) {
      stopVoice();
      this.setData({ voiceBusyId: '', voiceTip: '' });
      return;
    }
    const s = this.data.sister;
    // 用户自己的录音：直接播
    if (msg.from === 'user') {
      if (!msg.audio || !msg.audio.files.length) {
        wx.showToast({ title: '录音文件已失效', icon: 'none' });
        return;
      }
      this.setData({ voiceBusyId: id, voiceTip: '播放中…' });
      playVoiceFiles(msg.audio.files, {
        onEnded: () => this.setData({ voiceBusyId: '', voiceTip: '' }),
        onError: () => {
          this.setData({ voiceBusyId: '', voiceTip: '' });
          wx.showToast({ title: '录音播放失败', icon: 'none' });
        }
      });
      return;
    }
    // 姐姐语音：命中缓存直接播，否则先合成
    if (msg.audio && msg.audio.files && msg.audio.files.length) {
      this.setData({ voiceBusyId: id, voiceTip: '播放中…' });
      playVoiceFiles(msg.audio.files, {
        onEnded: () => this.setData({ voiceBusyId: '', voiceTip: '' }),
        onError: () => {
          // 缓存文件可能被清理，重新合成
          this.patchMsg(id, { audio: { files: [], durationSec: (msg.audio as MsgAudio).durationSec } });
          this.speakMsg(id);
        }
      });
      return;
    }
    if (!msg.voice && !s.voice) {
      wx.showToast({ title: '这条消息没有可用的声音来源', icon: 'none' });
      return;
    }
    if (!this.data.voiceReady) {
      wx.showToast({ title: '语音服务未就绪（需先部署 tts 云函数）', icon: 'none' });
      return;
    }
    this.speakMsg(id);
  },

  /** 合成并播放某条姐姐语音 */
  speakMsg(id: string) {
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg) return;
    // 用这条消息自己登记的声音来源合成：切换姐姐后，旧消息仍用原姐姐的音色朗读
    const v = this.voiceParamsOf(msg) || this.data.sister.voice;
    if (!v) return;
    const sisterKey = (msg.voice && msg.voice.sisterKey) || this.data.sister.key;
    this.setData({ voiceBusyId: id, voiceTip: '正在生成语音…' });
    synthesizeSisterVoice(msg.text, v, { sisterKey, clipId: this.clipIdOf(msg, sisterKey) })
      .then((res) => {
        this.patchMsg(id, {
          audio: { files: res.files, durationSec: res.durationSec },
          voice: msg.voice
            ? { ...msg.voice, fromLocalClip: res.fromLocalClip }
            : this.voiceMetaOf(getSister(sisterKey))
        });
        this.setData({ voiceTip: res.fromLocalClip ? '真人录音播放中…' : '播放中…' });
        playVoiceFiles(res.files, {
          onEnded: () => this.setData({ voiceBusyId: '', voiceTip: '' }),
          onError: () => {
            this.setData({ voiceBusyId: '', voiceTip: '' });
            wx.showToast({ title: '语音播放失败', icon: 'none' });
          }
        });
      })
      .catch((err: Error) => {
        const msg = (err && err.message) || '语音生成失败';
        if (isDeployError(msg)) {
          // tts 云函数没部署：把语音置为「待部署」态，避免反复点反复失败
          this.setData({ voiceBusyId: '', voiceTip: '语音待部署', voiceReady: false });
        } else {
          this.setData({ voiceBusyId: '', voiceTip: '' });
        }
        wx.showToast({ title: msg, icon: 'none' });
      });
  },

  /** 消息对应的本地真人录音标识（有录音包时优先播真人录音） */
  clipIdOf(msg: ChatMsg, sisterKey?: string): string {
    const s = getSister(sisterKey || this.data.sister.key);
    if (s.greet && msg.text === s.greet) return 'greet';
    if (s.closing && msg.text === s.closing) return 'closing';
    const wi = s.warmth.indexOf(msg.text);
    if (wi >= 0) return 'warmth' + (wi + 1);
    const hi = s.habit.indexOf(msg.text);
    if (hi >= 0) return 'habit' + (hi + 1);
    return '';
  },

  /** 显示这条语音的来源详情 */
  onVoiceInfo(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg) return;
    const s = this.data.sister;
    const v: SisterVoice | undefined = s.voice;
    const body = msg.voice
      ? `声音来源：${msg.voice.label}\n音色：${msg.voice.voiceName}（ID ${msg.voice.voiceType}，${msg.voice.kind}）\n引擎：${msg.voice.engineName}\n朗读文本：与气泡文字一致（仅去掉动作旁白/表情符号）\n${msg.audio && msg.audio.files.length ? '' : '（尚未生成音频，点击语音条即可播放）'}`
      : voiceSourceNote(v);
    wx.showModal({
      title: msg.from === 'ai' ? '这条语音的声音来源' : '你的语音',
      content: msg.from === 'ai' ? body : '你自己录制的真人语音，仅保存在本地与本次会话中。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onToggleAutoVoice() {
    const next = !this.data.autoVoice;
    try {
      wx.setStorageSync('sister_auto_voice', next);
    } catch (_e) {
      /* 忽略 */
    }
    this.setData({ autoVoice: next });
    wx.showToast({ title: next ? '已开启自动朗读' : '已关闭自动朗读', icon: 'none' });
  },

  /** 试听姐姐声音（资料卡入口） */
  onPreviewVoice() {
    const s = this.data.sister;
    if (!s.voice) {
      wx.showToast({ title: '这位姐姐还没有配置语音', icon: 'none' });
      return;
    }
    const sample = s.style && s.style.openers.length ? s.style.openers[0] : s.greet;
    if (!this.data.voiceReady) {
      wx.showToast({ title: '语音服务未就绪（需先部署 tts 云函数）', icon: 'none' });
      return;
    }
    this.setData({ voiceTip: '正在生成试听…' });
    synthesizeSisterVoice(sample, s.voice, { sisterKey: s.key })
      .then((res) => {
        this.setData({ voiceTip: '试听中…' });
        playVoiceFiles(res.files, {
          onEnded: () => this.setData({ voiceTip: '' }),
          onError: () => this.setData({ voiceTip: '' })
        });
      })
      .catch((err: Error) => {
        this.setData({ voiceTip: '' });
        wx.showToast({ title: (err && err.message) || '试听失败', icon: 'none' });
      });
  },

  /* ==================== 语音：用户发真人录音 ==================== */

  onVoicePressStart() {
    if (this.data.recording || this.data.typing) return;
    if (!this.data.voiceReady) {
      wx.showToast({ title: '语音功能未就绪', icon: 'none' });
      return;
    }
    ensureRecordAuth().then((state) => {
      if (state !== 'granted') {
        wx.showToast({ title: '需要麦克风权限才能发语音', icon: 'none' });
        return;
      }
      const session = startVoiceSession({
        onStatus: (st) => {
          if (st === 'recording') this.setData({ recording: true, recordSec: 0, recordVol: 0 });
          if (st === 'recognizing') this.setData({ voiceTip: '正在识别语音…' });
          if (st === 'idle') this.setData({ voiceTip: '' });
        },
        onVolume: (vol) => this.setData({ recordVol: vol }),
        onFinal: (text, filePath, durationSec) => {
          this.setData({ recording: false, recordVol: 0 });
          this.pushVoiceMsg(text, filePath, durationSec);
        },
        onError: (msg) => {
          this.setData({ recording: false, recordVol: 0, voiceTip: '' });
          wx.showToast({ title: msg || '录音失败', icon: 'none' });
        }
      });
      if (!session) return;
      this.voiceSession = session;
      this.startRecordTimer();
    });
  },

  onVoicePressEnd() {
    this.stopRecordTimer();
    if (this.data.recording && this.voiceSession) {
      this.voiceSession.stop();
      this.voiceSession = null;
    }
  },

  startRecordTimer() {
    this.stopRecordTimer();
    this.recordTimer = setInterval(() => {
      const sec = this.data.recordSec + 1;
      this.setData({ recordSec: sec });
      if (sec >= 60) this.onVoicePressEnd(); // 1 分钟自动结束
    }, 1000);
  },

  stopRecordTimer() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
  },

  /** 把录音发成一条用户消息，并走原有回复流程 */
  pushVoiceMsg(text: string, filePath: string, durationSec: number) {
    const body = text && text.trim() ? text.trim() : '[语音]';
    const m = this.makeMsg('user', body, this.data.mood);
    m.audio = { files: filePath ? [filePath] : [], durationSec: Math.round(durationSec * 10) / 10 };
    this.pushMsg(m);
    if (this.data.typing) return;
    this.setData({ typing: true });
    setTimeout(() => {
      this.aiReply(text || '');
      this.setData({ typing: false });
    }, 900);
  },

  /* ==================== 切换姐姐 ==================== */

  /** 打开 / 关闭 切换姐姐面板 */
  onOpenSwitch() {
    stopVoice();
    this.setData({ switchOpen: true, voiceBusyId: '', voiceTip: '' });
  },
  onCloseSwitch() {
    this.setData({ switchOpen: false });
  },
  /** 面板内部点击，阻止冒泡关闭 */
  noop() {},

  /** 切换姐姐：换头像+人设+语气+音色；若仅开场白则直接替换，否则温柔接手 */
  onSelectSister(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ switchOpen: false });
    if (key === this.data.sisterKey) return;
    stopVoice();
    const s = getSister(key);
    this.setData({
      sisterKey: key,
      sister: s,
      voiceBusyId: '',
      voiceTip: '',
      voiceLabel: voiceSourceLabel(voiceOf(s))
    });
    const list = this.data.messages;
    if (list.length <= 1) {
      const m = this.makeMsg('ai', s.greet);
      m.voice = this.voiceMetaOf(s);
      m.audio = { files: [], durationSec: estimateDuration(s.greet, (s.voice || ({} as SisterVoice)).speed) };
      this.setData({ messages: [m], lastMsgId: m.id }, () => this.saveSession([m]));
      if (this.data.autoVoice) this.speakMsg(m.id);
    } else {
      const takeover = this.makeMsg('ai', '我是' + s.name + '～以后由我来陪你聊啦。' + s.tagline);
      takeover.voice = this.voiceMetaOf(s);
      takeover.audio = {
        files: [],
        durationSec: estimateDuration(takeover.text, (s.voice || ({} as SisterVoice)).speed)
      };
      this.pushMsg(takeover);
      if (this.data.autoVoice) this.speakMsg(takeover.id);
    }
  },

  /* ==================== 回复生成 ==================== */

  /** 高情商合成回复：情绪识别 + 专属语气池 + 当前姐姐的关怀/生活细节/专属收尾（保证每次不同） */
  aiReply(userText: string) {
    // 感谢快速通道
    if (/谢谢|感谢|辛苦|有心/.test(userText)) {
      const t = THANKS_REPLIES[Math.floor(Math.random() * THANKS_REPLIES.length)];
      this.pushAiReply(t);
      return;
    }
    // 自动识别情绪（未手选时）
    const infered = this.inferMood(userText);
    const mood = this.data.mood || infered;
    const topicKey = this.data.topic;
    const responses = TOPIC_RESPONSES[topicKey] || TOPIC_RESPONSES.other;
    const s = this.data.sister;
    const st = s.style;
    const parts: string[] = [];

    // 语气小词（约 3 成概率落在最前面，姐姐的口头禅）
    if (st && st.fillers.length && Math.random() < 0.3) parts.push(randomOf(st.fillers));

    // 开场：优先姐姐专属开场语气，其次才是通用时间问候
    if (st && st.openers.length && Math.random() < 0.55) {
      parts.push(randomOf(st.openers));
    } else if (Math.random() < 0.4) {
      const hr = new Date().getHours();
      parts.push(hr < 6 ? '夜深了呀 🌙' : hr < 12 ? '早上好呀 ☀️' : hr < 19 ? '下午好呀 🌤️' : '晚上好呀 🌙');
    }

    // 细节共情（引用用户话里的关键词，避免空泛）
    const sig = pickSig(userText);
    parts.push(sig ? randomOf(ECHO_PREFIX) + '「' + sig + '」' + randomOf(ECHO_FOLLOW) : randomOf(ECHO_PREFIX.slice(0, 2)) + '你此刻的心情' + randomOf(ECHO_FOLLOW));

    // 姐姐专属共情（个人经历感，避免"客服腔"）
    if (st && st.empathy.length && Math.random() < 0.7) parts.push(this.pickDistinct(st.empathy));

    // 主题深度回应
    parts.push(this.pickDistinct(responses));

    // 姐姐自称的关怀（低落/焦虑/烦躁/迷茫时更常说）
    const needWarm = ['sad', 'anxious', 'angry', 'confused'].indexOf(mood) >= 0;
    if (needWarm || Math.random() < 0.5) parts.push(randomOf(s.warmth));

    // 建议：姐姐专属建议口吻优先
    parts.push(st && st.advice.length ? this.pickDistinct(st.advice) : this.pickDistinct(SUGGESTIONS));

    // 拟人化生活小细节（约 35% 概率穿插，让姐姐“像在身边”）
    if (Math.random() < 0.35) parts.push(randomOf(s.habit));

    // 引导倾诉（一半概率）
    if (Math.random() < 0.5) parts.push(randomOf(FOLLOWUPS));

    // 收尾：姐姐专属收尾轮换，避免每次同一个签名
    parts.push(st && st.closings.length ? this.pickDistinct(st.closings) : s.closing);

    this.pushAiReply(parts.join(' '), mood || undefined);
  },

  /** 推送一条姐姐回复（自动附上语音来源元数据；开启自动朗读时立即合成语音） */
  pushAiReply(text: string, mood?: string) {
    const s = this.data.sister;
    const m = this.makeMsg('ai', text, mood);
    m.voice = this.voiceMetaOf(s);
    m.audio = { files: [], durationSec: estimateDuration(text, (s.voice || ({} as SisterVoice)).speed) };
    this.pushMsg(m);
    if (this.data.autoVoice) {
      setTimeout(() => this.speakMsg(m.id), 260);
    }
  },

  /** 简单情绪关键词识别（覆盖人工未选情绪的场景） */
  inferMood(t: string): string {
    if (/(难过|伤心|想哭|哭|委屈|心碎|难过死)/.test(t)) return 'sad';
    if (/(遗憾|后悔|如果当时|错过)/.test(t)) return 'sad';
    if (/(焦虑|担心|害怕|紧张|慌|睡不着)/.test(t)) return 'anxious';
    if (/(气|烦|讨厌|讨厌死|火大|委屈)/.test(t)) return 'angry';
    if (/(迷茫|不知道怎么办|没方向|困惑|纠结)/.test(t)) return 'confused';
    if (/(开心|高兴|太好|终于|惊喜)/.test(t)) return 'happy';
    if (/(累|疲惫|没力气|撑不住)/.test(t)) return 'sad';
    return '';
  },

  /** 随机取一条，并尽力避开上一条（保证不连续重复） */
  pickDistinct(pool: string[]): string {
    const self = this as unknown as { lastPick?: string };
    if (!pool.length) return '';
    let pick = pool[Math.floor(Math.random() * pool.length)];
    let guard = 0;
    while (pick === self.lastPick && pool.length > 1 && guard < 6) {
      pick = pool[Math.floor(Math.random() * pool.length)];
      guard++;
    }
    self.lastPick = pick;
    return pick;
  },

  saveSession(messages: ChatMsg[]) {
    clearNamespace(NS.sisterChat);
    // 落库前剥掉音频文件路径（本地缓存不可靠），只保留时长与来源标注
    const slim = messages.map((m) => (
      m.from === 'ai' && m.audio
        ? { ...m, audio: { files: [], durationSec: m.audio.durationSec } }
        : m
    ));
    addRecord(NS.sisterChat, {
      id: '',
      topic: this.data.topic,
      mood: this.data.mood,
      sisterKey: this.data.sisterKey,
      messages: slim.slice(-30)
    } as unknown as { id: string; topic: string; mood: string; sisterKey: string; messages: ChatMsg[] });
  },

  onClear() {
    wx.showModal({
      title: '清空对话', content: '确定要清空所有对话历史吗？',
      success: (r) => {
        if (r.confirm) {
          stopVoice();
          clearNamespace(NS.sisterChat);
          this.setData({ messages: [], topic: 'other', mood: '', voiceBusyId: '', voiceTip: '' }, () => {
            this.setData({ messages: this.greeting() });
          });
        }
      }
    });
  },

  moodLabel(key: string): string {
    const m = SISTER_MOODS.find((x) => x.key === key);
    return m ? m.label : '';
  },

  onImgErr(e: WechatMiniprogram.CustomEvent) {
    const t = e.currentTarget as WechatMiniprogram.Image;
    if (t.src !== this.data.placeholder) t.setData({ src: this.data.placeholder });
  }
});
/* ================= 工具函数 ================= */
function randomOf(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] || '';
}

/** 从用户输入中提取一个“能接住”的关键片段（2-8 字实体词） */
const SIG_BLOCKERS = /[，。！？、,.!?\s]/;
function pickSig(t: string): string {
  const targets = [
    /(考试|面试|工作|老板|同事|朋友|恋人|前任|爸妈|家人|室友|对象|男\s*朋友|女\s*朋友|论文|实习|搬家|减肥|失眠)/,
    /(他|她|它)(?!们)[^，。！？]{0,6}/
  ];
  for (const re of targets) {
    const m = t.match(re);
    if (m && m[0] && m[0].length <= 8) {
      const seg = m[0].replace(SIG_BLOCKERS, '').trim();
      if (seg.length >= 2) return seg;
    }
  }
  const words = t.split(SIG_BLOCKERS).filter((w) => w.length >= 2 && w.length <= 8);
  return words.length ? words[words.length - 1] : '';
}
