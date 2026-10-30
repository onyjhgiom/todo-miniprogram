// pages/settings/settings.ts —— 「我的」页面
import { callFn, toast, handleError } from '../../utils/cloud';
import * as todoStore from '../../utils/todo-store';
import { applyTheme, applyCustomTheme, getThemeState, syncNavBar, loadCustomTheme } from '../../utils/theme';
import {
  readHomeSkin,
  applyHomeStyle,
  applyHomeBg,
  homeStyleName,
  homeBgName,
  HOME_STYLE_CHIPS,
  HOME_BG_CHIPS
} from '../../utils/home-skin';
import type { HomeBg, HomeStyle } from '../../utils/home-skin';
import { runExport, saveExportToLocal, copyToClipboard } from '../../utils/export';
import { loadProfile, avatarRes, profileCompleted } from '../../utils/profile-store';
import type { ThemeKey, ICustomTheme } from '../../types/index';
import { go } from '../../utils/nav';
import * as addToDesktop from '../../utils/add-to-desktop';

const FONT_SIZE_KEY = 'my_font_size';
const FONT_STYLE_KEY = 'my_font_style';
const PASSWORD_KEY = 'my_password_enabled';
const SOUND_KEY = 'my_sound_enabled';

/**
 * 客服配置 —— 全项目唯一需要你手写的地方。
 *
 * 在线会话走的是小程序原生客服（wxml 里 `<button open-type="contact">`）：
 * 在小程序后台「功能 → 客服」里添加客服人员（绑定微信号）即生效，代码不用再动。
 * 个人主体也能用，不要求企业资质。
 *
 *  · hours：设置页该行右侧展示的服务时间，纯文案，改这里就行
 *  · email：客服邮箱。留空 →「客服邮箱」整行不渲染、兜底弹窗只给一句提示；
 *           填上 → 设置页多出一行可一键复制的邮箱，且会话进不去时兜底弹窗也能复制
 *
 * 注：不要再用 wx.openCustomerServiceChat —— 那是「微信客服」，需要企业主体
 * 且要填 corpId + 客服链接，本项目没配，调用必然失败。
 */
const SUPPORT = {
  hours: '每天 9:00–21:00',
  // 客服邮箱：留空则会话进不去时只给一句提示；填上后兜底弹窗可一键复制
  email: '1039725858@qq.com'
};

interface SettingsData {
  theme: ThemeKey;
  themeStyle: string;
  themeName: string;
  heroGradient: string;
  fxMode: string;
  fxLevel: number;
  fxSrc: string;
  fxFull: boolean;
  bgStyle: string;
  custom: ICustomTheme;
  stats: { total: number; active: number; done: number; archived: number };
  // 主页风格（工艺）与背景氛围：与主题正交，可自由组合
  homeStyle: HomeStyle;
  homeStyleLabel: string;
  homeStyleChips: { key: HomeStyle; name: string; dot: string }[];
  homeBg: HomeBg;
  homeBgLabel: string;
  homeBgChips: { key: HomeBg; name: string; dot: string }[];
  // 个人资料
  profileName: string;
  profileJob: string;
  profileLocation: string;
  avatarKind: 'preset' | 'file' | 'empty';
  avatarEmoji: string;
  avatarPath: string;
  profileReady: boolean;
  // 弹层
  showThemePanel: boolean;
  showFontPanel: boolean;
  showGeneralPanel: boolean;
  showFeedbackPanel: boolean;
  showTipsPanel: boolean;
  tipsList: { icon: string; title: string; desc: string }[];
  // 字体
  fontSize: string;
  fontSizeLabel: string;
  fontSizeOptions: { key: string; label: string }[];
  fontStyle: string;
  fontStyleLabel: string;
  fontStyleOptions: { key: string; label: string; css: string }[];
  fontFamilyCss: string;
  feedbackText: string;
  passwordEnabled: boolean;
  soundEnabled: boolean;
  /** 客服行右侧的服务时间文案（来自 SUPPORT.hours） */
  supportHours: string;
  /** 客服邮箱（来自 SUPPORT.email）；为空时不渲染「客服邮箱」行 */
  supportEmail: string;
  /** 「添加到桌面」引导弹层可见性 */
  showDesktopPanel: boolean;
  /** 入口右侧状态小字：安卓「可添加 / 已添加 / 已从桌面打开 N 次」，iOS「iOS 暂不支持」 */
  desktopStatusLabel: string;
  /** 入口副标题（按平台换文案） */
  desktopSubLabel: string;
  /** 当前平台能否添加到桌面（仅安卓 true） */
  desktopAddable: boolean;
  /** 是否 iOS（弹层文案分流用） */
  desktopIsIos: boolean;
  /** 弹层步骤：安卓=添加步骤，iOS=等效替代路径 */
  desktopSteps: { icon: string; title: string; desc: string }[];
  /** 从桌面图标进入（scene 1023）的累计次数 */
  desktopOpenCount: number;
}

