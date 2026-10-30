/**
 * 益智游戏本地统计存储
 * 全部数据仅存于 wx.storage，不上传服务器、不收集隐私
 *
 * 新增能力（闲趣游戏）：
 *  - 积分 points：答对/通关获得，提示可消耗
 *  - 每日免费提示 freeHintsLeft：每天 3 次，超出后消耗积分
 *  - 错题本 wrongBook：答错的题目本地保存，便于复习
 */
const GLOBAL_KEY = 'games_global_v1';
const HINT_COST = 5;          // 超出免费次数后，每次提示消耗积分
const FREE_HINTS_PER_DAY = 3; // 每日免费提示次数

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function read(key, def) {
  try { const v = wx.getStorageSync(key); return v ? v : def; }
  catch (e) { return def; }
}
function write(key, val) {
  try { wx.setStorageSync(key, val); } catch (e) {}
}

/** 单款游戏的存储键。此前 recordPlay / getGame 直接引用了未定义的 gameKey，导致通关时抛 ReferenceError。 */
function gameKey(id) { return 'games_rec_' + id; }

function getGlobal() {
  const g = read(GLOBAL_KEY, {
    date: todayStr(), todayPlays: 0, totalTime: 0, bestScore: 0,
    points: 0, freeHintsLeft: FREE_HINTS_PER_DAY
  });
  if (typeof g.points !== 'number') g.points = 0;
  if (typeof g.freeHintsLeft !== 'number') g.freeHintsLeft = FREE_HINTS_PER_DAY;
  if (!g.date) g.date = todayStr();
  return g;
}

/** 跨天重置：今日次数与免费提示 */
function ensureDaily(g) {
  const t = todayStr();
  if (g.date !== t) { g.date = t; g.todayPlays = 0; g.freeHintsLeft = FREE_HINTS_PER_DAY; }
  return g;
}

/** 一局结束后记录：今日次数、累计时长、各游戏最高分 */
function recordPlay(id, opt) {
  const g = ensureDaily(getGlobal());
  g.todayPlays += 1;
  g.totalTime += Math.max(0, Math.round(opt.timeSec || 0));
  g.bestScore = Math.max(g.bestScore, opt.score || 0);

  const rec = getGame(id);
  let changed = false;
  if (typeof opt.score === 'number') { rec.best = Math.max(rec.best, opt.score); changed = true; }
  if (typeof opt.steps === 'number') { rec.bestSteps = rec.bestSteps ? Math.min(rec.bestSteps, opt.steps) : opt.steps; changed = true; }
  if (typeof opt.timeSec === 'number' && opt.win) {
    rec.bestTime = rec.bestTime ? Math.min(rec.bestTime, opt.timeSec) : opt.timeSec; changed = true;
  }
  if (opt.win) { rec.clears = (rec.clears || 0) + 1; }
  if (opt.unlock) { rec.unlocked = Math.max(rec.unlocked || 1, opt.unlock); }
  if (changed) write(gameKey(id), rec);
  write(GLOBAL_KEY, g);
  return { global: g, rec };
}

function getGame(id) {
  return read(gameKey(id), { best: 0, bestSteps: 0, bestTime: 0, clears: 0, unlocked: 1 });
}

/**
 * 统一的「本局结束」入口：记录成绩 + 返回本次是否刷新了个人纪录。
 * 各游戏在通关 / 结算时调用，返回值用于决定是否展示通关庆祝层。
 *
 * @param {string} id  游戏标识
 * @param {object} opt { win, score, steps, timeSec }
 * @returns {{ win:boolean, isNewBest:boolean, prevBest:number, prevBestTime:number, rec:object, global:object }}
 */
