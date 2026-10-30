// subpackages/pomodoro/utils/focus-copy.ts
// 番茄钟「情绪激励」文案层。
//
// 设计原则（对应需求五 / 十八 / 十九）：
//   · 短、克制、有力量 —— 不做鸡汤堆砌，不喊口号，不承诺结果；
//   · 只讲「过程」不讲「成功学」：强调坚持本身，而不是坚持就能成功；
//   · 全部按「日期 + 轮次」确定性选取，同一天内不会每 tick 变一句（否则显得廉价）。
//
// 为什么不写进页面：文案是纯数据，混进 Page 会让 setData 体积变大，
// 且无法被单测覆盖。独立成层后页面只负责「取哪一条」。

/** 今日激励语池：按「用户打开这一天的心情」分层，不是一律打鸡血 */
export const DAILY_QUOTES: string[] = [
  '每一次专注，都是向目标靠近一步。',
  '真正的成长，是把简单的事情重复做好。',
  '不要追求一时爆发，坚持本身就是力量。',
  '专注当下这一件事，其余的先放下。',
  '进度条不会骗人，你走到哪里它就到哪里。',
  '今天的专注，是明天的从容。',
  '慢一点没关系，别停下来就行。',
  '把大目标拆小，小到不可能失败为止。',
  '你不需要状态很好，你只需要开始。',
  '一轮一轮来，路会自己出现。',
  '此刻的安静，会在以后替你说话。',
  '不用向谁证明，先对今天的自己负责。',
  '专注是这个时代最稀缺的能力。',
  '先完成，再完美。'
];

/**
 * 连续坚持里程碑：达到指定天数时替换默认文案。
 * key 为天数，命中即用；未命中走 streakMessage 的通用分支。
 */
export const STREAK_MILESTONES: Record<number, string> = {
  3: '第三天了。习惯正在悄悄成形。',
  7: '坚持不是一天的热血，而是每天都不放弃。',
  14: '两周。你已经骗过了那个想放弃的自己。',
  30: '你正在把自律变成习惯。',
  60: '六十天。认真的人运气不会太差。',
  100: '一百天的坚持，已经成为更好的自己。'
};

/** 底部成长价值观标签（需求十九）
 *  只有「符号 + 四字」两层，不再加注解小字：
 *  四个标签并排时每格只有 ~80px 宽，再加一行注解会小到 9px 反而像糊掉，
 *  也违背需求十九「不抢夺主界面视觉」的意图。 */
export interface GrowthTag {
  glyph: string;
  label: string;
}

export const GROWTH_TAGS: GrowthTag[] = [
  { glyph: '◎', label: '专注当下' },
  { glyph: '△', label: '坚持不懈' },
  { glyph: '♧', label: '收获成长' },
  { glyph: '♛', label: '成就自己' }
];

/** 把日期戳成稳定的整数种子（本地时区零点，避免跨时区跳变） */
export function daySeed(now: number = Date.now()): number {
  const d = new Date(now);
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.floor(local / 86400000);
}

/**
 * 取今日激励语。
 * @param offset 额外扰动（例如「第 N 轮完成」时 +1，让同一句不连续出现两遍）
 */
export function pickDailyQuote(now: number = Date.now(), offset = 0): string {
  const i = (daySeed(now) + offset) % DAILY_QUOTES.length;
  return DAILY_QUOTES[(i + DAILY_QUOTES.length) % DAILY_QUOTES.length];
}

/** 连续坚持天数 → 文案；里程碑优先 */
export function streakMessage(days: number): string {
  if (days <= 0) return '从今天开始，先走第一步。';
  const hit = STREAK_MILESTONES[days];
  if (hit) return hit;
  // 非里程碑：取「不超过当前天数」的最大里程碑做底，再拼当日进度
  const keys = Object.keys(STREAK_MILESTONES)
    .map(Number)
    .filter((n) => n <= days)
    .sort((a, b) => a - b);
  const near = keys.length ? STREAK_MILESTONES[keys[keys.length - 1]] : '';
  return `已经坚持 ${days} 天，继续保持。${near ? '' : ''}`.trim();
}

/** 里程碑进度点：已达成 / 未达成（需求十八的 ● ● ● ● 序列） */
export function streakDots(days: number, total = 7): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < total; i++) out.push(i < days);
  return out;
}

/** 阶段标签：计时器中央「专注学习 / 短休息 / 长休息」 */
export function modeLabelCn(mode: 'focus' | 'short' | 'long'): string {
  if (mode === 'focus') return '专注学习';
  if (mode === 'short') return '短休息';
  return '长休息';
}

/** 顶部状态条文案（需求十四：开始后顶部显示「正在专注 · 请勿打扰」） */
export function runningBanner(mode: 'focus' | 'short' | 'long'): string {
  if (mode === 'focus') return '正在专注 · 请勿打扰';
  if (mode === 'short') return '短休息中 · 起身走两步';
  return '长休息中 · 让眼睛歇一会儿';
}

/** 完成一轮的克制奖励文案（需求十六） */
export function completeTitle(mode: 'focus' | 'short' | 'long'): string {
  if (mode === 'focus') return '这一轮，坚持住了。';
  if (mode === 'short') return '休息结束，准备好了吗';
  return '长休息结束，回到专注';
}
