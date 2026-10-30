// pages/tools/tools.ts
// 工具中心枢纽页：吸顶搜索 + 横向分类 Tab + 响应式图标宫格
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast } from '../../utils/cloud';
import { openMiniLink, copyMiniLink } from '../../utils/mini-link';
import { TOOLS, TOOL_CATEGORIES, decorateTool, searchTools } from '../../utils/tools';
import type { DecoratedTool } from '../../utils/tools';
import type { ThemeKey } from '../../types/index';
import { go, relaunch } from '../../utils/nav';

interface CategoryTab {
  key: string;
  label: string;
  icon: string;
}

interface ToolsData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  fxMode: string;
  fxLevel: number;
  fxSrc: string;
  fxFull: boolean;
  bgStyle: string;
  categories: CategoryTab[];
  activeCat: string;
  keyword: string;
  displayTools: DecoratedTool[];
  total: number;
  hasCat: boolean;
}

const CATEGORY_TABS: CategoryTab[] = [
  { key: 'all', label: '全部', icon: '🧰' },
  ...TOOL_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon }))
];

/**
 * 装饰结果只算一次。
 * 原实现每次搜索/切分类都重新 map(decorateTool) 一遍，既要重新分配对象、
 * 又要让整份新数组重新跨线程传给视图层——输入框每敲一个字都付一次这个成本。
 * 这里预计算，后续只做过滤，setData 传的也是同一批对象引用。
 */
const DECORATED_TOOLS: DecoratedTool[] = TOOLS.map(decorateTool);

/** id → 工具索引：点击时按 id 反查，避免把整个工具对象塞进 dataset 跨线程往返 */
const TOOL_BY_ID: Record<string, DecoratedTool> = {};
DECORATED_TOOLS.forEach((t) => { TOOL_BY_ID[t.id] = t; });

/**
 * 工具 route → 落地页路径。
 * 用表驱动替代一长串 if 分支：新增工具只需在 utils/tools.ts 声明 route，
 * 这里补一行即可；漏配时点击会直接提示「功能开发中」，而不是静默无反应。
 */
const ROUTE_PATHS: Record<string, string> = {
  home: '/pages/index/index',
  calendar: '/pages/calendar/calendar',
  note: '/pages/note/note',
  wish: '/pages/wish/wish',
  ledger: '/pages/ledger/ledger',
  memo: '/pages/memo/memo',
  'group-reminder': '/pages/group-reminder/group-reminder',
  'subscribe-reminder': '/pages/subscribe-reminder/subscribe-reminder',
  'little-helper': '/subpackages/toolbox/pages/little-helper/little-helper',
  'important-day': '/subpackages/toolbox/pages/important-day/important-day',
  'todo-panel': '/pages/todo-panel/todo-panel',
  recruit: '/subpackages/recruit/pages/recruit/recruit',
  'asset-ledger': '/subpackages/tools/pages/asset-ledger/asset-ledger',
  astro: '/subpackages/tools/pages/astro/index',
  folklore: '/subpackages/tools/pages/folklore/index',
  games: '/subpackages/games/pages/center/center',
  'goal-breakdown': '/pages/goal-breakdown/goal-breakdown',
  'course-schedule': '/course-schedule/pages/schedule/index',
  travel: '/subpackages/travel/pages/index/index',
  photowall: '/subpackages/photowall/pages/index/index',
  wheel: '/subpackages/tools/pages/wheel/index',
  danmaku: '/subpackages/danmaku/pages/editor/editor',
  love: '/subpackages/love/pages/index/index',
  pomodoro: '/subpackages/pomodoro/pages/index/index'
};

/**
 * 位于分包里的工具：首次进入需要下载分包。
 * 这里额外挂一个 loading（nav 层做的是「延迟遮罩」——跳转够快就不显示，
 * 只有真正慢的时候才出现），既不影响正常秒开，也绝不会出现「点了没反应」。
 */
const SUBPACKAGE_ROUTES: Record<string, boolean> = {
  games: true,
  astro: true,
  folklore: true,
  recruit: true,
  'asset-ledger': true,
  travel: true,
  photowall: true,
  wheel: true,
  danmaku: true,
  love: true,
  pomodoro: true
};

