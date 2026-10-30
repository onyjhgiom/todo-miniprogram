// pages/group-reminder/group-reminder.ts
// 多人提醒工具页：创建提醒 → 选择多位参与者 → 到期同时通知（本地）。
// 含：列表/开关/重复周期/删除 + 新建&编辑弹层（标题/备注/时间/成员多选/方式/周期）
// + 页面风格(glass/frost/relief)与背景风格切换 + 高级立体视觉。
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast, callFn } from '../../utils/cloud';
import { SUB_TMPL_ID, requestSubscribe, grantSubscription } from '../../utils/subscribe';
import { loadShell, saveShell } from '../../utils/tool-shell';
import {
  loadAlerts, addAlert, updateAlert, removeAlert, ensureRegistered,
  DEFAULT_MEMBERS, uid, buildShareMessage,
  type GrpAlert, type GrpMember, type RepeatKind
} from '../../utils/group-reminder-store';
import { loadLogs, recentLogs, clearLogs, type GrpLog } from '../../utils/group-reminder-log';
import { fmtCn, pad, relTime } from '../../utils/datefmt';

import type { ThemeKey } from '../../types/index';
import type { PageStyleKey, BgStyleKey } from '../../utils/tool-shell';

interface DecoratedAlert extends GrpAlert {
  timeText: string;
  repeatLabel: string;
  rel: string;
  statusText: string;
  memberChips: { name: string; avatar: string; tone: string }[];
  /** 记录行左侧方形图标（按重复类型给不同表情，和参考图的 📅/🌷 一致） */
  icon: string;
}

interface DecoratedLog extends GrpLog {
  atFormat: string;
  membersText: string;
}

const REPEAT_LABEL: Record<RepeatKind, string> = {
  none: '单次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月'
};

const REPEAT_OPTIONS: { key: RepeatKind; label: string }[] = [
  { key: 'none', label: '单次' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' }
];

/**
 * 场景快捷入口（参考图的四个小胶囊）。
 * 作用不是装饰：点一下直接打开新建弹层并预填标题与重复周期，
 * 把「生日/聚会/缴费/纪念日」这类最常见的提醒压缩成一次点击。
 */
interface SceneItem {
  key: string;
  icon: string;
  name: string;
  title: string;
  repeat: RepeatKind;
}

const SCENES: SceneItem[] = [
  { key: 'birthday', icon: '🎂', name: '生日', title: '生日提醒', repeat: 'monthly' },
  { key: 'party', icon: '🍽', name: '聚会', title: '一起吃饭', repeat: 'none' },
  { key: 'bill', icon: '💳', name: '缴费', title: '账单缴费', repeat: 'monthly' },
  { key: 'anniv', icon: '🌷', name: '纪念日', title: '纪念日', repeat: 'monthly' }
];

interface GrpData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  // 页面外壳风格
  pageStyle: PageStyleKey;
  bgStyle: BgStyleKey;
  bgClass: string;
  shellClass: string;
  pagePresets: { key: PageStyleKey; name: string; dot: string }[];
  bgPresets: { key: BgStyleKey; name: string; dot: string }[];
  showStyleSheet: boolean;
  // 列表
  alerts: DecoratedAlert[];
  activeCount: number;
  loading: boolean;
  /** 三指标数据条（全部真实计算，禁止写死） */
  metrics: { active: number; members: number; week: number };
  /** 场景快捷入口 */
  scenes: SceneItem[];
  /** 提醒记录区是否展开（参考图的「展开 ▼」） */
  showRecords: boolean;
  /** 当前展开了操作区的提醒 id（同一时刻最多一条，默认空 = 全部收起） */
  expandedId: string;
  /** 分享深链高亮 */
  highlightId: string;
  // 提醒记录
  logs: DecoratedLog[];
  showLogs: boolean;
  logCount: number;
  // 订阅消息模板是否已配置
  subTmplReady: boolean;
  // 弹层
  showEditor: boolean;
  editingId: string | null;
  formTitle: string;
  formNote: string;
  formDate: string;
  formTime: string;
  selectedIds: string[];
  members: GrpMember[];
  method: 'toast' | 'modal';
  repeat: RepeatKind;
  repeatOptions: { key: RepeatKind; label: string }[];
  formError: string;
}

