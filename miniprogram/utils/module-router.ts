// utils/module-router.ts
// 功能模块统一路由表：小助手 / 工具中心 / 语音指令 共用的一份「模块 → 落地页」映射。
//
// 设计动机：
//   - 小程序内功能模块众多（首页待办 / 日历 / 看板 / 工具页 / 提醒 / 记录工具…），
//     若每处都硬编码 wx.navigateTo 极易遗漏、重复或冲突；
//   - 本表把「模块语义名」收敛为唯一出口，小助手解析到模块后调用 jumpToModule(id) 即可，
//     从而实现对全部功能模块的统一调度与跨功能联动（文字/语音共用此出口）。
//
// 每个模块可配：
//   kind: 'page'（直接落地页） | 'tool'（工具详情 widget，经 subpackages/toolbox 下的 tool 页）
//   path: kind==='page' 时的完整落地路径；kind==='tool' 时为 widget type
//   key: 模块名（含 icon，用于快捷动作标签）
//   kws: 可命中该模块的自然语言别名/关键词（供 helper-engine 意图匹配）
//   desc: 一句话说明（供“有哪些功能 / 帮我看看”等概览回复）
import { go, relaunch } from './nav';
import { openMiniLink } from './mini-link';

export type ModuleKind = 'page' | 'tool' | 'external';

export interface ModuleDef {
  id: string;
  key: string;
  kind: ModuleKind;
  path: string;
  kws: string[];
  desc: string;
  /** 顶级分类（概览/分组展示用） */
  group: string;
  /** kind==='external' 专用：跳转到其他小程序的 shortLink（主链接 + 备选） */
  links?: string[];
}

/** 归组展示顺序 */
export const MODULE_GROUPS: { key: string; label: string }[] = [
  { key: 'core', label: '核心待办' },
  { key: 'plan', label: '日程计划' },
  { key: 'remind', label: '提醒协作' },
  { key: 'track', label: '记录管理' },
  { key: 'focus', label: '专注成长' }
];

