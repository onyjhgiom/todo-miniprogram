// pages/love/love/love.ts
// 异地恋能量站：爱心培育 · 连续互动与彩蛋 · 两地距离与天气 · 生日送礼
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { getRelation, onTopic } from '../../utils/love-store';
import {
  heartState, streakState, togetherStat, achievements, nextAchievement,
  energyStat, recentInteractions, INTERACTIONS, heartGallery, heartVisual
} from '../../utils/love-energy';
import type { HeartState, Achievement, EnergyStat, TogetherStat, HeartGalleryItem, HeartVisual } from '../../utils/love-energy';
import { distanceKm, distanceText, flyText, fetchWeather, careMessage, coordPlot } from '../../utils/love-place';
import type { CityWeather } from '../../utils/love-types';
import type { CoordPlot } from '../../utils/love-place';
import { birthdayStat, zodiacOf, giftForHim } from '../../utils/love-gift';
import type { BirthdayStat } from '../../utils/love-gift';
import { go } from '../../../../utils/nav';

interface OrbitView {
  emoji: string;
  left: string;
  top: string;
  delay: string;
}

/** 星光粒子视图（点位/节奏由 heartVisual 预先算好，WXML 只做渲染） */
interface SparkView {
  left: string;
  top: string;
  size: string;
  delay: string;
  dur: string;
  op: string;
}

interface LoveData {
  skin: SkinView;
  heart: HeartState | null;
  orbits: OrbitView[];
  heartStyle: string;
  /** 爱心视觉层级类名（t1 简洁 / t2 精致 / t3 华丽） */
  heartTier: string;
  /** 主爱心星光粒子 */
  heartSparks: SparkView[];
  /** 升级瞬间置 true，触发「弹入 + 粒子迸发」，动画播完自动复位 */
  heartPop: boolean;
  streak: number;
  streakBest: number;
  streakTip: string;
  achs: Achievement[];
  nextAch: Achievement | null;
  stat: EnergyStat | null;
  /** 近 7 天柱状图：高度预先算好，避免在 wxml 的 style 里写比较运算符 */
  chart: { label: string; energy: number; h: number }[];
  together: TogetherStat | null;

  myCity: string;
  hisCity: string;
  km: number | null;
  distText: string;
  fly: string;
  /** 双方定位坐标图 */
  plot: CoordPlot | null;
  mapReady: boolean;
  myW: CityWeather | null;
  hisW: CityWeather | null;
  careText: string;
  loadingW: boolean;

  bday: BirthdayStat | null;
  gifts: { name: string; emoji: string; price: string; reason: string }[];
  nickname: string;

  recent: { type: string; label: string; emoji: string; energy: number; date: string; title: string }[];

  /** 爱心图鉴：全部等级外观（含未解锁），仅预览、不解锁 */
  gallery: HeartGalleryItem[];
  /** 图鉴英雄区大爱心（Lv.10 终极形态，纯展示） */
  galleryHero: HeartVisual;
  /** 当前打开预览的等级（null = 关闭） */
  preview: HeartGalleryItem | null;

  /** 升温成就特效预览（null = 关闭） */
  achPreview: AchFx | null;
}

interface AchFx {
  days: number;
  name: string;
  emoji: string;
  unlocked: boolean;
  egg: string;
  /** 等级 1~10，越高特效越华丽 */
  tier: number;
  /** 爆发粒子（按等级规模变化） */
  particles: { emoji: string; dx: string; dy: string; delay: string }[];
}

