// scripts/check-nav-routing.js
// 路由健壮性静态守卫 —— 专治「点了没反应 / 跳转静默失败」。
//
// 为什么需要它：
//   小程序的路由失败是**完全静默**的。目标页没注册、页面栈满、URL 拼错，
//   三者都只让点击「什么都没发生」，不报错、不提示，靠人肉点根本测不出来。
//   项目已有 utils/nav.ts 统一跳转层（栈深预检 + 防连点 + 三级兜底），
//   但只要有人绕过它写一句裸 wx.navigateTo，保护就全丢了 —— 而且没人会发现。
//
// 三条规则：
//   1) 除 utils/nav.ts 外，禁止直接调用 wx.navigateTo / redirectTo / reLaunch；
//      项目未配 tabBar 时，wx.switchTab 同样禁止（它只能跳 tabBar 页，必定失败）；
//      将来补上 tabBar，脚本会自动放行 switchTab。
//   2) go() / replace() / relaunch() 的路径字面量必须已在 app.json 注册
//   3) 外跳小程序 wx.navigateToMiniProgram 的调用点必须有 fail 降级兜底
//      （纠错：早期这里查「appId 是否写进 app.json 的 navigateToMiniProgramAppIdList」，
//        那是**错误规则** —— 该字段从来不是 app.json 合法配置，基础库 3.x 会报
//        invalid app.json ["navigateToMiniProgramAppIdList"]。白名单实际配在
//        微信公众平台后台，代码侧管不着；真正会出事的是"用户点了没反应"。）
//
// 用法：node scripts/check-nav-routing.js
// 退出码：0 = 全通过；1 = 有失败

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const APP_JSON = path.join(MP, 'app.json');
const NAV_TS = path.join(MP, 'utils', 'nav.ts');

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

/** 递归收集所有 .ts 源码（跳过 node_modules 与类型声明文件） */
function walk(dir, out) {
  const acc = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

/** 剥掉注释，避免注释里的示例代码被误报 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ==================== 注册表 ==================== */

const app = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
const registered = new Set();
(app.pages || []).forEach((p) => registered.add('/' + p));
const subs = app.subpackages || app.subPackages || [];
subs.forEach((s) => (s.pages || []).forEach((p) => registered.add('/' + s.root + '/' + p)));

const files = walk(MP, []);
console.log('扫描 ' + files.length + ' 个 TS 源文件，app.json 共注册 ' + registered.size + ' 个页面');

/* ==================== 规则 1：禁止绕过统一跳转层 ==================== */

section('1. 禁止绕过 utils/nav.ts 的裸路由调用');

// switchTab 是跳 tabBar 页的唯一方式，本身没错；
// 但本项目 app.json 没有 tabBar，任何 switchTab 都必定失败（"can not switch to no-tabBar page"）
// → 等同于裸路由，还会连带触发 nav 层兜底，短时间内连发多次路由。
// 若将来补上 tabBar，这里会自动放行。
const HAS_TABBAR = !!(app.tabBar && Array.isArray(app.tabBar.list) && app.tabBar.list.length);
const BANNED = HAS_TABBAR
  ? ['navigateTo', 'redirectTo', 'reLaunch']
  : ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab'];
const RAW_CALL = new RegExp('\\bwx\\.(' + BANNED.join('|') + ')\\s*\\(', 'g');
console.log('  项目 tabBar：' + (HAS_TABBAR ? '有（switchTab 放行）' : '无（switchTab 视为裸路由）'));

const bare = [];
files.forEach((f) => {
  if (f === NAV_TS) return; // 统一层自己就是干这个的
  const code = stripComments(fs.readFileSync(f, 'utf8'));
  const hits = [...new Set([...code.matchAll(RAW_CALL)].map((m) => m[1]))];
  if (hits.length) bare.push(path.relative(ROOT, f) + ' → wx.' + hits.join(' / wx.'));
});
ok('没有裸路由调用', bare.length === 0, bare.join(' | '));

/* ==================== 规则 2：路由目标必须已注册 ==================== */

section('2. go / replace / relaunch 的目标必须已在 app.json 注册');

// 前置断言：go|replace|relaunch 前不能是 . 或标识符字符，否则会误吃 "str".replace(...)
const NAV_CALL = /(?<![.\w$])(?:go|replace|relaunch)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const missing = [];
const dynamic = [];
let literalCount = 0;

files.forEach((f) => {
  const rel = path.relative(ROOT, f);
  const code = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of code.matchAll(NAV_CALL)) {
    const raw = m[2];
    if (!raw.startsWith('/')) continue; // 只认绝对路径
    literalCount += 1;
    const noQuery = raw.split('?')[0];
    // 路径中段含插值 → 无法静态判定，列出来人工确认
    if (noQuery.includes('${')) {
      dynamic.push(rel + ' :: ' + raw);
      continue;
    }
    if (!registered.has(noQuery)) missing.push(rel + ' :: ' + raw);
  }
});

ok('不存在指向未注册页面的路由（' + literalCount + ' 处绝对路径）', missing.length === 0, missing.join(' | '));
console.log('  ℹ️  含插值的动态路径 ' + dynamic.length + ' 处（人工确认）');
dynamic.slice(0, 8).forEach((d) => console.log('      · ' + d));
if (dynamic.length > 8) console.log('      · …另有 ' + (dynamic.length - 8) + ' 处');

/* ==================== 规则 3：外跳 appId 必须有降级兜底 ====================
 *
 * 【重要更正】早期版本这里校验「appId 是否写进 app.json 的 navigateToMiniProgramAppIdList」，
 * 这是**错误规则**：该字段从来不是 app.json 的合法配置，基础库 3.x 会直接报
 *   invalid app.json ["navigateToMiniProgramAppIdList"]
 * 真实约束是：白名单配在**微信公众平台后台**（代码里管不着），且必须用户点击触发、
 * 有确认弹窗（用户取消 → fail cancel）。因此代码侧唯一能查、也最容易出事的是
 * **外跳失败后有没有兜底** —— 用户点一下没反应是最典型的体验事故。
 * 下面校验：每个 appId 字面量所在调用点附近是否有 fail 兜底。
 */

section('3. 外跳小程序的 appId 调用点必须有 fail 降级兜底');

const APPID_LITERAL = /\bappId\s*[:=]\s*(['"])(w[a-zA-Z0-9]{15,})\1/g;
const declared = new Map();
const noFallback = [];

files.forEach((f) => {
  const code = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of code.matchAll(APPID_LITERAL)) {
    const id = m[2];
    if (!declared.has(id)) declared.set(id, path.relative(ROOT, f));

    // 从该 appId 出现位置往后 500 字符内找降级：fail 回调 / wx.setClipboardData / wx.showToast
    const tail = code.slice(m.index, m.index + 500);
    const hasFallback = /fail\s*[:(]/.test(tail)
      || /setClipboardData/.test(tail)
      || /showToast|showModal/.test(tail)
      || /shortLink/.test(tail);
    if (!hasFallback) {
      noFallback.push(id + '（' + path.relative(ROOT, f) + '）');
    }
  }
});

ok(
  '外跳调用点均有降级兜底（共 ' + declared.size + ' 个 appId 字面量）',
  noFallback.length === 0,
  noFallback.join(' | ')
);
console.log('  ℹ️  appId 白名单需在小程序后台配置（不在代码里）：' + [...declared.keys()].join(', '));


/* ==================== 收尾 ==================== */

console.log('\n' + '='.repeat(52));
console.log('路由健壮性守卫：' + pass + ' 通过 / ' + fail + ' 失败');
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  · ' + f));
}
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
