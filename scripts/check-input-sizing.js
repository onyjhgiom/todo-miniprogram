// scripts/check-input-sizing.js
// 表单控件静态守卫 —— 专治「输入框里的文字 / 占位文案被裁掉」，以及「占位文案样式静默失效」。
//
// 为什么需要它：
//   微信原生 <input> 自带一个默认高度（约 1.4rem）。若同时写了
//       box-sizing: border-box  +  竖向 padding  +  不给 height
//   竖向 padding 会把内容区压到几 rpx，占位文字与输入内容被直接裁掉半截。
//   —— 这种缺陷 tsc 查不出、preflight 查不出、真机也只有「字少了一半」，
//   肉眼很容易当成主题/字号问题放过去。2026-09-19 实测命中 7 处（行程表单 3 处、
//   深空输入框 3 处、卦象数字框 1 处的 padding 甚至已大于原生高度）。
//
//   对照组：同页的 <view> / <picker> 内层（content-box，padding 正常撑高）一直没事，
//   所以只看截图很难意识到差异出在 <input> 这个原生组件上。
//
// 两条规则：
//   1) 原生 <input> 不得「border-box + 竖向 padding + 无 height/min-height」；
//      （<textarea> 是例外：多行需要行内留白，且靠 min-height 撑高，不在此列）
//   2) wxml 里 placeholder-class 引用的类必须真实存在于该页（含 @import）的 wxss 中，
//      否则占位样式静默失效 —— 不报错、看截图才发现深色主题下灰得看不见。
//
// 用法：node scripts/check-input-sizing.js
// 退出码：0 = 全通过；1 = 有失败

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('  ✅ ' + name);
  } else {
    fail += 1;
    failures.push(name + (detail ? ' —— ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? ' —— ' + detail : ''));
  }
}

function section(title) {
  console.log('\n── ' + title + ' ──');
}

/* ==================== 文件遍历 ==================== */

function walk(dir, out) {
  const acc = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/**
 * 解析 @import 的目标路径。
 * 注意两种写法都要支持：相对路径（../../styles/x.wxss）与小程序根绝对路径（/styles/x.wxss）。
 */
function resolveImport(fromFile, spec) {
  if (spec.charAt(0) === '/') return path.join(MP, spec.slice(1));
  return path.resolve(path.dirname(fromFile), spec);
}

/**
 * 读取 wxss 并递归展开 @import。
 * 两个必须踩对的点：
 *   ① 递归展开 —— 共享样式里的缺陷要能落到具体页面上（astro-common / tool-shell 都是这么用的）；
 *   ② 先剥注释再找 @import —— 否则注释里写的 "@import xxx.wxss" 会被当成真实依赖。
 */
function loadWxss(file, seen) {
  const visited = seen || new Set();
  if (visited.has(file) || !fs.existsSync(file)) return '';
  visited.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const noComment = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let imported = '';
  for (const m of noComment.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    imported += '\n' + loadWxss(resolveImport(file, m[1]), visited);
  }
  return noComment + imported;
}

/** 解析出全部 {sel, body}；不做完整 CSS 解析，够用且不会因嵌套写法漏掉规则 */
function parseRules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: m[1].trim(), body: m[2] });
  }
  return out;
}

/** 取规则声明的竖向 padding 最大值（rpx），0 表示没有竖向内边距 */
function verticalPad(body) {
  const num = (x) => {
    const m = /^(-?[\d.]+)rpx/.exec(String(x || '').trim());
    return m ? parseFloat(m[1]) : 0;
  };
  let v = 0;
  const sh = body.match(/(?:^|;)\s*padding\s*:\s*([^;]+)/);
  if (sh) {
    const p = sh[1].trim().split(/\s+/);
    v = Math.max(num(p[0] || '0'), num(p[2] !== undefined ? p[2] : p[0] || '0'));
  }
  const top = body.match(/(?:^|;)\s*padding-top\s*:\s*([^;]+)/);
  const bottom = body.match(/(?:^|;)\s*padding-bottom\s*:\s*([^;]+)/);
  return Math.max(v, num(top && top[1]), num(bottom && bottom[1]));
}

/** 规则的 body 是否声明了非零的 height / min-height */
function hasExplicitHeight(body) {
  return /(?:^|;)\s*(?:min-)?height\s*:\s*[^;]*?[1-9]/.test(body);
}

