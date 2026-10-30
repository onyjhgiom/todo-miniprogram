// pages/love/index/index.ts
// 爱遇小栈 · 枢纽页（深空玻璃拟态重构版）
// 保留全部既有业务逻辑（在一起 / 快捷 / 想要准备的事 / 同步待办），
// 仅重构视觉与交互：3D 爱情水晶球 + 流动背景 + 玻璃卡 + 滚动视差 + 数字累加 + 脉冲反馈。
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import {
  getRelation, loadPeriods, loadInteractions, loadMemories, getSkinKey,
  loadPrepares, addPrepare, updatePrepare, removePrepare, parseYmd, fmtYmd,
  getCoreThemeKey, setCoreThemeKey
} from '../../utils/love-store';
import { CORE_THEMES, coreThemeViews, getCoreTheme, buildCorePageStyle, isDarkCoreTheme, coreThemeNav } from '../../utils/love-core-themes';
import { analyze, buildReminder } from '../../utils/love-cycle';
import { todayCareLine } from '../../utils/love-care';
import { heartState, streakState, togetherStat } from '../../utils/love-energy';
import { go } from '../../../../utils/nav';
import { addTodo, removeTodo } from '../../../../utils/todo-store';
import type { PrepareItem } from '../../utils/love-types';
import { isBound, partnerName } from '../../utils/love-pair';

interface Entry {
  key: string;
  icon: string;
  name: string;
  desc: string;
  path: string;
}

/** 把 yyyy-mm-dd / mm-dd 折算成「下一次到来」的 yyyy-mm-dd（今年若已过则用明年） */
function nextOccur(md: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(md) || /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return '';
  const mm = +m[m.length >= 4 ? 2 : 1];
  const dd = +m[m.length >= 4 ? 3 : 2];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cand = new Date(now.getFullYear(), mm - 1, dd);
  const year = cand.getTime() < today.getTime() ? now.getFullYear() + 1 : now.getFullYear();
  return fmtYmd(new Date(year, mm - 1, dd));
}

/** 六大模块入口（锚定设计稿的 3×2 玻璃宫格） */
const ENTRIES: Entry[] = [
  { key: 'care', icon: '🩷', name: '经期呵护', desc: '记录 · 预测 · 痛感关怀', path: '/subpackages/love/pages/cycle/cycle' },
  { key: 'makeup', icon: '💄', name: '妆造顾问', desc: '按妆感与场合给步骤', path: '/subpackages/love/pages/makeup/makeup' },
  { key: 'outfit', icon: '👗', name: '穿搭与好物', desc: '成套方案 · 好物推荐', path: '/subpackages/love/pages/outfit/outfit' },
  { key: 'love', icon: '💞', name: '异地恋能量站', desc: '爱心培育 · 距离天气', path: '/subpackages/love/pages/love/love' },
  { key: 'share', icon: '🔗', name: '共享能力', desc: '同步档案 · 共享心动', path: '/subpackages/love/pages/share/share' },
  { key: 'memory', icon: '💫', name: '心动时刻', desc: '回忆时间线 · 礼物', path: '/subpackages/love/pages/memory/memory' }
];

interface IndexData {
  skin: SkinView;
  entries: Entry[];
  careLine: string;
  cycleText: string;
  cycleSub: string;
  cycleIcon: string;
  togetherText: string;
  heartLv: number;
  heartName: string;
  heartTotal: number;
  heartPercent: number;
  streak: number;
  hasRelation: boolean;
  interCount: number;
  memoryCount: number;
  periodCount: number;
  /** 双人空间入口（未绑定时是引导态） */
  duo: { icon: string; title: string; desc: string };
  /** 想要准备的事 */
  prepares: PrepareItem[];
  prepDraft: string;
  prepDue: string;
  suggests: { key: string; label: string; content: string; due: string; person: string }[];
  unsyncedCount: number;
  /* —— 视觉与交互新增 —— */
  /** StatsPanel 四项（数字累加） */
  stats: { k: string; l: string; v: number }[];
  /** 水晶球配色（旗舰紫 / 粉） */
  corePrimary: string;
  coreAccent: string;
  coreHeight: number;
  coreHint: string;
  /** 系统是否开启「减弱动态效果」 */
  reducedMotion: boolean;
  /** 页面不可见时暂停水晶球渲染 */
  corePaused: boolean;
  /** 轻触水晶球的脉冲反馈显隐 */
  pulseFx: boolean;
  /** Hero 标语 */
  heroSub: string;
  /** 底部 dock 高亮项 */
  dockActive: string;
  /** 滚动视差派生值 */
  heroShift: number;
  heroFade: number;
  bgShift: number;
  /* —— 3D 水晶球视觉风格 —— */
  /** 当前风格 key */
  coreTheme: string;
  /** 当前风格在 themes 数组中的下标（wxml 取 emoji 用） */
  currentThemeIndex: number;
  /** 当前风格名（顶栏胶囊回显） */
  coreThemeName: string;
  /** 风格选择面板是否展开 */
  themePanel: boolean;
  /** 全部可选风格（供面板渲染） */
  themes: { key: string; name: string; tag: string; emoji: string }[];
}

