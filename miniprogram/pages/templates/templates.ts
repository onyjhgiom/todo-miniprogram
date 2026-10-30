// pages/templates/templates.ts
// 模板库：按分类（工作计划/学习任务/生活管理/出行准备/健康健身）分组展示
// 空库时自动导入系统模板；应用模板批量生成任务（含子任务与相对截止日）
import { callFn, toast, handleError } from '../../utils/cloud';
import { getThemeState, syncNavBar } from '../../utils/theme';
import type { ITemplate, ThemeKey, CloudResult } from '../../types/index';
import { relaunch } from '../../utils/nav';

interface TplGroup {
  category: string;
  items: ITemplate[];
}

// 分类展示顺序（未匹配的归入「更多」）
const CATEGORY_ORDER = ['工作计划', '学习任务', '生活管理', '出行准备', '健康健身', '家庭育儿', '社交活动', '自我成长'];

function groupByCategory(tpls: ITemplate[]): TplGroup[] {
  const map = new Map<string, ITemplate[]>();
  for (const t of tpls) {
    const cat = t.category || '更多';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(t);
  }
  const groups: TplGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = map.get(cat);
    if (items && items.length > 0) {
      groups.push({ category: cat, items });
      map.delete(cat);
    }
  }
  // 未识别分类追加在后面
  for (const [cat, items] of map) {
    if (items.length > 0) groups.push({ category: cat, items });
  }
  return groups;
}

// 防手抖：一次应用进行中时忽略后续点击（模块级变量，避免挂 this 触发 TS 报错）
let applying = false;

Page<{
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  themeName: string;
  fxMode: string;
  fxLevel: number;
  fxSrc: string;
  fxFull: boolean;
  bgStyle: string;
  groups: TplGroup[];
  userTpls: ITemplate[];
  loading: boolean;
}>({
  data: {
    theme: 'light',
    fxMode: 'sunset',
    fxLevel: 8,
    fxSrc: '',
    fxFull: false,
    bgStyle: '',
    themeStyle: '',
    heroGradient: '',
    themeName: '',
    groups: [],
    userTpls: [],
    loading: true
  },
  onLoad() {
    this.applyThemeToPage();
  },
  onShow() {
    // 主题可能在设置页被修改，每次显示都刷新
    this.applyThemeToPage();
    this.loadTemplates();
  },
  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient,
      themeName: state.themeName,
      fxMode: state.fxMode,
      fxLevel: state.fxLevel,
      fxSrc: state.fxSrc,
      fxFull: state.fxFull,
      bgStyle: state.bgStyle
    } as Record<string, unknown>);
    syncNavBar(state);
  },
  async loadTemplates() {
    this.setData({ loading: true });
    try {
      let res = await callFn<{ items?: ITemplate[] }>('templates', { action: 'list' });
      let items = res.items || [];
      // 空库时自动导入系统模板，免去手动点「导入」
      if (items.length === 0) {
        await callFn('templates', { action: 'seed' });
        res = await callFn<{ items?: ITemplate[] }>('templates', { action: 'list' });
        items = res.items || [];
      }
      const systemTpls = items.filter((t) => t.isSystem);
      this.setData({
        groups: groupByCategory(systemTpls),
        userTpls: items.filter((t) => !t.isSystem),
        loading: false
      });
    } catch (err) {
      handleError(err, '加载失败');
      this.setData({ loading: false });
    }
  },
  async onSeed() {
    try {
      toast('导入中…', 'loading');
      await callFn('templates', { action: 'seed' });
      toast('已导入系统模板', 'success');
      this.loadTemplates();
    } catch (err) {
      handleError(err, '导入失败');
    }
  },
  /**
   * 一键应用：点卡片 → 直接生成 → 自动返回首页。
   * 不再弹确认框 / 「去首页」二次确认 —— 用户要的是「点了就看到」。
   * 生成后写入 __tplAppliedAt 标记，首页 onShow 读到它就绕过节流立即增量同步。
   */
  async onApply(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = e.detail.id;
    if (applying) return; // 防手抖连点重复生成
    applying = true;
    try {
      toast('正在生成…', 'loading');
      const r = await callFn<CloudResult & { count?: number }>('templates', { action: 'apply', id });
      const count = r.count || 0;
      if (count <= 0) {
        toast('该模板没有可生成的任务', 'none');
        return;
      }
      wx.setStorageSync('__tplAppliedAt', Date.now());
      toast(`已生成 ${count} 个待办`, 'success');
      // 略作停留让成功提示可见，随即回首页（onShow 会立刻同步出新待办）
      setTimeout(() => {
        wx.navigateBack({ fail: () => relaunch('/pages/index/index') });
      }, 400);
    } catch (err) {
      handleError(err, '应用失败');
    } finally {
      applying = false;
    }
  },
  async onDelete(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    try {
      await callFn('templates', { action: 'delete', id: e.detail.id });
      toast('已删除', 'success');
      this.loadTemplates();
    } catch (err) {
      handleError(err, '删除失败');
    }
  },
  onNew() {
    wx.showModal({
      title: '新建模板',
      editable: true,
      placeholderText: '模板名称（如「项目复盘」）',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await callFn('templates', {
            action: 'save',
            template: {
              name: res.content.trim(),
              icon: '📌',
              category: '我的模板',
              items: [
                { content: '整理会议记录' },
                { content: '列出待办清单', priority: 'medium' },
                { content: '确认下次时间', priority: 'high' }
              ]
            }
          });
          toast('已保存', 'success');
          this.loadTemplates();
        } catch (err) {
          handleError(err, '保存失败');
        }
      }
    });
  }
});
