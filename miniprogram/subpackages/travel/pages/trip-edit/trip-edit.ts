// subpackages/travel/pages/trip-edit/trip-edit.ts
// 行程创建 / 编辑：标题 · 目的地 · 日期 · 封面 · 预算 · 场景
// 创建后引导「快速填充」：按目的地匹配路线模板 + 按场景生成行李清单
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { replace, back, backAfter } from '../../../../utils/nav';
import * as store from '../../utils/travel-store';
import * as travelAI from '../../utils/travel-ai';
import { COVER_PRESETS, SCENE_KEYS, sceneMeta, matchRouteTemplate, allRouteTemplates } from '../../utils/trip-templates';
import type { TravelScene, TripItemType } from '../../utils/travel-types';
import type { ThemeKey } from '../../../../types/index';

interface SceneChip {
  key: TravelScene;
  name: string;
  icon: string;
  on: boolean;
}

interface CoverChip {
  key: string;
  name: string;
  gradient: string;
  emoji: string;
  on: boolean;
}

interface RouteChip {
  key: string;
  name: string;
  days: number;
  budgetHint: number;
}

/** AI 生成条目在创建页里的可编辑态（_k 仅用于 wxml 的 wx:key） */
interface AIPreviewItem {
  _k: string;
  day: number;
  startTime: string;
  content: string;
  type: TripItemType;
  /**
   * 类型的 ASCII 类名后缀（供 wxml 拼 class 用）。
   * WXSS 类选择器**不允许非 ASCII 字符**，因此绝不能用中文 type 拼类名
   * 否则微信编译器会直接抛 WXSS 编译错误 "unexpected ? at pos ..."。
   * 显示中文用 type，拼类名用 typeCls。
   */
  typeCls: string;
  place: string;
  cost: number;
  note: string;
}

interface AIDayGroup {
  day: number;
  items: AIPreviewItem[];
}

interface TripEditData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  /** 编辑模式下的行程 id（空=新建） */
  id: string;
  isEdit: boolean;

  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: string;
  membersText: string;
  cover: string;
  coverStyle: string;
  coverEmoji: string;
  coverIsImage: boolean;

  scenes: SceneChip[];
  covers: CoverChip[];
  showCovers: boolean;

  /** 天数（由起止日期推导） */
  dayCount: number;
  /** 推荐路线模板 */
  routeHint: string;
  routes: RouteChip[];
  showRoutes: boolean;
  selectedRoute: string;

  /** ===== AI 智能规划（创建流程内置环节） ===== */
  /** 云端能力是否已开启（决定是否显示生成器） */
  aiOn: boolean;
  /** 生成中 */
  aiLoading: boolean;
  /** AI 生成的原始条目（可编辑） */
  aiItems: AIPreviewItem[];
  /** 按天分组后的预览（派生，wxml 直接渲染） */
  aiGroups: AIDayGroup[];

  minDate: string;
  saving: boolean;
}

/** 预览条目类型循环顺序（点一下切换类型标签） */
const AI_TYPE_CYCLE: TripItemType[] = ['交通', '景点', '餐厅', '酒店', '购物', '自定义'];

/** 类型 → ASCII 类名后缀（WXSS 选择器只能用 ASCII，中文类名会导致编译报错） */
const AI_TYPE_SLUG: Record<string, string> = {
  交通: 'traffic',
  景点: 'spot',
  餐厅: 'food',
  酒店: 'hotel',
  购物: 'shop',
  自定义: 'custom'
};

/** 取类型的 ASCII 类名后缀，未知类型兜底 custom */
function typeSlug(t: TripItemType | string): string {
  return AI_TYPE_SLUG[t] || 'custom';
}

function todayYMD(): string {
  return store.toYMD(Date.now());
}

function addDaysYMD(ymd: string, n: number): string {
  return store.toYMD(store.parseDate(ymd) + n * 86400000);
}