export const MODULES: ModuleDef[] = [
  // ---- 核心待办 core ----
  { id: 'home', kind: 'page', path: '/pages/index/index', key: '🏠 首页待办', group: 'core',
    kws: ['首页', '回首页', '待办列表', '我的待办', '全部待办', '任务列表'], desc: '查看与管理全部待办任务' },
  { id: 'todo-panel', kind: 'page', path: '/pages/todo-panel/todo-panel', key: '✅ 待办四维', group: 'core',
    kws: ['待办四维', '日待办', '月待办', '年待办', '四维', '按时间待办'], desc: '按 日/月/年/全部 分类查看待办' },
  { id: 'detail-new', kind: 'page', path: '', key: '➕ 新建待办', group: 'core',
    kws: ['新建待办', '添加任务', '记个任务'], desc: '在首页快速新建一条待办' },
  { id: 'templates', kind: 'page', path: '/pages/templates/templates', key: '✨ 任务模板', group: 'core',
    kws: ['模板', '任务模板', '模板库'], desc: '使用预设任务模板一键生成待办' },

  // ---- 日程计划 plan ----
  { id: 'calendar', kind: 'page', path: '/pages/calendar/calendar', key: '📅 日历', group: 'plan',
    kws: ['日历', '日程', '本月日程'], desc: '按日历查看各日期的任务分布' },
  { id: 'kanban', kind: 'page', path: '/pages/kanban/kanban', key: '🗂️ 看板', group: 'plan',
    kws: ['看板', '看板视图', '泳道'], desc: '用看板方式管理进行中的任务' },
  { id: 'countdown', kind: 'tool', path: 'countdown', key: '⏳ 倒数日', group: 'plan',
    kws: ['倒数日', '倒计时', '还有几天'], desc: '计算距离某个日子的剩余天数' },
  { id: 'travel', kind: 'page', path: '/subpackages/travel/pages/index/index', key: '🧳 旅行清单', group: 'plan',
    kws: ['旅行', '旅行清单', '出行', '行程', '行李', '打包', '出游', '旅游', '度假', '我的行程'], desc: '行程安排、行李清单与预算复盘，模板一键生成' },
  { id: 'goal-breakdown', kind: 'page', path: '/pages/goal-breakdown/goal-breakdown', key: '🎯 目标拆解', group: 'plan',
    kws: ['目标拆解', '拆解目标', '分解目标', '目标分解', '拆解一下', '拆成任务', '拆任务', '怎么完成目标'], desc: '把一个目标拆成可立刻执行的子任务序列' },
  { id: 'holiday', kind: 'tool', path: 'favorites', key: '🎈 节假日', group: 'plan',
    kws: ['节假日', '放假', '法定假日', '假期'], desc: '查看距节假日还有多少天' },
  { id: 'course-schedule', kind: 'page', path: '/course-schedule/pages/schedule/index', key: '📚 课程表', group: 'plan',
    kws: ['课程表', '课表', '上课表', '周课表', '我的课表', '导入课表', '课程安排'], desc: '导入课表、周次视图，支持自然语言改课' },

  // ---- 提醒协作 remind ----
  { id: 'group-reminder', kind: 'page', path: '/pages/group-reminder/group-reminder', key: '👥 多人提醒', group: 'remind',
    kws: ['多人提醒', '组提醒', '提醒大家', '团队提醒', '共享提醒'], desc: '创建提醒并勾选多位参与者，到点一起通知' },
  { id: 'subscribe-reminder', kind: 'page', path: '/pages/subscribe-reminder/subscribe-reminder', key: '📮 订阅提醒', group: 'remind',
    kws: ['订阅提醒', '定时提醒', '习惯提醒', '打卡提醒', '周期提醒'], desc: '设定时刻与星期，养成定期提醒习惯' },
  { id: 'important-day', kind: 'page', path: '/subpackages/toolbox/pages/important-day/important-day', key: '💖 重要日', group: 'remind',
    kws: ['重要日', '纪念日', '生日', '到期日'], desc: '管理生日、纪念日、到期日，含即将到来与已过期' },

  // ---- 记录管理 track ----
  { id: 'note', kind: 'page', path: '/pages/note/note', key: '📌 便签', group: 'track',
    kws: ['便签', '笔记', '随手记', 'sticky'], desc: '随手一贴的便签' },
  { id: 'memo', kind: 'page', path: '/pages/memo/memo', key: '🎙️ 备忘录', group: 'track',
    kws: ['备忘录', '速记', '语音速记', '清单'], desc: '语音速记、清单、文件夹' },
  { id: 'ledger', kind: 'page', path: '/pages/ledger/ledger', key: '💰 记账本', group: 'track',
    kws: ['记账', '账本', '记一笔', '支出', '收入'], desc: '收支、预算、报表一站记' },
  { id: 'photo-wall', kind: 'page', path: '/subpackages/photowall/pages/index/index', key: '💞 照片墙', group: 'track',
    kws: ['照片墙', '心形照片墙', '照片拼图', '拼图', '心形拼图', '照片拼心', '爱心照片墙', 'photowall'], desc: '把多张照片拼成心形、文字或节日形状并导出分享' },
  { id: 'danmaku', kind: 'page', path: '/subpackages/danmaku/pages/editor/editor', key: '🎉 弹幕特效', group: 'track',
    kws: ['弹幕', '弹幕墙', '弹幕特效', '祝福弹幕', '生日弹幕', '聚会弹幕', '表白弹幕', '滚动弹幕', '动态弹幕'], desc: '生成滚动/弹出/闪烁/随机弹幕，特效、粒子与节日皮肤一键复用' },
  { id: 'wheel', kind: 'page', path: '/subpackages/tools/pages/wheel/index', key: '🎡 万能转盘', group: 'focus',
    kws: ['万能转盘', '转盘', '抽奖转盘', '决策转盘', '今天吃什么', '去哪玩', '谁来做', '随机选一个', '帮我选', '转一下', '抽签', '抽奖'], desc: '自定义选项转盘，随机做决定，结果可一键转待办' },
  { id: 'wish', kind: 'page', path: '/pages/wish/wish', key: '✨ 愿望清单', group: 'track',
    kws: ['愿望', '心愿', '愿望清单', '心愿单'], desc: '自定义心愿与进度追踪' },

  // ---- 专注成长 focus ----
  { id: 'pomodoro', kind: 'page', path: '/subpackages/pomodoro/pages/index/index', key: '🍅 番茄时钟', group: 'focus',
    kws: ['番茄', '专注', '番茄钟', 'pomodoro'], desc: '25 分钟专注计时' },
  { id: 'life', kind: 'tool', path: 'life', key: '🧬 人生进度', group: 'focus',
    kws: ['人生进度', '人生余额'], desc: '看你的人生余额' },
  { id: 'lifegrid', kind: 'tool', path: 'lifegrid', key: '▦ 人生格子', group: 'focus',
    kws: ['人生格子', '900格', '格子'], desc: '人生只有 900 格' },
  { id: 'time-progress', kind: 'tool', path: 'time', key: '⌛ 时间进度', group: 'focus',
    kws: ['时间进度', '今年进度', '今天进度'], desc: '感受时间流逝' },
  { id: 'flipclock', kind: 'tool', path: 'flipclock', key: '🕒 翻页时钟', group: 'focus',
    kws: ['翻页时钟', '时钟', '3d时钟'], desc: '3D 立体翻页时钟' },
  { id: 'fun-games', kind: 'page', path: '/subpackages/games/pages/center/center', key: '🎮 闲趣游戏', group: 'focus',
    kws: ['闲趣游戏', '小游戏', '玩游戏', '游戏中心', '单机游戏', '打游戏', '游戏'], desc: '18 款单机小游戏，休闲解压' },

  // ---- 系统/其他 ----
  { id: 'tools', kind: 'page', path: '/pages/tools/tools', key: '🧰 工具中心', group: 'core',
    kws: ['工具中心', '全部工具', '工具', '工具有什么'], desc: '工具中心，汇聚全部功能' },
  { id: 'settings', kind: 'page', path: '/pages/settings/settings', key: '⚙️ 设置', group: 'core',
    kws: ['设置', '设置页', '偏好'], desc: '主题、数据、个人资料等设置' },
  { id: 'astro-hub', kind: 'page', path: '/subpackages/tools/pages/astro/index', key: '🔮 星语星球', group: 'track',
    kws: ['星语星球', '星座运势', '塔罗', '占卜', '星象', '运势', '雷诺曼', '冥想', '星愿', '树洞'], desc: '星座·塔罗·冥想·星愿综合页' },
  { id: 'guoxiang', kind: 'page', path: '/subpackages/tools/pages/folklore/index', key: '☯️ 国风卦相', group: 'track',
    kws: ['国风卦相', '卦相', '起卦', '六十四卦', '算卦', '算一卦', '一卦', '占卦', '占一卦', '卜卦', '卦象', '生肖面相', '面相', '易经', '周易'], desc: '六十四卦起卦、人生疏导、生肖面相' },
  { id: 'asset-ledger', kind: 'page', path: '/subpackages/tools/pages/asset-ledger/asset-ledger', key: '📊 资产账本', group: 'track',
    kws: ['资产账本', '资产', '日均成本', '订阅月供', '月供', '资产记录', '物品成本'], desc: '登记资产，算日均成本与订阅月供' },

  // ---- 外部小程序（跳转到其他小程序领红包）----
  { id: 'jd-waimai', kind: 'external', path: '', group: 'track',
    key: '🛍️ 京东外卖红包',
    links: ['#小程序://京东购物丨点外卖领国补/hRS2HMvIzfr656E'],
    kws: ['京东外卖', '京东红包', '京东外卖红包', '京东国补', '京东领红包'], desc: '跳京东外卖领国补红包' },
  { id: 'meituan', kind: 'external', path: '', group: 'track',
    key: '🧧 美团外卖红包',
    links: ['#小程序://美团丨外卖团购特价美食酒店电影/Tn7TvvVDqdYaWTh'],
    kws: ['美团外卖', '美团红包', '美团外卖红包', '美团领红包', '美团团购'], desc: '跳美团外卖领红包' },
  { id: 'eleme', kind: 'external', path: '', group: 'track',
    key: '🛵 饿了么红包',
    links: ['#小程序://淘宝闪购l饿了么外卖美食超市/ne5tMEbu2doSxIb', '#小程序://淘宝闪购丨饿了么外卖美食超市/ne5tMEbu2doSxIb'],
    kws: ['饿了么', '饿了么红包', '淘宝闪购', '饿了么领红包', '饿了么外卖'], desc: '跳饿了么领红包' },
  { id: 'recruit-hub', kind: 'page', path: '/subpackages/recruit/pages/recruit/recruit', key: '💼 秋招助手', group: 'track',
    kws: ['秋招', '秋招助手', '招聘', '投递', '投递记录', '网申', '找工作', '求职'], desc: '秋招投递追踪、Deadline 雷达与面试准备' },
  { id: 'recruit-analysis', kind: 'page', path: '/subpackages/recruit/pages/recruit/analysis', key: '📊 秋招数据看板', group: 'track',
    kws: ['秋招看板', '秋招数据', '投递漏斗', '转化漏斗', '面试准备度', '投递统计'], desc: '投递漏斗、投递节奏与面试准备度分析' },
  { id: 'profile', kind: 'page', path: '/pages/profile/profile', key: '🪪 个人资料', group: 'core',
    kws: ['个人资料', '个人信息', '我的资料', '个人中心', '完善资料', '资料'], desc: '录入与查看我的个人资料' },
  { id: 'little-helper', kind: 'page', path: '/subpackages/toolbox/pages/little-helper/little-helper', key: '👩‍💼 小助手', group: 'core',
    kws: ['小助手', '助手', '召唤助手', 'help'], desc: '对话式命令台，调度全部功能' }
];

