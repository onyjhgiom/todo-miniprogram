// subpackages/toolbox/pages/little-helper/little-helper.ts
// 小琳 · 待办助手（AI 智能助手页）
//
// 分层：
//   规则意图引擎 → utils/helper-engine.ts（离线兜底，毫秒级响应）
//   AI 对话       → utils/helper-ai.ts（云端大模型，失败自动回退规则引擎）
//   ops 落地      → 本页 execOps()（批量建待办 / 完成 / 改期 / 删除 / 便签 / 跳转）
//
// 本页职责：
//   1) 对话渲染（用户气泡 / 助手气泡 / 结构化任务卡 / 确认卡 / 错误卡 / 快捷指令 / 图片）；
//   2) 执行 AI 产出的 ops 与规则引擎产出的动作，并把**真实执行结果**结构化回填卡片；
//   3) 把真实待办明细喂给模型，让回答有依据（「我还有哪些没做」）；
//   4) 危险操作确认、完成撤销、失败重试；
//   5) 主动服务：进入页面生成今日简报（每天一次）。
//
// ★ 真实性红线（对应验收标准 5/6）：
//   卡片上的「已完成 / 已创建」只能来自 todoStore 真实调用成功；
//   撤销只在后端确实支持时出现（toggle 反向 / 删除还原），不做假撤销；
//   找不到任务、接口异常一律走 failed 分支并给重试，绝不误报成功。
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { callFn, toast } from '../../../../utils/cloud';
import * as todoStore from '../../../../utils/todo-store';
import { replyTo } from '../../../../utils/helper-engine';
import {
  askAI,
  askBrief,
  isAINotConfigured,
  isAITimeout,
  toHelperReply,
  parseDueDate,
  type ChatHistoryItem,
  type HelperOp,
  type TodoBriefItem
} from '../../../../utils/helper-ai';
import { jumpToModule } from '../../../../utils/module-router';
import { loadShell, saveShell } from '../../../../utils/tool-shell';
import { isVoiceAvailable, startVoiceSession, ensureRecordAuth } from '../../../../utils/voice';
import { getNavMetrics } from '../../../../utils/navbar';
import type { ThemeKey, ITodo } from '../../../../types/index';
import type { PageStyleKey, BgStyleKey } from '../../../../utils/tool-shell';
import type { HelperActionKind, HelperAction } from '../../../../utils/helper-engine';
import { go } from '../../../../utils/nav';

/* ============================ 类型 ============================ */

/** 消息类型：文本 / 任务结果卡 / 待办列表卡 / 危险操作确认卡 / 错误卡 */
export type MsgType = 'text' | 'task_result' | 'task_list' | 'confirmation' | 'error';

/** 消息状态：空闲 / 思考中 / 提交中 / 成功 / 失败 / 待确认 */
export type MsgStatus = 'idle' | 'thinking' | 'submitting' | 'success' | 'failed' | 'awaiting_confirmation';

/** 单条任务详情行（真实业务字段） */
export interface TaskDetail {
  label: string;
  value: string;
}

/** 一次 op 的真实执行结果 —— 卡片数据源，绝不由前端臆造 */
export interface OpResult {
  /** 卡片标题，如「已为你完成任务」 */
  title: string;
  /** 任务名称（真实标题） */
  taskName: string;
  /** 状态文案，如「已完成」 */
  statusText: string;
  /** 任务详情行（时间取真实业务数据） */
  details: TaskDetail[];
  /** 真实任务 ID，撤销/查看都靠它，不靠标题匹配 */
  todoId?: string;
  /** 是否支持撤销（后端确有反向能力才为 true） */
  undoable: boolean;
  /** 撤销动作说明，如「撤销完成」 */
  undoLabel?: string;
  /** 失败原因（statusText 为「执行失败」时填这里） */
  errorText?: string;
  /** 成功时间戳（ms） */
  at: number;
}

export interface Msg {
  id: string;
  role: 'user' | 'bot';
  type: MsgType;
  text: string;
  /** 用户发送的图片（dataURL），用于气泡内预览 */
  image?: string;
  /** 是否为「今日简报」 */
  brief?: boolean;
  /** 是否展示快捷动作 */
  showActions?: boolean;
  actions?: HelperAction[];
  /** 结构化任务结果（type=task_result） */
  opResult?: OpResult;
  /** 危险操作确认卡：待确认的 op + 展示文案 */
  pendingOp?: HelperOp;
  /** 错误卡：是否可重试 + 重试时回填的原文 */
  retryable?: boolean;
  retryText?: string;
  /** 该条消息的完整时间戳，用于时间分隔线 */
  ts: number;
  /** 展示用 HH:mm */
  time: string;
  /** 是否在消息前显示时间分隔线（与上一条间隔 >5 分钟；由 TS 预计算） */
  showTimeSep?: boolean;
}

interface HelperData {
  theme: ThemeKey;
  themeStyle: string;
  pageStyle: PageStyleKey;
  bgStyle: BgStyleKey;
  bgClass: string;
  shellClass: string;
  pagePresets: { key: PageStyleKey; name: string; dot: string }[];
  bgPresets: { key: BgStyleKey; name: string; dot: string }[];
  showStyleSheet: boolean;
  messages: Msg[];
  /** 是否展示欢迎卡片（无历史消息时） */
  showWelcome: boolean;
  input: string;
  /** 助手思考中 */
  typing: boolean;
  /** 业务操作提交中（与聊天请求状态区分） */
  submitting: boolean;
  /** 输入框聚焦（用于聚焦态描边） */
  inputFocus: boolean;
  voiceOn: boolean;
  picking: boolean;
  aiOnline: boolean;
  quickChips: string[];
  scrollTo: string;
  /** 自定义导航尺寸 */
  padTop: number;
  navTotal: number;
  navRight: number;
  /** 底部安全区高度（px） */
  safeBottom: number;
}

/* ============================ 常量 ============================ */

const SUGGESTIONS = [
  '今日待办',
  '今天有什么安排？',
  '帮我记三件事：买牛奶、交电费、给妈妈打电话',
  '把开会的待办标记完成',
  '记一笔 32 块午饭',
  '打开记账本'
];

/** 简报每天只自动生成一次 */
const BRIEF_KEY = 'helper_brief_date';
/** 单张图片 base64 上限（云函数入参有体积限制） */
const MAX_IMAGE_KB = 700;
/** 页面左右 padding（rpx），与 navbar 避让计算保持一致 */
const PAGE_PAD_RPX = 32;

/** 消息自增 id（scroll-into-view 用） */
let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return 'msg_' + msgSeq;
}

