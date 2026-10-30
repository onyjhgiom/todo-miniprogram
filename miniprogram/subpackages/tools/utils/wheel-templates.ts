// subpackages/tools/utils/wheel-templates.ts
// 万能转盘：色盘 / 图标库 / 内置模板库
//
// 设计原则：
//  1) 色盘固定 12 色，且**数组内相邻两色一定不同** —— 选项按 index % 12 取色，
//     因此 12 个选项以内天然满足「相邻区不同色」，不需要运行时做冲突检测。
//  2) 模板只存「内容」，不存 id/时间 —— 实例化时才生成运行时对象，
//     同一个模板可以被实例化多次（复制同款）而互不干扰。
//  3) 模板选项数控制在 4~8 个：太少转起来没悬念，太多扇区太窄、字挤在一起。

/** 色盘 key */
export type PaletteKey = 'candy' | 'morandi' | 'festive' | 'ocean' | 'custom';

export interface IPalette {
  key: PaletteKey;
  label: string;
  /** 预览用前 5 色 */
  preview: string[];
  colors: string[];
}

/**
 * 四套内置色盘 + custom（选项颜色由用户自己挑，存储时落在 option.color 上）。
 * 每套 12 色，相邻不同色。
 */
export const PALETTES: Record<PaletteKey, IPalette> = {
  candy: {
    key: 'candy',
    label: '糖果色',
    preview: ['#FF6B81', '#FF9F43', '#FFD32A', '#A3E635', '#34D399'],
    colors: [
      '#FF6B81', '#FF9F43', '#FFD32A', '#A3E635', '#34D399', '#22D3EE',
      '#60A5FA', '#A78BFA', '#F472B6', '#FB7185', '#FDBA74', '#4ADE80'
    ]
  },
  morandi: {
    key: 'morandi',
    label: '莫兰迪',
    preview: ['#C7B8A8', '#A8B5A2', '#9FB0C0', '#C9BFC4', '#B7AEA3'],
    colors: [
      '#C7B8A8', '#A8B5A2', '#9FB0C0', '#C9BFC4', '#B7AEA3', '#AAB8C5',
      '#C4C0B0', '#B0A9B8', '#D0C4B8', '#A8C0BC', '#C0AEB4', '#B5BCA8'
    ]
  },
  festive: {
    key: 'festive',
    label: '节日红金',
    preview: ['#C0392B', '#D4AF37', '#8E44AD', '#E8C547', '#A93226'],
    colors: [
      '#C0392B', '#D4AF37', '#8E44AD', '#E8C547', '#A93226', '#B7950B',
      '#6C3483', '#F1C40F', '#922B21', '#D4AC0D', '#76448A', '#F7DC6F'
    ]
  },
  ocean: {
    key: 'ocean',
    label: '海洋蓝',
    preview: ['#0EA5E9', '#2563EB', '#06B6D4', '#3B82F6', '#0D9488'],
    colors: [
      '#0EA5E9', '#2563EB', '#06B6D4', '#3B82F6', '#0D9488', '#14B8A6',
      '#1D4ED8', '#0284C7', '#0F766E', '#2DD4BF', '#38BDF8', '#4338CA'
    ]
  },
  custom: {
    key: 'custom',
    label: '自定义',
    preview: ['#FF6B81', '#FF9F43', '#FFD32A', '#A3E635', '#34D399'],
    colors: [
      '#FF6B81', '#FF9F43', '#FFD32A', '#A3E635', '#34D399', '#22D3EE',
      '#60A5FA', '#A78BFA', '#F472B6', '#FB7185', '#FDBA74', '#4ADE80'
    ]
  }
};

/** 色盘顺序（模板选择页 / 换色弹层用） */
export const PALETTE_ORDER: PaletteKey[] = ['candy', 'morandi', 'festive', 'ocean', 'custom'];

/** 内置快捷图标（20 个），显示在扇区文字外侧 */
export const WHEEL_ICONS: string[] = [
  '🍚', '🍜', '🍔', '🍕', '🍢', '🍲',
  '☕', '🧋', '🍰', '🍎', '🥗', '🍣',
  '🎬', '🎮', '🎧', '🏀', '📚', '✈️',
  '🧹', '🎁'
];

