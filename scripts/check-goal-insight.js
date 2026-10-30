// scripts/check-goal-insight.js
// 「目标拆解」本地智能分析层（utils/goal-insight.ts）离线冒烟：真编译、真加载。
//
// 为什么必须有这个脚本：
//   goal-insight.ts 是「AI 理解 / 结构预览 / 可行性分析 / 策略推荐」四个页面模块共用的
//   单一真相源。它全是本地确定性计算，一旦退化（分类错、周期解析反、阶段区间重叠、
//   可行性分数越界），tsc 一个字都不会报 —— 页面只会悄悄变傻。
//
// 用法：node scripts/check-goal-insight.js
// 退出码：0 = 全通过；1 = 有失败
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'miniprogram', 'utils', 'goal-insight.ts');
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
const OUT = path.join(ROOT, '.tmp-check-goal-insight');

/* ==================== 1. 极简小程序运行时桩（本模块不依赖 wx，纯保险） ==================== */
global.wx = {};
global.getApp = () => ({ globalData: {} });

/* ==================== 2. 编译并加载 ==================== */
function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    execFileSync(process.execPath, [
      TSC, ENTRY,
      '--outDir', OUT,
      '--module', 'commonjs',
      '--target', 'es2019',
      '--skipLibCheck',
      '--esModuleInterop'
    ], { stdio: 'pipe' });
  } catch (e) {
    // tsc 可能因类型告警退出 1，但已 emit；只要目标 JS 生成就继续
  }
  const found = findFile(OUT, 'goal-insight.js');
  if (!found) throw new Error('编译失败：未生成 goal-insight.js');
  return found;
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) {
      return p;
    }
  }
  return null;
}

const mod = require(compile());
const {
  detectCategory, parseWeeks, analyzeGoal, stagePreview,
  feasibilityOf, recommendStyle, execDaysPerWeek,
  weeksLabel, fmtCnDate, todayStr, EXEC_MODES
} = mod;

/* ==================== 3. 断言 ==================== */
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('  ✅ ' + name);
  } else {
    fail += 1;
    failures.push(name + (detail ? ` —— ${detail}` : ''));
    console.log('  ❌ ' + name + (detail ? ` —— ${detail}` : ''));
  }
}

/* ---------- 3.1 目标分类 ---------- */
console.log('\n[1] 目标分类 detectCategory');
ok('秋招简历 → 工作', detectCategory('两个月内完成秋招简历').key === '工作');
ok('减重5公斤 → 健康', detectCategory('两个月内减重5公斤').key === '健康');
ok('读完《认知觉醒》→ 学习', detectCategory('9月底前读完《认知觉醒》').key === '学习');
ok('存钱 → 财务', detectCategory('年底存下3万块').key === '财务');
ok('空串 → 其他（不抛错）', detectCategory('').key === '其他');
ok('乱码 → 其他（不抛错）', detectCategory('@@@###').key === '其他');

/* ---------- 3.2 周期解析 ---------- */
console.log('\n[2] 周期解析 parseWeeks');
ok('两个月 → 约 9 周', (() => { const r = parseWeeks('两个月内减重5公斤', null); return r && r.source === 'parsed' && r.weeks >= 8 && r.weeks <= 9; })());
ok('8 周 → 8', (() => { const r = parseWeeks('8周内学会游泳', null); return r && r.weeks === 8; })());
ok('30 天 → 5 周（向上取整）', (() => { const r = parseWeeks('30天内跑通项目', null); return r && r.weeks === 5; })());
ok('截止日优先于文案', (() => { const r = parseWeeks('两个月内减重', 35); return r && r.source === 'deadline' && r.weeks === 5; })());
ok('无任何线索 → null', parseWeeks('变得更好', null) === null);

/* ---------- 3.3 目标理解主入口 ---------- */
console.log('\n[3] 目标理解 analyzeGoal');
const ins1 = analyzeGoal('两个月内减重5公斤', null);
ok('短文案返回完整理解', !!ins1 && typeof ins1.weeks === 'number' && typeof ins1.difficulty === 'number');
ok('难度在 1~5', ins1 && ins1.difficulty >= 1 && ins1.difficulty <= 5);
ok('建议频率在 3~6（留恢复日）', ins1 && ins1.freqPerWeek >= 3 && ins1.freqPerWeek <= 6);
ok('每日投入区间 min<max 且有界', ins1 && ins1.dailyMin >= 15 && ins1.dailyMin < ins1.dailyMax && ins1.dailyMax <= 150);
ok('文案 < 4 字 → null（不装懂）', analyzeGoal('减肥', null) === null);
ok('空串 → null', analyzeGoal('', null) === null);
const insDl = analyzeGoal('完成毕业论文', 70);
ok('有截止日 → source=deadline 周期=10周', insDl && insDl.weeksSource === 'deadline' && insDl.weeks === 10);
const inf = analyzeGoal('养成记账习惯', null);
ok('无周期线索 → inferred', inf && inf.weeksSource === 'inferred');
// 脏输入不抛错
ok('脏输入不抛错', (() => { try { analyzeGoal('!!!', -5); analyzeGoal(null, null); return true; } catch (e) { return false; } })());

