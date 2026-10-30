// pages/subscribe-reminder/subscribe-reminder.ts
// 订阅提醒工具页：订阅一份「提醒事项」，在设定的每日/指定星期时刻接收通知（本地定时）。
// 含：订阅列表/启停/删除 + 新建&编辑（内容/时刻/星期多选/方式）+ 页面风格与背景切换。
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast } from '../../utils/cloud';
import { loadShell, saveShell } from '../../utils/tool-shell';
import {
  loadSubs, addSub, updateSub, removeSub, ensureRegistered, weekdayLabel, uid,
  SUB_CATEGORIES, SUB_TEMPLATES, SUB_RECOMMEND, subCategoryOf,
  type SubReminder, type SubCategoryKey, type SubTemplateDef
} from '../../utils/subscribe-reminder-store';
import type { ThemeKey } from '../../types/index';
import type { PageStyleKey, BgStyleKey } from '../../utils/tool-shell';

const WEEK_OPTIONS = [
  { key: 1, label: '一' }, { key: 2, label: '二' }, { key: 3, label: '三' },
  { key: 4, label: '四' }, { key: 5, label: '五' }, { key: 6, label: '六' }, { key: 0, label: '日' }
];

interface DecoratedSub extends SubReminder {
  timeText: string;
  freqLabel: string;
  statusText: string;
  /** 分类展示 */
  catLabel: string;
  catIcon: string;
  /** 卡片图标：优先用标题里的 emoji，否则按分类给默认 */
  icon: string;
}

interface SubData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  pageStyle: PageStyleKey;
  bgStyle: BgStyleKey;
  bgClass: string;
  shellClass: string;
  pagePresets: { key: PageStyleKey; name: string; dot: string }[];
  bgPresets: { key: BgStyleKey; name: string; dot: string }[];
  showStyleSheet: boolean;
  subs: DecoratedSub[];
  /** 当前筛选后的列表（按分类过滤后的结果） */
  displaySubs: DecoratedSub[];
  /** 分类筛选（含「全部」） */
  filters: { key: string; label: string; icon: string; count: number }[];
  activeCat: string;
  recommend: SubTemplateDef[];
  templates: SubTemplateDef[];
  showTemplateSheet: boolean;
  activeCount: number;
  loading: boolean;
  // 弹层
  showEditor: boolean;
  editingId: string | null;
  formTitle: string;
  formNote: string;
  formTime: string;
  formCat: SubCategoryKey;
  weekdays: number[];
  method: 'toast' | 'modal';
  weekOptions: { key: number; label: string }[];
  formError: string;
}

/** 从标题里抽取 emoji（订阅名可以是「💧 喝水」这种带图标的） */
function leadingEmoji(s: string): string {
  const m = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\s]+/u.exec(s || '');
  if (!m) return '';
  const raw = m[0].replace(/[\s\uFE0F]/g, '');
  // 多个 emoji 连写时只取第一个
  if (!raw) return '';
  const cp = raw.codePointAt(0);
  return cp ? String.fromCodePoint(cp) : '';
}

