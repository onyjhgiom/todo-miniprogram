// pages/love/memory/memory.ts
// 回忆与互动：记一次互动（注入能量）/ 写一条回忆（飞进爱情球）
//
// 爱情球本体是独立组件 components/love-orb，本页只负责：
//   1) 把回忆映射成球体节点（图标 / 配色 / 首张照片）
//   2) 「放入我们的爱情球」→ 卡片缩小 → 变粒子 → 飞入 → 落进球体 → 节点成形
//   3) 落地同时注入能量（+20），若跨过等级阈值则播放 LevelUp 动画与横幅
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { go } from '../../../../utils/nav';
import { getSkin } from '../../utils/love-skin';
import {
  loadInteractions, addInteraction, removeInteraction,
  loadMemories, addMemory, removeMemory, todayYmd, onTopic
} from '../../utils/love-store';
import {
  PICKABLE_INTERACTIONS, energyOf, interactType, heartState, memoryEnergy
} from '../../utils/love-energy';
import type { InteractType } from '../../utils/love-energy';
import { memEmoji, memTint, toOrbItems } from '../../utils/love-orb';
import { uploadAttachImage } from '../../../../utils/attach';
import type { Memory } from '../../utils/love-types';

type TabKey = 'inter' | 'memory';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'inter', label: '💞 互动' },
  { key: 'memory', label: '🕰️ 回忆' }
];

interface DecoInter {
  id: string;
  type: string;
  date: string;
  at: number;
  minutes: number;
  title: string;
  note: string;
  energy: number;
  from: 'me' | 'him';
  createTime: number;
  label: string;
  emoji: string;
}

interface OrbNode {
  id: string;
  emoji: string;
  tint: string;
  photo: string;
}

interface MemoryData {
  skin: SkinView;
  tabs: { key: TabKey; label: string }[];
  tab: TabKey;

  types: InteractType[];
  list: DecoInter[];
  total: number;
  lv: number;

  iType: string;
  iMinutes: string;
  iTitle: string;
  iNote: string;
  iFrom: 'me' | 'him';
  iDate: string;
  previewEnergy: number;

  memories: Memory[];
  mDate: string;
  mTitle: string;
  mPlace: string;
  mNote: string;
  mTags: string[];
  mPhotos: string[];
  photoTip: string;
  showMForm: boolean;
  memoryTags: string[];
  memoryEnergy: number;

  /* —— 回忆分区：分类筛选（全部/照片/真实存在的标签） —— */
  filters: { key: string; label: string }[];
  mFilter: string;
  filteredMemories: Memory[];

  /* —— 顶部能量胶囊分母（当前能量 + 距下一级差额） —— */
  capsuleGoal: number;

  /* —— 爱情球 —— */
  view: 'globe' | 'list';
  orbItems: OrbNode[];
  orbPrimary: string;
  orbAccent: string;
  orbLevel: number;
  centerStyle: string;
  paused: boolean;
  reducedMotion: boolean;

  /* —— 进度 / 升级 —— */
  percent: number;
  nextLv: number;
  nextName: string;
  toNext: number;

  /* —— 弹层 —— */
  detail: Memory | null;
  detailEmoji: string;
  detailPhoto: string;
  ghost: { x: number; y: number; title: string; emoji: string } | null;
  levelUp: { lv: number; name: string; desc: string } | null;
}

const MEMORY_TAGS = ['第一次', '见面', '旅行', '生日', '纪念日', '吵架和好', '日常', '礼物', '视频', '约定'];

const REDUCED_KEY = 'love_orb_reduced';

// 标签 → emoji / 配色的映射收敛到 utils/love-orb.ts，能量站与回忆页共用一份，
// 避免两处各写一份后逐渐漂移。
function tagEmoji(m: Memory): string {
  return memEmoji(m.tags);
}
function tagTint(m: Memory): string {
  return memTint(m.tags);
}

/** 回忆 → 球体节点（首张照片作为照片记忆节点） */
function toOrbNodes(ms: Memory[]): OrbNode[] {
  return toOrbItems(ms);
}

/** 中心爱心的辉光（随皮肤主色变化） */
function centerGlow(primary: string): string {
  return `background:radial-gradient(circle at 35% 30%, #ffffff 0%, ${primary} 55%, ${primary} 100%);`
    + `box-shadow:0 0 36rpx ${primary}cc, 0 0 80rpx ${primary}66, 0 0 140rpx ${primary}33;`;
}

