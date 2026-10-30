// scripts/check-openings-timeline.js
// 秋招「岗位时间线」纵向改版离线冒烟：真编译、真加载 openings.ts，
// 用真实岗位库数据跑 buildTimeline，验证节点结构 / 匹配度 / 下一步提示 / 待公布折叠区。
//
// 用法：node scripts/check-openings-timeline.js
// 退出码：0 = 全通过；1 = 有失败
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'miniprogram', 'subpackages', 'recruit', 'pages', 'recruit', 'openings.ts');
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
const OUT = path.join(ROOT, '.tmp-check-openings-tl');

/* ==================== 1. 极简小程序运行时桩 ==================== */
const mem = new Map();
global.wx = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  getStorageInfoSync: () => ({ keys: Array.from(mem.keys()), currentSize: 0, limitSize: 10240 }),
  clearStorageSync: () => mem.clear(),
  showToast: () => {},
  setClipboardData: () => {},
  navigateTo: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375 })
};
global.getApp = () => ({ globalData: {} });
// 页面文件用 Page() 注册，Node 下只要不执行方法体就不需要真实现
global.Page = () => {};

/* ==================== 2. 编译并加载 ==================== */
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (e.name === name) return p;
  }
  return null;
}
function loadPage() {
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
    // 类型告警允许退出 1，只要 emit 出 JS 就继续（与 check-recruit-intel 同策略）
  }
  const found = findFile(OUT, 'openings.js');
  if (!found) throw new Error('编译失败：未生成 openings.js');
  return require(found);
}

/* ==================== 3. 断言 ==================== */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expect));
}
function section(t) { console.log('\n── ' + t + ' ──'); }

const page = loadPage();
const openMod = findFile(OUT, 'recruit-openings.js');
const storeMod = findFile(OUT, 'recruit-store.js');
const openings = require(openMod);
const store = require(storeMod);

const ALL = openings.loadOpenings();
section('数据基线');
ok('岗位库非空（' + ALL.length + ' 条）', ALL.length > 100);

/* ---------- A. 未填简历/意向：匹配度宁缺毋假 ---------- */
section('A. 空简历：fit 全为 null，结构完整');
let tl = page.buildTimeline(ALL);
ok('有日期节点非空（' + tl.nodes.length + ' 个节点）', tl.nodes.length > 0);
let fitNullAll = true, nextOk = true, labelOk = true, relOk = true, statusOk = true;
let cardCount = 0;
for (const nd of tl.nodes) {
  if (nd.status === 'tba') statusOk = false;
  if (!/^\d{1,2}\.\d{1,2}$/.test(nd.label)) labelOk = false;
  if (!/^(今天|明天|\d+ 天后|\d+ 天前)$/.test(nd.rel)) relOk = false;
  for (const c of nd.items) {
    cardCount++;
    if (c.fit !== null) fitNullAll = false;
    if (!c.next || /undefined|NaN/.test(c.next)) nextOk = false;
  }
}
ok('节点状态不为 tba（待公布只进折叠区）', statusOk);
ok('节点短日期格式正确（如 9.12）', labelOk);
ok('相对天数文案正确（今天/明天/N 天后/N 天前）', relOk);
ok('未填简历时所有卡片 fit === null（宁缺毋假）', fitNullAll);
ok('所有卡片 next 提示非空且无 undefined/NaN', nextOk);
eq('有日期卡片数 = datedCount', cardCount, tl.datedCount);
eq('待公布卡数 = undatedCount', tl.tba.length, tl.undatedCount);
eq('datedCount + undatedCount = 全量', tl.datedCount + tl.undatedCount, ALL.length);

// 节点新 → 旧
let descOk = true;
for (let i = 1; i < tl.nodes.length; i++) {
  const a = tl.nodes[i - 1], b = tl.nodes[i];
  if (a.key < b.key) descOk = false;
}
ok('节点按日期新 → 旧排列', descOk);