const FONT_SIZE_MAP: Record<string, string> = {
  small: '小号',
  medium: '标准',
  large: '大号',
  xlarge: '超大'
};

const FONT_STYLE_MAP: Record<string, string> = {
  default: '系统默认',
  song: '宋体',
  hei: '黑体',
  kai: '楷体',
  yahei: '微软雅黑'
};

// 字体样式选项：css 为 font-family 完整值，用于实时预览与整页应用。
// 优先使用 iOS 自带中文字体族，并给出 Windows/Android 常用 fallback。
const FONT_STYLE_OPTIONS = [
  { key: 'default', label: '系统默认', css: '-apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif' },
  { key: 'song', label: '宋体', css: '"Songti SC", "SimSun", "宋体", serif' },
  { key: 'hei', label: '黑体', css: '"Heiti SC", "SimHei", "黑体", sans-serif' },
  { key: 'kai', label: '楷体', css: '"Kaiti SC", "KaiTi", "楷体", serif' },
  { key: 'yahei', label: '微软雅黑', css: '"Microsoft YaHei", "微软雅黑", sans-serif' }
];

const styleToCss = (key: string): string => {
  const found = FONT_STYLE_OPTIONS.find((o) => o.key === key);
  return found ? found.css : '';
};

Page<SettingsData>({
  data: {
    theme: 'light',
    fxMode: 'sunset',
    fxLevel: 8,
    fxSrc: '',
    fxFull: false,
    bgStyle: '',
    themeStyle: '',
    themeName: '',
    heroGradient: '',
    custom: { primary: '#B5714C', bg: null, dark: false },
    stats: { total: 0, active: 0, done: 0, archived: 0 },
    homeStyle: 'jicha',
    homeStyleLabel: '侘寂纸感',
    homeStyleChips: HOME_STYLE_CHIPS,
    homeBg: 'warm',
    homeBgLabel: '暖晖流云',
    homeBgChips: HOME_BG_CHIPS,
    profileName: '',
    profileJob: '',
    profileLocation: '',
    avatarKind: 'preset',
    avatarEmoji: '🙋',
    avatarPath: '',
    profileReady: false,
    showThemePanel: false,
    showFontPanel: false,
    showGeneralPanel: false,
    showFeedbackPanel: false,
    showTipsPanel: false,
    // 「添加到桌面」：Android 支持（走微信菜单手动添加），iOS 官方不支持 → 换等效替代路径
    showDesktopPanel: false,
    desktopStatusLabel: '',
    desktopSubLabel: '',
    desktopAddable: false,
    desktopIsIos: false,
    desktopSteps: [] as { icon: string; title: string; desc: string }[],
    desktopOpenCount: 0,
    tipsList: [] as { icon: string; title: string; desc: string }[],
    fontSize: 'medium',
    fontSizeLabel: '标准',
    fontSizeOptions: [
      { key: 'small', label: '小号' },
      { key: 'medium', label: '标准' },
      { key: 'large', label: '大号' },
      { key: 'xlarge', label: '超大' }
    ],
    fontStyle: 'default',
    fontStyleLabel: '系统默认',
    fontStyleOptions: FONT_STYLE_OPTIONS,
    fontFamilyCss: FONT_STYLE_OPTIONS[0].css,
    feedbackText: '',
    passwordEnabled: false,
    soundEnabled: true,
    supportHours: SUPPORT.hours,
    supportEmail: SUPPORT.email
  },

  onLoad() {
    this.applyThemeToPage();
    this.loadPreferences();
    this.loadHomeSkin();
  },
  onShow() {
    this.applyThemeToPage();
    this.loadHomeSkin();
    this.refreshStats();
    this.refreshProfile();
    this.refreshDesktopEntry();
  },

  /**
   * 刷新「添加到桌面」入口状态。
   * 注意：微信不提供「是否已添加」的监听能力，这里显示的「已从桌面打开 N 次」
   * 来自 scene === 1023 埋点，是唯一能反映真实添加结果的信号。
   */
  refreshDesktopEntry() {
    const addable = addToDesktop.canAddToDesktop();
    this.setData({
      desktopStatusLabel: addToDesktop.statusLabel(),
      desktopSubLabel: addable ? '像 App 一样，一键直达' : '用「我的小程序」等效直达',
      desktopOpenCount: addToDesktop.getDesktopOpenCount()
    });
  },

  /** 读取主页「风格 + 背景」当前值（同一份 storage，主页侧 onShow 会自行同步） */
  loadHomeSkin() {
    const skin = readHomeSkin();
    this.setData({
      homeStyle: skin.style,
      homeStyleLabel: homeStyleName(skin.style),
      homeBg: skin.bg,
      homeBgLabel: homeBgName(skin.bg)
    });
  },

  /** 刷新任务统计（总任务/进行中/已完成/已归档） */
  refreshStats() {
    const st = todoStore.stats();
    const archived = todoStore.list().filter((t) => t.archived).length;
    this.setData({
      stats: {
        total: st.totalCount,
        active: st.activeCount,
        done: st.doneCount,
        archived
      }
    });
  },

  refreshProfile() {
    const p = loadProfile();
    const av = avatarRes(p.avatar);
    this.setData({
      profileName: p.name || '',
      profileJob: p.job || '',
      profileLocation: p.location || '',
      avatarKind: av.kind,
      avatarEmoji: av.emoji || '🙂',
      avatarPath: av.path || '',
      profileReady: profileCompleted(p)
    });
  },

  loadPreferences() {
    const fontSize = (wx.getStorageSync(FONT_SIZE_KEY) as string) || 'medium';
    const fontStyle = (wx.getStorageSync(FONT_STYLE_KEY) as string) || 'default';
    const passwordEnabled = !!wx.getStorageSync(PASSWORD_KEY);
    const soundEnabled = wx.getStorageSync(SOUND_KEY);
    this.setData({
      fontSize,
      fontSizeLabel: FONT_SIZE_MAP[fontSize] || '标准',
      fontStyle,
      fontStyleLabel: FONT_STYLE_MAP[fontStyle] || '系统默认',
      fontFamilyCss: styleToCss(fontStyle),
      passwordEnabled,
      soundEnabled: soundEnabled === '' ? true : !!soundEnabled
    });
  },

  onOpenProfile() {
    go('/pages/profile/profile');
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      themeName: state.themeName,
      heroGradient: state.heroGradient,
      fxMode: state.fxMode,
      fxLevel: state.fxLevel,
      fxSrc: state.fxSrc,
      fxFull: state.fxFull,
      bgStyle: state.bgStyle,
      custom: loadCustomTheme()
    });
    syncNavBar(state);
  },

  // ========== 模板调整（主题开关） ==========
  onToggleThemePanel() {
    this.setData({ showThemePanel: true });
  },
  onCloseThemePanel() {
    this.setData({ showThemePanel: false });
  },

  /**
   * 切换预设主题。
   * 直接应用主题、不做任何过渡动效：
   *   - 不调用 wx.vibrateShort，点击不再触发设备震动
   *   - 不渲染全屏色彩浸染层 / 触点涟漪，页面不会整屏变色闪烁
   * 页面自身的配色通过 CSS 变量瞬时切换，观感上只有颜色变化，没有遮罩层。
   */
  onThemeChange(e: WechatMiniprogram.CustomEvent<{ key: ThemeKey }>) {
    const { key } = e.detail;
    if (key === this.data.theme) return;

    const state = applyTheme(key);
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      themeName: state.themeName,
      heroGradient: state.heroGradient,
      custom: loadCustomTheme()
    });
    syncNavBar(state);
    toast(`已进入「${state.themeName}」`, 'success');
  },

  /**
   * 自定义主题颜色实时变化。
   * 原先在选色板时会误触发 onThemeChange（key 恒为 'custom'），
   * 导致每拖一次颜色就震动一次 + 全屏浸染一次。现已彻底解耦，此处只做即时换色。
   */
  onCustomChange(e: WechatMiniprogram.CustomEvent<ICustomTheme>) {
    const next = e.detail as unknown as ICustomTheme;
    const state = applyCustomTheme(next);
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      themeName: state.themeName,
      heroGradient: state.heroGradient,
      custom: next
    });
  },

  // ========== 主页风格 / 背景（与主题正交的两个维度） ==========
  /**
   * 主页风格（工艺）：圆角 / 描边 / 阴影形状 / 玻璃质感。
   * 只改外观不动数据，落 storage 后由主页 onShow 读取生效，无需跨页通信。
   */
  onHomeStyleSelect(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.key as string) || '';
    if (key === this.data.homeStyle) return;
    const next = applyHomeStyle(key);
    this.setData({ homeStyle: next, homeStyleLabel: homeStyleName(next) });
    toast(`主页风格：${homeStyleName(next)}`);
  },

  /** 主页背景（氛围装饰层）：与风格独立，可任意组合 */
  onHomeBgSelect(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.key as string) || '';
    if (key === this.data.homeBg) return;
    const next = applyHomeBg(key);
    this.setData({ homeBg: next, homeBgLabel: homeBgName(next) });
    toast(`主页背景：${homeBgName(next)}`);
  },

  // ========== 字体大小 ==========
  onOpenFontPanel() {
    this.setData({ showFontPanel: true });
  },
  onCloseFontPanel() {
    this.setData({ showFontPanel: false });
  },
  onFontSizeSelect(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.key as string) || 'medium';
    wx.setStorageSync(FONT_SIZE_KEY, key);
    this.setData({ fontSize: key, fontSizeLabel: FONT_SIZE_MAP[key] || '标准' });
    toast('字体大小已切换');
  },
  onFontStyleSelect(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.key as string) || 'default';
    wx.setStorageSync(FONT_STYLE_KEY, key);
    this.setData({
      fontStyle: key,
      fontStyleLabel: FONT_STYLE_MAP[key] || '系统默认',
      fontFamilyCss: styleToCss(key)
    });
    toast('字体样式已切换');
  },

  // ========== 通用设置 ==========
  onOpenGeneralPanel() {
    this.setData({ showGeneralPanel: true });
  },
  onCloseGeneralPanel() {
    this.setData({ showGeneralPanel: false });
  },
  onToggleSound() {
    this.setData({ soundEnabled: !this.data.soundEnabled });
    wx.setStorageSync(SOUND_KEY, this.data.soundEnabled);
    toast(this.data.soundEnabled ? '完成音效已开启' : '完成音效已关闭');
  },
  onSoundSwitch(e: WechatMiniprogram.SwitchChangeEvent) {
    const checked = !!e.detail.value;
    wx.setStorageSync(SOUND_KEY, checked);
    this.setData({ soundEnabled: checked });
    toast(checked ? '完成音效已开启' : '完成音效已关闭');
  },
  onClearDone() {
    wx.showModal({
      title: '清空已完成任务',
      content: '确定要清空所有已完成的任务吗？此操作不会删除进行中的任务。',
      confirmColor: '#b5714c',
      success: (res) => {
        if (!res.confirm) return;
        try {
          todoStore.clearCompleted();
          this.refreshStats();
          toast('已完成任务已清空');
        } catch (err) {
          toast('清空失败，请重试');
        }
      }
    });
  },

  // ========== 统计报表 ==========
  onScrollToStats() {
    wx.createSelectorQuery()
      .select('#stats-section')
      .boundingClientRect((rect) => {
        if (!rect) return;
        wx.pageScrollTo({ scrollTop: rect.top + 120, duration: 300 });
      })
      .exec();
  },

  // ========== 密码保护 ==========
  onPassword() {
    wx.showModal({
      title: '密码保护',
      content: '密码保护功能开发中，开启后可为小程序加锁。',
      showCancel: false
    });
  },
  onPasswordSwitch(e: WechatMiniprogram.SwitchChangeEvent) {
    const checked = !!e.detail.value;
    wx.setStorageSync(PASSWORD_KEY, checked);
    this.setData({ passwordEnabled: checked });
    toast(checked ? '密码保护已开启' : '密码保护已关闭');
  },

  // ========== 使用技巧 ==========
  onTips() {
    const tips: { icon: string; title: string; desc: string }[] = [
      { icon: '➕', title: '新建任务', desc: '点击底部「+」进入编辑，填写标题、备注、截止时间（精确到分钟），并可为任务添加附件与子任务，让计划更完整。' },
      { icon: '🗂️', title: '多视图切换', desc: '首页支持列表、看板、时间轴等多种视图，按「全部 / 今天 / 已完成」等维度筛选，快速找到当前要做的任务。' },
      { icon: '☑️', title: '子任务', desc: '为大任务拆分子步骤，逐项勾选完成；子任务全部完成，主任务即自动标记为已完成。' },
      { icon: '🏷️', title: '标签与优先级', desc: '给任务打标签、设优先级（高/中/低），首页按颜色与排序一眼区分轻重缓急。' },
      { icon: '🔔', title: '每日提醒', desc: '在「通用设置」中开启每日提醒并设定提醒时间，到点自动推送，帮你按时处理待办。' },
      { icon: '🎨', title: '模板调换（主题外观）', desc: '「我的 - 模板调换」内置多套配色与自定义颜色，一键换肤，全局沉浸生效。' },
      { icon: '🖼️', title: '主页风格与背景', desc: '同一个弹层里还能单独挑「主页风格」（侘寂纸感 / 冰肌玻璃 / 水墨宣纸 / 硬边几何 / 柔光拟物 / 复古套印）与「主页背景」（暖晖流云 / 纯净底色 / 极光流彩 / 星尘夜空 / 月光栅格 / 浮点粒子）。风格管工艺、背景管氛围，与主题配色三方独立，可任意组合。' },
      { icon: '🔠', title: '字体调整', desc: '「我的 - 字体调整」可改字号（小号/标准/大号/超大）与字体样式（宋体/黑体/楷体等），整页即时应用。' },
      { icon: '🔒', title: '密码保护', desc: '开启后进入小程序需验证密码，保护你的私人待办内容不被他人查看。' },
      { icon: '📊', title: '任务统计', desc: '「我的」页实时展示总任务、进行中、已完成、已归档数量，直观掌握完成情况。' },
      { icon: '🗄️', title: '数据管理', desc: '可导出 JSON / CSV 备份，或查看已归档任务；完成音效、清空已完成也在「通用设置」中管理。' },
      { icon: '🤝', title: '分享与反馈', desc: '「分享好友」把小程序发给微信好友；「优化建议」可提交想法；「联系客服」进入在线客服会话（' + SUPPORT.hours + '），「客服邮箱」点一下即可复制邮箱地址。' }
    ];
    this.setData({ tipsList: tips, showTipsPanel: true });
  },

  onCloseTipsPanel() {
    this.setData({ showTipsPanel: false });
  },

  // ========== 分享好友 ==========
  onShare() {
    // 由 button open-type="share" 自动触发 onShareAppMessage
  },
  onShareAppMessage() {
    // 不指定 imageUrl：让其自动取当前页截图。
    // 原先指向的 /assets/share-cover.png 并不存在于工程里，属失效引用，
    // 会让分享卡图变成空白，反而比默认截图更差。
    return {
      title: '来试试这款好用的待办清单小程序',
      path: '/pages/index/index'
    };
  },

  // ========== 优化建议 ==========
  onFeedback() {
    this.setData({ showFeedbackPanel: true, feedbackText: '' });
  },
  onCloseFeedbackPanel() {
    this.setData({ showFeedbackPanel: false });
  },
  onFeedbackInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ feedbackText: e.detail.value });
  },
  onFeedbackSubmit() {
    const text = this.data.feedbackText.trim();
    if (!text) {
      toast('请先输入建议内容');
      return;
    }
    // 优先尝试提交到云函数
    callFn('submitFeedback', { content: text })
      .then(() => toast('建议已提交，感谢反馈'))
      .catch(() => {
        // 云函数不存在时仅本地提示
        toast('建议已收到，感谢反馈');
      });
    this.setData({ showFeedbackPanel: false, feedbackText: '' });
  },

  // ========== 联系客服 ==========
  /**
   * 点击行内的透明 button（open-type="contact"）直接进小程序原生客服会话，
   * 这里只在「明确进不去」（后台未添加客服人员 / 基础库不支持）时兜底，
   * 正常打开会话时不做任何打扰。
   */
  onContactCallback(e: WechatMiniprogram.CustomEvent) {
    const detail = ((e && (e as any).detail) || {}) as { errMsg?: string };
    const errMsg = String(detail.errMsg || '');
    // errMsg 为空或形如 'enterContact:ok' 视为正常
    if (!errMsg || /:ok$/.test(errMsg)) return;
    this.showSupportFallback();
  },

  /** 点「客服邮箱」行 —— 直接把邮箱复制到剪贴板 */
  onCopySupportEmail() {
    this.copySupportEmail();
  },

  /** 复制客服邮箱（设置页行、兜底弹窗共用） */
  copySupportEmail() {
    if (!SUPPORT.email) return;
    wx.setClipboardData({
      data: SUPPORT.email,
      success: () => toast('邮箱已复制')
    });
  },

  /**
   * 兜底出口：填了 SUPPORT.email 就给「复制邮箱」，没填就只说明情况。
   * 目的只有一个 —— 用户点了按钮之后，不能出现「什么都没发生」。
   */
  showSupportFallback() {
    if (!SUPPORT.email) {
      wx.showModal({
        title: '联系客服',
        content: `在线客服暂时连不上，请稍后再试。\n服务时间 ${SUPPORT.hours}`,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    wx.showModal({
      title: '联系客服',
      content: `在线客服暂时连不上，也可以发邮件找我们：\n${SUPPORT.email}\n服务时间 ${SUPPORT.hours}`,
      confirmText: '复制邮箱',
      cancelText: '知道了',
      success: (r) => {
        if (!r.confirm) return;
        this.copySupportEmail();
      }
    });
  },

  // ========== 数据管理 ==========
  /**
   * 导出备份：直接读本地数据生成，不依赖云端（见 utils/export.ts）。
   * 本地同步生成是瞬时的，无需 loading；写文件 + 复制到剪贴板双通道，
   * 确保清缓存前一定能把数据拿出来（即使写文件失败，复制通道仍可用）。
   */
  async onExportJson() {
    try {
      const res = await runExport('json');
      this.afterExport(res);
    } catch (err) {
      handleError(err, '导出失败');
    }
  },
  async onExportCsv() {
    try {
      const res = await runExport('csv');
      this.afterExport(res);
    } catch (err) {
      handleError(err, '导出失败');
    }
  },

  /** 导出结果处理：尝试写文件，并提示用户可复制到剪贴板 */
  afterExport(res: { filename: string; content: string; total: number; subtasks?: number }) {
    // 写文件失败不致命（隐私目录用户未必能直接取回），复制通道照样可用
    try {
      saveExportToLocal(res.filename, res.content).catch(() => null);
    } catch (_e) {
      /* 忽略 */
    }
    const sub = res.subtasks ? `、${res.subtasks} 条子任务` : '';
    wx.showModal({
      title: '备份已生成',
      content: `共 ${res.total} 条任务${sub}。\n\n建议点「复制内容」，粘贴到微信文件传输助手 / 备忘录 / 电脑留存；也可转发备份文件给自己。`,
      confirmText: '复制内容',
      cancelText: '完成',
      success: (r) => {
        if (r.confirm) copyToClipboard(res.content);
      }
    });
  },

  onOpenArchived() {
    wx.showModal({
      title: '查看归档',
      content: '切换到首页并选择「已归档」筛选标签即可查看',
      showCancel: false
    });
  },

  /* ==================== 添加到桌面 ==================== */

  /**
   * 打开「添加到桌面」引导。
   * 平台分流：Android 走三步手动引导 + 机型授权兜底；iOS 如实说明不支持并给等效替代。
   */
  onOpenDesktopPanel() {
    const addable = addToDesktop.canAddToDesktop();
    const platform = addToDesktop.getPlatform();
    this.setData({
      showDesktopPanel: true,
      desktopAddable: addable,
      desktopIsIos: platform === 'ios',
      desktopSteps: addable ? addToDesktop.androidSteps() : addToDesktop.iosAlternatives(),
      desktopOpenCount: addToDesktop.getDesktopOpenCount()
    });
    addToDesktop.markGuideShown();
  },

  onCloseDesktopPanel() {
    this.setData({ showDesktopPanel: false });
  },

  /** 用户自述已添加。微信不给「添加成功」的回调，所以只说「去桌面看看」，不做成功承诺 */
  onDesktopConfirmed() {
    addToDesktop.markConfirmed();
    this.setData({ showDesktopPanel: false });
    this.refreshDesktopEntry();
    wx.showToast({ title: '已在桌面找找看吧', icon: 'none' });
  },

  /** 菜单里没有「添加到桌面」→ 展示常见机型的微信授权路径 */
  onDesktopHelp() {
    wx.showModal({
      title: '菜单里没有这一项？',
      content: '基本都是手机没给微信「创建桌面快捷方式」权限。\n\n' + addToDesktop.ANDROID_PERMISSION_TIPS.join('\n'),
      showCancel: false,
      confirmText: '知道了'
    });
  },

  // 阻止弹层点击冒泡
  onSheetStop() { /* noop */ }
});
