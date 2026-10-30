'use strict';

/**
 * 课表小助手页（统一输入框）
 *
 * 设计：用户只需要一个输入框，用一句话描述改课表意图。
 * 本地规则解析（services/parser.js）把指令解析为操作 → 校验 → 执行 → 回显执行结果。
 *
 * 注：课程表 AI（云函数 courseScheduleAI）已按平台审核要求下线，
 *     当前一律走本地规则解析，仅支持「改课表」类指令；其余调整请到课表页手动编辑。
 */

const validator = require('../../utils/validator');
const { applyEdit } = require('../../store/applyEdit');
const { localParse } = require('../../services/parser');
const { SLOTS, WEEKDAY_NAMES } = require('../../utils/slots');
const csTheme = require('../../utils/csTheme');

const app = getApp();

/** 示例指令：均为本地规则可解析的改课表指令 */
const CHIPS = [
  '第6周周五嵌入式停课',
  '操作系统调到周五 5-6 节',
  '把所有计算机网络教室改成博文北302',
];

Page({
  data: {
    input: '',
    chips: CHIPS,
    sending: false,

    /** 对话流：[{ id, role:'user'|'ai', kind, text, applied, skipped, conflicts, candidates, note }] */
    feed: [],

    canUndo: false,

    // 撤销条：必须在这里声明初始值，否则首屏 {{undoText}} 是 undefined，
    // 传给 undo-bar 会变成 null 并触发 "expected <String> but get null" 告警
    undoVisible: false,
    undoText: '',

    // 新增课程弹层（unknown 兜底出口）
    showAdd: false,
    addTitle: '',
    weekdayOptions: WEEKDAY_NAMES,
    slotOptions: [],
    addWeekdayIndex: 0,
    addSlotIndex: 0,

    csTheme: csTheme.DEFAULT_CS_THEME,
  },

  /** 自增消息 id，保证 wx:key 稳定 */
  _msgSeq: 0,
  /** 当前请求引用，用于取消 */
  _requestRef: null,

  onLoad: function onLoad() {
    this.store = app.globalData.store;
    const t = csTheme.getCsTheme();
    this.setData({
      slotOptions: SLOTS.map((s) => s.label + ' ' + s.start + '-' + s.end),
      canUndo: this.store.canUndo(),
      csTheme: t,
    });
    csTheme.applyNavBar(t);
  },

  onShow: function onShow() {
    const t = csTheme.getCsTheme();
    if (t !== this.data.csTheme) {
      this.setData({ csTheme: t });
      csTheme.applyNavBar(t);
    }
    this.setData({ canUndo: this.store.canUndo() });
  },

  onCsThemeChange: function onCsThemeChange(e) {
    const key = e.detail && e.detail.key;
    if (!key) return;
    this.setData({ csTheme: key });
    csTheme.applyNavBar(key);
  },

  /* ======================== 输入 ======================== */

  onInput: function onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onChip: function onChip(e) {
    const text = e.currentTarget.dataset.text;
    this.setData({ input: text });
  },

  /* ======================== 发送（统一入口） ======================== */

  onSend: function onSend() {
    const text = (this.data.input || '').trim();
    if (!text) { wx.showToast({ title: '说点什么吧', icon: 'none' }); return; }
    if (this.data.sending) return;

    this._pushMessage({ role: 'user', text: text });
    this.setData({ input: '', sending: true });

    const store = this.store;
    const ctx = {
      totalWeeks: store.totalWeeks,
      currentWeek: app.globalData.currentWeek || 1,
      entries: store.getEntries(),
      weekOfDate: (d) => store.weekOfDate(d),
      year: new Date().getFullYear(),
    };

    // 课程表 AI 已按平台审核要求下线：一律走本地规则解析（离线也能干活）
    this._fallbackLocal(text, ctx);
  },

  /* ======================== 本地解析 ======================== */

  /**
   * 本地规则解析：
   *   1. 先试本地规则解析 —— 能处理改课表就照常执行
   *   2. 兜不住才回话引导用户换个说法
   */
  _fallbackLocal: function _fallbackLocal(text, ctx) {
    let raw = null;
    try {
      raw = localParse(text, ctx);
    } catch (e) {
      console.error('[schedule] 本地解析异常', e);
    }
    if (raw) {
      this._handleEditPayload(raw, '（本地解析）');
      this.setData({ sending: false });
      return;
    }
    this._pushMessage({
      role: 'ai',
      kind: 'text',
      text: '这条指令我没解析清楚，试试「第6周周五嵌入式停课」这类说法，或到课表页手动编辑～',
    });
    this.setData({ sending: false });
  },

  /* ======================== 处理 edit payload ======================== */

  _handleEditPayload: function _handleEditPayload(payload, replyText) {
    const store = this.store;
    const v = validator.validate(payload, {
      totalWeeks: store.totalWeeks,
      validIds: store.getIds(),
    });

    if (!v.ok) {
      this._pushMessage({
        role: 'ai',
        kind: 'text',
        text: '这条指令我没解析清楚，换个说法试试？比如「第6周周五嵌入式停课」',
      });
      return;
    }

    // 二选一：AI 给出了两种理解
    if (v.value.output_candidates && v.value.output_candidates.length) {
      this._pushMessage({
        role: 'ai',
        kind: 'edit',
        text: '',
        applied: [],
        skipped: [],
        conflicts: [],
        candidates: v.value.output_candidates,
        note: '',
        question: v.value.question || '这条指令有两种理解，选一个',
      });
      return;
    }

    const r = applyEdit(store, v.value);
    const applied = r.applied || [];
    const skipped = r.skipped || [];

    this._pushMessage({
      role: 'ai',
      kind: 'edit',
      text: (applied.length && replyText) ? replyText : '',
      applied: applied,
      skipped: skipped,
      conflicts: r.conflicts || [],
      candidates: [],
      note: v.value.confirm_note || '',
      question: v.value.question || '',
    });

    if (applied.length) {
      this._notifyPrev();
      this.setData({ canUndo: store.canUndo(), undoVisible: true, undoText: '已执行 ' + applied.length + ' 项修改' });
    } else {
      this.setData({ canUndo: store.canUndo() });
    }
  },

  /* ======================== 对话流操作 ======================== */

  _pushMessage: function _pushMessage(msg) {
    this._msgSeq += 1;
    const item = Object.assign({
      id: 'm' + this._msgSeq,
      role: 'ai',
      kind: 'text',
      text: '',
      applied: [],
      skipped: [],
      conflicts: [],
      candidates: [],
      note: '',
      question: '',
    }, msg);
    const feed = this.data.feed.concat([item]);
    this.setData({ feed: feed });
    this._scrollToBottom();
  },

  _scrollToBottom: function _scrollToBottom() {
    // 页面级滚动到底部；失败静默（部分环境无 pageScrollTo）
    if (typeof wx.pageScrollTo !== 'function') return;
    wx.pageScrollTo({ scrollTop: 1000000, duration: 250, fail: () => {} });
  },

  _notifyPrev: function _notifyPrev() {
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && typeof prev.onScheduleChanged === 'function') prev.onScheduleChanged();
  },

  /* ======================== 候选二选一 ======================== */

  onPickCandidate: function onPickCandidate(e) {
    const mi = Number(e.currentTarget.dataset.mi);
    const ci = Number(e.currentTarget.dataset.ci);
    const msg = this.data.feed[mi];
    if (!msg || !msg.candidates || !msg.candidates[ci]) return;
    const cand = msg.candidates[ci];
    this._handleEditPayload(
      { request_type: 'edit', operations: cand.operations, conflicts: [], output_candidates: [], confirm_note: cand.interpretation, question: '' },
      cand.interpretation
    );
    // 清掉该消息的候选，避免重复点击
    this.setData({ ['feed[' + mi + '].candidates']: [] });
  },

  /* ======================== 冲突处理 ======================== */

  onKeepBoth: function onKeepBoth(e) {
    const mi = Number(e.currentTarget.dataset.mi);
    const ci = Number(e.currentTarget.dataset.ci);
    this.setData({ ['feed[' + mi + '].conflicts[' + ci + '].done']: '已保留两者' });
  },

  onOverwrite: function onOverwrite(e) {
    const mi = Number(e.currentTarget.dataset.mi);
    const ci = Number(e.currentTarget.dataset.ci);
    const msg = this.data.feed[mi];
    const c = msg && msg.conflicts && msg.conflicts[ci];
    if (!c) return;
    const other = this.store.getEntries().find((x) => x._id === c.conflict_with_id);
    wx.showModal({
      title: '删除冲突的旧课？',
      content: other ? '「' + other.title + '」将被移除' : '',
      success: (res) => {
        if (!res.confirm) return;
        this.store.removeEntry(c.conflict_with_id);
        this.setData({ ['feed[' + mi + '].conflicts[' + ci + '].done']: '已删除旧课' });
        this._notifyPrev();
        this.setData({ canUndo: this.store.canUndo(), undoVisible: true, undoText: '已删除冲突课程' });
      },
    });
  },

  /* ====================== unknown → 新增这门课 ====================== */

  onOpenAdd: function onOpenAdd() {
    this.setData({ showAdd: true, addTitle: '' });
  },

  onAddTitle: function onAddTitle(e) {
    this.setData({ addTitle: e.detail.value });
  },

  onAddWeekday: function onAddWeekday(e) {
    this.setData({ addWeekdayIndex: Number(e.detail.value) });
  },

  onAddSlot: function onAddSlot(e) {
    this.setData({ addSlotIndex: Number(e.detail.value) });
  },

  onConfirmAdd: function onConfirmAdd() {
    const title = (this.data.addTitle || '').trim();
    if (!title) { wx.showToast({ title: '请填写课程名', icon: 'none' }); return; }
    const slot = SLOTS[this.data.addSlotIndex];
    const entry = {
      title: title,
      weekday: this.data.addWeekdayIndex + 1,
      startTime: slot.start,
      endTime: slot.end,
      weekRule: { mode: 'every', ranges: [], weeks: [] },
    };
    this.store.addEntry(entry);
    this.setData({ showAdd: false, canUndo: this.store.canUndo() });
    this._pushMessage({
      role: 'ai', kind: 'edit',
      text: '',
      applied: [{ operation: 'add_entry', detail: '已新增 ' + title + '（' + WEEKDAY_NAMES[entry.weekday - 1] + ' ' + slot.start + '-' + slot.end + '）' }],
      skipped: [], conflicts: [], candidates: [], note: '', question: '',
    });
    this._notifyPrev();
    wx.showToast({ title: '已新增', icon: 'success' });
  },

  onCancelAdd: function onCancelAdd() {
    this.setData({ showAdd: false });
  },

  /* ======================== 撤销 ======================== */

  onUndo: function onUndo() {
    const ok = this.store.undo();
    this.setData({ undoVisible: false, canUndo: this.store.canUndo() });
    if (!ok) { wx.showToast({ title: '没有可撤销的操作', icon: 'none' }); return; }
    this._notifyPrev();
    wx.showToast({ title: '已撤销', icon: 'none' });
  },

  onUndoClose: function onUndoClose() {
    this.setData({ undoVisible: false });
  },

  /** 清空对话流 */
  onClearFeed: function onClearFeed() {
    this.setData({ feed: [] });
  },

  onBack: function onBack() {
    wx.navigateBack();
  },
});
