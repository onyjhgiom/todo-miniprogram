'use strict';

/**
 * 课表主页
 * 渲染只依赖 store.getWeek(week) 的返回值，切周 = 换一次 merge 参数。
 * 每屏 10~15 条数据，单次 setData 完成，不整表重建。
 */

const { buildRows, WEEKDAY_NAMES } = require('../../utils/slots');
const { weekRuleText } = require('../../utils/format');
const csTheme = require('../../utils/csTheme');
const { FIELDS, validateInlineEdit, isDirty, draftFromEntry } = require('../../utils/inlineEdit');

const app = getApp();

/** 编辑面板尺寸（px）。面板是 fixed 浮层，这两个值只用于避免它超出视口 */
const PANEL_W = 260;
const PANEL_H = 300;
const EDGE = 12;
/**
 * 键盘预留高度（px）。
 * 面板打开即聚焦第一个输入框，键盘必然弹起 —— 点课表下方的课时，
 * 若按卡片原位定位，面板会被键盘整个盖住（输入不了）。
 * 打开时先按这个保守值收敛面板位置，键盘真实高度出来后再精确修正（见 onKbHeight）。
 */
const KB_RESERVE = 290;
/**
 * 失焦后延迟提交的毫秒数。
 * 必须大于 0：在课程名/教师/地点三个输入框之间点来点去时，会先 blur 再 focus，
 * 若 blur 立即提交，用户刚点第二个框就被关掉了。
 */
const BLUR_DELAY = 150;

