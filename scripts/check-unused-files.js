// scripts/check-unused-files.js —— 依赖可达性分析（死文件 / 真实包体积）
//
// 为什么需要它：
// 1. 开发者工具上传时会按「代码依赖分析」过滤掉没有任何页面引用到的文件
//    （project.config.json -> setting.ignoreUploadUnusedFiles = true）。
//    所以「磁盘上多大」不等于「上传包多大」，两者差值就是可以清理的死文件。
// 2. 分包预下载（preloadRule）的体积校验用的是【上传包】口径，
//    本脚本给出同一口径下的每个分包体积，便于判断预下载限额。
//
// 可达性判定规则（与开发者工具一致的部分）：
//   - 根：app.json 中注册的全部页面（主包 + 各分包）的 .ts|.js / .wxml / .json / .wxss
//   - .ts/.js  : import / require / export ... from 的相对或绝对路径
//   - .json    : usingComponents 里的组件路径（文件或目录）
//   - .wxml    : <import src> / <include src> / <wxs src> 与 src="/..." 资源
//   - .wxss    : @import "..." 与 url("/...") 资源
//
// 用法：node scripts/check-unused-files.js [--list=20]
// 退出码：始终 0（这是体检工具，不是门禁）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const listArg = (process.argv.find((a) => a.startsWith('--list=')) || '--list=20').split('=')[1];
const LIST = Math.max(0, parseInt(listArg, 10) || 20);

const EXTS = ['.ts', '.js', '.json', '.wxml', '.wxss', '.wxs'];
const toPosix = (p) => p.replace(/\\/g, '/');
const kb = (n) => (n / 1024).toFixed(1);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** packOptions.ignore */
const projCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
const ignoreRules = ((projCfg.packOptions || {}).ignore || []).slice();
function globToRe(g) {
  let out = '^';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { out += '.*'; i++; if (g[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp(out + '$');
}
function isIgnored(rel) {
  for (const r of ignoreRules) {
    const v = toPosix(r.value);
    if (r.type === 'suffix' && rel.endsWith(v)) return true;
    if (r.type === 'file' && rel === v) return true;
    if (r.type === 'folder' && (rel === v || rel.startsWith(v + '/'))) return true;
    if (r.type === 'glob' && globToRe(r.value).test(rel)) return true;
    if (r.type === 'regexp' && new RegExp(r.value).test(rel)) return true;
  }
  return false;
}

const allFiles = walk(MP).map((abs) => ({ abs, rel: toPosix(path.relative(MP, abs)) }));
const byRel = new Map(allFiles.map((f) => [f.rel, f]));
const keepFiles = allFiles.filter((f) => !isIgnored(f.rel));
const sizeOf = new Map(keepFiles.map((f) => [f.rel, fs.statSync(f.abs).size]));

/** 把写法各异的引用解析成 miniprogram 下的相对路径 */
function resolveRef(fromRel, spec) {
  if (!spec) return null;
  let s = spec.trim().split('?')[0];
  if (!s || s.startsWith('http') || s.startsWith('data:')) return null;
  let baseRel;
  if (s.startsWith('/')) baseRel = s.replace(/^\/+/, '');
  else if (s.startsWith('.')) baseRel = toPosix(path.normalize(path.join(path.dirname(fromRel), s)));
  else return null; // 裸模块（npm / 插件）

  const cands = [baseRel];
  for (const e of EXTS) cands.push(baseRel + e);
  for (const e of EXTS) cands.push(toPosix(path.join(baseRel, 'index' + e)));
  for (const c of cands) if (sizeOf.has(c)) return c;
  // 资源类（图片/音频）直接按原样比
  const asset = baseRel;
  if (sizeOf.has(asset)) return asset;
  return { missing: baseRel };
}

function refsOf(rel) {
  const f = byRel.get(rel);
  if (!f) return [];
  let src;
  try {
    src = fs.readFileSync(f.abs, 'utf8');
  } catch (e) {
    return [];
  }
  const out = [];
  const push = (spec) => {
    const r = resolveRef(rel, spec);
    if (r) out.push(r);
  };

  if (/\.(ts|js)$/.test(rel)) {
    const re = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) push(m[1]);
  }
  if (rel.endsWith('.json')) {
    // usingComponents 的值可能是文件路径或组件目录
    const re = /"usingComponents"\s*:\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const re2 = /:\s*"([^"]+)"/g;
      let m2;
      while ((m2 = re2.exec(m[1]))) push(m2[1]);
    }
  }
  if (rel.endsWith('.wxml')) {
    const re = /(?:src|usingComponents)\s*=\s*"([^"{]+)"/g;
    let m;
    while ((m = re.exec(src))) push(m[1]);
    // 属性里出现的内联 / 绝对资源路径
    const re3 = /["'(](\/[^"'){]+\.(?:png|jpg|jpeg|gif|webp|svg|mp3|wav|m4a|aac|json))["')]/g;
    while ((m = re3.exec(src))) push(m[1]);
  }
  if (rel.endsWith('.wxss')) {
    const re = /@import\s+["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) push(m[1]);
    const re2 = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
    while ((m = re2.exec(src))) push(m[1]);
  }
  if (rel.endsWith('.wxs')) {
    const re = /require\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(src))) push(m[1]);
  }
  return out;
}