const BY_ID = new Map(MODULES.map((m) => [m.id, m]));
/** 关键词(小写) → 命中模块 */
const KW_INDEX: { kw: string; m: ModuleDef }[] = [];
for (const m of MODULES) {
  for (const k of m.kws) KW_INDEX.push({ kw: k.toLowerCase(), m });
}
// 按长度降序，让更长的别名优先匹配（避免「待办」先命中较短别名）
KW_INDEX.sort((a, b) => b.kw.length - a.kw.length);

export function getModule(id: string): ModuleDef | undefined {
  return BY_ID.get(id);
}

/** 依据自然语言文字，匹配最可能的模块（返回 null 表示无法判定） */
export function matchModule(text: string): ModuleDef | null {
  const t = (text || '').trim().toLowerCase();
  if (!t) return null;
  for (const { kw, m } of KW_INDEX) {
    if (t.indexOf(kw) >= 0) return m;
  }
  return null;
}

/** 构造某模块的落地 url（page 或 tool widget）；external 无站内 url，返回 null */
export function moduleUrl(m: ModuleDef): string | null {
  if (m.kind === 'external') return null;
  if (m.kind === 'tool') return `/subpackages/toolbox/pages/tool/tool?type=${m.path}`;
  if (m.path) return m.path;
  return null;
}