Page<SubData>({
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
    subs: [],
    displaySubs: [],
    filters: [],
    activeCat: 'all',
    recommend: SUB_RECOMMEND,
    templates: SUB_TEMPLATES,
    showTemplateSheet: false,
    activeCount: 0,
    loading: true,
    showEditor: false,
    editingId: null,
    formTitle: '',
    formNote: '',
    formTime: '',
    weekdays: [],
    method: 'modal',
    formCat: 'life',
    weekOptions: WEEK_OPTIONS,
    formError: ''
  },

  onLoad() {
    ensureRegistered();
    const shell = loadShell('sub');
    this.applyTheme();
    this.applyShell(shell.pageStyle, shell.bgStyle);
    this.refresh();
  },

  onShow() {
    this.applyTheme();
    this.refresh();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  applyShell(page: PageStyleKey, bg: BgStyleKey) {
    const shell = saveShell('sub', { pageStyle: page, bgStyle: bg });
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

  /** 返回上一页 */
  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/index/index' });
  },

  refresh() {
    const list = loadSubs();
    const decorated: DecoratedSub[] = list.map((s) => this.decorate(s));

    // 分类筛选条：全部 + 三大分类（带各自条目数）
    const filters: { key: string; label: string; icon: string; count: number }[] = [
      { key: 'all', label: '全部', icon: '', count: decorated.length }
    ];
    SUB_CATEGORIES.forEach((c) => {
      filters.push({
        key: c.key,
        label: c.label,
        icon: c.icon,
        count: decorated.filter((s) => (s.cat || 'life') === c.key).length
      });
    });

    const cat = this.data.activeCat;
    const displaySubs =
      cat === 'all' ? decorated : decorated.filter((s) => (s.cat || 'life') === cat);

    this.setData({
      subs: decorated,
      displaySubs,
      filters,
      activeCount: list.filter((s) => s.enabled).length,
      loading: false
    });
  },

  /** 分类筛选切换 */
  onCatFilter(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || 'all');
    if (key === this.data.activeCat) return;
    this.setData({ activeCat: key }, () => this.refresh());
  },

  decorate(s: SubReminder): DecoratedSub {
    const p = (n: number) => String(n).padStart(2, '0');
    const cat = subCategoryOf(s.cat);
    return {
      ...s,
      timeText: `${p(s.hour)}:${p(s.minute)}`,
      freqLabel: weekdayLabel(s.weekdays),
      statusText: s.enabled ? '订阅中，到点将提醒' : '已暂停',
      catLabel: cat.label,
      catIcon: cat.icon,
      icon: leadingEmoji(s.title) || cat.icon
    };
  },

  // ===== 新建 / 编辑 =====
  onAdd() {
    const now = new Date();
    const def = new Date(now.getTime() + 5 * 60000);
    this.setData({
      showEditor: true,
      editingId: null,
      formTitle: '',
      formNote: '',
      formTime: `${String(def.getHours()).padStart(2, '0')}:${String(def.getMinutes()).padStart(2, '0')}`,
      formCat: (this.data.activeCat === 'all' ? 'life' : this.data.activeCat) as SubCategoryKey,
      weekdays: [],
      method: 'modal',
      formError: ''
    });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const s = this.data.subs.find((x) => x.id === id);
    if (!s) return;
    this.setData({
      showEditor: true,
      editingId: id,
      formTitle: s.title,
      formNote: s.note,
      formTime: s.timeText,
      weekdays: s.weekdays.slice(),
      method: s.method,
      formCat: (s.cat || 'life') as SubCategoryKey,
      formError: ''
    });
  },

  onEditorClose() {
    this.setData({ showEditor: false, editingId: null, formError: '' });
  },
  onSheetStop() { /* noop */ },

  onTitle(e: WechatMiniprogram.InputEvent) { this.setData({ formTitle: e.detail.value }); },
  onNote(e: WechatMiniprogram.InputEvent) { this.setData({ formNote: e.detail.value }); },
  onTime(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ formTime: String(e.detail.value) }); },
  onMethod(e: WechatMiniprogram.TouchEvent) {
    this.setData({ method: (e.currentTarget.dataset.key as 'toast' | 'modal') });
  },
  onCatPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formCat: (e.currentTarget.dataset.key as SubCategoryKey) });
  },
  onWeek(e: WechatMiniprogram.TouchEvent) {
    const k = Number(e.currentTarget.dataset.key);
    const cur = this.data.weekdays.slice();
    const idx = cur.indexOf(k);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(k);
    this.setData({ weekdays: cur });
  },
  onEveryDay() {
    this.setData({ weekdays: [] });
  },

  onSave() {
    const title = this.data.formTitle.trim();
    if (!title) {
      this.setData({ formError: '请填写订阅内容' });
      toast('请填写订阅内容');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(this.data.formTime)) {
      this.setData({ formError: '请选择有效的提醒时刻' });
      return;
    }
    const [hour, minute] = this.data.formTime.split(':').map(Number);
    const now = Date.now();
    if (this.data.editingId) {
      updateSub(this.data.editingId, {
        title, note: this.data.formNote.trim(), hour, minute,
        weekdays: this.data.weekdays, method: this.data.method,
        cat: this.data.formCat, enabled: true
      });
      toast('已更新');
    } else {
      const sub: SubReminder = {
        id: uid(), title, note: this.data.formNote.trim(), hour, minute,
        weekdays: this.data.weekdays, method: this.data.method,
        cat: this.data.formCat, enabled: true, lastFireKey: '',
        createTime: now, updateTime: now
      };
      addSub(sub);
      toast('已订阅，到点提醒');
    }
    this.setData({ showEditor: false, editingId: null, formError: '' });
    this.refresh();
  },

  // ===== 推荐模板 =====
  openTemplateSheet() {
    this.setData({ showTemplateSheet: true });
  },
  closeTemplateSheet() {
    this.setData({ showTemplateSheet: false });
  },

  /**
   * 选用模板：
   * - custom（自定义）→ 直接进编辑器自己填
   * - 其它 → 直接按模板建订阅（带 emoji 前缀 + 分类 + 时刻），一步完成
   */
  onPickTemplate(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '');
    const tpl = SUB_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    this.setData({ showTemplateSheet: false });

    if (tpl.key === 'custom') {
      this.setData({
        showEditor: true,
        editingId: null,
        formTitle: '',
        formNote: '',
        formTime: `${String(tpl.hour).padStart(2, '0')}:${String(tpl.minute).padStart(2, '0')}`,
        formCat: tpl.cat,
        weekdays: [],
        method: 'modal',
        formError: ''
      });
      return;
    }

    const now = Date.now();
    const sub: SubReminder = {
      id: uid(),
      title: `${tpl.icon} ${tpl.title}`,
      note: tpl.desc,
      hour: tpl.hour,
      minute: tpl.minute,
      weekdays: tpl.weekdays.slice(),
      method: 'modal',
      cat: tpl.cat,
      enabled: true,
      lastFireKey: '',
      createTime: now,
      updateTime: now
    };
    addSub(sub);
    this.setData({ activeCat: 'all' });
    this.refresh();
    toast(`已订阅「${tpl.title}」`);
  },

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const s = this.data.subs.find((x) => x.id === id);
    if (!s) return;
    updateSub(id, { enabled: !s.enabled });
    this.refresh();
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const s = this.data.subs.find((x) => x.id === id);
    wx.showModal({
      title: '取消订阅',
      content: `确定取消「${s ? s.title : ''}」的订阅吗？`,
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        removeSub(id);
        this.refresh();
        toast('已取消订阅');
      }
    });
  },

  onTestFire(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const s = this.data.subs.find((x) => x.id === id);
    if (!s) return;
    if (s.method === 'modal') {
      wx.showModal({
        title: '⏰ ' + s.title,
        content: s.note || '到点了，记得查看~',
        showCancel: false,
        confirmText: '知道了'
      });
    } else {
      wx.showToast({ title: '⏰ ' + s.title, icon: 'none', duration: 2600 });
    }
  }
});
