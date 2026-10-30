// utils/love-cycle.ts
// 经期呵护 · 周期推算 + 阶段自我照顾建议
//
// 【医学边界】本模块只做「常识级自我照顾提示」，不诊断、不治疗、不推荐处方药。
//   · 周期预测基于用户自己的历史记录做均值，样本不足时回落到 28 天通用值；
//   · 出现「就医红线」症状时明确建议看医生，而不是给缓解办法——这是底线。
import { loadPeriods, getCycleSettings, diffDays, addDays, todayYmd, weekdayCn } from './love-store';
import type { CyclePhase } from './love-types';

export interface CycleAnalysis {
  hasData: boolean;
  /** 历史经期次数 */
  count: number;
  /** 实际平均周期（样本 ≥2 才有值） */
  avgCycle: number;
  /** 实际平均经期长度 */
  avgPeriod: number;
  /** 规律度：'enough'|'learning'|'none' */
  regularity: 'enough' | 'learning' | 'none';
  lastStart: string;
  lastEnd: string;
  running: boolean;
  /** 当前周期第几天（1-based） */
  dayIndex: number;
  phase: CyclePhase;
  phaseName: string;
  phaseEmoji: string;
  /** 预测下次开始日 */
  nextStart: string;
  /** 距下次开始还有几天（负数=已推迟） */
  daysToNext: number;
  /** 预测排卵日 */
  ovulation: string;
  /** 易孕期起止 */
  fertileStart: string;
  fertileEnd: string;
  /** 是否处于易孕期 */
  inFertile: boolean;
  /** 未来 3 次预测开始日（给日历用） */
  forecast: string[];
  /** 推迟提示文案 */
  delayText: string;
}

const PHASE_META: Record<CyclePhase, { name: string; emoji: string }> = {
  menstrual: { name: '经期', emoji: '🌹' },
  follicular: { name: '卵泡期', emoji: '🌱' },
  ovulation: { name: '排卵期', emoji: '✨' },
  luteal: { name: '黄体期', emoji: '🌙' }
};

/** 样本不足时的通用值 */
const FALLBACK_CYCLE = 28;
const FALLBACK_PERIOD = 5;

export function analyze(): CycleAnalysis {
  const list = loadPeriods().filter((x) => x && x.start);
  const s = getCycleSettings();
  const today = todayYmd();

  const avgCycle = calcAvgCycle(list.map((x) => x.start));
  const avgPeriod = calcAvgPeriod(list);
  const cycleLen = avgCycle || s.cycleLen || FALLBACK_CYCLE;
  const periodLen = avgPeriod || s.periodLen || FALLBACK_PERIOD;
  const luteal = s.lutealLen || 14;

  const last = list[0];
  if (!last) {
    return {
      hasData: false, count: 0, avgCycle: 0, avgPeriod: 0, regularity: 'none',
      lastStart: '', lastEnd: '', running: false, dayIndex: 0,
      phase: 'follicular', phaseName: '待记录', phaseEmoji: '📝',
      nextStart: '', daysToNext: 0, ovulation: '', fertileStart: '', fertileEnd: '',
      inFertile: false, forecast: [], delayText: ''
    };
  }

  const dayIndex = diffDays(last.start, today) + 1;
  const nextStart = addDays(last.start, cycleLen);
  const daysToNext = diffDays(today, nextStart);

  // 排卵日 = 下次开始日 - 黄体期长度（比「周期第 14 天」更贴合个体）
  const ovulation = addDays(nextStart, -luteal);
  const fertileStart = addDays(ovulation, -5);
  const fertileEnd = addDays(ovulation, 1);

  let phase: CyclePhase = 'luteal';
  if (dayIndex <= periodLen) phase = 'menstrual';
  else {
    const dOvu = diffDays(last.start, ovulation) + 1;
    if (dayIndex >= dOvu - 5 && dayIndex <= dOvu + 1) phase = 'ovulation';
    else if (dayIndex < dOvu - 5) phase = 'follicular';
    else phase = 'luteal';
  }
  // 已经过了预测开始日还没记录 → 仍算黄体期，但给出推迟提示
  if (dayIndex > cycleLen) phase = 'luteal';

  const inFertile = today >= fertileStart && today <= fertileEnd;
  const forecast = [nextStart, addDays(nextStart, cycleLen), addDays(nextStart, cycleLen * 2)];

  let delayText = '';
  if (daysToNext < 0) {
    const d = -daysToNext;
    delayText = d <= 7
      ? `已推迟 ${d} 天，7 天内都属常见波动，先别紧张`
      : `已推迟 ${d} 天，超过一周建议留意（压力/作息/体重变化都会影响），必要时看医生`;
  }

  const regularity = list.length >= 3 ? 'enough' : (list.length >= 1 ? 'learning' : 'none');

  return {
    hasData: true,
    count: list.length,
    avgCycle: avgCycle || 0,
    avgPeriod: avgPeriod || 0,
    regularity,
    lastStart: last.start,
    lastEnd: last.end,
    running: !last.end,
    dayIndex,
    phase,
    phaseName: PHASE_META[phase].name,
    phaseEmoji: PHASE_META[phase].emoji,
    nextStart,
    daysToNext,
    ovulation,
    fertileStart,
    fertileEnd,
    inFertile,
    forecast,
    delayText
  };
}