Page<IndexData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '星梦夜曲', emoji: '🌌' },
    entries: ENTRIES,
    duo: { icon: '💞', title: '和 TA 绑定，解锁双人空间', desc: '邀请码配对 · 留言 · 心情 · 心愿 · 动态' },
    careLine: '',
    cycleText: '还没记录经期',
    cycleSub: '记一次之后，这里会给出预测与提醒',
    cycleIcon: '🌹',
    togetherText: '还没设置在一起的日子',
    heartLv: 1,
    heartName: '心动微光',
    heartTotal: 0,
    heartPercent: 0,
    streak: 0,
    hasRelation: false,
    interCount: 0,
    memoryCount: 0,
    periodCount: 0,
    prepares: [],
    prepDraft: '',
    prepDue: '',
    suggests: [],
    unsyncedCount: 0,
    /* 视觉新增 */
    stats: [
      { k: 'lv', l: '爱心等级', v: 0 },
      { k: 'streak', l: '连续互动', v: 0 },
      { k: 'mem', l: '回忆', v: 0 },
      { k: 'period', l: '经期记录', v: 0 }
    ],
    /* corePrimary/coreAccent 故意留空：由所选风格自带配色决定，
       这样切风格才真的换得到颜色。传了值会覆盖风格色。 */
    corePrimary: '',
    coreAccent: '',
    coreHeight: 600,
    coreHint: '轻触水晶球，注入心动 ♡',
    coreTheme: 'galaxy',
    currentThemeIndex: 0,
    coreThemeName: '星河紫梦',
    themePanel: false,
    themes: coreThemeViews(),
    reducedMotion: false,
    corePaused: false,
    pulseFx: false,
    heroSub: '把生活过成我们喜欢的样子 ♡',
    dockActive: 'home',
    heroShift: 0,
    heroFade: 1,
    bgShift: 0
  },

  onLoad() {
    this.setData({ skin: this.skinWithTheme() });
    this.unsub = watchSkin(() => {
      // 换肤或换球体风格都会走到这里：一次 setData，首页画布与胶囊同步更新
      this.setData({ skin: this.skinWithTheme(), ...this.coreThemeView() });
    });
    this.setData(this.coreThemeView());
  },

  onUnload() {
    if (this.unsub) this.unsub();
    this.clearTimers();
  },

  onShow() {
    this.setData({
      skin: this.skinWithTheme(),
      reducedMotion: this.detectReduced(),
      dockActive: 'home',
      ...this.coreThemeView()
    });
    this.refresh();
    // 页面重新可见：恢复水晶球渲染与数字累加
    this.setData({ corePaused: false });
  },

  onHide() {
    this.setData({ corePaused: true });
    this.clearTimers();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  unsub: null as (() => void) | null,
  _countTimer: null as ReturnType<typeof setTimeout> | null,
  _fxTimer: null as ReturnType<typeof setTimeout> | null,

  clearTimers() {
    if (this._countTimer) { clearTimeout(this._countTimer); this._countTimer = null; }
    if (this._fxTimer) { clearTimeout(this._fxTimer); this._fxTimer = null; }
  },

  /** 读取系统「减弱动态效果」开关 */
  detectReduced(): boolean {
    try {
      const s: any = (wx as any).getSystemSetting ? (wx as any).getSystemSetting() : {};
      return s.reducedMotion === 'enable';
    } catch (e) {
      return false;
    }
  },

  /** 当前水晶球风格的视图数据（key + 下标 + 展示名） */
  coreThemeView(): { coreTheme: string; currentThemeIndex: number; coreThemeName: string } {
    const key = getCoreThemeKey();
    const idx = CORE_THEMES.findIndex((t) => t.key === key);
    return {
      coreTheme: key,
      // 找不到时回落到 0，避免 wxml 取 themes[-1].emoji 出错
      currentThemeIndex: idx >= 0 ? idx : 0,
      coreThemeName: getCoreTheme(key).name
    };
  },

  /**
   * 皮肤视图 + 当前风格的整页设计语言。
   *
   * 关键是「把风格的 --t-* 变量拼到 skin.style 后面」——根节点仍只绑 style="{{skin.style}}"，
   * 既不动共享皮肤系统、也不改 WXML 契约（check-love-module.py 强校验这两个字符串），
   * 又能让 [data-skin][style] 上一次带上整套整页变量。
   *
   * 注意顺序：皮肤先、风格后 → 同名前缀不同（--ay-* vs --t-*），互不覆盖，各管各的。
   */
  skinWithTheme(): SkinView {
    const v = applySkin();
    const key = getCoreThemeKey();
    v.style = v.style + ';' + buildCorePageStyle(key);
    // 导航栏也要跟着风格的明暗走，否则浅底风格会顶一条深色导航栏，很割裂
    try {
      wx.setNavigationBarColor({
        frontColor: isDarkCoreTheme(key) ? '#ffffff' : '#000000',
        backgroundColor: coreThemeNav(key),
        fail: () => undefined
      });
    } catch (e) { /* 忽略 */ }
    return v;
  },

  /* ============================ 水晶球视觉风格 ============================ */

  /** 顶栏胶囊：打开/收起风格面板 */
  onToggleThemePanel() {
    if (!guardTap('toggle_theme_panel', 400)) return;
    this.setData({ themePanel: !this.data.themePanel });
  },

  /** 选一种风格：写盘 + 广播，首页画布立即换装并重绘 */
  onPickTheme(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key || key === this.data.coreTheme) {
      this.setData({ themePanel: false });
      return;
    }
    if (!guardTap('pick_theme_' + key, 400)) return;
    setCoreThemeKey(key);
    // 主动 setData 一次：不依赖 emit 回调，保证面板立刻收起、整页与球体马上换装
    this.setData({ themePanel: false, skin: this.skinWithTheme(), ...this.coreThemeView() });
    // 换装后给一次脉冲，让用户立刻看到"换掉了"（视觉确认）
    this.pulseCore();
    toast(`已切换为「${getCoreTheme(key).name}」`, 'success');
  },

  /** 触发水晶球自身的一次脉冲（不经过 click 组件回调） */
  pulseCore() {
    const c: any = this.selectComponent('#core');
    if (c && typeof c.pulse === 'function') c.pulse();
  },

  refresh() {
    const cyc = analyze();
    const rem = buildReminder();
    const rel = getRelation();
    const h = heartState();
    const st = streakState();
    const tg = togetherStat();

    let cycleText = '还没记录经期';
    let cycleSub = '记一次之后，这里会给出预测与提醒';
    let cycleIcon = '🌹';
    if (cyc.hasData) {
      cycleIcon = cyc.phaseEmoji;
      cycleText = rem.due ? rem.title : `${cyc.phaseName} · 第 ${cyc.dayIndex} 天`;
      cycleSub = rem.desc || `下次预计 ${cyc.nextStart}`;
    }

    this.setData({
      duo: isBound()
        ? { icon: '💞', title: `和 ${partnerName()} 的双人空间`, desc: '私密留言 · 心情打卡 · 心愿约定 · 双人动态' }
        : { icon: '🔒', title: '和 TA 绑定，解锁双人空间', desc: '邀请码配对 · 留言 · 心情 · 心愿 · 动态' },
      careLine: todayCareLine(),
      cycleText,
      cycleSub,
      cycleIcon,
      togetherText: tg.text,
      heartLv: h.lv,
      heartName: h.cur.name,
      heartTotal: h.total,
      heartPercent: h.percent,
      streak: st.days,
      hasRelation: !!rel.togetherDate,
      interCount: loadInteractions().length,
      memoryCount: loadMemories().length,
      periodCount: loadPeriods().length
    });
    this.refreshPrepares();
    this.runCountUp();
  },

  /* ============================ 数字累加 ============================ */
  /** StatsPanel 入场数字累加；减弱动效时直接落定终值 */
  runCountUp() {
    const targets = [this.data.heartLv, this.data.streak, this.data.memoryCount, this.data.periodCount];
    const labels = ['爱心等级', '连续互动', '回忆', '经期记录'];
    if (this.data.reducedMotion) {
      this.setData({ stats: targets.map((v, i) => ({ k: 's' + i, l: labels[i], v })) });
      return;
    }
    const dur = 800;
    const t0 = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      this.setData({
        stats: targets.map((v, i) => ({ k: 's' + i, l: labels[i], v: Math.round(v * e) }))
      });
      if (t < 1) this._countTimer = setTimeout(tick, 24);
    };
    tick();
  },

  /* ============================ 滚动视差 ============================ */
  onPageScroll(e: { scrollTop: number }) {
    const y = e.scrollTop || 0;
    const heroShift = Math.min(180, y * 0.25);
    const heroFade = Math.max(0, 1 - y / 520);
    const bgShift = y * 0.06;
    this.setData({ heroShift, heroFade, bgShift });
  },

  /* ============================ 水晶球交互 ============================ */
  /** 轻触水晶球（组件内判定为点击而非拖动时触发） */
  onCorePulse() {
    this.flashPulse();
  },

  /** 点击「爱情能量」CTA：主动让水晶球脉冲 + 反馈 */
  onPulseTap() {
    const c: any = this.selectComponent('#core');
    if (c && typeof c.pulse === 'function') c.pulse();
    this.flashPulse();
  },

  flashPulse() {
    try { (wx.vibrateShort as (o?: { type?: string }) => void)({ type: 'light' }); } catch (err) { /* 不支持则忽略 */ }
    this.setData({ pulseFx: true });
    if (this._fxTimer) clearTimeout(this._fxTimer);
    this._fxTimer = setTimeout(() => this.setData({ pulseFx: false }), 720);
  },

  /* ============================ 底部 dock ============================ */
  onDock(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    if (k === 'home') {
      wx.pageScrollTo({ scrollTop: 0, duration: 260 });
      return;
    }
    if (!guardTap('dock_' + k, 450)) return;
    const map: Record<string, string> = {
      memory: '/subpackages/love/pages/memory/memory',
      love: '/subpackages/love/pages/love/love',
      wardrobe: '/subpackages/love/pages/wardrobe/wardrobe',
      profile: '/subpackages/love/pages/profile/profile'
    };
    const p = map[k];
    if (!p) return;
    // force 跳过 go() 的 400ms 全局节流：dock 是高频入口，
    // 若被节流静默 return，用户只会觉得「点了没反应」。防连点已由上面的 guardTap 负责。
    go(p, { title: '爱遇小栈', loading: true, force: true });
  },

  /* ============================ 想要准备的事 ============================ */

  buildSuggests(): { key: string; label: string; content: string; due: string; person: string }[] {
    const rel = getRelation();
    const him = rel.him.nickname || '他';
    const out: { key: string; label: string; content: string; due: string; person: string }[] = [];
    if (rel.him.birthday) {
      out.push({
        key: 'birthday',
        label: `🎂 准备${him}的生日礼物`,
        content: `准备${him}的生日礼物`,
        due: nextOccur(rel.him.birthday),
        person: him
      });
    }
    if (rel.togetherDate) {
      out.push({
        key: 'anniversary',
        label: '💞 准备周年纪念日惊喜',
        content: '准备我们的周年纪念日惊喜',
        due: nextOccur(rel.togetherDate),
        person: him
      });
    }
    return out;
  },

  refreshPrepares() {
    const list = loadPrepares();
    const unsyncedCount = list.filter((x) => !x.synced).length;
    this.setData({ prepares: list, suggests: this.buildSuggests(), unsyncedCount });
  },

  onPrepInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ prepDraft: e.detail.value });
  },

  onPrepDue(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ prepDue: e.detail.value });
  },

  onAddPrep() {
    const content = (this.data.prepDraft || '').trim();
    if (!content) { toast('先写点想准备的事吧'); return; }
    if (!guardTap('add_prep', 500)) return;
    const rel = getRelation();
    addPrepare({
      content,
      due: this.data.prepDue || '',
      person: rel.him.nickname || '',
      synced: false,
      todoId: '',
      done: false
    });
    this.setData({ prepDraft: '', prepDue: '' });
    this.refreshPrepares();
  },

  onQuickPrep(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const s = this.data.suggests.find((x) => x.key === key);
    if (!s) return;
    if (!guardTap('quick_prep_' + key, 500)) return;
    addPrepare({ content: s.content, due: s.due, person: s.person, synced: false, todoId: '', done: false });
    this.refreshPrepares();
    toast('已添加到清单', 'success');
  },

  async onSyncPrep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.prepares.find((x) => x.id === id);
    if (!item) return;
    if (!guardTap('sync_' + id, 600)) return;
    const ts = item.due ? (parseYmd(item.due)?.getTime() ?? null) : null;
    const res = await addTodo({
      content: '🎁 ' + item.content,
      dueDate: ts,
      people: item.person ? [item.person] : [],
      tags: ['爱遇小栈'],
      priority: 'medium',
      description: '来自爱遇小栈 · 想要准备的事'
    });
    if (!res) return;
    updatePrepare(id, { synced: true, todoId: res._id });
    this.refreshPrepares();
    toast('已同步到首页待办', 'success');
  },

  async onSyncAll() {
    if (!guardTap('sync_all', 800)) return;
    const list = this.data.prepares.filter((x) => !x.synced);
    if (!list.length) return;
    let n = 0;
    for (const item of list) {
      const ts = item.due ? (parseYmd(item.due)?.getTime() ?? null) : null;
      const res = await addTodo({
        content: '🎁 ' + item.content,
        dueDate: ts,
        people: item.person ? [item.person] : [],
        tags: ['爱遇小栈'],
        priority: 'medium',
        description: '来自爱遇小栈 · 想要准备的事'
      });
      if (res) { updatePrepare(item.id, { synced: true, todoId: res._id }); n += 1; }
    }
    this.refreshPrepares();
    toast(n ? `已同步 ${n} 条到首页待办` : '同步完成', 'success');
  },

  onTogglePrep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.prepares.find((x) => x.id === id);
    if (!item) return;
    updatePrepare(id, { done: !item.done });
    this.refreshPrepares();
  },

  async onUnsyncPrep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.prepares.find((x) => x.id === id);
    if (!item || !item.todoId) return;
    if (!guardTap('unsync_' + id, 600)) return;
    const tid = item.todoId;
    updatePrepare(id, { synced: false, todoId: '' });
    this.refreshPrepares();
    try { await removeTodo(tid); } catch (_e) { /* 本地已置未同步，云端失败不影响 */ }
    toast('已撤回同步', 'none');
  },

  async onDelPrep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.prepares.find((x) => x.id === id);
    if (!item) return;
    if (!guardTap('del_' + id, 500)) return;
    if (item.todoId) { try { await removeTodo(item.todoId); } catch (_e) { /* 忽略 */ } }
    removePrepare(id);
    this.refreshPrepares();
  },

  onEntry(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!guardTap('entry_' + key, 450)) return;
    const item = ENTRIES.find((x) => x.key === key);
    if (!item) return;
    go(item.path, { title: item.name, loading: true });
  },

  /** 双人空间：情侣绑定 + 双向互动 */
  onGoDuo() {
    if (!guardTap('go_duo', 450)) return;
    go('/subpackages/love/pages/couple/couple', { title: '双人空间', loading: true });
  },

  /** 顶部 / 快捷入口（含换肤、回忆、档案、共享） */
  onQuick(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    if (!guardTap('quick_' + k, 450)) return;
    const map: Record<string, string> = {
      memory: '/subpackages/love/pages/memory/memory',
      profile: '/subpackages/love/pages/profile/profile',
      share: '/subpackages/love/pages/share/share',
      skin: '/subpackages/love/pages/skin/skin'
    };
    const p = map[k];
    if (!p) return;
    go(p, { title: '爱遇小栈', loading: true });
  },

  onQuickInteract() {
    if (!guardTap('quick_add', 600)) return;
    go('/subpackages/love/pages/memory/memory?tab=inter', { title: '记录互动', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '爱遇小栈 · 女孩子的私密小屋', path: '/subpackages/love/pages/index/index' };
  }
});
