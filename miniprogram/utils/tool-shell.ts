// utils/tool-shell.ts
// 工具页通用外壳：页面风格(PAGE_STYLE)与背景风格(BG_STYLE)的可选预设 + 持久化。
//
// 设计约定（与本项目其他工具保持一致，仅调外观不动逻辑）：
//  - PAGE_STYLE：决定整页布局配色/质感倾向（玻璃 / 磨砂 / 浮雕 等），叠加在全局主题之上；
//  - BG_STYLE：决定页面根背景（渐变氛围），可为每页独立配置；
//  - 两项选择均写入 wx.storage（独立 key，互不干扰），onShow 读回实现跨页记忆。
//
// 新增工具页用法：
//   import { loadShell, saveShell } from '../../utils/tool-shell';
//   data.shell = { pageStyle, bgStyle, pagePresets, bgPresets }
//   loadShell('grp')   -> 读持久化 (key = 'todo_app_tsh_grp')
//   saveShell('grp', page, bg)
import { get, set } from './storage';
export type PageStyleKey = 'glass' | 'frost' | 'relief';
export type BgStyleKey = 'none' | 'aurora' | 'mesh' | 'halo' | 'lattice' | 'dots';

export interface PageStyleDef {
  key: PageStyleKey;
  /** 名称 */
  name: string;
  /** 一句提示 */
  hint: string;
  /** 调色圆点（供选择条展示） */
  dot: string;
}

export interface BgStyleDef {
  key: BgStyleKey;
  name: string;
  hint: string;
  dot: string;
}

/** 页面质感预设：玻璃 / 磨砂 / 浮雕 */
export const PAGE_STYLE_PRESETS: PageStyleDef[] = [
  { key: 'glass', name: '立体玻璃', hint: '通透高光·圆润', dot: '#38bdf8' },
  { key: 'frost', name: '柔雾磨砂', hint: '低饱和·柔光', dot: '#a78bfa' },
  { key: 'relief', name: '丝绒浮雕', hint: '压印·层次', dot: '#f472b6' }
];

/** 背景氛围预设（叠加在全局主题底色之上的装饰层） */
export const BG_STYLE_PRESETS: BgStyleDef[] = [
  { key: 'none', name: '纯净底色', hint: '极简无装饰', dot: '#e2e8f0' },
  { key: 'aurora', name: '极光流彩', hint: '蓝紫渐变光', dot: '#6366f1' },
  { key: 'mesh', name: '星尘光斑', hint: '弥散光晕', dot: '#22d3ee' },
  { key: 'halo', name: '暖晖光圈', hint: '暖色柔光', dot: '#fbbf24' },
  { key: 'lattice', name: '月光栅格', hint: '细腻网格', dot: '#64748b' },
  { key: 'dots', name: '浮点粒子', hint: '轻盈圆点', dot: '#c084fc' }
];

export interface ToolShell {
  pageStyle: PageStyleKey;
  bgStyle: BgStyleKey;
}

const DEFAULTS: ToolShell = { pageStyle: 'glass', bgStyle: 'aurora' };

function validPage(v: string): PageStyleKey {
  return PAGE_STYLE_PRESETS.some((p) => p.key === v) ? (v as PageStyleKey) : DEFAULTS.pageStyle;
}
function validBg(v: string): BgStyleKey {
  return BG_STYLE_PRESETS.some((b) => b.key === v) ? (v as BgStyleKey) : DEFAULTS.bgStyle;
}

/** 读取某工具页持久化的风格（prefix 用于区分不同工具页，如 'grp'/'sub'/'hlp'/'imp'/'tpl'） */
export function loadShell(prefix: string): ToolShell {
  const raw = get<Partial<ToolShell> | null>(`tsh_${prefix}`, null);
  if (raw && typeof raw === 'object') {
    return {
      pageStyle: validPage(raw.pageStyle || DEFAULTS.pageStyle),
      bgStyle: validBg(raw.bgStyle || DEFAULTS.bgStyle)
    };
  }
  return { ...DEFAULTS };
}

/** 持久化某工具页风格；返回合并结果 */
export function saveShell(prefix: string, patch: Partial<ToolShell>): ToolShell {
  const cur = loadShell(prefix);
  const next = { ...cur, ...patch };
  set(`tsh_${prefix}`, next);
  return next;
}