/** 相邻开始日差值取中位数（比均值抗 outliers：偶尔一次紊乱不会带偏预测） */
function calcAvgCycle(starts: string[]): number {
  const gaps: number[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const g = diffDays(starts[i + 1], starts[i]); // starts 已降序
    if (g >= 18 && g <= 60) gaps.push(g);
  }
  if (!gaps.length) return 0;
  const sorted = gaps.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return clamp(med, 21, 40);
}

function calcAvgPeriod(list: { start: string; end: string }[]): number {
  const lens: number[] = [];
  list.forEach((x) => {
    if (x.start && x.end) {
      const d = diffDays(x.start, x.end) + 1;
      if (d >= 2 && d <= 10) lens.push(d);
    }
  });
  if (!lens.length) return 0;
  const sum = lens.reduce((a, b) => a + b, 0);
  return clamp(Math.round(sum / lens.length), 2, 10);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/* ============================ 阶段自我照顾建议 ============================ */

export interface PhaseAdvice {
  name: string;
  emoji: string;
  /** 一句话状态描述 */
  desc: string;
  food: string[];
  move: string[];
  skin: string[];
  mood: string[];
  wear: string[];
  caution: string[];
}

const ADVICE: Record<CyclePhase, PhaseAdvice> = {
  menstrual: {
    name: '经期',
    emoji: '🌹',
    desc: '身体在「清理」，能量偏低是正常现象，这几天请把标准降到最低。',
    food: [
      '补铁：瘦红肉 / 鸭血 / 菠菜 + 维 C（橙子、彩椒）一起吃更好吸收',
      '暖饮优先：红糖姜茶、桂圆红枣茶，冰饮先停一停',
      '少盐少咖啡：会加重水肿与乳房胀痛；巧克力可以吃，选 70% 以上黑巧',
      '镁 + B6：坚果、香蕉、燕麦，对缓解痛经与情绪波动有帮助'
    ],
    move: [
      '前两天以休息为主，别硬扛高强度训练',
      '散步 15–20 分钟、猫牛式、婴儿式拉伸，能明显缓解腰腹坠胀',
      '游泳暂停，盆浴改淋浴，注意卫生用品 2–4 小时更换一次'
    ],
    skin: [
      '激素下滑容易泛红敏感：护肤做减法，清洁 + 保湿 + 防晒三步就够',
      '暂停刷酸、A 醇、去角质与首次使用的功效型新品',
      '唇周下巴易冒痘：局部点涂消炎精华，别用手挤'
    ],
    mood: [
      '允许自己「什么都不想做」，把待办砍掉三成不是偷懒',
      '情绪低落时先补觉 + 晒 10 分钟太阳，比硬撑有效',
      '想哭就哭，这是激素在退潮，不是你脆弱'
    ],
    wear: [
      '高腰宽松下装 + 腰腹一层保暖（暖宝宝贴隔着衣服贴，别直接贴皮肤）',
      '深色 / 宽松裤装更安心，包里常备一份卫生用品与一条备用内裤',
      '鞋跟降下来，重心不稳的日子别穿细高跟'
    ],
    caution: [
      '经量突然翻倍、每小时湿透一片 → 就医',
      '剧烈腹痛吃止痛药也无法缓解 → 就医',
      '经期超过 8 天或周期 <21 天 / >40 天持续三个月 → 建议妇科检查'
    ]
  },
  follicular: {
    name: '卵泡期',
    emoji: '🌱',
    desc: '雌激素回升，体力、皮肤耐受度、学习专注度都在上行——这是一整个月里最好用的窗口期。',
    food: [
      '蛋白质拉满：鸡蛋、鱼虾、豆制品，配合力量训练肌肉合成效率最高',
      '多吃纤维与发酵食物（酸奶、纳豆），肠道顺了皮肤也顺',
      '可以适量喝咖啡，但别空腹'
    ],
    move: [
      '最适合加力量训练：深蹲、硬拉、臀桥，这周加重量最容易出效果',
      '心肺：慢跑 / 跳绳 / 团课，耐力感受明显比上周好',
      '尝试新运动（攀岩、普拉提）放在这周，接受度最高'
    ],
    skin: [
      '皮肤状态最稳：美白、刷酸、A 醇、医美项目都可以安排在这两周',
      '新护肤品做皮试也放这周，出问题还有时间修',
      '出油开始回升，清洁可以稍微加强，但别过度'
    ],
    mood: [
      '适合推进难的事：重要汇报、谈薪资、开始一个新计划',
      '社交能量高，约人、见朋友、拍照片都安排起来'
    ],
    wear: [
      '尝试新风格的最佳时机：亮色、露肤、设计款都能hold住',
      '可以买需要一点「驾驭力」的单品，这周穿最有底气'
    ],
    caution: ['分泌物异常、异味、瘙痒 → 及时就医，别自行冲洗阴道']
  },
  ovulation: {
    name: '排卵期',
    emoji: '✨',
    desc: '雌激素峰值，状态最好也最容易「用力过猛」；同时是易孕期，避孕需求请务必确认。',
    food: [
      '抗炎饮食：深海鱼、亚麻籽、深色蔬菜，帮助缓解排卵痛',
      '继续高蛋白 + 充足碳水，训练表现会不错',
      '少油少辣，减轻排卵期常见的腹胀'
    ],
    move: [
      '可以冲高强度，但注意热身与拉伸，韧带松弛期关节更容易扭伤',
      '出现单侧下腹刺痛（排卵痛）就降强度，热敷 + 休息'
    ],
    skin: [
      '皮脂分泌上升，T 区开始出油：加一次温和清洁或泥膜',
      '有备孕/避孕需求的话，这周是重点窗口，请提前确认措施'
    ],
    mood: [
      '精力与表达欲都在线，适合谈判、表白、拍视频、主动联系想联系的人',
      '注意别把日程排爆，峰值之后是下滑'
    ],
    wear: [
      '腰线最细的一周，收腰连衣裙、高腰裤都好看',
      '若有腹胀就换 A 字裙 / 直筒裤，别跟身体较劲'
    ],
    caution: ['排卵痛剧烈或持续超过 3 天 → 就医；无避孕计划的性行为请务必做好避孕']
  },
  luteal: {
    name: '黄体期',
    emoji: '🌙',
    desc: '孕酮上升：容易水肿、嘴馋、情绪敏感、胸部胀痛。这不是你矫情，是激素在做事。',
    food: [
      '控盐控糖：水肿与爆痘主要来自这里，外卖少点重口味',
      '嘴馋时优先：黑巧、坚果、无糖酸奶、冻干水果，别一次性囤零食',
      '补镁 + 钙 + B6：深绿叶菜、坚果、奶类，缓解 PMS 与睡眠变差',
      '咖啡减半，下午以后改花草茶，睡眠会好很多'
    ],
    move: [
      '降强度：瑜伽、快走、普拉提比 HIIT 合适',
      '水肿明显就抬腿 15 分钟 + 轻按摩，比疯狂有氧有用',
      '胸胀时选支撑好的运动内衣，别省'
    ],
    skin: [
      '下巴下颌线易闭口爆痘：简化护肤，别叠加太多功效品',
      '按时清洁化妆刷与枕套，这周细菌最容易作妖',
      '水肿脸早上冷敷 + 咖啡因眼霜，急救效果明显'
    ],
    mood: [
      '情绪敏感是正常的：先把「我是不是不行」翻译成「我今天是黄体期」',
      '重要决定尽量避开经前 3 天，容易过度悲观',
      '想哭/想发脾气时，写下来比说出来更安全，也更容易被理解'
    ],
    wear: [
      '宽松腰头 + 弹性面料，腹部胀气时别穿硬腰封',
      '深色上装更安心，备一件薄外套应对忽冷忽热'
    ],
    caution: ['PMS 严重影响工作生活、经前持续失眠或极度低落 → 建议就医评估']
  }
};

export function phaseAdvice(phase: CyclePhase): PhaseAdvice {
  return ADVICE[phase] || ADVICE.follicular;
}

/* ============================ 痛经分级应对 ============================ */

export interface PainPlan {
  level: number;
  title: string;
  steps: string[];
  redFlags: string[];
}

const PAIN_PLANS: Record<number, { title: string; steps: string[] }> = {
  0: {
    title: '没有痛感',
    steps: ['保持现在的节奏就好：规律作息 + 温热饮水', '记录这一次的流量与情绪，样本攒起来预测会更准']
  },
  1: {
    title: '轻微不适',
    steps: [
      '热水袋 / 暖宝宝隔着衣服敷下腹 15–20 分钟',
      '喝一杯热的红糖姜茶，慢慢喝别牛饮',
      '做 5 分钟猫牛式或婴儿式，放松腰腹',
      '早睡一小时，睡眠是最便宜的止痛药'
    ]
  },
  2: {
    title: '明显疼痛（影响做事）',
    steps: [
      '热敷 + 休息双管齐下，今天的重体力/高强度任务往后挪',
      '布洛芬类止痛药：**在痛感刚起来时吃**效果最好，按说明书剂量，餐后服用',
      '咖啡与浓茶暂停（会加重血管收缩），换成温水',
      '深呼吸 4-7-8 法：吸 4 秒、憋 7 秒、呼 8 秒，重复 5 轮',
      '如果每次都这么痛，下次就诊时可以带着这份记录去给医生看'
    ]
  },
  3: {
    title: '剧烈疼痛（难以忍受）',
    steps: [
      '优先止痛：按说明书服用止痛药，不要硬扛到痛晕',
      '躺下 + 热敷 + 补充温水，今天请把自己当病人照顾',
      '不要喝酒、不要吃生冷',
      '⚠️ 建议尽快就医：排除子宫内膜异位症、腺肌症等器质性问题',
      '把这份记录导出给医生：疼痛等级 + 持续天数 + 经量，比口头描述有用得多'
    ]
  }
};

const RED_FLAGS = [
  '止痛药吃了也压不住的剧痛',
  '经量突然变大（1 小时湿透一片，或大量血块）',
  '经期超过 8 天，或非经期出血',
  '伴随发烧、呕吐、晕厥',
  '疼痛逐月加重、开始影响上学上班'
];

export function painPlan(level: number): PainPlan {
  const lv = Math.max(0, Math.min(3, Number(level) || 0));
  const p = PAIN_PLANS[lv] || PAIN_PLANS[0];
  return { level: lv, title: p.title, steps: p.steps, redFlags: lv >= 2 ? RED_FLAGS : [] };
}

/* ============================ 提醒文案 ============================ */

export interface CycleReminder {
  due: boolean;
  title: string;
  desc: string;
  /** 'before' | 'today' | 'running' | 'delay' | 'none' */
  kind: 'before' | 'today' | 'running' | 'delay' | 'none';
}

export function buildReminder(): CycleReminder {
  const a = analyze();
  const s = getCycleSettings();
  if (!a.hasData) {
    return { due: false, kind: 'none', title: '', desc: '记录第一次经期后，这里会给出预测与提醒' };
  }
  if (a.running) {
    return {
      due: true, kind: 'running',
      title: `经期第 ${a.dayIndex} 天`,
      desc: `${a.phaseName} · 记得 2–4 小时更换一次卫生用品，别喝冰的`
    };
  }
  if (a.daysToNext === 0) {
    return { due: true, kind: 'today', title: '今天预计来月经', desc: '把卫生用品放进包里，今天允许自己慢一点' };
  }
  if (a.daysToNext < 0) {
    return { due: true, kind: 'delay', title: `已推迟 ${-a.daysToNext} 天`, desc: a.delayText || '周期波动很常见，先观察' };
  }
  if (a.daysToNext <= s.remindBefore) {
    return { due: true, kind: 'before', title: `还有 ${a.daysToNext} 天来月经`, desc: `预计 ${a.nextStart}（${weekdayCn(a.nextStart)}）· 提前备好用品，这几天注意保暖别贪凉` };
  }
  return { due: false, kind: 'none', title: '', desc: `下次预计 ${a.nextStart}，还有 ${a.daysToNext} 天` };
}

/** 症状标签（记录时快速勾选） */
export const SYMPTOM_TAGS = ['腹痛', '腰酸', '头痛', '胸胀', '水肿', '爆痘', '疲惫', '失眠', '腹泻', '便秘'];
export const MOOD_TAGS = ['低落', '易怒', '焦虑', '想哭', '平静', '开心', '黏人', '没动力'];