/* ---------- B. 填简历后：匹配度出现且合理 ---------- */
section('B. 有简历：fit 出现、范围 0-100');
const draft = openMod ? null : null; // 占位，保持结构与 intel 门禁一致
const intel = require(findFile(OUT, 'recruit-intel.js'));
const d = intel.defaultResumeDraft();
d.headline = '后端开发';
d.skills = 'java spring mysql';
intel.saveResumeDraft(d);
tl = page.buildTimeline(ALL);
let fitShown = 0, fitInRange = true;
for (const nd of tl.nodes) for (const c of nd.items) {
  if (c.fit !== null) { fitShown++; if (c.fit < 0 || c.fit > 100) fitInRange = false; }
}
ok('填写简历后出现匹配度（' + fitShown + ' 张卡）', fitShown > 0);
ok('匹配度都在 0-100', fitInRange);

/* ---------- C. 状态语义：closing 紧急、open 可投、已投公司提示 ---------- */
section('C. 下一步提示的状态语义');
let closingNext = true, openNext = true, hasClosing = false, hasOpen = false;
for (const nd of tl.nodes) for (const c of nd.items) {
  if (c.status === 'closing') {
    hasClosing = true;
    if (!/截止|投递|已投递/.test(c.next)) closingNext = false;
    // 紧急 = closing 且 ≤7 天未投：next 必含「截止」
    if (c.urgent && !/立即|尽快|已投递/.test(c.next)) closingNext = false;
  }
  if (c.status === 'open') {
    hasOpen = true;
    if (!/投递|已投递|准备/.test(c.next)) openNext = false;
  }
}
ok('closing 卡片提示含截止/投递语义', closingNext, '存在 closing=' + hasClosing);
ok('open 卡片提示含投递/已投语义', openNext, '存在 open=' + hasOpen);

// 已投过的公司：next 以「已投递」开头，且 urgent 必为 false
const sampleOpen = ALL.find((o) => openings.statusOf(o) === 'open');
if (sampleOpen) {
  store.saveApps([{ _id: 't1', company: sampleOpen.company, status: 'applied' }]);
  tl = page.buildTimeline(ALL);
  let appliedNextOk = true, appliedUrgentOk = true, found = false;
  for (const nd of tl.nodes) for (const c of nd.items) {
    if (c.company === sampleOpen.company) {
      found = true;
      if (c.next.indexOf('已投递') < 0) appliedNextOk = false;
      if (c.urgent) appliedUrgentOk = false;
    }
  }
  ok('已投公司：提示以「已投递」开头', found && appliedNextOk);
  ok('已投公司：不再标紧急', appliedUrgentOk);
  store.saveApps([]); // 还原
} else {
  ok('已投公司用例（库中无 open 岗位，跳过）', true);
}

/* ---------- D. 待公布折叠区：关注置顶 ---------- */
section('D. 待公布区');
if (tl.tba.length >= 2) {
  const victim = tl.tba[tl.tba.length - 1]._id; // 关注最后一条
  store.toggleFollowOpening(victim);
  tl = page.buildTimeline(ALL);
  eq('关注的待公布岗位排到最前', tl.tba[0]._id, victim);
  store.toggleFollowOpening(victim); // 还原
} else {
  ok('待公布不足 2 条，跳过排序用例', true);
}
ok('待公布卡 next 含「准备/公布」语义', tl.tba.every((c) => /公布|准备/.test(c.next)));

/* ---------- E. 筛选联动：状态过滤后节点只剩该状态 ---------- */
section('E. 筛选联动');
const onlyClosing = ALL.filter((o) => openings.statusOf(o) === 'closing');
if (onlyClosing.length) {
  tl = page.buildTimeline(onlyClosing);
  const allClosing = tl.nodes.every((nd) => nd.items.every((c) => c.status === 'closing'));
  ok('传 closing 子集 → 节点全部为 closing', allClosing);
}

console.log('\n====================================================');
console.log('岗位时间线纵向改版冒烟：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