/** onLoad query 参数解码：上游页面跳转时用 encodeURIComponent 编码过，必须还原；非法序列原样返回 */
function decQuery(s: string | undefined): string {
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

Page<TripEditData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    id: '',
    isEdit: false,
    title: '',
    destination: '',
    startDate: todayYMD(),
    endDate: addDaysYMD(todayYMD(), 2),
    budget: '',
    membersText: '',
    cover: 'sea',
    coverStyle: COVER_PRESETS[0].gradient ? `background:${COVER_PRESETS[0].gradient}` : '',
    coverEmoji: COVER_PRESETS[0].emoji,
    coverIsImage: false,
    scenes: [],
    covers: [],
    showCovers: false,
    dayCount: 3,
    routeHint: '',
    routes: [],
    showRoutes: false,
    selectedRoute: '',
    aiOn: false,
    aiLoading: false,
    aiItems: [],
    aiGroups: [],
    minDate: todayYMD(),
    saving: false
  },

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    this.setData({
      aiOn: travelAI.aiAvailable(),
      scenes: SCENE_KEYS.map((k) => ({ key: k, name: sceneMeta(k).name, icon: sceneMeta(k).icon, on: false })),
      covers: COVER_PRESETS.map((p) => ({
        key: p.key,
        name: p.name,
        gradient: p.gradient,
        emoji: p.emoji,
        on: p.key === this.data.cover
      }))
    });

    const id = (q && q.id) || '';
    if (id) {
      const trip = store.getTrip(id);
      if (!trip) {
        toast('行程不存在', 'none');
        backAfter(600);
        return;
      }
      const cov = COVER_PRESETS.find((p) => p.key === trip.cover);
      this.setData({
        id,
        isEdit: true,
        title: trip.title,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        budget: trip.budget ? String(trip.budget) : '',
        membersText: (trip.members || []).join('、'),
        cover: trip.cover || 'sea',
        coverStyle: cov ? `background:${cov.gradient}` : '',
        coverEmoji: cov ? cov.emoji : '',
        coverIsImage: !cov && !!trip.cover,
        scenes: SCENE_KEYS.map((k) => ({
          key: k,
          name: sceneMeta(k).name,
          icon: sceneMeta(k).icon,
          on: (trip.scenes || []).indexOf(k) >= 0
        }))
      });
    } else if (q && q.destination) {
      // 从「旅行灵感」页一键带目的地新建行程（参数是 encodeURIComponent 编码过的，需解码）
      const destination = decQuery(q.destination);
      const formTitle = decQuery(q.formTitle);
      this.setData({
        destination,
        title: formTitle || `${destination}之旅`
      });
    }
    this.recalc();
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    });
    syncNavBar(state);
  },

  /* ===== 表单 ===== */
  onTitle(e: WechatMiniprogram.InputEvent) {
    this.setData({ title: e.detail.value });
  },
  onDestination(e: WechatMiniprogram.InputEvent) {
    this.setData({ destination: e.detail.value }, () => this.recalc());
  },
  onBudget(e: WechatMiniprogram.InputEvent) {
    this.setData({ budget: e.detail.value });
  },
  onMembers(e: WechatMiniprogram.InputEvent) {
    this.setData({ membersText: e.detail.value });
  },

  onStartChange(e: WechatMiniprogram.PickerChangeEvent) {
    const v = e.detail.value as string;
    const start = v || this.data.startDate;
    // 结束日期早于开始日期时自动顺延
    const end = store.parseDate(this.data.endDate) < store.parseDate(start) ? start : this.data.endDate;
    this.setData({ startDate: start, endDate: end }, () => this.recalc());
  },
  onEndChange(e: WechatMiniprogram.PickerChangeEvent) {
    const v = e.detail.value as string;
    const end = v || this.data.endDate;
    const start =
      store.parseDate(end) < store.parseDate(this.data.startDate) ? end : this.data.startDate;
    this.setData({ endDate: end, startDate: start }, () => this.recalc());
  },

  /** 用微信选点填目的地 */
  onPickLocation() {
    wx.chooseLocation({
      success: (res) => {
        const name = res.name || res.address || '';
        if (!name) return;
        // 取城市名：优先 poi 名，其次地址前两段
        const city = name.length > 12 ? name.slice(0, 12) : name;
        this.setData({ destination: city }, () => this.recalc());
        toast(`已选择 ${city}`, 'none');
      },
      fail: (err) => {
        // 用户主动取消不打扰；接口未开通 / 授权被拒时提示改手动填写
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return;
        toast('地图选点暂不可用，可直接填写目的地', 'none');
      }
    });
  },

  /* ===== 场景 ===== */
  onToggleScene(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TravelScene;
    this.setData(
      { scenes: this.data.scenes.map((s) => (s.key === key ? { ...s, on: !s.on } : s)) },
      () => this.recalc()
    );
  },

  /* ===== 封面 ===== */
  onToggleCovers() {
    this.setData({ showCovers: !this.data.showCovers });
  },
  onPickCover(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const p = COVER_PRESETS.find((c) => c.key === key);
    if (!p) return;
    this.setData({
      cover: key,
      coverStyle: `background:${p.gradient}`,
      coverEmoji: p.emoji,
      coverIsImage: false,
      covers: this.data.covers.map((c) => ({ ...c, on: c.key === key })),
      showCovers: false
    });
  },
  onPickCoverImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({
          cover: f.tempFilePath,
          coverStyle: '',
          coverEmoji: '',
          coverIsImage: true,
          covers: this.data.covers.map((c) => ({ ...c, on: false })),
          showCovers: false
        });
      },
      fail: () => {
        /* 用户取消 */
      }
    });
  },

  /* ===== 路线推荐 ===== */
  recalc() {
    const days = store.tripDays({
      startDate: this.data.startDate,
      endDate: this.data.endDate
    } as import('../../utils/travel-types').ITrip);
    const tpl = matchRouteTemplate(this.data.destination, days);
    const routes: RouteChip[] = allRouteTemplates()
      .filter((t) => t.days === days)
      .map((t) => ({ key: t.key, name: t.name, days: t.days, budgetHint: t.budgetHint }));
    this.setData({
      dayCount: days,
      routeHint: tpl ? tpl.name : '',
      routes,
      selectedRoute: tpl ? tpl.key : routes.length ? routes[0].key : ''
    });
  },
  onToggleRoutes() {
    this.setData({ showRoutes: !this.data.showRoutes });
  },
  onPickRoute(e: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedRoute: e.currentTarget.dataset.key as string });
  },

  /* ===== AI 智能规划（创建内置环节） ===== */

  /** 把 aiItems 派生出按天分组，供 wxml 渲染（同时维护顺序） */
  recomputeAI() {
    const items = this.data.aiItems;
    const daySet = new Set<number>();
    items.forEach((it) => daySet.add(it.day));
    const days = Array.from(daySet).sort((a, b) => a - b);
    const groups: AIDayGroup[] = days.map((d) => ({
      day: d,
      items: items
        .filter((it) => it.day === d)
        .sort((a, b) => (a.startTime || '09:00').localeCompare(b.startTime || '09:00'))
    }));
    this.setData({ aiGroups: groups });
  },

  /** 把可编辑预览条目映射成 store 写入结构 */
  toItemInputs(items: AIPreviewItem[]): store.TripItemInput[] {
    return items.map((it) => ({
      content: it.content || '新安排',
      day: it.day,
      startTime: it.startTime || '09:00',
      duration: 60,
      location: it.place ? { name: it.place, address: '', latitude: 0, longitude: 0 } : null,
      itemType: it.type,
      cost: Number(it.cost) || 0,
      note: it.note || ''
    }));
  },

  /** 启用 AI 能力（独立探测云函数 aiStatus，不依赖数据库集合是否建好） */
  onAiEnable() {
    toast('正在启用 AI…', 'loading');
    void travelAI.enableAI().then((r) => {
      if (!r.ok) {
        toast(r.msg, 'none');
        return;
      }
      this.setData({ aiOn: true });
      this.onAiGen();
    });
  },

  /** 生成 / 重新生成行程 */
  onAiGen() {
    if (!this.data.aiOn) {
      this.onAiEnable();
      return;
    }
    const destination = (this.data.destination || '').trim();
    if (!destination) {
      toast('先填写目的地', 'none');
      return;
    }
    if (!this.data.dayCount || this.data.dayCount < 1) {
      toast('先选择出发 / 返程日期', 'none');
      return;
    }
    this.setData({ aiLoading: true });
    const members = (this.data.membersText || '')
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const scenes = this.data.scenes.filter((s) => s.on).map((s) => s.key);
    void travelAI
      .generatePlan({
        destination,
        days: this.data.dayCount,
        budget: Number(this.data.budget) || 0,
        members,
        scenes
      })
      .then((r) => {
        if (!r.ok || !r.items.length) {
          this.setData({ aiLoading: false });
          toast(r.message || 'AI 未返回行程，请重试', 'none');
          return;
        }
        const mapped: AIPreviewItem[] = r.items.map((it) => ({
          _k: `ai_${Math.random().toString(36).slice(2, 9)}`,
          day: it.day,
          startTime: it.startTime,
          content: it.content,
          type: it.type,
          typeCls: typeSlug(it.type),
          place: it.place,
          cost: it.cost,
          note: it.note
        }));
        this.setData({ aiLoading: false, aiItems: mapped }, () => this.recomputeAI());
        toast(`已生成 ${mapped.length} 条行程`, 'success');
      })
      .catch(() => {
        this.setData({ aiLoading: false });
        toast('AI 调用失败，请重试', 'none');
      });
  },

  onAiContent(e: WechatMiniprogram.InputEvent) {
    const k = e.currentTarget.dataset.k as string;
    const v = e.detail.value;
    this.setData({ aiItems: this.data.aiItems.map((it) => (it._k === k ? { ...it, content: v } : it)) });
  },
  onAiPlace(e: WechatMiniprogram.InputEvent) {
    const k = e.currentTarget.dataset.k as string;
    const v = e.detail.value;
    this.setData({ aiItems: this.data.aiItems.map((it) => (it._k === k ? { ...it, place: v } : it)) });
  },
  onAiCost(e: WechatMiniprogram.InputEvent) {
    const k = e.currentTarget.dataset.k as string;
    const v = e.detail.value;
    this.setData({ aiItems: this.data.aiItems.map((it) => (it._k === k ? { ...it, cost: Number(v) || 0 } : it)) });
  },
  onAiTime(e: WechatMiniprogram.PickerChangeEvent) {
    const k = e.currentTarget.dataset.k as string;
    const v = e.detail.value as string;
    this.setData(
      { aiItems: this.data.aiItems.map((it) => (it._k === k ? { ...it, startTime: v } : it)) },
      () => this.recomputeAI()
    );
  },
  onAiType(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    this.setData({
      aiItems: this.data.aiItems.map((it) => {
        if (it._k !== k) return it;
        const idx = AI_TYPE_CYCLE.indexOf(it.type);
        const next = AI_TYPE_CYCLE[(idx + 1) % AI_TYPE_CYCLE.length];
        return { ...it, type: next, typeCls: typeSlug(next) };
      })
    });
  },
  onAiRemove(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    this.setData({ aiItems: this.data.aiItems.filter((it) => it._k !== k) }, () => this.recomputeAI());
  },
  onAiAdd(e: WechatMiniprogram.TouchEvent) {
    const day = Number(e.currentTarget.dataset.day) || 1;
    const k = `ai_${Math.random().toString(36).slice(2, 9)}`;
    this.setData(
      {
        aiItems: this.data.aiItems.concat([
          {
            _k: k,
            day,
            startTime: '09:00',
            content: '',
            type: '景点',
            typeCls: typeSlug('景点'),
            place: '',
            cost: 0,
            note: ''
          }
        ])
      },
      () => this.recomputeAI()
    );
  },
  onAiDiscard() {
    this.setData({ aiItems: [] }, () => this.recomputeAI());
  },

  /* ===== 保存 ===== */
  onSave() {
    if (this.data.saving) return;
    const title = (this.data.title || '').trim();
    if (!title) {
      toast('给行程起个名字', 'none');
      return;
    }
    const destination = (this.data.destination || '').trim();
    const members = (this.data.membersText || '')
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const scenes = this.data.scenes.filter((s) => s.on).map((s) => s.key);
    const budget = Number(this.data.budget) || 0;

    this.setData({ saving: true });

    const payload = {
      title,
      destination,
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      cover: this.data.cover,
      budget,
      members,
      scenes,
      currency: null
    };

    const done = (tripId: string) => {
      const routeKey = this.data.selectedRoute;
      const hasRoute = !!routeKey;
      const hasScenes = scenes.length > 0;
      if (!hasRoute && !hasScenes) {
        this.setData({ saving: false });
        replace(`/subpackages/travel/pages/trip-detail/trip-detail?id=${tripId}`, { title });
        return;
      }
      wx.showModal({
        title: '快速填充',
        content: hasRoute
          ? `已为你匹配「${this.routeName(routeKey)}」路线${hasScenes ? '，并按场景生成行李清单' : ''}。立即导入？`
          : '按所选场景自动生成一个行李清单？',
        confirmText: '导入',
        cancelText: '手动添加',
        success: (m) => {
          if (m.confirm) {
            wx.showLoading({ title: '生成中', mask: true });
            void store
              .bootstrapTrip(tripId, scenes)
              .then((r) => {
                wx.hideLoading();
                toast(`已导入 ${r.route} 项日程 · ${r.packing} 件行李`, 'success');
                replace(`/subpackages/travel/pages/trip-detail/trip-detail?id=${tripId}`, { title });
              })
              .catch(() => {
                wx.hideLoading();
                this.setData({ saving: false });
                replace(`/subpackages/travel/pages/trip-detail/trip-detail?id=${tripId}`, { title });
              });
          } else {
            this.setData({ saving: false });
            replace(`/subpackages/travel/pages/trip-detail/trip-detail?id=${tripId}`, { title });
          }
        },
        fail: () => {
          this.setData({ saving: false });
        }
      });
    };

    if (this.data.id) {
      const editId = this.data.id;
      void store.updateTrip(editId, payload).then(() => {
        const aiItems = this.data.aiItems;
        if (aiItems.length) {
          const inputs = this.toItemInputs(aiItems);
          void store.bulkAddTripItems(editId, inputs).then(() => {
            this.setData({ saving: false });
            toast(`已保存并追加 ${inputs.length} 条 AI 行程`, 'success');
            backAfter(500);
          });
          return;
        }
        this.setData({ saving: false });
        toast('已保存', 'success');
        backAfter(500);
      });
      return;
    }

    void store.addTrip(payload).then((trip) => {
      const aiItems = this.data.aiItems;
      if (aiItems.length) {
        const inputs = this.toItemInputs(aiItems);
        void store.bulkAddTripItems(trip._id, inputs).then(() => {
          this.setData({ saving: false });
          // AI 已生成完整日程，跳过路线模板快速填充，直达详情（详情页可继续编辑每一条）
          toast(`已创建并生成 ${inputs.length} 条行程`, 'success');
          replace(`/subpackages/travel/pages/trip-detail/trip-detail?id=${trip._id}`, { title });
        });
        return;
      }
      done(trip._id);
    });
  },

  routeName(key: string): string {
    const t = allRouteTemplates().find((r) => r.key === key);
    return t ? t.name : '经典路线';
  },

  onCancel() {
    back();
  }
});