/** 当前语音会话句柄（本地录音 + 云端转写） */
let voiceSession: { stop: () => void } | null = null;

/** AI 对话历史（最近 10 轮），跨消息复用以保持上下文 */
let aiHistory: ChatHistoryItem[] = [];

/** 待办明细缓存（本轮会话内复用，避免每条消息都遍历全量） */
let briefCache: TodoBriefItem[] = [];
let briefCacheAt = 0;

/** 请求序号：用于丢弃过期响应，避免快速连发时旧回复覆盖新回复 */
let reqSeq = 0;

Page<HelperData>({
  data: {
    theme: 'light',
    themeStyle: '',
    pageStyle: 'glass',
    bgStyle: 'aurora',
    bgClass: '',
    shellClass: '',
    pagePresets: [],
    bgPresets: [],
    showStyleSheet: false,
    messages: [],
    showWelcome: true,
    input: '',
    typing: false,
    submitting: false,
    inputFocus: false,
    voiceOn: false,
    picking: false,
    aiOnline: false,
    quickChips: SUGGESTIONS,
    scrollTo: '',
    padTop: 20,
    navTotal: 64,
    navRight: 0,
    safeBottom: 0
  },

  onLoad() {
    this.applyTheme();
    this.applyShell(loadShell('hlp').pageStyle, loadShell('hlp').bgStyle);
    this.applyNavMetrics();

    // 欢迎卡片承担「自我介绍 + 能力说明 + 4 个快捷操作」，
    // 不再额外插一条文本问候，避免和欢迎卡重复。
    this.setData({ showWelcome: true });
    this.maybeBrief();
  },

  onShow() {
    this.applyTheme();
  },

  onHide() {
    this.stopVoiceSession();
  },

  onUnload() {
    this.stopVoiceSession();
  },

  /* ==================== 导航与主题 ==================== */

  /** 依真实窗口计算状态栏 / 导航行高 / 胶囊右侧让位 */
  applyNavMetrics() {
    const nav = getNavMetrics(PAGE_PAD_RPX);
    let safeBottom = 0;
    try {
      const info: any = (wx as any).getWindowInfo
        ? (wx as any).getWindowInfo()
        : wx.getSystemInfoSync();
      safeBottom = (info && info.safeArea && info.screenHeight - info.safeArea.bottom) || 0;
    } catch (e) {
      safeBottom = 0;
    }
    this.setData({
      padTop: nav.statusBarHeight,
      navTotal: nav.navTotalHeight,
      navRight: nav.rightGap,
      safeBottom
    });
  },

  /** 停止未结束的语音会话，避免离开页面后残留录音 */
  stopVoiceSession() {
    if (voiceSession) {
      voiceSession.stop();
      voiceSession = null;
    }
    if (this.data.voiceOn) this.setData({ voiceOn: false });
  },

  now(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle });
    syncNavBar(s);
  },

  applyShell(page: PageStyleKey, bg: BgStyleKey) {
    const shell = saveShell('hlp', { pageStyle: page, bgStyle: bg });
    this.setData({
      pageStyle: shell.pageStyle,
      bgStyle: shell.bgStyle,
      shellClass: `tshell-ps-${shell.pageStyle}`,
      bgClass: `tshell-bg-${shell.bgStyle}`,
      pagePresets: [
        { key: 'glass', name: '立体玻璃', dot: '#38bdf8' },
        { key: 'frost', name: '柔雾磨砂', dot: '#a78bfa' },
        { key: 'relief', name: '丝绒浮雕', dot: '#f472b6' }
      ],
      bgPresets: [
        { key: 'none', name: '纯净', dot: '#e2e8f0' },
        { key: 'aurora', name: '极光', dot: '#6366f1' },
        { key: 'mesh', name: '星尘', dot: '#22d3ee' },
        { key: 'halo', name: '暖晖', dot: '#fbbf24' },
        { key: 'lattice', name: '栅格', dot: '#64748b' },
        { key: 'dots', name: '粒子', dot: '#c084fc' }
      ]
    });
  },

  onPageStyle(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PageStyleKey;
    if (!key || key === this.data.pageStyle) return;
    this.applyShell(key, this.data.bgStyle);
  },
  onBgStyle(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as BgStyleKey;
    if (!key || key === this.data.bgStyle) return;
    this.applyShell(this.data.pageStyle, key);
  },
  toggleStyleSheet() {
    this.setData({ showStyleSheet: !this.data.showStyleSheet });
  },
  onStyleSheetStop() { /* 阻止冒泡到遮罩 */ },

  /** 回到首页（顶栏返回） */
  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => go('/pages/index/index', { silent: true })
    });
  },

  /* ==================== 上下文：真实待办明细 ==================== */

  /**
   * 拉取真实待办并整理成「喂给模型的明细」。
   * 只上传回答所需的最少字段（标题/状态/截止/优先级），不上传备注、附件等隐私内容。
   */
  async collectContext(): Promise<{ brief: TodoBriefItem[]; todayTotal: number; todayDone: number; active: number }> {
    let todayTotal = 0;
    let todayDone = 0;
    let active = 0;
    let brief: TodoBriefItem[] = [];
    try {
      await todoStore.ensureLoaded();
      const todos = todoStore.rawList();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startTs = start.getTime();
      const now = Date.now();

      const live = todos.filter((t) => !t.archived);
      const inDay = live.filter((t) => t.dueDate && t.dueDate >= startTs && t.dueDate < startTs + 86400000);
      todayTotal = inDay.length;
      todayDone = inDay.filter((t) => t.completed).length;
      active = live.filter((t) => !t.completed).length;

      // 排序：未完成优先 → 有截止优先 → 逾期最前 → 高优先级靠前
      const rank = (t: ITodo) => {
        if (t.completed) return 3;
        if (t.dueDate && t.dueDate < now) return 0;
        if (t.dueDate) return 1;
        return 2;
      };
      const sorted = live
        .slice()
        .sort((a, b) => {
          const ra = rank(a);
          const rb = rank(b);
          if (ra !== rb) return ra - rb;
          if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
          return (b.updateTime || 0) - (a.updateTime || 0);
        })
        .slice(0, 40);

      brief = sorted.map((t) => ({
        content: (t.content || '').slice(0, 60),
        done: !!t.completed,
        overdue: !t.completed && !!t.dueDate && t.dueDate < now,
        due: t.dueDate ? this.fmtDue(t.dueDate) : undefined,
        priority: t.priority ?? null
      }));
    } catch (_e) {
      /* 弱网 / 无数据：保持空，不影响对话 */
    }
    briefCache = brief;
    briefCacheAt = Date.now();
    return { brief, todayTotal, todayDone, active };
  },

  /** 截止时间格式化：今天只显示 HH:mm，其他显示 MM-DD HH:mm */
  fmtDue(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    return sameDay ? `今天 ${hm}` : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
  },

  /** 完整时间戳格式化（任务卡详情用，真实业务数据） */
  fmtFull(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  /** 复用 60 秒内已算好的明细，避免每条消息都全量遍历 */
  async contextFast() {
    if (briefCacheAt && Date.now() - briefCacheAt < 60000) {
      const cached = briefCache;
      return { brief: cached, todayTotal: 0, todayDone: 0, active: cached.filter((b) => !b.done).length };
    }
    return this.collectContext();
  },

  /* ==================== 主动服务：今日简报 ==================== */

  maybeBrief() {
    let today = '';
    try {
      const d = new Date();
      today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    } catch (_e) {
      return;
    }
    let last = '';
    try { last = String(wx.getStorageSync(BRIEF_KEY) || ''); } catch (_e) { last = ''; }
    if (last === today) return;
    try { wx.setStorageSync(BRIEF_KEY, today); } catch (_e) { /* 存储失败不阻塞 */ }
    setTimeout(() => { this.runBrief(false); }, 700);
  },

  /** 生成今日简报；manual=true 时失败会给出可见提示 */
  async runBrief(manual: boolean) {
    if (this.data.typing) return;
    this.setData({ typing: true });
    try {
      const ctx = await this.collectContext();
      const res = await askBrief({
        context: { activeTodoCount: ctx.active, todayDone: ctx.todayDone, todayTotal: ctx.todayTotal, currentPage: '小助手' },
        todoBrief: ctx.brief
      });
      const m = this.makeMsg('bot', 'text', res.text || '今天也一起加油 💪');
      m.brief = true;
      m.showActions = !!(res.actions && res.actions.length);
      m.actions = res.actions;
      this.pushMsg(m);
      this.setData({ typing: false, aiOnline: true });
      aiHistory.push({ role: 'assistant', text: res.text || '' });
    } catch (err) {
      this.setData({ typing: false });
      // 失败不占用「今天已推过」的名额：改好云函数超时配置后重新进入就能拿到简报
      try { wx.removeStorageSync(BRIEF_KEY); } catch (_e) { /* 忽略 */ }
      if (manual) {
        if (isAINotConfigured(err)) {
          this.botSay('AI 还没接通 ☁️ 请确认云函数 helperChat 已上传部署（配置见接入说明）。\n现在规则引擎也能用：说「今天有什么待办」试试。');
        } else if (isAITimeout(err)) {
          this.botSay('简报生成超时 ⏱️ 云函数默认只给 3 秒。\n去云开发控制台 → 云函数 → helperChat → 版本与配置，把「超时时间」改成 60 秒即可。');
        } else {
          this.botSay('简报生成失败，稍后再试就好。你也可以直接问「今天有什么待办」。');
        }
      }
    }
  },

  /* ==================== 语音输入 ==================== */

  /**
   * 语音入口：本地录音 → 云端转写 → 自动发送为指令。
   * 不依赖任何小程序插件；云端未就绪时优雅降级为文字输入（明确提示，不伪造识别结果）。
   * 交互：按一次开始录音，再按一次结束并识别。
   */
  async onVoiceTap() {
    if (this.data.voiceOn) {
      this.setData({ voiceOn: false });
      this.botSay('收到，正在识别…');
      if (voiceSession) voiceSession.stop();
      return;
    }
    if (!isVoiceAvailable()) {
      toast('云端识别未就绪，请用文字输入', 'none');
      this.botSay('语音转写服务还没接通 ☁️ 需要部署 asr 云函数并配置腾讯云密钥（详见《备忘录语音转写接入说明.md》）。\n（现在用文字指令，效果一致。）');
      return;
    }
    const auth = await ensureRecordAuth();
    if (auth === 'denied') {
      toast('未获得麦克风权限');
      return;
    }
    voiceSession = startVoiceSession({
      onStatus: (status) => {
        if (status === 'recording') this.setData({ voiceOn: true, input: '' });
        else if (status === 'recognizing') this.botSay('识别中…');
      },
      onFinal: (text) => {
        voiceSession = null;
        this.setData({ voiceOn: false, input: text || '' });
        if (text && text.trim()) {
          this.pushUser(text.trim());
          this.respond(text.trim());
        } else {
          this.botSay('没听清，再试一次或直接用文字输入吧。');
        }
      },
      onError: () => {
        voiceSession = null;
        this.setData({ voiceOn: false });
        toast('语音识别失败，请用文字输入');
      }
    });
    if (voiceSession) {
      this.botSay('我在听，请说～ 说「打开记账本 / 今天有什么待办 / 帮我记一条待办」等，说完再按一次结束。');
    } else {
      this.setData({ voiceOn: false });
      toast('语音服务启动失败');
    }
  },

  /* ==================== 图片输入 ==================== */

  /** 选图 → 压缩 → base64 → 让模型看图作答 */
  onPickImage() {
    if (this.data.picking) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        const path = f && (f as { tempFilePath?: string }).tempFilePath;
        if (!path) return;
        this.prepareImage(path);
      },
      fail: () => { /* 用户取消，静默 */ }
    });
  },

  prepareImage(path: string) {
    this.setData({ picking: true });
    const read = (p: string) => this.readAsDataUrl(p);
    // 部分基础库的类型定义未覆盖 compressImage，这里按能力探测使用，缺失则直接用原图
    const compress = (wx as unknown as {
      compressImage?: (opts: { src: string; quality: number; success: (r: { tempFilePath: string }) => void; fail: () => void }) => void;
    }).compressImage;
    if (!compress) {
      read(path)
        .then((url) => this.sendImage(url))
        .catch(() => this.setData({ picking: false }));
      return;
    }
    compress({
      src: path,
      quality: 70,
      success: (r) => {
        read(r.tempFilePath)
          .then((url) => this.sendImage(url))
          .catch(() => this.setData({ picking: false }));
      },
      fail: () => {
        read(path)
          .then((url) => this.sendImage(url))
          .catch(() => this.setData({ picking: false }));
      }
    });
  },

  /** 读文件为 dataURL，并做体积预检（超限直接提示，不白跑一次请求） */
  readAsDataUrl(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: 'base64',
          success: (res) => {
            const b64 = String(res.data || '');
            const kb = Math.round((b64.length * 3) / 4 / 1024);
            if (kb > MAX_IMAGE_KB) {
              this.setData({ picking: false });
              toast('图片过大，请换一张或先裁剪');
              reject(new Error('IMAGE_TOO_LARGE'));
              return;
            }
            resolve('data:image/jpeg;base64,' + b64);
          },
          fail: () => {
            this.setData({ picking: false });
            toast('读取图片失败');
            reject(new Error('READ_FAIL'));
          }
        });
      } catch (_e) {
        this.setData({ picking: false });
        reject(new Error('READ_FAIL'));
      }
    });
  },

  sendImage(dataUrl: string) {
    this.setData({ picking: false });
    this.pushUser('[图片]', dataUrl);
    this.respond('看看这张图，帮我提取里面的待办或告诉我内容', { images: [dataUrl] });
  },

  /* ==================== 输入与发送 ==================== */

  onInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ input: e.detail.value });
  },
  onInputFocus() {
    this.setData({ inputFocus: true });
  },
  onInputBlur() {
    this.setData({ inputFocus: false });
  },
  onSend() {
    const text = this.data.input.trim();
    // 发送期间防重复提交
    if (!text || this.data.typing || this.data.submitting) return;
    this.setData({ input: '', inputFocus: false });
    if (text === '今日待办' || text === '今日简报') {
      this.pushUser(text);
      this.runBrief(true);
      return;
    }
    this.pushUser(text);
    this.respond(text);
  },
  onChip(e: WechatMiniprogram.TouchEvent) {
    const text = (e.currentTarget.dataset.q as string) || '';
    if (!text || this.data.typing || this.data.submitting) return;
    if (text === '今日待办' || text === '今日简报') {
      this.pushUser(text);
      this.runBrief(true);
      return;
    }
    this.pushUser(text);
    this.respond(text);
  },
  onEnter() {
    this.onSend();
  },

  pushUser(text: string, image?: string) {
    const m = this.makeMsg('user', 'text', text);
    m.image = image;
    this.pushMsg(m);
    this.setData({ typing: true });
  },

  /* ==================== 消息构造与推送 ==================== */

  makeMsg(role: 'user' | 'bot', type: MsgType, text: string): Msg {
    const ts = Date.now();
    return {
      id: nextMsgId(),
      role,
      type,
      text,
      ts,
      time: this.now()
    };
  },

  /** 统一追加消息并滚动到底；首次用户消息后收起欢迎卡 */
  pushMsg(m: Msg) {
    const prev = this.data.messages[this.data.messages.length - 1];
    // 时间分隔线在 TS 侧算好：WXML 表达式不适合做「数组下标算术 + 比较」的组合判断
    m.showTimeSep = !!prev && m.ts - prev.ts > 300000;
    const next = this.data.messages.concat(m);
    this.setData({
      messages: next,
      scrollTo: m.id,
      showWelcome: next.length === 0
    });
  },

  /** 助手发一条纯文本 */
  botSay(text: string) {
    const m = this.makeMsg('bot', 'text', text);
    this.pushMsg(m);
    this.setData({ typing: false });
  },

  /** 助手发一张结构化任务结果卡（内容必须来自真实执行结果） */
  botCard(result: OpResult, text?: string) {
    const m = this.makeMsg('bot', 'task_result', text || '');
    m.opResult = result;
    this.pushMsg(m);
    this.setData({ typing: false, submitting: false });
  },

  /** 助手发错误卡（可重试） */
  botError(text: string, retryText?: string) {
    const m = this.makeMsg('bot', 'error', text);
    m.retryable = !!retryText;
    m.retryText = retryText;
    this.pushMsg(m);
    this.setData({ typing: false, submitting: false });
  },

  /* ==================== 主流程：理解 → 执行 → 回复 ==================== */

  async respond(input: string, opts?: { images?: string[] }) {
    const myReq = ++reqSeq;
    const ctx = await this.contextFast();
    if (myReq !== reqSeq) return; // 已被更新的请求取代

    // 优先走 AI 大模型；未配置 / 失败时静默回退到本地规则引擎，保证始终有响应
    try {
      const ai = await askAI({
        message: input,
        history: aiHistory,
        context: { activeTodoCount: ctx.active, todayDone: ctx.todayDone, todayTotal: ctx.todayTotal, currentPage: '小助手' },
        todoBrief: ctx.brief,
        images: opts?.images
      });
      if (myReq !== reqSeq) return;

      aiHistory.push({ role: 'user', text: input });
      aiHistory.push({ role: 'assistant', text: ai.text || '' });

      // —— 危险操作拦截：先确认，不直接执行 ——
      const danger = this.pickDangerOp(ai.ops);
      if (danger) {
        const others = (ai.ops || []).filter((o) => o !== danger);
        // 非危险部分照常执行
        if (others.length) {
          this.setData({ submitting: true });
          const r0 = await this.execOps(others);
          this.setData({ submitting: false });
          this.emitOpResults(r0, '');
          if (r0.notes.length) briefCacheAt = 0;
        }
        this.pushConfirm(danger, ai.text || '这个操作会改变你的数据，请确认后我再执行。');
        return;
      }

      // 执行模型给出的可执行操作（建待办 / 完成 / 改期 / 删除 / 便签 / 跳转）
      this.setData({ submitting: true });
      const r = await this.execOps(ai.ops || []);
      this.setData({ submitting: false, typing: false });
      if (myReq !== reqSeq) return;

      let replyText = ai.text || '';
      // 有结构化结果时，卡片承载「已执行」信息，正文不再重复堆 notes
      this.emitOpResults(r, replyText);
      if (r.notes.length) briefCacheAt = 0;

      let replyActions = ai.actions && ai.actions.length > 0 ? ai.actions : [];
      // 已经跳转过就不再堆跳转按钮；否则保证至少有一个出口
      if (r.navHandled) {
        replyActions = replyActions.filter((a) => a.kind === 'none');
      } else if (!replyActions.length && !r.results.length && r.notes.length) {
        replyActions = [{ kind: 'nav-todo-panel', label: '✅ 去待办清单', module: 'todo-panel' }];
      }

      if (replyText || (!r.results.length && replyActions.length)) {
        const reply = toHelperReply({ text: replyText, actions: replyActions });
        const m = this.makeMsg('bot', 'text', r.results.length ? replyText || '' : reply.text);
        // 有卡片时正文保持简洁，避免和卡片重复
        m.text = r.results.length ? this.leadText(replyText, r) : reply.text;
        m.showActions = !!(reply.actions && reply.actions.length) && !r.results.length;
        m.actions = reply.actions;
        this.pushMsg(m);
      }

      this.setData({ aiOnline: true });
      return;
    } catch (err) {
      if (myReq !== reqSeq) return;
      const notConfigured = isAINotConfigured(err);
      if (!notConfigured) {
        console.error('[helper] AI 调用失败，回退本地规则:', err);
      }
      // 规则引擎兜底：仍走真实数据，不做假成功
      const fallbackReply = replyTo(input, { activeTodoCount: ctx.active, todayDone: ctx.todayDone, todayTotal: ctx.todayTotal });
      const fb = this.makeMsg('bot', 'text', fallbackReply.text);
      fb.showActions = !!(fallbackReply.actions && fallbackReply.actions.length);
      fb.actions = fallbackReply.actions;
      this.pushMsg(fb);
      this.setData({ typing: false, submitting: false });
      return;
    }
  },

  /** 有卡片时的引导语：正文只留一句，避免和卡片内容重复 */
  leadText(text: string, r: { notes: string[]; results: OpResult[] }): string {
    const base = (text || '').trim();
    if (!r.results.length) return base;
    const okCount = r.results.filter((x) => !x.errorText).length;
    if (base) return base;
    return okCount ? '已为你处理完成 ✨' : '操作没能完成，可以再试一次。';
  },

  /** 把 execOps 的结构化结果渲染成卡片（真实驱动） */
  emitOpResults(r: { notes: string[]; results: OpResult[]; navHandled: boolean }, _replyText: string) {
    if (!r.results.length) {
      // 没有结构化结果时，若有 notes 追加到最近一条文本消息
      if (r.notes.length) {
        const list = this.data.messages.slice();
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].role === 'bot' && list[i].type === 'text') {
            list[i] = { ...list[i], text: list[i].text ? list[i].text + '\n' + r.notes.join('\n') : r.notes.join('\n') };
            break;
          }
        }
        this.setData({ messages: list });
      }
      return;
    }
    // 每条真实结果一张卡
    for (const res of r.results) {
      this.botCard(res);
    }
  },

  /** 挑出需要确认的危险 op（目前：删除任务） */
  pickDangerOp(ops?: HelperOp[]): HelperOp | null {
    if (!ops || !ops.length) return null;
    for (const op of ops) {
      if (op.type === 'todo.remove') return op;
    }
    return null;
  },

  /** 推送危险操作确认卡 */
  pushConfirm(op: HelperOp, text: string) {
    const target = this.findTodo(op.match);
    const name = target ? this.shortTitle(target.content) : this.shortTitle(op.match || '这条待办');
    const m = this.makeMsg('bot', 'confirmation', text);
    m.pendingOp = op;
    m.text = `即将删除「${name}」。删除后无法自动恢复，确定继续吗？`;
    m.actions = [
      { kind: 'none', label: '确认删除', payload: 'confirm' } as HelperAction,
      { kind: 'none', label: '再想想', payload: 'cancel' } as HelperAction
    ];
    m.showActions = true;
    this.pushMsg(m);
    this.setData({ typing: false, submitting: false });
  },

  /* ==================== 确认 / 撤销 / 重试 ==================== */

  /**
   * 卡片上的操作分发：
   *   payload=confirm/cancel → 危险操作确认
   *   payload=undo         → 真实撤销
   *   其余 kind              → 原有动作（建待办/完成/改期/跳转）
   */
  onAction(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as {
      kind?: string;
      label?: string;
      module?: string;
      payload?: string;
      due?: number;
      msgId?: string;
    };
    const kind = ds.kind as HelperActionKind;
    const label = ds.label || '';
    const mod = ds.module || '';
    const payload = ds.payload || '';
    const due = ds.due || 0;
    const msgId = ds.msgId || '';

    // —— 危险操作确认 ——
    if (payload === 'confirm' && msgId) { this.confirmDanger(msgId); return; }
    if (payload === 'cancel' && msgId) { this.cancelConfirm(msgId); return; }

    // —— 撤销 ——
    if (payload === 'undo' && msgId) { this.undoOp(msgId); return; }

    // —— 可直接执行的操作（规则引擎/AI 产出的「一键动作」） ——
    if (kind === 'todo-create') { this.execCreateTodo(payload || label); return; }
    if (kind === 'note-create') { this.execCreateNote(payload || label); return; }
    if (kind === 'todo-complete') { this.execCompleteTodo(mod, payload !== '0', label); return; }
    if (kind === 'todo-reschedule') { this.execRescheduleTodo(mod, due, label); return; }

    if (kind === 'nav-module') {
      if (mod && jumpToModule(mod)) return;
      go('/pages/tools/tools');
      return;
    }
    if (kind === 'nav-tools') { go('/pages/tools/tools'); return; }
    if (kind === 'nav-group') { go('/pages/group-reminder/group-reminder'); return; }
    if (kind === 'nav-subscribe') { go('/pages/subscribe-reminder/subscribe-reminder'); return; }
    if (kind === 'nav-important') { go('/subpackages/toolbox/pages/important-day/important-day'); return; }
    if (kind === 'nav-todo-panel') { go('/pages/todo-panel/todo-panel'); return; }
    if (kind === 'nav-pomodoro') { go('/subpackages/toolbox/pages/tool/tool?type=pomodoro'); return; }
    if (kind === 'none' && label.indexOf('建好') >= 0) {
      const mm = label.match(/「(.+?)」/);
      const content = mm ? mm[1] : '';
      if (!content) { toast('无法创建，内容为空'); return; }
      this.execCreateTodo(content);
      return;
    }
    toast('收到');
  },

  /** 确认执行删除 */
  async confirmDanger(msgId: string) {
    const msg = this.data.messages.find((m) => m.id === msgId);
    if (!msg || !msg.pendingOp) return;
    const op = msg.pendingOp;
    this.setData({ submitting: true });

    const target = this.findTodo(op.match);
    if (!target) {
      this.setData({ submitting: false });
      this.botError(`没找到「${op.match || '这条待办'}」，没有删除任何内容。`, op.match || '');
      this.markConfirmDone(msgId, '已取消');
      return;
    }
    const name = this.shortTitle(target.content);
    try {
      await todoStore.removeTodo(target._id);
      briefCacheAt = 0;
      this.setData({ submitting: false });
      this.markConfirmDone(msgId, '已删除');
      this.botCard({
        title: '已删除任务',
        taskName: name,
        statusText: '已删除',
        details: [
          { label: '任务名称', value: name },
          { label: '操作结果', value: '已从清单中删除' },
          { label: '操作时间', value: this.fmtFull(Date.now()) }
        ],
        todoId: target._id,
        undoable: false, // 后端无「恢复已删除」能力，不提供假撤销
        at: Date.now()
      });
    } catch (err) {
      console.error('[helper] 删除失败:', err);
      this.setData({ submitting: false });
      this.botError('删除失败，请稍后重试。', op.match || '');
      this.markConfirmDone(msgId, '删除失败');
    }
  },

  /** 取消删除 */
  cancelConfirm(msgId: string) {
    this.markConfirmDone(msgId, '已取消');
    toast('已取消', 'none');
  },

  /** 把确认卡收敛成一行结果 */
  markConfirmDone(msgId: string, suffix: string) {
    const list = this.data.messages.slice();
    const i = list.findIndex((m) => m.id === msgId);
    if (i < 0) return;
    const m = list[i];
    const base = (m.text || '').split('\n')[0];
    list[i] = { ...m, type: 'text', text: `${base}（${suffix}）`, pendingOp: undefined, showActions: false, actions: [] };
    this.setData({ messages: list });
  },

  /** 真实撤销：complete↔uncomplete 用 toggle 反向；reschedule 还原旧日期 */
  async undoOp(msgId: string) {
    const msg = this.data.messages.find((m) => m.id === msgId);
    if (!msg || !msg.opResult || !msg.opResult.undoable || !msg.opResult.todoId) return;
    const res = msg.opResult;
    this.setData({ submitting: true });
    try {
      if (res.statusText === '已完成') {
        await todoStore.toggleTodo(res.todoId, false);
        briefCacheAt = 0;
        this.setData({ submitting: false });
        this.markUndone(msgId, '已恢复为未完成');
      } else if (res.statusText === '未完成') {
        await todoStore.toggleTodo(res.todoId, true);
        briefCacheAt = 0;
        this.setData({ submitting: false });
        this.markUndone(msgId, '已重新标记完成');
      } else if (res.undoLabel === '撤销新建') {
        await todoStore.removeTodo(res.todoId);
        briefCacheAt = 0;
        this.setData({ submitting: false });
        this.markUndone(msgId, '已撤销创建，任务已移除');
      } else {
        this.setData({ submitting: false });
        toast('该操作暂不支持撤销');
      }
    } catch (err) {
      console.error('[helper] 撤销失败:', err);
      this.setData({ submitting: false });
      this.botError('撤销失败，请稍后重试。');
    }
  },

  /** 撤销后更新卡片状态 */
  markUndone(msgId: string, note: string) {
    const list = this.data.messages.slice();
    const i = list.findIndex((m) => m.id === msgId);
    if (i < 0) return;
    const m = list[i];
    const op = m.opResult;
    if (!op) return;
    let statusText = op.statusText;
    if (op.statusText === '已完成') statusText = '未完成';
    else if (op.statusText === '未完成') statusText = '已完成';
    list[i] = {
      ...m,
      opResult: { ...op, statusText, undoable: false },
      showActions: false,
      actions: []
    };
    this.setData({ messages: list });
    toast(note, 'none');
  },

  /** 错误卡重试：重新提交原文 */
  onRetry(e: WechatMiniprogram.TouchEvent) {
    const msgId = (e.currentTarget.dataset.msgId as string) || '';
    const msg = this.data.messages.find((m) => m.id === msgId);
    if (!msg || !msg.retryText) return;
    if (this.data.typing || this.data.submitting) return;
    // 移除失败卡，避免重试后卡片堆积
    const list = this.data.messages.filter((m) => m.id !== msgId);
    this.setData({ messages: list });
    this.pushUser(msg.retryText);
    this.respond(msg.retryText);
  },

  /** 卡片里的「查看任务」 */
  onViewTask(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.todoId as string) || '';
    if (!id) { go('/pages/todo-panel/todo-panel'); return; }
    go(`/pages/detail/detail?id=${encodeURIComponent(id)}`);
  },

  /** 一键新建待办：规则引擎的「建好「X」」按钮（走真实 store，产出结构化卡） */
  async execCreateTodo(content: string) {
    const c = (content || '').trim();
    if (!c) { toast('内容为空'); return; }
    this.setData({ submitting: true });
    try {
      const created = await todoStore.addTodo({ content: c });
      briefCacheAt = 0;
      this.setData({ submitting: false, typing: false });
      if (!created) {
        this.botError('创建失败，没有生成待办。请稍后重试。', c);
        return;
      }
      toast('已创建 ✔');
      this.botCard({
        title: '已为你创建任务',
        taskName: this.shortTitle(created.content || c),
        statusText: created.dueDate ? '已创建' : '已创建',
        details: [
          { label: '任务名称', value: created.content || c },
          { label: '操作结果', value: '已加入待办清单' },
          { label: '截止时间', value: created.dueDate ? this.fmtFull(created.dueDate) : '未设置' },
          { label: '创建时间', value: this.fmtFull(Date.now()) }
        ],
        todoId: created._id,
        undoable: true, // 后端支持 removeTodo → 撤销=移除该条
        undoLabel: '撤销新建',
        at: Date.now()
      });
    } catch (err) {
      console.error('[helper] 创建待办失败:', err);
      this.setData({ submitting: false });
      this.botError('创建失败，请稍后重试。', c);
    }
  },

  /** 一键存便签：规则引擎的「存便签」按钮 */
  async execCreateNote(content: string) {
    const c = (content || '').trim();
    if (!c) { toast('内容为空'); return; }
    try {
      const id = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const now = Date.now();
      await callFn('notes', {
        action: 'upsert',
        note: {
          _id: id,
          content: c,
          colorKey: 'default',
          patternKey: 'none',
          figureKey: 'none',
          pinned: false,
          createTime: now,
          updateTime: now
        }
      });
      toast('已存便签 📌');
      this.botSay(`已帮你存成便签：「${c}」。在「便签」页可以随时翻看。`);
    } catch (err) {
      this.botError('便签保存失败，请稍后重试。', c);
    }
  },

  /** 一键标记完成/恢复：规则引擎的「完成「X」」按钮 */
  async execCompleteTodo(title: string, wantDone: boolean, label: string) {
    const t = (title || '').trim();
    if (!t) { toast('未指定待办'); return; }
    const target = this.findTodo(t);
    if (!target) {
      toast('没找到这条待办');
      this.botError(`没在清单里找到「${t}」，你可以去待办清单手动${wantDone ? '勾选完成' : '恢复'}。`);
      return;
    }
    this.setData({ submitting: true });
    try {
      await todoStore.toggleTodo(target._id, wantDone);
      briefCacheAt = 0;
      this.setData({ submitting: false, typing: false });
      const now = Date.now();
      this.botCard({
        title: wantDone ? '已为你完成任务' : '已恢复任务',
        taskName: this.shortTitle(target.content),
        statusText: wantDone ? '已完成' : '未完成',
        details: [
          { label: '任务名称', value: target.content },
          { label: '操作结果', value: wantDone ? '成功标记为完成' : '已恢复为未完成' },
          { label: wantDone ? '完成时间' : '操作时间', value: this.fmtFull(now) }
        ],
        todoId: target._id,
        undoable: true, // toggle 反向即撤销
        undoLabel: wantDone ? '撤销完成' : '撤销恢复',
        at: now
      });
    } catch (err) {
      console.error('[helper] 标记完成失败:', err);
      this.setData({ submitting: false });
      this.botError('操作失败，请重试。', t);
    }
  },

  /** 一键改期：规则引擎的「改到 X」按钮 */
  async execRescheduleTodo(title: string, due: number, label: string) {
    const t = (title || '').trim();
    if (!t) { toast('未指定待办'); return; }
    const target = this.findTodo(t);
    if (!target) {
      toast('没找到这条待办');
      this.botError(`没在清单里找到「${t}」，你可以去待办清单手动改期。`);
      return;
    }
    this.setData({ submitting: true });
    try {
      await todoStore.updateTodo(target._id, { dueDate: due }, true);
      briefCacheAt = 0;
      this.setData({ submitting: false, typing: false });
      const now = Date.now();
      this.botCard({
        title: '已为你调整日程',
        taskName: this.shortTitle(target.content),
        statusText: '已改期',
        details: [
          { label: '任务名称', value: target.content },
          { label: '新截止时间', value: this.fmtFull(due) },
          { label: '操作时间', value: this.fmtFull(now) }
        ],
        todoId: target._id,
        undoable: false, // 未保存旧时间，不提供假撤销
        at: now
      });
    } catch (err) {
      console.error('[helper] 改期失败:', err);
      this.setData({ submitting: false });
      this.botError('改期失败，请重试。', t);
    }
  },

  /* ==================== ops 执行（返回结构化真实结果） ==================== */

  /**
   * 执行模型给出的操作。逐个执行、单个失败不影响其余。
   * 返回结构化结果供卡片渲染 —— 每个 OpResult 都对应一次真实 store 调用。
   */
  async execOps(ops: HelperOp[]): Promise<{ notes: string[]; results: OpResult[]; navHandled: boolean }> {
    const notes: string[] = [];
    const results: OpResult[] = [];
    let navHandled = false;

    for (const op of ops) {
      const now = Date.now();
      try {
        switch (op.type) {
          case 'todo.add': {
            const content = (op.content || '').trim();
            if (!content) break;
            const due = parseDueDate(op.dueDate);
            const created = await todoStore.addTodo({
              content,
              dueDate: due ?? null,
              priority: (op.priority as 'high' | 'medium' | 'low' | undefined) ?? null,
              tags: op.tags && op.tags.length ? op.tags : []
            });
            if (!created) {
              results.push({
                title: '创建失败',
                taskName: this.shortTitle(content),
                statusText: '执行失败',
                details: [
                  { label: '任务名称', value: content },
                  { label: '操作结果', value: '未创建成功' }
                ],
                errorText: '待办未能创建，请稍后重试。',
                undoable: false,
                at: now
              });
              break;
            }
            notes.push(`✅ 已新建「${content}」${due ? '（' + this.fmtDue(due) + '）' : ''}`);
            results.push({
              title: '已为你创建任务',
              taskName: this.shortTitle(content),
              statusText: '已创建',
              details: [
                { label: '任务名称', value: content },
                { label: '操作结果', value: '已加入待办清单' },
                { label: '截止时间', value: due ? this.fmtFull(due) : '未设置' },
                { label: '创建时间', value: this.fmtFull(now) }
              ],
              todoId: created._id,
              undoable: true,
              undoLabel: '撤销新建',
              at: now
            });
            break;
          }
          case 'todo.addMany': {
            const items = (op.items || []).filter((i) => i && i.content);
            if (!items.length) break;
            let ok = 0;
            const names: string[] = [];
            for (const it of items) {
              const due = parseDueDate(it.dueDate);
              const created = await todoStore.addTodo({
                content: it.content.trim(),
                dueDate: due ?? null,
                priority: (it.priority as 'high' | 'medium' | 'low' | undefined) ?? null,
                tags: it.tags && it.tags.length ? it.tags : []
              });
              if (created) {
                ok += 1;
                names.push(it.content.trim());
              }
            }
            if (ok) {
              notes.push(`✅ 已新建 ${ok} 条待办`);
              results.push({
                title: '已为你批量创建任务',
                taskName: this.shortTitle(names.join('、')),
                statusText: `已创建 ${ok} 条`,
                details: [
                  { label: '任务数量', value: `${ok} 条` },
                  { label: '任务列表', value: names.join('、') },
                  { label: '创建时间', value: this.fmtFull(now) }
                ],
                undoable: false, // 批量撤销不提供，避免误删
                at: now
              });
            } else {
              results.push({
                title: '批量创建失败',
                taskName: this.shortTitle(items.map((i) => i.content).join('、')),
                statusText: '执行失败',
                details: [{ label: '操作结果', value: '未创建成功' }],
                errorText: '待办未能创建，请稍后重试。',
                undoable: false,
                at: now
              });
            }
            break;
          }
          case 'todo.complete':
          case 'todo.uncomplete': {
            const target = this.findTodo(op.match);
            if (!target) {
              notes.push(`⚠️ 没找到「${op.match}」，可在待办清单里手动勾选`);
              results.push({
                title: '未找到任务',
                taskName: this.shortTitle(op.match || ''),
                statusText: '执行失败',
                details: [
                  { label: '匹配关键词', value: op.match || '（空）' },
                  { label: '操作结果', value: '清单中未找到该任务' }
                ],
                errorText: '没找到这条待办，请确认名称或去清单手动操作。',
                undoable: false,
                at: now
              });
              break;
            }
            const want = op.type === 'todo.complete';
            await todoStore.toggleTodo(target._id, want);
            notes.push(`✅ 已${want ? '' : '取消'}完成「${this.shortTitle(target.content)}」`);
            results.push({
              title: want ? '已为你完成任务' : '已恢复任务',
              taskName: this.shortTitle(target.content),
              statusText: want ? '已完成' : '未完成',
              details: [
                { label: '任务名称', value: target.content },
                { label: '操作结果', value: want ? '成功标记为完成' : '已恢复为未完成' },
                { label: want ? '完成时间' : '操作时间', value: this.fmtFull(now) }
              ],
              todoId: target._id,
              undoable: true,
              undoLabel: want ? '撤销完成' : '撤销恢复',
              at: now
            });
            break;
          }
          case 'todo.reschedule': {
            const target = this.findTodo(op.match);
            const due = parseDueDate(op.dueDate);
            if (!target) {
              notes.push(`⚠️ 没找到「${op.match}」，无法改期`);
              results.push({
                title: '未找到任务',
                taskName: this.shortTitle(op.match || ''),
                statusText: '执行失败',
                details: [
                  { label: '匹配关键词', value: op.match || '（空）' },
                  { label: '操作结果', value: '清单中未找到该任务' }
                ],
                errorText: '没找到这条待办，无法改期。',
                undoable: false,
                at: now
              });
              break;
            }
            if (!due) {
              notes.push('⚠️ 没听清要改到哪一天，请说得更具体些');
              results.push({
                title: '未执行改期',
                taskName: this.shortTitle(target.content),
                statusText: '执行失败',
                details: [{ label: '操作结果', value: '没能解析出目标日期' }],
                errorText: '没听清要改到哪一天，请说得更具体些。',
                undoable: false,
                at: now
              });
              break;
            }
            await todoStore.updateTodo(target._id, { dueDate: due }, true);
            notes.push(`✅ 「${this.shortTitle(target.content)}」已改到 ${this.fmtDue(due)}`);
            results.push({
              title: '已为你调整日程',
              taskName: this.shortTitle(target.content),
              statusText: '已改期',
              details: [
                { label: '任务名称', value: target.content },
                { label: '新截止时间', value: this.fmtFull(due) },
                { label: '操作时间', value: this.fmtFull(now) }
              ],
              todoId: target._id,
              undoable: false,
              at: now
            });
            break;
          }
          case 'todo.priority': {
            const target = this.findTodo(op.match);
            if (!target) {
              results.push({
                title: '未找到任务',
                taskName: this.shortTitle(op.match || ''),
                statusText: '执行失败',
                details: [{ label: '操作结果', value: '清单中未找到该任务' }],
                errorText: '没找到这条待办。',
                undoable: false,
                at: now
              });
              break;
            }
            const p = (op as { priority?: 'high' | 'medium' | 'low' }).priority;
            if (!p) break;
            await todoStore.updateTodo(target._id, { priority: p }, true);
            notes.push(`✅ 「${this.shortTitle(target.content)}」优先级已更新`);
            const pLabel = p === 'high' ? '高' : p === 'low' ? '低' : '中';
            results.push({
              title: '已更新优先级',
              taskName: this.shortTitle(target.content),
              statusText: '已更新',
              details: [
                { label: '任务名称', value: target.content },
                { label: '新优先级', value: pLabel },
                { label: '操作时间', value: this.fmtFull(now) }
              ],
              todoId: target._id,
              undoable: false,
              at: now
            });
            break;
          }
          case 'todo.remove': {
            // 删除已在 respond 阶段被拦截并确认过；这里兜底直接执行
            const target = this.findTodo(op.match);
            if (!target) {
              results.push({
                title: '未找到任务',
                taskName: this.shortTitle(op.match || ''),
                statusText: '执行失败',
                details: [{ label: '操作结果', value: '清单中未找到该任务' }],
                errorText: '没找到这条待办，没有删除任何内容。',
                undoable: false,
                at: now
              });
              break;
            }
            await todoStore.removeTodo(target._id);
            notes.push(`✅ 已删除「${this.shortTitle(target.content)}」`);
            results.push({
              title: '已删除任务',
              taskName: this.shortTitle(target.content),
              statusText: '已删除',
              details: [
                { label: '任务名称', value: target.content },
                { label: '操作结果', value: '已从清单中删除' },
                { label: '操作时间', value: this.fmtFull(now) }
              ],
              todoId: target._id,
              undoable: false,
              at: now
            });
            break;
          }
          case 'note.add': {
            const text = (op.text || '').trim();
            if (!text) break;
            const id = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            await callFn('notes', {
              action: 'upsert',
              note: {
                _id: id,
                content: text,
                colorKey: 'default',
                patternKey: 'none',
                figureKey: 'none',
                pinned: false,
                createTime: now,
                updateTime: now
              }
            });
            notes.push('✅ 已存进便签');
            results.push({
              title: '已存入便签',
              taskName: this.shortTitle(text),
              statusText: '已保存',
              details: [
                { label: '内容', value: text },
                { label: '操作结果', value: '已保存到便签' },
                { label: '保存时间', value: this.fmtFull(now) }
              ],
              undoable: false, // 便签无删除撤销接口，不提供假撤销
              at: now
            });
            break;
          }
          case 'ledger.add': {
            // 记账涉及账户/分类等本地账本上下文，这里只做引导，不直接写账，避免写脏数据
            const amount = op.amount;
            const tip = `记一笔 ${amount} 元${op.category ? '（' + op.category + '）' : ''}${op.note ? ' · ' + op.note : ''}`;
            navHandled = jumpToModule('ledger') || navHandled;
            notes.push(`💰 已为你打开记账本，可一键记「${tip}」`);
            break;
          }
          case 'nav': {
            if (op.module && jumpToModule(op.module)) navHandled = true;
            break;
          }
          default:
            break;
        }
      } catch (e) {
        console.error('[helper] op 执行失败:', op && op.type, e);
        notes.push(`⚠️ ${op.type} 执行失败，请在对应页面确认`);
        // 失败也产出一张 failed 卡，绝不静默、也绝不误报成功
        results.push({
          title: '任务执行失败',
          taskName: this.shortTitle(op.match || op.content || op.type),
          statusText: '执行失败',
          details: [
            { label: '操作类型', value: op.type },
            { label: '操作结果', value: '未能完成' }
          ],
          errorText: '操作未能完成，请检查网络后重试。',
          undoable: false,
          at: now
        });
      }
    }

    return { notes, results, navHandled };
  },

  /** 在未归档待办里按关键词找最匹配的一条（未完成优先、标题更短者优先） */
  findTodo(match?: string): ITodo | null {
    const key = (match || '').trim().toLowerCase();
    if (!key) return null;
    const list = todoStore.rawList().filter((t) => !t.archived);
    const hit = list.filter((t) => (t.content || '').toLowerCase().indexOf(key) >= 0);
    if (!hit.length) return null;
    hit.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return (a.content || '').length - (b.content || '').length;
    });
    return hit[0];
  },

  shortTitle(s: string): string {
    const t = s || '';
    return t.length > 12 ? t.slice(0, 12) + '…' : t;
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '小琳 · 待办助手',
      path: '/subpackages/toolbox/pages/little-helper/little-helper'
    };
  }
});