Page<GrpData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    pageStyle: 'glass',
    bgStyle: 'aurora',
    bgClass: '',
    shellClass: '',
    pagePresets: [],
    bgPresets: [],
    showStyleSheet: false,
    alerts: [],
    activeCount: 0,
    loading: true,
    metrics: { active: 0, members: 0, week: 0 },
    scenes: SCENES,
    showRecords: true,
    expandedId: '',
    highlightId: '',
    logs: [],
    showLogs: false,
    logCount: 0,
    subTmplReady: SUB_TMPL_ID.length > 0,
    showEditor: false,
    editingId: null,
    formTitle: '',
    formNote: '',
    formDate: '',
    formTime: '',
    selectedIds: [],
    members: DEFAULT_MEMBERS,
    method: 'modal',
    repeat: 'none',
    repeatOptions: REPEAT_OPTIONS,
    formError: ''
  },

  onLoad(options?: Record<string, string>) {
    ensureRegistered();
    const shell = loadShell('grp');
    this.applyTheme();
    this.applyShell(shell.pageStyle, shell.bgStyle);
    // 来自好友分享卡片：高亮对应提醒
    if (options && options.alert) {
      this.setData({ highlightId: options.alert });
    }
    this.refresh();
  },

  onShow() {
    this.applyTheme();
    // 回到页面时刷新（可能跨天导致周期推进状态变化）
    this.refresh();
  },

  // 分享给微信好友（button open-type="share" 触发）
  onShareAppMessage(e?: { from?: 'button' | 'menu'; target?: { dataset?: Record<string, unknown> } }) {
    const dsId = e && e.from === 'button' && e.target && e.target.dataset ? (e.target.dataset.id as string) : '';
    const id = dsId || this.data.highlightId;
    const a = this.data.alerts.find((x) => x.id === id) || this.data.alerts[0];
    if (!a) {
      return { title: '多人提醒 · 待办清单', path: '/pages/group-reminder/group-reminder' };
    }
    return {
      title: '🔔 ' + a.title,
      path: `/pages/group-reminder/group-reminder?alert=${a.id}&from=share`
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    const a = this.data.alerts.find((x) => x.id === this.data.highlightId) || this.data.alerts[0];
    return {
      title: a ? `🔔 ${a.title}（多人提醒）` : '多人提醒 · 待办清单',
      query: a ? `alert=${a.id}&from=timeline` : ''
    };
  },

  onUnload() {
    this.applyShell(this.data.pageStyle, this.data.bgStyle);
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  applyShell(page: PageStyleKey, bg: BgStyleKey) {
    const shell = saveShell('grp', { pageStyle: page, bgStyle: bg });
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
  onStyleSheetStop() { /* 阻止冒泡 */ },

  refresh() {
    const list = loadAlerts();
    const now = Date.now();
    const weekEnd = now + 7 * 86400000;

    // 三指标全部从真实数据推导：
    //  active  —— 启用中的提醒数
    //  members —— 所有启用提醒里出现过的**去重成员**数（不含自己，「共同参与」才有意义）
    //  week    —— 未来 7 天内到点的启用提醒数
    const activeList = list.filter((a) => a.enabled);
    const memberIds: Record<string, true> = {};
    activeList.forEach((a) => {
      (a.members || []).forEach((m) => {
        if (m && m.id && m.id !== 'self') memberIds[m.id] = true;
      });
    });
    const metrics = {
      active: activeList.length,
      members: Object.keys(memberIds).length,
      week: activeList.filter((a) => a.dueAt >= now && a.dueAt <= weekEnd).length
    };

    // 到期近的排前面，同一时间按创建时间新→旧
    const sorted = list.slice().sort((a, b) => {
      const av = a.enabled ? a.dueAt : Number.MAX_SAFE_INTEGER;
      const bv = b.enabled ? b.dueAt : Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return (b.createTime || 0) - (a.createTime || 0);
    });

    this.setData({
      alerts: sorted.map(this.decorate),
      activeCount: metrics.active,
      metrics,
      loading: false,
      logs: recentLogs(50).map(this.decorateLog),
      logCount: loadLogs().length
    });
  },

  /** 场景快捷入口：预填标题与周期后直接打开新建弹层 */
  onSceneTap(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '');
    const scene = SCENES.find((s) => s.key === key);
    if (!scene) return;
    const today = new Date();
    const def = new Date(today.getTime() + 3600 * 1000);
    this.setData({
      showEditor: true,
      editingId: null,
      formTitle: scene.title,
      formNote: '',
      formDate: `${def.getFullYear()}-${pad(def.getMonth() + 1)}-${pad(def.getDate())}`,
      formTime: `${pad(def.getHours())}:${pad(def.getMinutes())}`,
      selectedIds: ['self'],
      method: 'modal',
      repeat: scene.repeat,
      formError: ''
    });
  },

  /** 「提醒记录」区折叠 / 展开 */
  onToggleRecords() {
    this.setData({ showRecords: !this.data.showRecords });
  },

  /**
   * 展开 / 收起某一行的操作区。
   * 原来 7 个操作按钮常驻每张卡片，三条提醒就 21 个按钮把列表撑爆；
   * 收进「⋯」后列表回到参考图那种紧凑单行，点开才看到全部操作。
   * 再次点击同一条 = 收起；点另一条 = 切换（同一时刻只展开一条，避免页面被撑开）。
   */
  onToggleRowActs(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  decorateLog(l: GrpLog): DecoratedLog {
    const d = new Date(l.at);
    return {
      ...l,
      atFormat: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      membersText: l.members && l.members.length ? l.members.join('、') : '我'
    };
  },

  decorate(a: GrpAlert): DecoratedAlert {
    const now = Date.now();
    const active = a.enabled && a.dueAt > now;
    const icon = a.repeat === 'daily' ? '🌞' : a.repeat === 'weekly' ? '📅' : a.repeat === 'monthly' ? '🌷' : '⏰';
    return {
      ...a,
      timeText: fmtCn(a.dueAt),
      repeatLabel: REPEAT_LABEL[a.repeat || 'none'] || '单次',
      rel: relTime(a.updateTime || a.createTime),
      statusText: active ? `将于 ${fmtCn(a.dueAt).slice(5)} 提醒` : (a.enabled ? '已错过，下次周期生效' : '已停用'),
      memberChips: a.members.map((m) => ({ name: m.name, avatar: m.avatar, tone: m.tone })),
      icon
    };
  },

  // ===== 新建 / 编辑 =====
  onAdd() {
    const today = new Date();
    const def = new Date(today.getTime() + 3600 * 1000);
    this.setData({
      showEditor: true,
      editingId: null,
      formTitle: '',
      formNote: '',
      formDate: `${def.getFullYear()}-${pad(def.getMonth() + 1)}-${pad(def.getDate())}`,
      formTime: `${pad(def.getHours())}:${pad(def.getMinutes())}`,
      selectedIds: ['self'],
      method: 'modal',
      repeat: 'none',
      formError: ''
    });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const a = this.data.alerts.find((x) => x.id === id);
    if (!a) return;
    const d = new Date(a.dueAt);
    this.setData({
      showEditor: true,
      editingId: id,
      formTitle: a.title,
      formNote: a.note,
      formDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      formTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      selectedIds: a.members.map((m) => m.id),
      method: a.method,
      repeat: a.repeat,
      formError: ''
    });
  },

  onEditorClose() {
    this.setData({ showEditor: false, editingId: null, formError: '' });
  },
  onSheetStop() { /* noop */ },
  /** 空实现：配合 catchtap 阻止「点行内按钮」冒泡到整行的 onEdit */
  noop() { /* 占位 */ },

  onTitle(e: WechatMiniprogram.InputEvent) { this.setData({ formTitle: e.detail.value }); },
  onNote(e: WechatMiniprogram.InputEvent) { this.setData({ formNote: e.detail.value }); },
  onDate(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ formDate: String(e.detail.value) }); },
  onTime(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ formTime: String(e.detail.value) }); },
  onMethod(e: WechatMiniprogram.TouchEvent) {
    this.setData({ method: (e.currentTarget.dataset.key as 'toast' | 'modal') });
  },
  onRepeat(e: WechatMiniprogram.TouchEvent) {
    this.setData({ repeat: (e.currentTarget.dataset.key as RepeatKind) });
  },
  onMemberToggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const cur = this.data.selectedIds.slice();
    const idx = cur.indexOf(id);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(id);
    this.setData({ selectedIds: cur });
  },

  buildDueAt(): number {
    const { formDate, formTime } = this.data;
    const [y, m, d] = formDate.split('-').map(Number);
    const [hh, mm] = formTime.split(':').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0).getTime();
  },

  onSave() {
    const title = this.data.formTitle.trim();
    if (!title) {
      this.setData({ formError: '请填写提醒内容' });
      toast('请填写提醒内容');
      return;
    }
    const dueAt = this.buildDueAt();
    if (!dueAt || Number.isNaN(dueAt)) {
      this.setData({ formError: '请选择有效的提醒时间' });
      return;
    }
    if (this.data.repeat === 'none' && dueAt <= Date.now()) {
      this.setData({ formError: '单次提醒时间需晚于当前时间' });
      return;
    }
    const members = this.data.members.filter((m) => this.data.selectedIds.indexOf(m.id) >= 0);
    if (members.length === 0) {
      this.setData({ formError: '请至少选择一位参与者' });
      return;
    }
    const now = Date.now();
    if (this.data.editingId) {
      updateAlert(this.data.editingId, {
        title, note: this.data.formNote.trim(), dueAt,
        members, method: this.data.method, repeat: this.data.repeat,
        enabled: true
      });
      toast('已更新');
    } else {
      const alert: GrpAlert = {
        id: uid(), title, note: this.data.formNote.trim(), dueAt,
        members, method: this.data.method, repeat: this.data.repeat,
        enabled: true, subscribed: false, createTime: now, updateTime: now
      };
      addAlert(alert);
      toast('已创建，到点提醒');
    }
    this.setData({ showEditor: false, editingId: null, formError: '' });
    this.refresh();
  },

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const a = this.data.alerts.find((x) => x.id === id);
    if (!a) return;
    updateAlert(id, { enabled: !a.enabled });
    this.refresh();
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const a = this.data.alerts.find((x) => x.id === id);
    wx.showModal({
      title: '删除提醒',
      content: `确定删除「${a ? a.title : ''}」吗？`,
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        removeAlert(id);
        this.refresh();
        toast('已删除');
      }
    });
  },

  // 立即测试触发（便于演示验证到点效果）
  onTestFire(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const a = this.data.alerts.find((x) => x.id === id);
    if (!a) return;
    const who = a.members.length ? a.members.map((m) => m.name).join('、') : '我';
    if (a.method === 'modal') {
      wx.showModal({
        title: '⏰ ' + a.title,
        content: `${a.note || '无备注'} · 通知：${who}`,
        showCancel: false,
        confirmText: '知道了'
      });
    } else {
      wx.showToast({ title: '⏰ ' + a.title, icon: 'none', duration: 2600 });
    }
  },

  onShare(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const a = this.data.alerts.find((x) => x.id === id);
    if (!a) return;
    wx.setClipboardData({
      data: buildShareMessage(a),
      success: () => toast('已复制给参与者的提醒消息')
    });
  },

  // ===== 提醒记录 =====
  onToggleLogs() {
    this.setData({ showLogs: !this.data.showLogs });
  },
  onClearLogs() {
    wx.showModal({
      title: '清空提醒记录',
      content: '将删除全部触发记录（不影响提醒本身），确定吗？',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        clearLogs();
        this.setData({ logs: [], logCount: 0 });
        toast('已清空记录');
      }
    });
  },

  // ===== 订阅消息授权（需 MP 后台注册模板后生效）=====
  async onAllowSubscribe(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const a = this.data.alerts.find((x) => x.id === id);
    if (!a) return;
    if (!SUB_TMPL_ID) {
      wx.showModal({
        title: '尚未配置订阅模板',
        content: '请在微信 MP 后台「功能 → 订阅消息 → 我的模板」添加提醒类模板，并把模板 ID 填入代码 SUB_TMPL_ID（utils/subscribe.ts）。配置后即可在聊天列表收到该提醒的服务通知。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    const state = await requestSubscribe(SUB_TMPL_ID);
    if (state === 'ban') {
      // 被后台封禁：不应再弹授权，降级纯本地
      updateAlert(id, { subscribed: false });
      toast('订阅功能受限，已仅保留本机提醒');
      this.refresh();
      return;
    }
    if (state === 'empty') {
      // 理论上方已拦截；保险处理
      toast('模板未配置');
      return;
    }
    if (state !== 'accept') {
      // reject / fail：本次未授权，仅本机提醒，不写死 subscribed
      updateAlert(id, { subscribed: false });
      toast(state === 'reject' ? '未开启，仅本机提醒' : '授权失败，仅本机提醒');
      this.refresh();
      return;
    }
    // accept：记录授权 + 时间，到期时由服务端推送订阅消息
    updateAlert(id, { subscribed: true, grantedAt: Date.now() });
    // 【关键】必须把授权同步到云端 user_subs，否则云函数 send() 查不到记录 → 推送恒失败
    const granted = await grantSubscription(SUB_TMPL_ID);
    toast(granted ? '已开启微信通知' : '已开启提醒（云端同步失败，将仅本机通知）');
    this.refresh();
  }
});