/** 根 = app.json 注册的所有页面四件套 */
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const pagePaths = [];
for (const p of appJson.pages || []) pagePaths.push(p);
for (const sp of appJson.subpackages || appJson.subPackages || []) {
  for (const p of sp.pages || []) pagePaths.push(sp.root + '/' + p);
}

const reachable = new Set();
const missing = [];
const queue = [];
for (const p of pagePaths) {
  for (const e of ['.ts', '.js', '.wxml', '.json', '.wxss']) {
    const cand = p + e;
    if (sizeOf.has(cand)) queue.push(cand);
  }
}
// app 级入口
for (const r of ['app.js', 'app.wxss', 'app.json']) if (sizeOf.has(r)) queue.push(r);

while (queue.length) {
  const rel = queue.pop();
  if (reachable.has(rel)) continue;
  reachable.add(rel);
  for (const r of refsOf(rel)) {
    if (r && typeof r === 'object') { missing.push([rel, r.missing]); continue; }
    if (!reachable.has(r)) queue.push(r);
  }
}

/** 分包归属 */
const subRoots = (appJson.subpackages || []).map((s) => toPosix(s.root));
const ownerOf = (rel) => subRoots.find((r) => rel.startsWith(r + '/')) || '__main__';

const buckets = new Map();
for (const f of keepFiles) {
  const o = ownerOf(f.rel);
  if (!buckets.has(o)) buckets.set(o, { total: 0, reach: 0, unused: [] });
  const b = buckets.get(o);
  const s = sizeOf.get(f.rel) || 0;
  b.total += s;
  if (reachable.has(f.rel)) b.reach += s;
  else b.unused.push([s, f.rel]);
}

console.log('==============================================');
console.log(' 依赖可达性 / 死文件体检（上传包口径）');
console.log('==============================================\n');
console.log(
  '包'.padEnd(24) + '磁盘(剔除ignore)'.padStart(16) + '可达(上传)'.padStart(12) + '未引用'.padStart(12)
);
const order = ['__main__', ...subRoots];
let totAll = 0, totReach = 0, totUnused = 0;
for (const o of order) {
  const b = buckets.get(o);
  if (!b) continue;
  const u = b.total - b.reach;
  totAll += b.total; totReach += b.reach; totUnused += u;
  console.log(
    (o === '__main__' ? '主包' : o).padEnd(24) +
    (kb(b.total) + 'KB').padStart(16) +
    (kb(b.reach) + 'KB').padStart(12) +
    (kb(u) + 'KB').padStart(12)
  );
}
console.log(
  '合计'.padEnd(24) + (kb(totAll) + 'KB').padStart(16) + (kb(totReach) + 'KB').padStart(12) +
  (kb(totUnused) + 'KB').padStart(12)
);

console.log('\n--- 各包合计（含预下载 rule 口径）---');
console.log('主包 + 全部预下载分包 可达合计: ' + kb(totReach) + 'KB');

/** 预下载 rule 口径 */
const rules = appJson.preloadRule || {};
for (const key of Object.keys(rules)) {
  let sum = 0;
  const parts = [];
  for (const pkg of rules[key].packages || []) {
    const b = buckets.get(pkg);
    if (b) { sum += b.reach; parts.push(pkg + '=' + kb(b.reach) + 'KB'); }
  }
  console.log(`  rule[${key}] 预下载可达合计 ${kb(sum)}KB  (${parts.join(' + ')})`);
}

if (LIST) {
  console.log('\n--- 未引用文件 TOP ' + LIST + '（可从上传包中剔除，也可直接删）---');
  const flat = [];
  for (const o of order) {
    const b = buckets.get(o);
    if (b) for (const [s, rel] of b.unused) flat.push([s, rel, o]);
  }
  flat.sort((a, b) => b[0] - a[0]);
  for (const [s, rel, o] of flat.slice(0, LIST)) {
    console.log((kb(s) + 'KB').padStart(10) + '  ' + rel + '   [' + (o === '__main__' ? '主包' : o) + ']');
  }
}

if (missing.length) {
  console.log('\n--- 解析不到的引用（可能是字符串拼接，需人工确认）---');
  for (const [from, spec] of missing.slice(0, 15)) console.log('  ' + from + '  ->  ' + spec);
}