function todayWeekday() {
  const d = new Date();
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

/** 取视口尺寸，兼容新旧 API */
function viewport() {
  try {
    if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo();
    if (typeof wx.getSystemInfoSync === 'function') return wx.getSystemInfoSync();
  } catch (e) { /* 非小程序环境（单测） */ }
  return { windowWidth: 375, windowHeight: 667 };
}

Page({
  data: {
    week: 1,
    currentWeek: 1,
    totalWeeks: 16,
    weekOptions: [],
    weekIndex: 0,
    todayWeekday: 0,
    showToday: false,
    headers: [],
    grid: [],
    empty: false,
    conflictTip: '',
    undoVisible: false,
    undoText: '',
    csTheme: csTheme.DEFAULT_CS_THEME,
    /* ---- 就地编辑 ---- */
    editingId: '',
    editFields: FIELDS,
    draft: {},
    editFocus: '',
    editPos: { top: 0, left: 0, width: PANEL_W },
  },

  onLoad: function onLoad() {
    this.store = app.globalData.store;
    const currentWeek = app.globalData.currentWeek || 1;
    const totalWeeks = this.store.totalWeeks;
    const weekOptions = [];
    for (let i = 1; i <= totalWeeks; i += 1) weekOptions.push('第 ' + i + ' 周');

    this.setData({
      week: currentWeek,
      currentWeek: currentWeek,
      totalWeeks: totalWeeks,
      weekOptions: weekOptions,
      weekIndex: currentWeek - 1,
      todayWeekday: todayWeekday(),
      csTheme: csTheme.getCsTheme(),
    });
    csTheme.applyNavBar(this.data.csTheme);
  },

  onShow: function onShow() {
    // 从编辑页/导入页返回时，皮肤可能已被改动，这里同步一次
    const t = csTheme.getCsTheme();
    if (t !== this.data.csTheme) {
      this.setData({ csTheme: t });
      csTheme.applyNavBar(t);
    }
    this.render(this.data.week);
  },

  /** 皮肤切换：写存储 + 刷新根节点 data-cs-theme（变量级联，无需重渲染课表） */
  onCsThemeChange: function onCsThemeChange(e) {
    const key = e.detail && e.detail.key;
    if (!key) return;
    this.setData({ csTheme: key });
    csTheme.applyNavBar(key);
  },

  /** 供导入页回调 */
  onScheduleChanged: function onScheduleChanged() {
    this.render(this.data.week);
    this.showUndo('课表已更新');
  },

  render: function render(week) {
    const courses = this.store.getWeek(week);
    const rows = buildRows(courses);
    const conflicts = this.store.conflictsOfWeek(week);
    const conflictMap = {};
    conflicts.forEach((c) => { conflictMap[c.target_id] = true; conflictMap[c.conflict_with_id] = true; });

    const headers = WEEKDAY_NAMES.map((name, i) => ({
      name: name,
      today: week === this.data.currentWeek && i + 1 === this.data.todayWeekday,
    }));

    const grid = rows.map((r) => ({
      label: r.label,
      start: r.start,
      end: r.end || '',
      cells: headers.map((h, wi) => {
        const c = courses.find((x) => x.weekday === wi + 1 && x.startTime === r.start);
        if (!c) return null;
        return {
          id: c._id,
          title: c.title,
          location: c.location || '',
          teacher: c.teacher || '',
          weekText: weekRuleText(c.weekRule),
          conflicted: conflictMap[c._id] === true,
          overridden: c._overridden === true,
          ci: csTheme.colorIndexOf(c.title),
        };
      }),
    }));

    this.setData({
      week: week,
      weekIndex: week - 1,
      headers: headers,
      grid: grid,
      empty: courses.length === 0,
      showToday: week === this.data.currentWeek,
      conflictTip: conflicts.length ? conflicts[0].detail + '（共 ' + conflicts.length + ' 处）' : '',
    });
  },

  /* ---------------------------- 周次切换 ---------------------------- */

  onPrevWeek: function onPrevWeek() {
    // 切周前先落库：否则面板会停在新一周的错误位置，且未保存的输入直接丢失
    if (this._editId) this._commitEdit({ silent: true });
    if (this.data.week <= 1) { wx.showToast({ title: '已经是第 1 周', icon: 'none' }); return; }
    this.render(this.data.week - 1);
  },

  onNextWeek: function onNextWeek() {
    if (this._editId) this._commitEdit({ silent: true });
    if (this.data.week >= this.data.totalWeeks) { wx.showToast({ title: '已是学期最后一周', icon: 'none' }); return; }
    this.render(this.data.week + 1);
  },

  onWeekPick: function onWeekPick(e) {
    if (this._editId) this._commitEdit({ silent: true });
    this.render(Number(e.detail.value) + 1);
  },

  onBackToThisWeek: function onBackToThisWeek() {
    if (this._editId) this._commitEdit({ silent: true });
    this.render(this.data.currentWeek);
  },

  /** 离开页面（返回/切后台）时兜底保存，别让用户白敲一遍 */
  onHide: function onHide() {
    if (this._editId) this._commitEdit({ silent: true });
  },

  onUnload: function onUnload() {
    if (this._editId) {
      clearTimeout(this._blurTimer);
      this._editId = null; // 页面即将销毁，只清状态不 setData
      this._blurTimer = null;
    }
  },

  /* ------------------------------ 撤销 ------------------------------ */

  showUndo: function showUndo(text) {
    this.setData({ undoVisible: true, undoText: text });
  },

  onUndo: function onUndo() {
    const ok = this.store.undo();
    this.setData({ undoVisible: false });
    if (!ok) { wx.showToast({ title: '没有可撤销的操作', icon: 'none' }); return; }
    this.render(this.data.week);
    wx.showToast({ title: '已撤销', icon: 'none' });
  },

  onUndoClose: function onUndoClose() {
    this.setData({ undoVisible: false });
  },

  /* ------------------------------ 其他 ------------------------------ */

  onTapCourse: function onTapCourse(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // 重复点同一张：已在编辑中，直接忽略。
    // 这里绝不能重新 setData 一次 draft —— 那会把用户刚敲进去的字清掉。
    if (this._editId === id) return;
    // 点另一张：先把当前编辑落库，再打开新的（连续快速编辑时不会丢前一次的输入）
    if (this._editId) this._commitEdit({ silent: true });
    this._openEdit(id);
  },

  /** 原「点卡片弹菜单」的入口，现在收进编辑面板的「更多」里 */
  _showCourseMenu: function _showCourseMenu(id) {
    const c = this.store.getEntries().find((x) => x._id === id);
    if (!c) return;
    wx.showActionSheet({
      itemList: ['单周停课', '整学期删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.store.addOverride({ entryId: id, kind: 'week', week: this.data.week, cancelled: true });
          this.render(this.data.week);
          this.showUndo('第' + this.data.week + '周「' + c.title + '」已停课');
        } else if (res.tapIndex === 1) {
          this.store.removeEntry(id);
          this.render(this.data.week);
          this.showUndo('已删除「' + c.title + '」');
        }
      },
      fail: () => {},
    });
  },

  /* ======================== 就地编辑 ======================== */

  /**
   * 打开编辑面板。
   * 草稿取自「当前周 merge 后的值」而不是底表 —— 用户看到什么就编辑什么，
   * 第 6 周被 override 换过教室时，编辑框里就应该是那个新教室。
   */
  _openEdit: function _openEdit(id) {
    const week = this.data.week;
    const cur = this.store.getWeek(week).find((x) => x._id === id);
    if (!cur) return;

    const draft = draftFromEntry(cur);
    this._editId = id;
    this._editWeek = week;
    this._origin = draftFromEntry(cur);
    this._cancelFlag = false;
    this._holdFlag = false;

    const open = (pos) => {
      if (this._editId !== id) return; // 期间又被切走了
      this.setData({ editingId: id, draft: draft, editFocus: '', editPos: pos }, () => {
        // focus 必须等面板真正渲染出来再给，直接写在初次 setData 里会落空
        setTimeout(() => {
          if (this._editId === id) this.setData({ editFocus: FIELDS[0].key });
        }, 50);
      });
    };

    if (typeof wx.createSelectorQuery !== 'function') {
      this._editRect = null;
      open(this._fallbackPos());
      return;
    }

    // 定位到卡片：面板从卡片位置长出来，视觉上"就地"
    wx.createSelectorQuery().in(this).select('#card-' + id).boundingClientRect().exec((res) => {
      const rect = res && res[0];
      // 记下卡片矩形：键盘弹起时要用它重新收敛面板位置
      this._editRect = rect && rect.width ? rect : null;
      open(rect && rect.width ? this._clampPos(rect) : this._fallbackPos());
    });
  },

  _clampPos: function _clampPos(rect) {
    const vp = viewport();
    const left = Math.max(EDGE, Math.min(rect.left, vp.windowWidth - PANEL_W - EDGE));
    // 面板打开即聚焦 → 键盘必弹起，所以顶部一律按「避开键盘」收敛：
    // 宁可离卡片远一点，也绝不能让输入区被键盘盖住。
    const kb = this._kbH || KB_RESERVE;
    const topMax = vp.windowHeight - kb - PANEL_H - EDGE;
    const top = topMax < EDGE ? EDGE : Math.min(rect.top, topMax);
    return {
      top: Math.round(Math.max(EDGE, top)),
      left: Math.round(left),
      width: PANEL_W,
    };
  },

  /**
   * 键盘弹起 / 收起时，用真实键盘高度重新定位面板。
   * adjust-position 已关掉（页面不再整体上推，顶栏不会错位），
   * 面板位置完全由这里负责，保证输入区始终在键盘上方可见。
   */
  onKbHeight: function onKbHeight(e) {
    const h = e && e.detail && typeof e.detail.height === 'number' ? e.detail.height : 0;
    this._kbH = h;
    if (!this._editId || !this._editRect) return;
    this.setData({ editPos: this._clampPos(this._editRect) });
  },

  _fallbackPos: function _fallbackPos() {
    const vp = viewport();
    return {
      top: Math.max(EDGE, Math.round((vp.windowHeight - PANEL_H) / 2)),
      left: Math.max(EDGE, Math.round((vp.windowWidth - PANEL_W) / 2)),
      width: PANEL_W,
    };
  },

  /** 只关面板，不写入任何东西（取消 / 校验失败回退都走这里） */
  _closeEdit: function _closeEdit() {
    clearTimeout(this._blurTimer);
    this._blurTimer = null;
    this._editId = null;
    this._editWeek = null;
    this._origin = null;
    this._editRect = null;
    this._kbH = 0;
    this._cancelFlag = false;
    this._holdFlag = false;
    this.setData({
      editingId: '',
      draft: {},
      editFocus: '',
      editPos: { top: 0, left: 0, width: PANEL_W },
    });
  },

  /**
   * 提交编辑。
   * 三条出路：没改动 → 直接关；非法 → 提示并回退；合法 → 写库 + 撤销点。
   * @returns {boolean} 是否真的写入了
   */
  _commitEdit: function _commitEdit(opts) {
    const id = this._editId;
    if (!id) return false;
    clearTimeout(this._blurTimer);
    this._blurTimer = null;

    const draft = this.data.draft || {};
    const origin = this._origin || {};

    // 一个字没改：不写库、不压撤销点，静默关闭
    if (!isDirty(draft, origin)) { this._closeEdit(); return false; }

    const checked = validateInlineEdit(draft);
    if (!checked.ok) {
      // 非法：明确告知原因，并回退到修改前的值（不写入＝数据仍在原值）
      wx.showToast({ title: checked.message, icon: 'none', duration: 2000 });
      this.setData({ draft: Object.assign({}, origin) });
      this._closeEdit();
      return false;
    }

    const target = this.store.applyEntryEditForWeek(id, this._editWeek || this.data.week, checked.value);
    const title = checked.value.title;
    const scopeText = target && target.type !== 'entry' ? '（本周）' : '';
    this._closeEdit();
    if (!target) { wx.showToast({ title: '该课程已不存在', icon: 'none' }); return false; }

    this.render(this.data.week);
    if (!opts || !opts.silent) {
      wx.showToast({ title: '已保存', icon: 'success', duration: 1200 });
      this.showUndo('已更新「' + title + '」' + scopeText);
    }
    return true;
  },

  /** 输入时不 setData：每次按键都重渲染会让光标跳到末尾（安卓尤其明显） */
  onEditInput: function onEditInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field || !this.data.draft) return;
    this.data.draft[field] = e.detail.value;
  },

  /** 在三个输入框之间切换焦点时，取消掉上一个框触发的延迟提交 */
  onEditFocus: function onEditFocus() {
    clearTimeout(this._blurTimer);
    this._blurTimer = null;
  },

  onEditBlur: function onEditBlur() {
    // 「取消 / 更多」会先触发 blur，但它们的 touchstart 已经置了标记，交给按钮处理
    if (this._cancelFlag || this._holdFlag) return;
    clearTimeout(this._blurTimer);
    this._blurTimer = setTimeout(() => { this._commitEdit(); }, BLUR_DELAY);
  },

  /** 回车：立即保存 */
  onEditConfirm: function onEditConfirm() {
    clearTimeout(this._blurTimer);
    this._commitEdit();
  },

  /** 点遮罩 = 点空白处 = 保存 */
  onMaskTap: function onMaskTap() {
    clearTimeout(this._blurTimer);
    this._commitEdit();
  },

  // touchstart 早于 blur，用来给 blur「打招呼」：这次失焦别自作主张提交
  onEditCancelTouch: function onEditCancelTouch() { this._cancelFlag = true; },
  onEditMoreTouch: function onEditMoreTouch() { this._holdFlag = true; },
  onEditSaveTouch: function onEditSaveTouch() { clearTimeout(this._blurTimer); },

  onEditCancel: function onEditCancel() {
    this._cancelFlag = true;
    this._closeEdit();
  },

  onEditSave: function onEditSave() {
    clearTimeout(this._blurTimer);
    this._commitEdit();
  },

  onEditMore: function onEditMore() {
    const id = this._editId;
    this._holdFlag = true;
    this._closeEdit();
    if (id) this._showCourseMenu(id);
  },

  /** 空处理：阻止面板上的点击/滑动穿透到课表 */
  onNoop: function onNoop() {},

  goEdit: function goEdit() {
    wx.navigateTo({ url: '/course-schedule/pages/schedule-edit/index' });
  },

  goImport: function goImport() {
    if (!app.globalData.pendingImport) {
      wx.showToast({ title: '请先上传或粘贴课表', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/course-schedule/pages/schedule-import/index' });
  },

  /** 演示用：填入真实课表样例，方便联调预览页与网格 */
  demoFill: function demoFill() {
    const sample = require('../../data/sample-entries.js');
    this.store.replaceAll(sample);
    this.render(this.data.week);
    this.showUndo('已载入示例课表');
  },
});