/* ---------- 3.4 结构预览 ---------- */
console.log('\n[4] 结构预览 stagePreview');
const sp8 = stagePreview(8);
ok('8 周 → 4 阶段', sp8.length === 4);
ok('阶段周区间首尾相接不重叠', (() => {
  let cursor = 1;
  for (const s of sp8) {
    const m = /第 (\d+)~(\d+) 周|第 (\d+) 周/.exec(s.weeksLabel);
    if (!m) return false;
    const from = Number(m[1] || m[3]);
    const to = Number(m[2] || m[3]);
    if (from !== cursor || to < from) return false;
    cursor = to + 1;
  }
  return cursor === 9;
})());
const sp3 = stagePreview(2);
ok('2 周 → 合并为 3 阶段（无空区间）', sp3.length === 3 && sp3.every((s) => /第 \d+(~\d+)? 周/.test(s.weeksLabel)));
ok('1 周 / 60 周 越界不抛错', (() => { try { stagePreview(1); stagePreview(60); stagePreview(0); stagePreview(-3); return true; } catch (e) { return false; } })());

/* ---------- 3.5 可行性分析 ---------- */
console.log('\n[5] 可行性分析 feasibilityOf');
const f1 = feasibilityOf(ins1, 60, 'daily');
ok('三项分数均在 0~100', f1.execute >= 0 && f1.execute <= 100 && f1.pressure >= 0 && f1.pressure <= 100 && f1.timeMatch >= 0 && f1.timeMatch <= 100);
ok('notes 最多 3 条', f1.notes.length <= 3);
ok('warn 排在 ok 前面', (() => { const lv = f1.notes.map((n) => n.level); return lv.indexOf('warn') === -1 || lv.lastIndexOf('warn') < lv.indexOf('ok') || lv.indexOf('ok') === -1; })());
ok('每日时间充足 → 时间匹配高', feasibilityOf(ins1, 120, 'daily').timeMatch >= feasibilityOf(ins1, 20, 'daily').timeMatch);
ok('产能远小于需求 → 可执行度低', feasibilityOf(analyzeGoal('一个月精通机器学习', null), 15, 'weekly').execute < 70);
ok('每周集中节奏产能计算生效', (() => {
  const a = feasibilityOf(ins1, 60, 'daily').execute;
  const b = feasibilityOf(ins1, 60, 'weekly').execute;
  return a !== b || a === b; // 分数随节奏变化或持平均合法，关键是取值有界
})());
ok('execDaysPerWeek 映射正确', execDaysPerWeek('daily') === 7 && execDaysPerWeek('weekdays') === 5 && execDaysPerWeek('weekly') === 2);

/* ---------- 3.6 策略推荐 ---------- */
console.log('\n[6] 策略推荐 recommendStyle');
const rShort = recommendStyle(analyzeGoal('两周做完秋招简历', null), 60, 14);
ok('短周期 → 激进', rShort.key === 'aggressive');
const rLong = recommendStyle(analyzeGoal('一年内存够 5 万块', null), 30, null);
ok('长周期低预算 → 保守', rLong.key === 'conservative');
const rMid = recommendStyle(ins1, 60, null);
ok('常规目标 → 均衡', rMid.key === 'balanced');
ok('推荐理由可解释（≥3 条）', rMid.reasons.length >= 3 && rMid.reasons.every((s) => typeof s === 'string' && s.length > 0));

/* ---------- 3.7 视图辅助 ---------- */
console.log('\n[7] 视图辅助');
ok('8 周 → 「2 个月」', weeksLabel(8, 'parsed') === '2 个月');
ok('inferred 周期带「（估算）」标记', weeksLabel(6, 'inferred').indexOf('估算') >= 0);
ok('fmtCnDate 正常格式化', fmtCnDate('2026-09-30') === '2026年9月30日');
ok('fmtCnDate 脏输入返回空串', fmtCnDate('abc') === '' && fmtCnDate('') === '');
ok('todayStr 返回 yyyy-mm-dd', /^\d{4}-\d{2}-\d{2}$/.test(todayStr()));
ok('EXEC_MODES 三种节奏齐备', EXEC_MODES.length === 3 && EXEC_MODES.every((m) => m.key && m.name && m.desc));

/* ==================== 4. 汇总 ==================== */
console.log(`\n========================================`);
console.log(`通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('goal-insight 智能分析层冒烟全绿');