Page<LoveData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    heart: null,
    orbits: [],
    heartStyle: '',
    heartTier: 'ay-heart--t1',
    heartSparks: [],
    heartPop: false,
    streak: 0,
    streakBest: 0,
    streakTip: '',
    achs: [],
    nextAch: null,
    stat: null,
    chart: [],
    together: null,
    myCity: '',
    hisCity: '',
    km: null,
    distText: '',
    fly: '',
    plot: null,
    mapReady: false,
    myW: null,
    hisW: null,
    careText: '',
    loadingW: false,
    bday: null,
    gifts: [],
    nickname: '',
    recent: [],
    gallery: [],
    galleryHero: { style: '', orbits: [], tier: 1, tierCls: 'ay-heart--t1', sparks: [] },
    preview: null,
    achPreview: null
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.unsubData = onTopic('relation', () => this.refresh());
    this.unsub2 = onTopic('interaction', () => this.refresh());
    this.refresh();
  },

  onUnload() {
    if (this.unsub) this.unsub();
    if (this.unsubData) this.unsubData();
    if (this.unsub2) this.unsub2();
    if (this.popTimer) {
      clearTimeout(this.popTimer);
      this.popTimer = null;
    }
  },

  onShow() {
    this.setData({ skin: applySkin() });
    this.refresh();
  },

  unsub: null as (() => void) | null,
  unsubData: null as (() => void) | null,
  unsub2: null as (() => void) | null,
  /** 升级反馈动画的复位定时器 */
  popTimer: null as ReturnType<typeof setTimeout> | null,

  refresh() {
    const rel = getRelation();
    const h = heartState();
    const st = streakState();
    const tg = togetherStat();
    const stat = energyStat();

    // 爱心外观由等级决定：颜色（多层渐变）、光晕、边缘描光、环绕、心跳速度全部随等级变化
    const hv = heartVisual(h.cur.lv);
    const heartStyle = hv.style;
    // 等级提升时给一次「弹入 + 粒子迸发 + 高光扫过」反馈
    const prev = this.data.heart;
    const levelUp = !!prev && prev.lv < h.cur.lv;
    const n = h.orbits.length;
    const orbits: OrbitView[] = h.orbits.map((o, i) => {
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 132;
      const x = 160 + r * Math.sin(ang);
      const y = 140 - r * Math.cos(ang);
      return { emoji: o.emoji, left: x.toFixed(0) + 'rpx', top: y.toFixed(0) + 'rpx', delay: o.delay + 'ms' };
    });

    const bday = rel.him.birthday ? birthdayStat(rel.him.birthday) : null;
    const gifts = rel.him.birthday || rel.him.hobbies.length ? giftForHim().map((g) => ({
      name: g.name, emoji: g.emoji, price: g.price, reason: g.reason
    })) : [];

    const recent = recentInteractions(5).map((x) => {
      const t = INTERACTIONS.find((i) => i.key === x.type);
      return {
        type: x.type,
        label: t ? t.label : '互动',
        emoji: t ? t.emoji : '⭐',
        energy: x.energy,
        date: x.date,
        title: x.title || ''
      };
    });

    const chart = stat.daily.map((d) => ({
      label: d.label,
      energy: d.energy,
      h: Math.min(100, Math.max(d.energy > 0 ? 6 : 0, d.energy * 3))
    }));

    // 爱情能量球已迁到「回忆」页独占展示，能量站只保留爱心培育与统计

    this.setData({
      heart: h,
      orbits,
      heartStyle,
      heartTier: hv.tierCls,
      heartSparks: hv.sparks,
      heartPop: levelUp,
      chart,
      streak: st.days,
      streakBest: st.best,
      streakTip: st.tip,
      achs: achievements(st.days),
      nextAch: nextAchievement(st.days),
      stat,
      together: tg,
      myCity: rel.me.city,
      hisCity: rel.him.city,
      bday,
      gifts,
      nickname: rel.him.nickname || '他',
      recent,
      gallery: heartGallery(h.total),
      // 图鉴英雄区大爱心：直接取 Lv.10 的完整视觉（终极形态展示用，与解锁无关）
      galleryHero: heartVisual(10)
    });

    // 升级反馈只播一次，动画结束后复位，避免后续 refresh 反复弹
    if (levelUp) {
      if (this.popTimer) clearTimeout(this.popTimer);
      this.popTimer = setTimeout(() => {
        this.popTimer = null;
        this.setData({ heartPop: false });
      }, 1200);
    }

    this.loadDistance();
    this.loadWeather();
  },

  loadDistance() {
    const rel = getRelation();
    const plot = coordPlot(rel.me.city, rel.him.city);
    if (!rel.me.city || !rel.him.city) {
      this.setData({ km: null, distText: '把双方城市填完整，就能算出距离', fly: '', plot, mapReady: false });
      return;
    }
    const km = distanceKm(rel.me.city, rel.him.city);
    this.setData({
      km,
      distText: km === null
        ? `没查到「${rel.me.city} / ${rel.him.city}」的坐标，换一个更常见的城市名试试`
        : distanceText(km),
      fly: flyText(km),
      plot,
      mapReady: plot.ready
    });
  },

  /** 距离卡点击 → 进入档案页编辑双方城市（更快捷的入口） */
  onGoProfile() {
    if (!guardTap('go_profile', 500)) return;
    go('/subpackages/love/pages/profile/profile?focus=city', { title: '爱遇小栈', loading: true });
  },

  /**
   * 天气是异步的，且允许失败——失败时展示本地估算并标明来源。
   * 这里先给一份「立刻可见」的估算，拿到真实数据再覆盖，避免空白等待。
   */
  loadWeather() {
    const rel = getRelation();
    if (!rel.him.city && !rel.me.city) {
      this.setData({ myW: null, hisW: null });
      return;
    }
    this.setData({ loadingW: true });
    const tasks: Promise<CityWeather>[] = [];
    if (rel.me.city) tasks.push(fetchWeather(rel.me.city));
    if (rel.him.city) tasks.push(fetchWeather(rel.him.city));
    Promise.all(tasks).then((list) => {
      let myW: CityWeather | null = null;
      let hisW: CityWeather | null = null;
      if (rel.me.city && rel.him.city) { myW = list[0]; hisW = list[1]; }
      else if (rel.me.city) { myW = list[0]; }
      else { hisW = list[0]; }
      const careText = hisW && rel.him.city ? careMessage(rel.him.city, hisW, rel.him.nickname) : '';
      this.setData({ myW, hisW, careText, loadingW: false });
    });
  },

  onRefreshWeather() {
    if (!guardTap('refresh_w', 1500)) return;
    toast('正在刷新天气');
    this.loadWeather();
  },

  /** 把关心话术复制出来，直接粘贴到聊天框 */
  onCopyCare() {
    if (!guardTap('copy_care', 1000)) return;
    const t = this.data.careText;
    if (!t) { toast('还没有可发送的内容'); return; }
    try {
      wx.setClipboardData({ data: t });
    } catch (e) {
      toast('复制失败');
    }
  },

  onGo(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    if (!guardTap('go_' + k, 500)) return;
    const map: Record<string, string> = {
      memory: '/subpackages/love/pages/memory/memory',
      profile: '/subpackages/love/pages/profile/profile',
      share: '/subpackages/love/pages/share/share',
      add: '/subpackages/love/pages/memory/memory?tab=inter'
    };
    const p = map[k];
    if (p) go(p, { title: '爱遇小栈', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const d = this.data;
    return {
      title: d.together ? `我们一起已经 ${d.together.days} 天了` : '爱遇小栈 · 异地恋能量站',
      path: '/subpackages/love/pages/love/love'
    };
  },

  /** 打开爱心图鉴预览：只查看模样，绝不解锁 */
  onOpenPreview(e: WechatMiniprogram.TouchEvent) {
    const lv = Number(e.currentTarget.dataset.lv) || 1;
    const item = this.data.gallery.find((g) => g.lv === lv);
    if (!item) return;
    this.setData({ preview: item });
  },

  /** 关闭预览 */
  onClosePreview() {
    if (this.data.preview) this.setData({ preview: null });
  },

  /** 阻止冒泡（点预览卡片内部不关闭） */
  onNoop() {},

  /** 打开升温成就的特效预览：按等级释放不同规模的庆祝粒子，纯展示、不解锁 */
  onOpenAch(e: WechatMiniprogram.TouchEvent) {
    const days = Number(e.currentTarget.dataset.days) || 0;
    const item = this.data.achs.find((a) => a.days === days);
    if (!item) return;
    const tier = Math.max(1, Math.min(10, Math.round(days / 36.5) + 1)); // 3天→1，365天→11→封顶10
    const count = Math.max(8, Math.min(30, 6 + Math.round(days / 12)));
    const emojis = ['💖', '✨', '🌟', '💫', '🎉', '🌸', '💕', '⭐', '🫧', '🔮', '🦋', '🌈'];
    const R = 150; // 爆发半径(rpx)
    const particles: { emoji: string; dx: string; dy: string; delay: string }[] = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.18;
      const r = R * (0.78 + (i % 3) * 0.11);
      particles.push({
        emoji: emojis[(i + tier) % emojis.length],
        dx: (Math.cos(ang) * r).toFixed(0) + 'rpx',
        dy: (Math.sin(ang) * r).toFixed(0) + 'rpx',
        delay: (i % 6 * 40) + 'ms'
      });
    }
    this.setData({
      achPreview: {
        days: item.days, name: item.name, emoji: item.emoji,
        unlocked: item.unlocked, egg: item.unlocked ? item.egg : '',
        tier, particles
      }
    });
  },

  onCloseAch() {
    if (this.data.achPreview) this.setData({ achPreview: null });
  }
});