/** 选择器里是否直接命中某个类名（避免 .foo 命中 .foo-bar） */
function selectorHasClass(sel, cls) {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp('\\.' + escaped + '(?![\\w-])').test(sel);
}

/* ==================== 采集 ==================== */

const wxmls = walk(MP, []).filter((f) => f.endsWith('.wxml'));
console.log('扫描 ' + wxmls.length + ' 个 wxml');

/* app.wxss 及其 @import 是**全局**样式，对所有页面生效。
 * 必须并进来，否则会误报：例如 .muted-3 定义在 app.wxss 导入的 styles/common.wxss 里，
 * 页面自身的 wxss 当然找不到它，但它确实是有效的。 */
const globalRules = parseRules(loadWxss(path.join(MP, 'app.wxss')));
console.log('全局样式（app.wxss + @import）共 ' + globalRules.length + ' 条规则');

const clipHits = []; // 规则 1
const deadPhClass = []; // 规则 2
let inputCount = 0;
let phRefCount = 0;

for (const wxml of wxmls) {
  const rel = path.relative(ROOT, wxml);
  const src = fs.readFileSync(wxml, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const rules = globalRules.concat(
    parseRules(loadWxss(wxml.replace(/\.wxml$/, '.wxss')))
  );

  /* ---- 规则 1：原生 <input> 的定高 ---- */
  const inputClasses = new Set();
  for (const m of src.matchAll(/<input\b[^>]*>/g)) {
    inputCount += 1;
    const cm = /class\s*=\s*"([^"]*)"/.exec(m[0]);
    if (cm) cm[1].split(/\s+/).filter(Boolean).forEach((c) => inputClasses.add(c));
  }

  for (const cls of inputClasses) {
    const matched = rules.filter((r) => selectorHasClass(r.sel, cls));
    const borderBox = matched.some((r) => /box-sizing\s*:\s*border-box/.test(r.body));
    const sized = matched.some((r) => hasExplicitHeight(r.body));
    const vpad = matched.reduce((mx, r) => Math.max(mx, verticalPad(r.body)), 0);
    if (borderBox && !sized && vpad > 0) {
      clipHits.push(rel + '  .' + cls + '（竖向 padding ' + vpad + 'rpx，无 height）');
    }
  }

  /* ---- 规则 2：placeholder-class 必须真实存在 ---- */
  const allSeen = new Set();
  rules.forEach((r) => {
    for (const m of r.sel.matchAll(/\.([A-Za-z_][\w-]*)/g)) allSeen.add(m[1]);
  });
  for (const m of src.matchAll(/<input\b[^>]*>/g)) {
    const pm = /placeholder-class\s*=\s*"([^"]*)"/.exec(m[0]);
    if (!pm) continue;
    for (const cls of pm[1].split(/\s+/).filter(Boolean)) {
      phRefCount += 1;
      // 允许动态类名（含 {{ }}）与组件内类，静态字面量才校验
      if (cls.includes('{')) continue;
      if (!allSeen.has(cls)) deadPhClass.push(rel + '  .' + cls);
    }
  }
}

console.log('共发现 ' + inputCount + ' 个原生 <input>、' + phRefCount + ' 处 placeholder-class 引用');

/* ==================== 判定 ==================== */

section('1. 原生 <input> 必须显式定高（否则文字被竖向 padding 裁掉）');
ok(
  '不存在「border-box + 竖向 padding + 无 height」的输入框',
  clipHits.length === 0,
  clipHits.join(' | ')
);

section('2. placeholder-class 引用的类必须存在（否则占位样式静默失效）');
ok(
  '没有指向不存在类的 placeholder-class（校验范围：本页 wxss + @import + app.wxss 全局）',
  deadPhClass.length === 0,
  deadPhClass.join(' | ')
);

/* ==================== 收尾 ==================== */

console.log('\n' + '='.repeat(52));
console.log('表单控件守卫：' + pass + ' 通过 / ' + fail + ' 失败');
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  · ' + f));
  console.log('\n修法：给该 <input> 显式 height（如 88rpx），并把竖向 padding 归零、只留横向。');
  console.log('      <textarea> 不受此限（多行需要行内留白，靠 min-height 撑高）。');
}
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