/** 查询某个节点在视口中的位置（飞入动画起点） */
function rectOf(sel: string): Promise<any> {
  return new Promise((resolve) => {
    wx.createSelectorQuery().select(sel).boundingClientRect().exec((res: any) => {
      resolve(res && res[0] ? res[0] : null);
    });
  });
}

/**
 * 云存储不可用时，把临时图存到用户目录，避免「重进小程序照片全变灰块」。
 * 仍失败就退回临时路径（本次会话可见）。
 */
function persistLocal(temp: string): string {
  try {
    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/love-memory`;
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
    const to = `${dir}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
    fs.saveFileSync(temp, to);
    return to;
  } catch (e) {
    return temp;
  }
}

Page<MemoryData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    tabs: TABS,
    tab: 'inter',
    types: PICKABLE_INTERACTIONS,
    list: [],
    total: 0,
    lv: 1,
    iType: 'chat',
    iMinutes: '',
    iTitle: '',
    iNote: '',
    iFrom: 'me',
    iDate: '',
    previewEnergy: 2,
    memories: [],
    mDate: '',
    mTitle: '',
    mPlace: '',
    mNote: '',
    mTags: [],
    mPhotos: [],
    photoTip: '',
    showMForm: false,
    memoryTags: MEMORY_TAGS,
    memoryEnergy: memoryEnergy(),

    filters: [
      { key: 'all', label: '全部' },
      { key: 'photo', label: '照片' }
    ],
    mFilter: 'all',
    filteredMemories: [],
    capsuleGoal: 0,

    view: 'globe',
    orbItems: [],
    orbPrimary: '#FF7F9C',
    orbAccent: '#FFC77D',
    orbLevel: 1,
    centerStyle: '',
    paused: false,
    reducedMotion: false,

    percent: 0,
    nextLv: 2,
    nextName: '',
    toNext: 0,

    detail: null,
    detailEmoji: '💗',
    detailPhoto: '',
    ghost: null,
    levelUp: null
  },

  /* —— 实例字段 —— */
  /** 已落库但要等飞入动画结束才在球上出现的回忆 id */
  pendingId: '',
  /** 升级动画进行中：这期间不把新等级推给球，让动画自己揭示新形态 */
  lvAnimating: false,
  unsub: null as (() => void) | null,
  unsubData: null as (() => void) | null,
  unsub2: null as (() => void) | null,
  ghostTimer: null as ReturnType<typeof setTimeout> | null,
  lvTimer: null as ReturnType<typeof setTimeout> | null,
  dmHandler: null as ((e: any) => void) | null,
  /** 外部带过来的「定位到这条回忆」id（能量站点球体节点跳进来时用） */
  focusId: '',

  onLoad(q: Record<string, string>) {
    const focusId = (q && q.focus) || '';
    // 带 focus 进来必然是为了看球，直接落在星球视图
    const tab: TabKey = focusId ? 'memory' : (q && q.tab === 'memory' ? 'memory' : 'inter');
    const sv = applySkin();
    const vars = getSkin(sv.key).vars;
    this.setData({
      skin: sv,
      tab,
      iDate: todayYmd(),
      mDate: todayYmd(),
      previewEnergy: energyOf('chat', 0),
      orbPrimary: vars['primary'] || '#FF7F9C',
      orbAccent: vars['accent'] || '#FFC77D',
      centerStyle: centerGlow(vars['primary'] || '#FF7F9C'),
      reducedMotion: !!wx.getStorageSync(REDUCED_KEY)
    });
    this.unsub = watchSkin(() => {
      const s = applySkin();
      const v = getSkin(s.key).vars;
      this.setData({
        skin: s,
        orbPrimary: v['primary'] || '#FF7F9C',
        orbAccent: v['accent'] || '#FFC77D',
        centerStyle: centerGlow(v['primary'] || '#FF7F9C')
      });
    });
    this.unsubData = onTopic('interaction', () => this.refresh());
    this.unsub2 = onTopic('memory', () => this.refresh());
    this.refresh();
    this.startTilt();

    // 球是组件内部异步初始化的，这里给几次重试机会再定位
    if (focusId) {
      this.focusId = focusId;
      setTimeout(() => this.consumeFocus(6), 400);
    }
  },

  /**
   * 定位到指定回忆：球转到该节点并放大，同时浮出详情卡。
   * 组件可能还没 ready，拿不到就按 120ms 间隔重试几次。
   */
  consumeFocus(retry: number) {
    if (!this.focusId) return;
    const orb: any = this.selectComponent('#orb');
    if (!orb || typeof orb.focus !== 'function') {
      if (retry > 0) setTimeout(() => this.consumeFocus(retry - 1), 120);
      return;
    }
    const id = this.focusId;
    this.focusId = '';
    orb.focus(id);
    const m = this.data.memories.find((x) => x.id === id);
    if (m) {
      this.setData({
        detail: m,
        detailEmoji: tagEmoji(m),
        detailPhoto: (m.photos && m.photos[0]) || ''
      });
    }
  },

  onUnload() {
    if (this.unsub) this.unsub();
    if (this.unsubData) this.unsubData();
    if (this.unsub2) this.unsub2();
    if (this.ghostTimer) clearTimeout(this.ghostTimer);
    if (this.lvTimer) clearTimeout(this.lvTimer);
    this.stopTilt();
  },

  onShow() {
    const s = applySkin();
    const vars = getSkin(s.key).vars;
    this.setData({
      skin: s,
      paused: false,
      orbPrimary: vars['primary'] || '#FF7F9C',
      orbAccent: vars['accent'] || '#FFC77D',
      centerStyle: centerGlow(vars['primary'] || '#FF7F9C')
    });
    this.refresh();
  },

  /** 页面隐藏时停掉渲染，省电（回到前台自动恢复） */
  onHide() {
    this.setData({ paused: true });
  },

  /* ============================ 数据刷新 ============================ */

  refresh() {
    const list: DecoInter[] = loadInteractions().map((x) => {
      const t = interactType(x.type);
      return { ...x, label: t.label, emoji: t.emoji };
    });
    const memories = loadMemories();
    const st = heartState();
    const nodes = toOrbNodes(memories);
    // 正在飞入的回忆先不出现在球上，等粒子落进球体再放出来。
    // holding 覆盖「刚落库、pendingId 还没来得及赋值」这一个同步 emit 的空档，
    // 否则新节点会先闪现一帧再消失。
    const orbItems = nodes.filter((n) => {
      if (this.pendingId && n.id === this.pendingId) return false;
      if (this.holding && !this.knownIds[n.id]) return false;
      return true;
    });
    this.knownIds = {};
    nodes.forEach((n) => { this.knownIds[n.id] = true; });

    const patch: any = {
      list,
      total: st.total,
      lv: st.lv,
      memories,
      orbItems,
      percent: st.percent,
      nextLv: st.next ? st.next.lv : 0,
      nextName: st.next ? st.next.name : '',
      toNext: st.toNext,
      /* 能量胶囊分母：到下一级还需要的能量（满级时只显示总量） */
      capsuleGoal: st.next ? st.total + st.toNext : st.total,
      ...this.filterPatch(memories, this.data.mFilter)
    };
    // 升级动画期间不提前把等级给球，让动画自己揭示新形态
    if (!this.lvAnimating) patch.orbLevel = st.lv;
    this.setData(patch);
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TabKey;
    if (!key || key === this.data.tab) return;
    this.setData({ tab: key });
  },

  /* ============================ 回忆分区筛选 ============================ */

  /**
   * 依当前筛选算出 filters + filteredMemories。
   * 分类只给真实数据支撑的项：全部 / 照片（有配图）/ 回忆里出现过的标签，
   * 不造「语音」「视频」这种没有数据来源的空分类。
   */
  filterPatch(memories: Memory[], cur: string): { filters: { key: string; label: string }[]; filteredMemories: Memory[] } {
    const used = new Set<string>();
    (memories || []).forEach((m) => (m.tags || []).forEach((t) => used.add(t)));
    const filters = [{ key: 'all', label: '全部' }, { key: 'photo', label: '照片' }]
      .concat(MEMORY_TAGS.filter((t) => used.has(t)).map((t) => ({ key: t, label: t })));
    // 当前筛选若已被数据淘汰（如删光了某标签的回忆），回落到「全部」
    const key = filters.some((f) => f.key === cur) ? cur : 'all';
    const filtered = key === 'all'
      ? memories || []
      : key === 'photo'
        ? (memories || []).filter((m) => (m.photos || []).length > 0)
        : (memories || []).filter((m) => (m.tags || []).indexOf(key) >= 0);
    return { filters, mFilter: key, filteredMemories: filtered } as any;
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    this.setData(this.filterPatch(this.data.memories, key));
  },

  /** 列表卡点击 → 详情（与球内节点点击一致） */
  onOpenMemory(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const m = this.data.memories.find((x) => x.id === id);
    if (!m) return;
    this.setData({
      detail: m,
      detailEmoji: tagEmoji(m),
      detailPhoto: (m.photos && m.photos[0]) || ''
    });
  },

  /* ============================ 右上角更多 / 底部导航 ============================ */

  /** 更多：换肤 / 动效开关（分享走页面右上角菜单） */
  onMore() {
    const items = ['更换星球皮肤', this.data.reducedMotion ? '恢复丰富动效' : '减弱动效（省电）'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) {
          go('/subpackages/love/pages/skin/skin', { loading: '正在打开皮肤' });
        } else if (res.tapIndex === 1) {
          this.onToggleMotion();
        }
      },
      fail: () => { /* 用户取消 */ }
    });
  },

  /** 底部 Dock：只跳爱遇小栈真实存在的页面 */
  onDock(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    if (!url) return;
    // 【修复】原来直接 go(url)，一旦被节流拦下或跳转失败，用户完全没有反馈，
    // 表现为「点了没反应」。现在加防连点 + 强制跳转（跳过 400ms 节流的静默 return）。
    if (!guardTap('mm_dock_' + url, 450)) return;
    go(url, { title: '爱遇小栈', loading: true, force: true });
  },

  /* ============================ 互动 ============================ */

  onType(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const t = interactType(v);
    this.setData({ iType: v, iMinutes: String(t.suggest), previewEnergy: energyOf(v, t.suggest) });
  },
  onMinutes(e: WechatMiniprogram.InputEvent) {
    const v = e.detail.value;
    this.setData({ iMinutes: v, previewEnergy: energyOf(this.data.iType, Number(v) || 0) });
  },
  onTitle(e: WechatMiniprogram.InputEvent) { this.setData({ iTitle: e.detail.value }); },
  onNote(e: WechatMiniprogram.InputEvent) { this.setData({ iNote: e.detail.value }); },
  onFrom(e: WechatMiniprogram.TouchEvent) {
    this.setData({ iFrom: e.currentTarget.dataset.v as 'me' | 'him' });
  },
  onPickDate(e: WechatMiniprogram.TouchEvent) { this.setData({ iDate: e.detail.value as string }); },

  onSaveInter() {
    if (!guardTap('save_i', 800)) return;
    const d = this.data;
    const mins = Number(d.iMinutes) || 0;
    addInteraction({
      type: d.iType,
      date: d.iDate || todayYmd(),
      at: Date.now(),
      minutes: mins,
      title: d.iTitle || '',
      note: d.iNote || '',
      energy: energyOf(d.iType, mins),
      from: d.iFrom
    });
    this.setData({ iTitle: '', iNote: '', iMinutes: '' });
    toast(`能量 +${energyOf(d.iType, mins)}`);
    this.refresh();
  },

  onDelInter(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('删除这条互动？对应的能量也会扣掉。', () => {
      removeInteraction(id);
      this.refresh();
    }, '删除互动');
  },

  /* ============================ 回忆 · 配图 ============================ */

  onToggleMForm() {
    if (!guardTap('mform', 400)) return;
    this.setData({ showMForm: !this.data.showMForm });
  },

  onMPickDate(e: WechatMiniprogram.TouchEvent) { this.setData({ mDate: e.detail.value as string }); },
  onMTitle(e: WechatMiniprogram.InputEvent) { this.setData({ mTitle: e.detail.value }); },
  onMPlace(e: WechatMiniprogram.InputEvent) { this.setData({ mPlace: e.detail.value }); },
  onMNote(e: WechatMiniprogram.InputEvent) { this.setData({ mNote: e.detail.value }); },

  onMTag(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const cur = this.data.mTags || [];
    this.setData({ mTags: cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]) });
  },

  /** 选照片：优先上云存储（换设备也在），失败则落到用户目录（本机持久） */
  onPickPhoto() {
    if (!guardTap('pick_photo', 600)) return;
    const left = 3 - (this.data.mPhotos || []).length;
    if (left <= 0) return;
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],          // 只要缩略图，球里渲染够用且省流量
      sourceType: ['album', 'camera'],
      success: (res: any) => {
        const temps: string[] = (res.tempFiles || [])
          .map((f: any) => f.tempFilePath)
          .filter((p: string) => !!p);
        if (!temps.length) return;
        wx.showLoading({ title: '收进照片', mask: true });
        let done = 0;
        const out: string[] = [];
        let localFallback = false;
        const finish = () => {
          done++;
          if (done < temps.length) return;
          wx.hideLoading();
          this.setData({
            mPhotos: (this.data.mPhotos || []).concat(out),
            photoTip: localFallback ? '云端不可用，照片已存本机' : ''
          });
        };
        temps.forEach((t) => {
          uploadAttachImage(t, 'love-memory')
            .then((fileID: string) => { out.push(fileID); finish(); })
            .catch(() => { out.push(persistLocal(t)); localFallback = true; finish(); });
        });
      },
      fail: () => { /* 用户取消，不提示 */ }
    });
  },

  onDelPhoto(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const cur = (this.data.mPhotos || []).slice();
    if (isNaN(i) || i < 0 || i >= cur.length) return;
    cur.splice(i, 1);
    this.setData({ mPhotos: cur });
  },

  /* ============================ 放入爱情球（飞入全流程） ============================ */

  async onPutInOrb() {
    if (!guardTap('put_orb', 1200)) return;
    const d = this.data;
    if (!d.mTitle) { toast('给它一个标题吧'); return; }

    // 先拿到按钮位置作为飞入起点（表单马上要收起，必须提前量）
    const r = await rectOf('#putBtn');
    // 先落库保证数据不丢，再标记「等飞入」，中间由 holding 兜住同步刷新
    this.holding = true;
    const rec = addMemory({
      date: d.mDate || todayYmd(),
      title: d.mTitle,
      place: d.mPlace || '',
      note: d.mNote || '',
      tags: d.mTags || [],
      photos: d.mPhotos || []
    });
    this.pendingId = rec.id;
    this.holding = false;

    this.setData({
      mTitle: '', mPlace: '', mNote: '', mTags: [], mPhotos: [], photoTip: '',
      showMForm: false
    });
    // 已落库但先不让它出现在球上，等飞入动画落地
    this.pendingId = rec.id;
    this.refresh();

    const orb: any = this.selectComponent('#orb');
    const emoji = tagEmoji(rec);
    const startX = r ? r.left + r.width / 2 : (wx.getSystemInfoSync().windowWidth || 375) / 2;
    const startY = r ? r.top + r.height / 2 : 400;

    // 无障碍模式：不做飞入动画，直接落地
    if (!orb || this.data.reducedMotion) {
      this.landPending();
      return;
    }

    // 阶段一：回忆卡片缩小（CSS 动画）→ 阶段二：变发光粒子飞向球体（canvas）
    this.setData({ ghost: { x: (r ? r.left : startX), y: (r ? r.top : startY), title: rec.title, emoji } });
    if (this.ghostTimer) clearTimeout(this.ghostTimer);
    this.ghostTimer = setTimeout(() => {
      this.ghostTimer = null;
      this.setData({ ghost: null });
      orb.flyIn(
        { id: rec.id, emoji, tint: tagTint(rec), photo: (rec.photos && rec.photos[0]) || '' },
        startX,
        startY
      );
    }, 560);
  },

  /** 粒子落进球体：节点成形 + 注入能量 + 判定升级 */
  landPending() {
    if (!this.pendingId) return;
    const id = this.pendingId;
    this.pendingId = '';
    const before = heartState().lv;
    const rec = loadMemories().find((m) => m.id === id);
    addInteraction({
      type: 'memory',
      date: (rec && rec.date) || todayYmd(),
      at: Date.now(),
      minutes: 0,
      title: `记录回忆：${(rec && rec.title) || ''}`,
      note: '',
      energy: memoryEnergy(),
      from: 'me'
    });
    this.refresh();
    const after = heartState().lv;
    toast(`爱情能量 +${memoryEnergy()}`);
    if (after > before) this.playLevelUp(after);
  },

  /** 球体的 arrive 事件：粒子真正进入球体内部 */
  onOrbArrive() {
    this.landPending();
  },

  /* ============================ 升级 ============================ */

  playLevelUp(lv: number) {
    const st = heartState();
    const orb: any = this.selectComponent('#orb');
    if (!orb) {
      // 球不在场（列表视图 / 未渲染）：直接弹横幅
      this.showLevelUp(lv, st.cur.name, st.cur.desc || st.cur.mode);
      return;
    }
    this.lvAnimating = true;
    orb.playLevelUp(lv);
  },

  /** 引擎在「新形态出现」那一刻回调 */
  onOrbLevelUp(e: any) {
    const d = (e && e.detail) || {};
    const st = heartState();
    this.showLevelUp(d.lv || st.lv, d.name || st.cur.name, d.desc || st.cur.desc || st.cur.mode);
  },

  /** 弹出等级横幅；横幅收起时把等级同步给组件（形态已由动画切换，setLevel 会是空操作） */
  showLevelUp(lv: number, name: string, desc: string) {
    this.setData({ levelUp: { lv, name, desc } });
    if (this.lvTimer) clearTimeout(this.lvTimer);
    this.lvTimer = setTimeout(() => {
      this.lvTimer = null;
      this.lvAnimating = false;
      this.setData({ levelUp: null, orbLevel: this.data.lv });
    }, 3600);
  },

  /* ============================ 球体交互回调 ============================ */

  /** 点击记忆节点：球已转到该节点并放大，这里浮出详情卡 */
  onOrbSelect(e: any) {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    const m = this.data.memories.find((x) => x.id === id);
    if (!m) return;
    this.setData({
      detail: m,
      detailEmoji: tagEmoji(m),
      detailPhoto: (m.photos && m.photos[0]) || ''
    });
  },

  onSetView(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as 'globe' | 'list';
    if (!v || v === this.data.view) return;
    if (v === 'list' && this.pendingId) {
      // 球要销毁了，别让这条回忆卡在「待飞入」状态
      this.landPending();
    }
    this.setData({ view: v });
  },

  /** 无障碍：减弱动效（不自动旋转 / 飞入直接落地 / 粒子减半） */
  onToggleMotion() {
    const next = !this.data.reducedMotion;
    wx.setStorageSync(REDUCED_KEY, next);
    this.setData({ reducedMotion: next });
    toast(next ? '已减弱动效' : '已恢复动效');
  },

  /* ============================ 详情 / 删除 ============================ */

  onNoop() { /* 阻止冒泡 */ },

  onCloseDetail() {
    this.setData({ detail: null, detailPhoto: '' });
  },

  onDelFromDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('删除这条回忆？', () => {
      removeMemory(id);
      this.setData({ detail: null, detailPhoto: '' });
      this.refresh();
    }, '删除回忆');
  },

  onDelMemory(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('删除这条回忆？', () => {
      removeMemory(id);
      this.refresh();
    }, '删除回忆');
  },

  /* ============================ 陀螺仪微视差 ============================ */

  startTilt() {
    const anyWx = wx as any;
    if (!anyWx.startDeviceMotionListening || !anyWx.onDeviceMotionChange) return;
    try {
      anyWx.startDeviceMotionListening({ interval: 'normal' });
      this.dmHandler = (e: any) => {
        const orb: any = this.selectComponent('#orb');
        if (orb && typeof orb.onDeviceMotion === 'function') orb.onDeviceMotion(e);
      };
      anyWx.onDeviceMotionChange(this.dmHandler);
    } catch (e) {
      this.dmHandler = null;
    }
  },

  stopTilt() {
    const anyWx = wx as any;
    if (!this.dmHandler) return;
    try { if (anyWx.offDeviceMotionChange) anyWx.offDeviceMotionChange(this.dmHandler); } catch (e) { /* ignore */ }
    try { if (anyWx.stopDeviceMotionListening) anyWx.stopDeviceMotionListening(); } catch (e) { /* ignore */ }
    this.dmHandler = null;
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '我们的回忆与互动', path: '/subpackages/love/pages/memory/memory' };
  }
});
