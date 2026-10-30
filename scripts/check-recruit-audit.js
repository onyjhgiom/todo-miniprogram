// scripts/check-recruit-audit.js —— 秋招助手模块专项静态审计
//
// 目的：找出「点了没反应」「渲染出 undefined」这类运行时才暴露的问题。
//   1) wxml 里 bind*/catch* 绑定的方法，在对应 .ts 里是否存在（不存在 = 点击报错或静默失效）
//   2) wxml 里 {{}} 引用的数据字段，是否在 data 初始值或 setData 里出现过（未出现 = 渲染空白/undefined）
//   3) .ts 里定义但 wxml 从未绑定的方法（死代码，提示清理）
//   4) json 页面文件是否齐备（四件套）
//
// 用法：node scripts/check-recruit-audit.js
// 退出码：0 无高危问题 / 1 有高危问题（缺 handler）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RECRUIT = path.join(ROOT, 'miniprogram', 'subpackages', 'recruit', 'pages', 'recruit');
const CIVIL = path.join(ROOT, 'miniprogram', 'subpackages', 'tools', 'pages', 'civil');

const targets = [];
for (const dir of [RECRUIT, CIVIL]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.wxml')) targets.push(path.join(dir, f.replace(/\.wxml$/, '')));
  }
}

let blockers = 0;
let warns = 0;

for (const base of targets) {
  const name = path.relative(ROOT, base).replace(/\\/g, '/');
  const wxml = fs.existsSync(base + '.wxml') ? fs.readFileSync(base + '.wxml', 'utf8') : '';
  const ts = fs.existsSync(base + '.ts') ? fs.readFileSync(base + '.ts', 'utf8') : '';
  const four = ['.wxml', '.ts', '.json', '.wxss'].filter((ext) => !fs.existsSync(base + ext));

  console.log('\n── ' + name + ' ──');
  if (four.length) { console.log('  [高危] 缺少四件套文件：' + four.join(' ')); blockers++; }
  if (!wxml || !ts) continue;

  // 1) 事件绑定 → 方法是否存在
  const bound = new Set();
  const bindRe = /\b(?:bind|catch|capture-bind|capture-catch)[:]?([a-zA-Z]+)\s*=\s*"([^"{}][^"]*)"/g;
  let m;
  while ((m = bindRe.exec(wxml))) {
    const method = m[2].trim();
    if (!method) continue;
    bound.add(method);
  }
  const missing = [];
  for (const method of bound) {
    // 支持 Page 对象方法定义、以及 `方法名(` 形式
    const defined =
      new RegExp('(^|[\\s{,])(async\\s+)?' + method + '\\s*\\(').test(ts) ||
      new RegExp('\\b' + method + '\\s*:\\s*(async\\s+)?function').test(ts);
    if (!defined) missing.push(method);
  }
  if (missing.length) {
    console.log('  [高危] wxml 绑定但 ts 未定义：' + missing.join(', '));
    blockers += missing.length;
  }

  // 2) wxml 引用的顶层字段是否在 ts 里出现
  const fields = new Set();
  const mustacheRe = /\{\{([^}]*)\}\}/g;
  while ((m = mustacheRe.exec(wxml))) {
    const expr = m[1];
    const idRe = /[a-zA-Z_$][\w$]*/g;
    let t;
    while ((t = idRe.exec(expr))) {
      const word = t[0];
      // 跳过字面量关键字与 wx:for 的局部变量
      if (['true', 'false', 'null', 'undefined', 'item', 'index', 'true', 'length', 'indexOf'].includes(word)) continue;
      // 跳过属性访问 obj.prop 中的 prop
      const before = expr.slice(0, t.index).trimEnd();
      if (before.endsWith('.') || before.endsWith('?')) continue;
      fields.add(word);
    }
  }
  const unknown = [];
  for (const f of fields) {
    const re = new RegExp('\\b' + f.replace(/\$/g, '\\$') + '\\b');
    if (!re.test(ts)) unknown.push(f);
  }
  if (unknown.length) {
    console.log('  [提示] wxml 引用但 ts 中没有出现的字段（可能是 wx:for 局部变量或内联常量）：' + unknown.join(', '));
    warns += unknown.length;
  }

  // 3) ts 中定义但 wxml 未绑定的页面方法（死代码）
  const methodRe = /^\s{2}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm;
  const declared = new Set();
  while ((m = methodRe.exec(ts))) declared.add(m[1]);
  const lifecycle = new Set(['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh',
    'onReachBottom', 'onShareAppMessage', 'onShareTimeline', 'onPageScroll', 'onResize', 'onAddToFavorites',
    'onTabItemTap', 'onSaveExitState', 'onRouteDone']);
  const dead = [];
  for (const d of declared) {
    if (lifecycle.has(d)) continue;
    if (!wxml.includes(d)) dead.push(d);
  }
  if (dead.length) {
    console.log('  [提示] ts 中定义但 wxml 未绑定的方法：' + dead.join(', '));
    warns += dead.length;
  }
}

console.log('\n' + '='.repeat(52));
console.log('秋招模块审计：' + targets.length + ' 个页面，高危 ' + blockers + ' 项，提示 ' + warns + ' 项');
console.log('='.repeat(52));
process.exit(blockers ? 1 : 0);