/** 落地跳转统一出口：页面内使用（从助手等调用）。返回是否已发起跳转。 */
export function jumpToModule(id: string, navigator: (url: string) => void = navGo): boolean {
  const m = getModule(id);
  if (!m) return false;
  // 外部小程序：调起其他小程序（红包类），失败时 openMiniLink 内部会复制链接兜底
  if (m.kind === 'external') {
    if (!m.links || !m.links.length) return false;
    openMiniLink(m.links, (m.key.split(' ').slice(1).join(' ') || m.key));
    return true;
  }
  const url = moduleUrl(m);
  if (!url) return false;
  // 首页属于“根页”，用 reLaunch 清栈回根，避免从工具/助手一路 push 造成层级过深
  if (m.path === '/pages/index/index') {
    relaunch(url, { force: true, silent: true });
    return true;
  }
  navigator(url);
  return true;
}

/** 依据文字匹配并落地跳转；返回是否跳转成功 */
export function jumpByText(text: string, navigator: (url: string) => void = navGo): boolean {
  const m = matchModule(text);
  if (!m) return false;
  return jumpToModule(m.id, navigator);
}

/** 默认跳转实现：走统一导航层，栈满/失败都有兜底与提示 */
function navGo(url: string): void {
  // 分包页面首次进入要下载分包：挂「延迟遮罩」，快则无感、慢则有进度反馈
  const isSubpackage = url.indexOf('/subpackages/') === 0;
  go(url, isSubpackage ? { loading: '正在进入' } : undefined);
}

/** 概览某分组下所有模块（用于“有哪些 xx”问答） */
export function groupModules(group: string): ModuleDef[] {
  return MODULES.filter((m) => m.group === group);
}