function finishRound(id, opt) {
  opt = opt || {};
  const prev = getGame(id);
  const prevBest = prev.best || 0;
  const prevBestTime = prev.bestTime || 0;

  const win = !!opt.win;
  // 判定是否破纪录（需在 recordPlay 写入之前比较）
  const isNewBest = win && (
    (typeof opt.score === 'number' && opt.score > prevBest) ||
    (typeof opt.timeSec === 'number' && prevBestTime === 0)
  );

  const res = recordPlay(id, {
    win,
    score: typeof opt.score === 'number' ? opt.score : undefined,
    steps: typeof opt.steps === 'number' ? opt.steps : undefined,
    timeSec: typeof opt.timeSec === 'number' ? opt.timeSec : undefined
  });

  return {
    win,
    isNewBest,
    prevBest,
    prevBestTime,
    rec: res.rec,
    global: res.global
  };
}

function clearAll() {
  const g = getGlobal();
  const keys = wx.getStorageInfoSync().keys || [];
  keys.forEach((k) => {
    if (k.indexOf('games_rec_') === 0 || k.indexOf('games_wrong_') === 0) wx.removeStorageSync(k);
  });
  write(GLOBAL_KEY, { date: todayStr(), todayPlays: g.todayPlays, totalTime: 0, bestScore: 0, points: 0, freeHintsLeft: FREE_HINTS_PER_DAY });
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

/* ---------- 积分与提示 ---------- */
function addPoints(n) {
  const g = ensureDaily(getGlobal());
  g.points += Math.max(0, Math.round(n));
  write(GLOBAL_KEY, g);
  return g.points;
}

/** 返回 { result:'free'|'paid'|'none', freeLeft, points } */
function consumeHint(cost) {
  cost = cost || HINT_COST;
  const g = ensureDaily(getGlobal());
  let result;
  if (g.freeHintsLeft > 0) {
    g.freeHintsLeft -= 1;
    result = 'free';
  } else if (g.points >= cost) {
    g.points -= cost;
    result = 'paid';
  } else {
    write(GLOBAL_KEY, g);
    return { result: 'none', freeLeft: g.freeHintsLeft, points: g.points, cost };
  }
  write(GLOBAL_KEY, g);
  return { result, freeLeft: g.freeHintsLeft, points: g.points, cost };
}

function getHintState() {
  const g = ensureDaily(getGlobal());
  write(GLOBAL_KEY, g);
  return { freeLeft: g.freeHintsLeft, points: g.points, cost: HINT_COST };
}

/* ---------- 主题外观 ---------- */
/**
 * 主题类名：游戏分包自带一套侘寂暖色配色（见 styles/themes.wxss 的 .tk.theme-*）
 * 这里读取主包在 Storage('theme') 中保存的主题键，映射到分包的四套配色。
 * 不 import 主包 theme.ts —— 分包应保持自洽，避免跨包依赖导致分包无法独立编译。
 * 映射规则：主包深色/冷色调主题一律落到 ink（墨韵），暖色调落到 warm，其余走默认。
 */
const THEME_MAP = {
  light: 'theme-warm',
  dark: 'theme-ink',
  rose: 'theme-ink',
  forest: 'theme-qing',
  twilight: 'theme-ink',
  custom: 'theme-warm'
};

function themeClass() {
  let key = 'light';
  try {
    const v = wx.getStorageSync('theme');
    if (typeof v === 'string' && v) key = v;
  } catch (e) { /* 读取失败走默认 */ }
  return THEME_MAP[key] || 'theme-warm';
}

/* ---------- 错题本 ---------- */
function getWrongBook(id) { return read('games_wrong_' + id, []); }
function addWrong(id, item) {
  const list = getWrongBook(id);
  if (!list.some((x) => x.qid === item.qid)) list.push(item);
  write('games_wrong_' + id, list);
  return list;
}
function clearWrong(id) { write('games_wrong_' + id, []); }

module.exports = {
  getGlobal, getGame, recordPlay, finishRound, clearAll, formatTime,
  addPoints, consumeHint, getHintState, HINT_COST,
  getWrongBook, addWrong, clearWrong,
  themeClass
};