Page<ToolsData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    fxMode: 'sunset',
    fxLevel: 6,
    fxSrc: '',
    fxFull: false,
    bgStyle: '',
    categories: CATEGORY_TABS,
    activeCat: 'all',
    keyword: '',
    displayTools: [],
    total: TOOLS.length,
    hasCat: true
  },

  onLoad() {
    this.applyThemeToPage();
    this.applyFilter();
    // 首屏渲染完成后再预下载分包，不抢占首屏资源
    setTimeout(preloadSubPackages, 300);
  },

  onShow() {
    this.applyThemeToPage();
  },

  applyThemeToPage() {
    const state = getThemeState();
this.setData({
        theme: state.theme,
        themeStyle: state.themeStyle,
        heroGradient: state.heroGradient,
        fxMode: state.fxMode,
        fxLevel: state.fxLevel,
        fxSrc: state.fxSrc,
        fxFull: state.fxFull,
        bgStyle: state.bgStyle
      });
    syncNavBar(state);
  },

  // ===== 分类切换 =====
  onCategory(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.activeCat) return;
    this.setData({ activeCat: key }, () => this.applyFilter());
  },

  // ===== 搜索 =====
  onSearch(e: WechatMiniprogram.InputEvent) {
    const value = e.detail.value;
    this.setData({ keyword: value }, () => this.applyFilter());
  },

  onClearSearch() {
    if (!this.data.keyword) return;
    this.setData({ keyword: '' }, () => this.applyFilter());
  },

  applyFilter() {
    const { activeCat, keyword } = this.data;
    let list = DECORATED_TOOLS;
    if (activeCat !== 'all') {
      list = list.filter((t) => t.category === activeCat);
    }
    list = searchTools(list, keyword);
    this.setData({
      displayTools: list,
      total: list.length,
      hasCat: activeCat !== 'all'
    });
  },

  // ===== 工具点击 =====
  onTool(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string; tool?: DecoratedTool };
    const tool = ds.id ? TOOL_BY_ID[ds.id] : ds.tool;
    if (!tool) return;
    if (tool.soon) {
      toast('该工具即将上线，敬请期待');
      return;
    }
    // 外部小程序链接（如美团 / 饿了么红包）：通过小程序链接跳转，失败自动复制链接
    if (tool.shortLink) {
      openMiniLink([tool.shortLink, tool.shortLinkAlt], tool.name);
      return;
    }
    // 工具详情页（widget）：type 决定渲染哪个小工具
    if (tool.route === 'tool') {
      if (!tool.widget) {
        toast(`${tool.name}：功能开发中`);
        return;
      }
      go(`/subpackages/toolbox/pages/tool/tool?type=${tool.widget}`, { title: tool.name });
      return;
    }

    const path = tool.route ? ROUTE_PATHS[tool.route] : '';
    if (!path) {
      toast(`${tool.name}：功能开发中`);
      return;
    }

    // 首页是根页：清空页面栈回根，避免从工具中心一路 push 把层级越点越深
    if (tool.route === 'home') {
      relaunch(path, { force: true, silent: true });
      return;
    }
    // 分包工具：首次进入要下载分包，挂延迟遮罩——快则无感，慢则有反馈
    if (tool.route && SUBPACKAGE_ROUTES[tool.route]) {
      go(path, { title: tool.name, loading: '正在进入' });
      return;
    }
    go(path, { title: tool.name, loading: true });
  },

  /** 长按外链工具卡片：复制链接（便于手动粘贴到微信打开） */
  onToolLongPress(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string; tool?: DecoratedTool };
    const tool = ds.id ? TOOL_BY_ID[ds.id] : ds.tool;
    if (!tool || !tool.shortLink) return;
    copyMiniLink(tool.shortLink, tool.name);
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '工具中心', path: '/pages/tools/tools' };
  }
});

/**
 * 首屏空闲时主动触发分包下载，使后续点击分包工具（游戏 / 星语星球 / 秋招…）几乎瞬时进入。
 *
 * 为什么只在这里预热 3 个分包，而不是把 6 个都写进 app.json 的 preloadRule：
 * preloadRule 会占用「预下载体积预算」——单条规则里的分包合计受 2MB 限制，
 * 超了会直接上传失败（错误码 80058，报 preloadRule [...] source size exceed max limit 2MB）。
 * 工具中心这条静态规则已带上 tools + games + danmaku（约 1.74MB，留出余量），
 * 剩下的 recruit / travel / photowall 改用运行时 wx.preloadSubpackage 预热：
 * 体验几乎一致（首屏渲染完 300ms 后才发起，不抢首屏资源），但不占静态规则预算。
 */
function preloadSubPackages() {
  if (typeof wx.preloadSubpackage !== 'function') return;
  // 静态 preloadRule 只放得下 tools + danmaku（合计 1939KB，逼近 2048KB 上限），
  // 其余分包一律走运行时错峰预热：games（小游戏中心）、toolbox（工具详情/小助手，
  // 2026-10-05 从主包下沉而来）、recruit / travel / photowall / love。
  const names = ['subpackages/games', 'subpackages/toolbox', 'subpackages/recruit', 'subpackages/travel', 'subpackages/photowall', 'subpackages/love'];
  names.forEach((name, i) => {
    // 错峰发起：避免同一瞬间挤满网络，把通道让给首屏与用户主动发起的请求
    setTimeout(() => {
      wx.preloadSubpackage({
        name,
        fail: () => { /* 预下载失败不影响正常使用，点击时仍会按需加载 */ }
      });
    }, i * 350);
  });
}
