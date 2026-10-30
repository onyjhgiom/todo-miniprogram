'use strict';

/**
 * 课表皮肤校验：变量覆盖完整性 + 对比度 + 亮度差 + 元数据一致性
 * 运行：node test/theme-check.js
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var WXSS = path.join(ROOT, 'styles', 'themes.wxss');

var pass = 0;
var fail = 0;
var problems = [];

function ok(name) { pass += 1; }
function bad(name, detail) {
  fail += 1;
  problems.push(name + (detail ? '  → ' + detail : ''));
}

/* ---------------- 颜色工具 ---------------- */

function srgbToLin(c) {
  var v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function parseHex(hex) {
  if (!hex || hex.charAt(0) !== '#') return null;
  var h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function luminance(hex) {
  var c = parseHex(hex);
  if (!c) return null;
  return 0.2126 * srgbToLin(c.r) + 0.7152 * srgbToLin(c.g) + 0.0722 * srgbToLin(c.b);
}

function contrast(a, b) {
  var la = luminance(a);
  var lb = luminance(b);
  if (la === null || lb === null) return null;
  var hi = Math.max(la, lb);
  var lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function lumDiff(a, b) {
  var la = luminance(a);
  var lb = luminance(b);
  if (la === null || lb === null) return null;
  return Math.abs(la - lb);
}

/* ---------------- 解析 themes.wxss ---------------- */

var css = fs.readFileSync(WXSS, 'utf8');

// 括号平衡
var open = (css.match(/\{/g) || []).length;
var close = (css.match(/\}/g) || []).length;
if (open === close) ok('WXSS 大括号平衡 (' + open + ')');
else bad('WXSS 大括号不平衡', '{=' + open + ' }=' + close);

// 提取每个主题块的变量（先剥掉注释，否则文件头注释会被当成选择器前缀）
var cssClean = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 回归守卫：小程序 wxss 不允许属性选择器，会报
// "Some selectors are not allowed in component wxss, including tag name
//  selectors, ID selectors, and attribute selectors"
// 皮肤必须走类选择器 .cs-root.cs-theme-X
if (/\[data-cs-theme/.test(cssClean)) {
  bad('themes.wxss 仍在使用属性选择器 [data-cs-theme=...]');
} else {
  ok('皮肤选择器全部为类选择器（无属性选择器）');
}

var themes = {};
var blockRe = /([^{}]+)\{([^{}]*)\}/g;
var bm;
while ((bm = blockRe.exec(cssClean))) {
  var sel = bm[1].trim();
  var body = bm[2];
  if (sel.indexOf('.cs-root') !== 0) continue;
  if (body.indexOf('--cs-') < 0) continue;

  var key = 'dawn';
  var km = sel.match(/\.cs-theme-([a-z0-9-]+)/);
  if (km) key = km[1];

  var vars = {};
  var vre = /(--cs-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  var vm;
  var dupes = [];
  while ((vm = vre.exec(body))) {
    if (vars[vm[1]] !== undefined) dupes.push(vm[1]);
    vars[vm[1]] = vm[2].trim();
  }
  if (dupes.length) bad(key + ' 块内重复变量', dupes.join(', '));
  themes[key] = vars;
}

var themeKeys = Object.keys(themes).sort();
console.log('解析到皮肤: ' + themeKeys.join(', '));

if (themeKeys.length === 6) ok('皮肤数量 = 6');
else bad('皮肤数量不是 6', '实际 ' + themeKeys.length);

// 基准 = dawn（默认写在 .cs-root 上）
var base = themes['dawn'] || {};
var baseKeys = Object.keys(base).sort();

// 变量覆盖完整性
themeKeys.forEach(function (k) {
  var vars = themes[k];
  var keys = Object.keys(vars);
  var missing = baseKeys.filter(function (x) { return keys.indexOf(x) < 0; });
  var extra = keys.filter(function (x) { return baseKeys.indexOf(x) < 0; });
  if (!missing.length && !extra.length) ok(k + ' 变量完整 (' + keys.length + ')');
  else bad(k + ' 变量不完整', '缺 ' + (missing.join(',') || '无') + ' | 多 ' + (extra.join(',') || '无'));
});

/* ---------------- 对比度 / 亮度 ---------------- */

// 阈值按换肤规范：正文≥12、次级≥7、弱化≥4、主色对白字≥3、主色对底色≥3、卡片与底色差≥0.008
var RULES = [
  { name: '正文/背景', a: '--cs-text', b: '--cs-bg', min: 12 },
  { name: '次级/背景', a: '--cs-text-soft', b: '--cs-bg', min: 7 },
  { name: '弱化/背景', a: '--cs-text-mute', b: '--cs-bg', min: 4 },
  { name: '主色/primary上文字', a: '--cs-primary', b: '--cs-on-primary', min: 3 },
  { name: '主色/页面底', a: '--cs-primary', b: '--cs-bg', min: 3 },
  { name: '警示文字/警示底', a: '--cs-warn-text', b: '--cs-warn-bg', min: 3 },
  { name: '危险文字/危险底', a: '--cs-danger-text', b: '--cs-danger-bg', min: 3 },
];

themeKeys.forEach(function (k) {
  var v = themes[k];
  var rulesOk = true;
  var msgs = [];
  RULES.forEach(function (r) {
    var c = contrast(v[r.a], v[r.b]);
    if (c === null) { msgs.push(r.name + ' 无法计算'); rulesOk = false; return; }
    if (c < r.min) { msgs.push(r.name + ' ' + c.toFixed(2) + '<' + r.min); rulesOk = false; }
  });
  if (rulesOk) ok(k + ' 对比度全部达标');
  else bad(k + ' 对比度不足', msgs.join('; '));
});

// 卡片与页面底亮度差
themeKeys.forEach(function (k) {
  var v = themes[k];
  var d = lumDiff(v['--cs-card'], v['--cs-bg']);
  if (d === null) { bad(k + ' 卡片/底色 无法计算'); return; }
  if (d >= 0.008) ok(k + ' 卡片与底色可辨 (ΔL ' + d.toFixed(4) + ')');
  else bad(k + ' 卡片糊在背景里', 'ΔL ' + d.toFixed(4) + ' < 0.008');
});

/* ---------------- 元数据一致性 ---------------- */

var csTheme = require(path.join(ROOT, 'utils', 'csTheme.js'));

// 元数据 key 与 wxss 主题 key 一致
var metaKeys = csTheme.CS_THEMES.map(function (t) { return t.key; }).sort();
if (JSON.stringify(metaKeys) === JSON.stringify(themeKeys)) ok('元数据 key 与 WXSS 主题 key 一致');
else bad('元数据 key 不一致', 'meta=' + metaKeys.join(',') + ' | wxss=' + themeKeys.join(','));

// preview 必须等于 --cs-hero（去掉空格差异）
function normGradient(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

csTheme.CS_THEMES.forEach(function (t) {
  var v = themes[t.key];
  if (!v) { bad(t.key + ' 在 WXSS 中无对应块'); return; }
  if (normGradient(t.preview) === normGradient(v['--cs-hero'])) ok(t.key + ' 预览渐变与 --cs-hero 一致');
  else bad(t.key + ' 预览渐变不一致', t.preview + ' vs ' + v['--cs-hero']);

  if (String(t.dot).toLowerCase() === String(v['--cs-primary']).toLowerCase()) ok(t.key + ' 预览色点与 --cs-primary 一致');
  else bad(t.key + ' 预览色点不一致', t.dot + ' vs ' + v['--cs-primary']);
});

// 默认皮肤存在
if (themes[csTheme.DEFAULT_CS_THEME]) ok('默认皮肤 ' + csTheme.DEFAULT_CS_THEME + ' 存在');
else bad('默认皮肤缺失');

/* ---------------- 课程配色轮转 ---------------- */

var ci = csTheme.colorIndexOf('高等数学');
var ci2 = csTheme.colorIndexOf('高等数学');
if (ci === ci2 && ci >= 0 && ci <= 5) ok('colorIndexOf 稳定且在 0~5 (' + ci + ')');
else bad('colorIndexOf 异常', String(ci));

var spread = {};
['高等数学', '大学英语', '操作系统', '计算机网络', '嵌入式系统与应用', '习思想概论'].forEach(function (t) {
  spread[csTheme.colorIndexOf(t)] = true;
});
if (Object.keys(spread).length >= 3) ok('6 门课配色分散度 ' + Object.keys(spread).length + '/6');
else bad('配色分散度过低', Object.keys(spread).length + '/6');

/* ---------------- 旧硬编码色残留 ---------------- */

var pageFiles = [
  'pages/schedule/index.wxss',
  'pages/schedule-import/index.wxss',
  'pages/schedule-edit/index.wxss',
  'components/undo-bar/undo-bar.wxss',
];
var LEGACY = ['#f5f6f8', '#3b6df6', '#1a1d21', '#6b7280', '#f2f3f5', '#ffffff', '#8a9099'];
// 注意：var(--cs-x, #fallback) 里的兜底色是有意保留的，先剥掉再检测
var FALLBACK_RE = /var\(\s*--cs-[a-z0-9-]+\s*,[^)]*\)/g;
pageFiles.forEach(function (f) {
  var src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(FALLBACK_RE, 'var(--cs-x)');
  var hits = LEGACY.filter(function (c) { return src.toLowerCase().indexOf(c) >= 0; });
  if (!hits.length) ok(f + ' 无硬编码残留');
  else bad(f + ' 仍有硬编码色', hits.join(', '));
});

/* ---------------- 汇总 ---------------- */

console.log('\n————————————————————————');
if (problems.length) {
  console.log('问题清单：');
  problems.forEach(function (p) { console.log('  ✗ ' + p); });
  console.log('');
}
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