/** 模板选项（纯内容，无 id） */
export interface ITplOption {
  text: string;
  icon?: string;
  /** 权重 1-9，默认 1 */
  weight?: number;
}

export interface IWheelTemplate {
  id: string;
  name: string;
  icon: string;
  /** 分类 key */
  cat: string;
  theme: PaletteKey;
  /** 一句话说明 */
  desc: string;
  options: ITplOption[];
}

export interface ITplCategory {
  key: string;
  label: string;
  icon: string;
}

export const TEMPLATE_CATEGORIES: ITplCategory[] = [
  { key: 'eat', label: '干饭', icon: '🍚' },
  { key: 'go', label: '出行', icon: '✈️' },
  { key: 'chore', label: '家务分工', icon: '🧹' },
  { key: 'fun', label: '娱乐', icon: '🎮' },
  { key: 'work', label: '工作学习', icon: '📚' },
  { key: 'fest', label: '节日', icon: '🎁' }
];

/**
 * 内置模板库（18 个）。
 * weight 用法示例：年会抽奖里「谢谢参与」权重 9、「特等奖」权重 1 —— 用它表达概率倍率。
 */
export const TEMPLATES: IWheelTemplate[] = [
  // ===== 干饭 =====
  {
    id: 'eat-lunch',
    name: '今天吃什么',
    icon: '🍚',
    cat: 'eat',
    theme: 'candy',
    desc: '选择困难症的终极解药',
    options: [
      { text: '火锅', icon: '🍲' },
      { text: '日料', icon: '🍣' },
      { text: '烧烤', icon: '🍢' },
      { text: '麻辣烫', icon: '🌶️' },
      { text: '快餐', icon: '🍔' },
      { text: '轻食', icon: '🥗' }
    ]
  },
  {
    id: 'eat-milktea',
    name: '奶茶点哪家',
    icon: '🧋',
    cat: 'eat',
    theme: 'morandi',
    desc: '一天一杯，喝哪家不纠结',
    options: [
      { text: '喜茶', icon: '🧋' },
      { text: '奈雪', icon: '🧋' },
      { text: '蜜雪冰城', icon: '🍦' },
      { text: '茶百道', icon: '🧋' },
      { text: '古茗', icon: '🧋' },
      { text: '沪上阿姨', icon: '🧋' }
    ]
  },
  {
    id: 'eat-teatime',
    name: '下午茶吃什么',
    icon: '☕',
    cat: 'eat',
    theme: 'candy',
    desc: '三点几了，饮茶先啦',
    options: [
      { text: '咖啡', icon: '☕' },
      { text: '蛋糕', icon: '🍰' },
      { text: '水果', icon: '🍎' },
      { text: '坚果', icon: '🥜' },
      { text: '酸奶', icon: '🥛' },
      { text: '饼干', icon: '🍪' }
    ]
  },

  // ===== 出行 =====
  {
    id: 'go-weekend',
    name: '周末去哪玩',
    icon: '🎡',
    cat: 'go',
    theme: 'ocean',
    desc: '两天一夜，别再宅着了',
    options: [
      { text: '逛公园', icon: '🌳' },
      { text: '博物馆', icon: '🏛️' },
      { text: '看电影', icon: '🎬' },
      { text: '逛街', icon: '🛍️' },
      { text: '爬山', icon: '⛰️' },
      { text: '在家躺平', icon: '🛋️' }
    ]
  },
  {
    id: 'go-travel',
    name: '旅行目的地',
    icon: '✈️',
    cat: 'go',
    theme: 'ocean',
    desc: '下一个假期去哪儿',
    options: [
      { text: '云南', icon: '🏔️' },
      { text: '新疆', icon: '🐎' },
      { text: '海南', icon: '🏖️' },
      { text: '川西', icon: '🛣️' },
      { text: '东北', icon: '❄️' },
      { text: '东南亚', icon: '🌴' }
    ]
  },
  {
    id: 'go-dinner',
    name: '聚餐去哪吃',
    icon: '🍽️',
    cat: 'go',
    theme: 'festive',
    desc: '一群人点菜最难，交给转盘',
    options: [
      { text: '火锅', icon: '🍲' },
      { text: '烤肉', icon: '🥩' },
      { text: '日料', icon: '🍣' },
      { text: '川菜', icon: '🌶️' },
      { text: '粤菜', icon: '🥟' },
      { text: '烧烤', icon: '🍢' }
    ]
  },

  // ===== 家务分工 =====
  {
    id: 'chore-dish',
    name: '谁洗碗',
    icon: '🍽️',
    cat: 'chore',
    theme: 'ocean',
    desc: '饭后最严肃的家庭议题',
    options: [
      { text: '我', icon: '🙋' },
      { text: '老爸', icon: '👨' },
      { text: '老妈', icon: '👩' },
      { text: '弟弟', icon: '🧒' },
      { text: '妹妹', icon: '👧' },
      { text: '猜拳决定', icon: '✌️' }
    ]
  },
  {
    id: 'chore-trash',
    name: '谁倒垃圾',
    icon: '🚮',
    cat: 'chore',
    theme: 'morandi',
    desc: '垃圾不等人',
    options: [
      { text: '我', icon: '🙋' },
      { text: '室友', icon: '🧑‍🤝‍🧑' },
      { text: '轮到谁谁', icon: '🔁' },
      { text: '今晚先不倒', icon: '😴' },
      { text: '猜拳决定', icon: '✌️' },
      { text: '谁在家谁去', icon: '🏠' }
    ]
  },
  {
    id: 'chore-duty',
    name: '谁做值日',
    icon: '🧹',
    cat: 'chore',
    theme: 'morandi',
    desc: '宿舍 / 班级值日分配',
    options: [
      { text: '我', icon: '🙋' },
      { text: '同桌', icon: '🧑‍🎓' },
      { text: '前排', icon: '⬆️' },
      { text: '后排', icon: '⬇️' },
      { text: '猜拳决定', icon: '✌️' },
      { text: '老师点名', icon: '👩‍🏫' }
    ]
  },
  {
    id: 'chore-express',
    name: '谁取快递',
    icon: '📦',
    cat: 'chore',
    theme: 'candy',
    desc: '快递柜前的选择',
    options: [
      { text: '我', icon: '🙋' },
      { text: '室友', icon: '🧑‍🤝‍🧑' },
      { text: '顺路的人', icon: '🚶' },
      { text: '明天再说', icon: '📅' },
      { text: '猜拳决定', icon: '✌️' },
      { text: '谁下单谁取', icon: '🛒' }
    ]
  },

  // ===== 娱乐 =====
  {
    id: 'fun-movie',
    name: '看什么电影',
    icon: '🎬',
    cat: 'fun',
    theme: 'morandi',
    desc: '别再刷半小时片单了',
    options: [
      { text: '科幻', icon: '🚀' },
      { text: '喜剧', icon: '😂' },
      { text: '悬疑', icon: '🕵️' },
      { text: '动画', icon: '🎠' },
      { text: '爱情', icon: '💗' },
      { text: '纪录片', icon: '🎥' }
    ]
  },
  {
    id: 'fun-game',
    name: '玩什么游戏',
    icon: '🎮',
    cat: 'fun',
    theme: 'candy',
    desc: '开局前的最后一道题',
    options: [
      { text: '王者', icon: '⚔️' },
      { text: '原神', icon: '🗡️' },
      { text: '剧本杀', icon: '📖' },
      { text: '桌游', icon: '🎲' },
      { text: 'Switch', icon: '🕹️' },
      { text: '健身环', icon: '🏃' }
    ]
  },
  {
    id: 'fun-music',
    name: '听什么歌单',
    icon: '🎧',
    cat: 'fun',
    theme: 'ocean',
    desc: '今天的心情配什么歌',
    options: [
      { text: '流行', icon: '🎤' },
      { text: '民谣', icon: '🎸' },
      { text: '古典', icon: '🎻' },
      { text: '说唱', icon: '🎙️' },
      { text: '电子', icon: '🎛️' },
      { text: '轻音乐', icon: '🎹' }
    ]
  },

  // ===== 工作学习 =====
  {
    id: 'work-first-task',
    name: '先做哪项任务',
    icon: '✅',
    cat: 'work',
    theme: 'ocean',
    desc: '拖延症克星：随机开一个头',
    options: [
      { text: '最难的', icon: '🔥' },
      { text: '最紧急的', icon: '⏰' },
      { text: '最讨厌的', icon: '😖' },
      { text: '最快的', icon: '⚡' }
    ]
  },
  {
    id: 'work-meeting',
    name: '开会谁先来',
    icon: '🗣️',
    cat: 'work',
    theme: 'morandi',
    desc: '轮流发言，公平公正',
    options: [
      { text: '我', icon: '🙋' },
      { text: '组长', icon: '🧑‍💼' },
      { text: '新人', icon: '🧑‍🎓' },
      { text: '按顺序', icon: '🔢' },
      { text: '随机点名', icon: '🎯' },
      { text: '最闲的先说', icon: '☕' }
    ]
  },
  {
    id: 'work-review',
    name: '复习哪科',
    icon: '📚',
    cat: 'work',
    theme: 'morandi',
    desc: '考前突击，先啃哪一科',
    options: [
      { text: '数学', icon: '📐' },
      { text: '英语', icon: '🔤' },
      { text: '专业课', icon: '📘' },
      { text: '政治', icon: '📕' },
      { text: '错题本', icon: '📝' },
      { text: '背单词', icon: '🅰️' }
    ]
  },

  // ===== 节日 =====
  {
    id: 'fest-truth-dare',
    name: '真心话 or 大冒险',
    icon: '🎯',
    cat: 'fest',
    theme: 'candy',
    desc: '聚会破冰神器',
    options: [
      { text: '真心话', icon: '💬', weight: 3 },
      { text: '大冒险', icon: '😈', weight: 3 },
      { text: '指定一人', icon: '👉' },
      { text: '翻倍惩罚', icon: '❌❌' },
      { text: '跳过', icon: '⏭️' }
    ]
  },
  {
    id: 'fest-lottery',
    name: '年会抽奖',
    icon: '🎁',
    cat: 'fest',
    theme: 'festive',
    desc: '权重模式：大奖概率低，参与奖概率高',
    options: [
      { text: '谢谢参与', icon: '🙂', weight: 9 },
      { text: '阳光普照', icon: '🎈', weight: 5 },
      { text: '三等奖', icon: '🥉', weight: 3 },
      { text: '二等奖', icon: '🥈', weight: 2 },
      { text: '一等奖', icon: '🥇', weight: 1 },
      { text: '特等奖', icon: '🏆', weight: 1 }
    ]
  },

  // ===== 彩蛋：完成待办后的小奖励 =====
  {
    id: 'reward-lucky',
    name: '幸运转盘',
    icon: '🎉',
    cat: 'fest',
    theme: 'candy',
    desc: '完成任务的你，值得一个小奖励',
    options: [
      { text: '喝杯奶茶吧', icon: '🧋' },
      { text: '摸鱼 10 分钟', icon: '🐟' },
      { text: '站起来走走', icon: '🚶' },
      { text: '刷 5 分钟手机', icon: '📱' },
      { text: '吃点小零食', icon: '🍪' },
      { text: '继续加油干', icon: '💪', weight: 3 }
    ]
  }
];

/** 按 id 取模板 */
export function getTemplate(id: string): IWheelTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** 按分类取模板 */
export function templatesOf(cat: string): IWheelTemplate[] {
  return TEMPLATES.filter((t) => t.cat === cat);
}

/** 取色盘中的第 i 色（循环取用，且相邻不同色） */
export function paletteColor(p: PaletteKey, i: number): string {
  const list = (PALETTES[p] || PALETTES.candy).colors;
  const n = list.length || 1;
  return list[((i % n) + n) % n];
}
