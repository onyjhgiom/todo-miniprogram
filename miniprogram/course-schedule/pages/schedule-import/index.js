'use strict';

/**
 * 导入预览页
 * 设计要点：
 * 1. AI 结果绝不直接入库，必须让用户过一眼；
 * 2. confidence < 0.8 的条目单独分组 + 标黄，默认展开在最上面；
 * 3. 卡片行内可改（标题/地点/教师/星期/节次/周次），改完再导入，
 *    避免"导入错了要整表重来"；
 * 4. 文本输入用 bindblur 而非 bindinput，避免每次输入触发 setData 丢焦点。
 */

const { SLOTS, WEEKDAY_NAMES, buildRows } = require('../../utils/slots');
const { weekRuleText, ruleModeToIndex } = require('../../utils/format');
const csTheme = require('../../utils/csTheme');

const app = getApp();
const LOW_THRESHOLD = 0.8;

function weekOptions(totalWeeks) {
  const out = [];
  for (let i = 1; i <= totalWeeks; i += 1) out.push('第' + i + '周');
  return out;
}

Page({
  data: {
    ready: false,
    tableTitle: '',
    semesterHint: '',
    totalCount: 0,
    lowCount: 0,
    checkedCount: 0,
    warnings: [],
    viewList: [],
    showLowOnly: false,
    appendMode: false,

    weekdayOptions: WEEKDAY_NAMES,
    slotOptions: [],
    ruleModeOptions: ['每周', '单周', '双周', '自定义周次'],
    weekOptions: [],
    csTheme: csTheme.DEFAULT_CS_THEME,
  },

  onShow: function onShow() {
    const t = csTheme.getCsTheme();
    if (t !== this.data.csTheme) {
      this.setData({ csTheme: t });
      csTheme.applyNavBar(t);
    }
  },

  /** 皮肤切换：只换根节点 data-cs-theme，CSS 变量级联即可全页换装 */
  onCsThemeChange: function onCsThemeChange(e) {
    const key = e.detail && e.detail.key;
    if (!key) return;
    this.setData({ csTheme: key });
    csTheme.applyNavBar(key);
  },

  onLoad: function onLoad(options) {
    const store = app.globalData.store;
    const payload = app.globalData.pendingImport;
    this.store = store;
    this.appendMode = options && options.mode === 'append';

    if (!payload || !Array.isArray(payload.entries) || !payload.entries.length) {
      wx.showToast({ title: '没有可导入的内容', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }

    const totalWeeks = store.totalWeeks;

    // 节次选项：预设作息 + 本次识别到的非常规时间
    const slotOptions = SLOTS.map((s) => s.label + ' ' + s.start + '-' + s.end);
    const slotValues = SLOTS.map((s) => ({ start: s.start, end: s.end }));
    payload.entries.forEach((e) => {
      if (!e.startTime) return;
      if (slotValues.some((v) => v.start === e.startTime)) return;
      slotValues.push({ start: e.startTime, end: e.endTime || e.startTime });
      slotOptions.push(e.startTime + '-' + (e.endTime || ''));
    });

    const items = payload.entries.map((e, i) => {
      const slotIndex = slotValues.findIndex((v) => v.start === e.startTime);
      const rule = e.weekRule || { mode: 'every' };
      const modeIndex = ruleModeToIndex(rule);
      const rangeStart = rule.mode === 'range' && rule.ranges && rule.ranges.length
        ? rule.ranges[0].start
        : (rule.mode === 'weeks' && rule.weeks && rule.weeks.length ? rule.weeks[0] : 1);
      const rangeEnd = rule.mode === 'range' && rule.ranges && rule.ranges.length
        ? rule.ranges[0].end
        : (rule.mode === 'weeks' && rule.weeks && rule.weeks.length ? rule.weeks[rule.weeks.length - 1] : totalWeeks);

      return {
        _idx: i,
        checked: true,
        low: Number(e.confidence) < LOW_THRESHOLD,
        confidence: Number(e.confidence) || 0,
        title: e.title,
        location: e.location || '',
        teacher: e.teacher || '',
        weekdayIndex: Math.min(6, Math.max(0, Number(e.weekday) - 1)),
        slotIndex: slotIndex < 0 ? 0 : slotIndex,
        ruleModeIndex: modeIndex,
        ruleStartIndex: Math.min(totalWeeks - 1, Math.max(0, rangeStart - 1)),
        ruleEndIndex: Math.min(totalWeeks - 1, Math.max(0, rangeEnd - 1)),
        weekText: weekRuleText(rule),
        note: e.note || '',
      };
    });

    this.items = items;
    this.slotValues = slotValues;

    this.setData({
      ready: true,
      tableTitle: (payload.table_meta && payload.table_meta.title) || '识别结果',
      semesterHint: (payload.table_meta && payload.table_meta.semester_hint) || '',
      totalCount: items.length,
      lowCount: items.filter((x) => x.low).length,
      warnings: payload.warnings || [],
      slotOptions: slotOptions,
      weekOptions: weekOptions(totalWeeks),
      appendMode: this.appendMode,
      csTheme: csTheme.getCsTheme(),
    }, () => this._sync());
    csTheme.applyNavBar(this.data.csTheme);
  },

  _sync: function _sync() {
    const list = this.data.showLowOnly ? this.items.filter((x) => x.low) : this.items;
    this.setData({
      viewList: list,
      checkedCount: this.items.filter((x) => x.checked).length,
    });
  },

  _update: function _update(idx, patch) {
    Object.assign(this.items[idx], patch);
    this._sync();
  },

  /* ------------------------------ 交互 ------------------------------ */

  onToggle: function onToggle(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.items[idx].checked = !this.items[idx].checked;
    this._sync();
  },

  onToggleAll: function onToggleAll() {
    const target = this.items.some((x) => !x.checked);
    this.items.forEach((x) => { x.checked = target; });
    this._sync();
  },

  onToggleLowOnly: function onToggleLowOnly() {
    this.setData({ showLowOnly: !this.data.showLowOnly }, () => this._sync());
  },

  onFieldBlur: function onFieldBlur(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch[field] = e.detail.value.trim();
    this._update(idx, patch);
  },

  onWeekdayChange: function onWeekdayChange(e) {
    this._update(Number(e.currentTarget.dataset.idx), { weekdayIndex: Number(e.detail.value) });
  },

  onSlotChange: function onSlotChange(e) {
    this._update(Number(e.currentTarget.dataset.idx), { slotIndex: Number(e.detail.value) });
  },

  onRuleModeChange: function onRuleModeChange(e) {
    this._update(Number(e.currentTarget.dataset.idx), { ruleModeIndex: Number(e.detail.value) });
  },

  onRuleStartChange: function onRuleStartChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const s = Number(e.detail.value);
    const patch = { ruleStartIndex: s };
    if (s > this.items[idx].ruleEndIndex) patch.ruleEndIndex = s;
    this._update(idx, patch);
  },

  onRuleEndChange: function onRuleEndChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const v = Number(e.detail.value);
    const patch = { ruleEndIndex: v };
    if (v < this.items[idx].ruleStartIndex) patch.ruleStartIndex = v;
    this._update(idx, patch);
  },

  onConfirm: function onConfirm() {
    const picked = this.items.filter((x) => x.checked && x.title);
    if (!picked.length) {
      wx.showToast({ title: '至少选择一门课', icon: 'none' });
      return;
    }

    const totalWeeks = this.store.totalWeeks;
    const entries = picked.map((it) => {
      const slot = this.slotValues[it.slotIndex] || { start: null, end: null };
      const mode = ['every', 'odd', 'even', 'range'][it.ruleModeIndex];
      const s = Math.min(it.ruleStartIndex, it.ruleEndIndex) + 1;
      const e2 = Math.max(it.ruleStartIndex, it.ruleEndIndex) + 1;
      return {
        title: it.title,
        weekday: it.weekdayIndex + 1,
        startTime: slot.start,
        endTime: slot.end,
        location: it.location || null,
        teacher: it.teacher || null,
        weekRule: mode === 'range'
          ? { mode: 'range', ranges: [{ start: s, end: e2 }], weeks: [] }
          : { mode: mode, ranges: [], weeks: [] },
        note: it.note,
      };
    });

    if (this.appendMode) this.store.addEntries(entries);
    else this.store.replaceAll(entries);

    app.globalData.pendingImport = null;

    // 通知上一页刷新
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && typeof prev.onScheduleChanged === 'function') prev.onScheduleChanged();

    wx.showToast({ title: '已导入 ' + entries.length + ' 门课', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  },

  onCancel: function onCancel() {
    wx.showModal({
      title: '放弃这次导入？',
      content: '识别结果不会被保存',
      success: (res) => {
        if (!res.confirm) return;
        app.globalData.pendingImport = null;
        wx.navigateBack();
      },
    });
  },
});

module.exports = {};
