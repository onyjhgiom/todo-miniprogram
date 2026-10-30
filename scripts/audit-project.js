/**
 * 项目整体体检脚本（Node 运行，零依赖）
 *
 * 用途：在提交 / 本地运行前，一次性检查项目结构层面的「硬伤」：
 *   1. app.json 主包 pages + 各 subpackages.pages 注册的路径，是否都有对应的 .json/.wxml/.js|.ts 文件
 *   2. 每个页面 / 组件 json 的 usingComponents 组件路径，是否都能解析到真实目录
 *   3. 每个页面脚本里的 require()/import 相对路径，是否指向真实存在的文件（缺失依赖是本地运行直接崩溃的常见原因）
 *   4. 主包体积粗估（超过 2MB 微信会拒绝上传）
 *
 * 用法：node scripts/audit-project.js
 * 退出码：0 = 全部通过；1 = 存在 ERROR
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

const errors = [];
const warns = [];
const ok = (msg) => console.log('  \u2713 ' + msg);
const err = (msg) => { errors.push(msg); console.log('  \u2717 [ERROR] ' + msg); };
const warn = (msg) => { warns.push(msg); console.log('  ! [WARN ] ' + msg); };

/** 判断某页面路径（不含扩展名）是否完整存在 */
function checkPage(base) {
  const musts = ['.json', '.wxml'];
  const problems = [];
  for (const ext of musts) {
    if (!fs.existsSync(base + ext)) problems.push('缺少 ' + ext);
  }
  const hasLogic = fs.existsSync(base + '.js') || fs.existsSync(base + '.ts');
  if (!hasLogic) problems.push('缺少 .js/.ts');
  if (!fs.existsSync(base + '.wxss')) problems.push('缺少 .wxss(可选)');
  return problems;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

/** 把 json 里 usingComponents 的相对路径解析到真实文件 */
function resolveComponent(jsonPath, rel) {
  const dir = path.dirname(jsonPath);
  const isAbs = rel.startsWith('/');
  const base = isAbs ? path.join(MP, rel) : path.resolve(dir, rel);
  const cands = [base + '.json', path.join(base, 'index.json'), base + '.wxml'];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

console.log('\n=== [1] 页面注册完整性 ===');
const appJson = readJson(path.join(MP, 'app.json'));
if (!appJson) {
  err('app.json 解析失败');
} else {
  const mainPages = appJson.pages || [];
  let badCount = 0;
  for (const p of mainPages) {
    const probs = checkPage(path.join(MP, p));
    if (probs.some((x) => !x.includes('可选'))) {
      badCount++;
      err('主包页面 ' + p + ' → ' + probs.join('、'));
    }
  }
  ok('主包 ' + mainPages.length + ' 个页面，异常 ' + badCount + ' 个');

  const subs = appJson.subpackages || [];
  for (const sub of subs) {
    let subBad = 0;
    for (const p of sub.pages || []) {
      const probs = checkPage(path.join(MP, sub.root, p));
      if (probs.some((x) => !x.includes('可选'))) {
        subBad++;
        err('子包 ' + sub.root + ' 页面 ' + p + ' → ' + probs.join('、'));
      }
    }
    ok('子包 ' + sub.root + '（' + (sub.pages || []).length + ' 页）异常 ' + subBad + ' 个');
  }
}

console.log('\n=== [2] 组件引用可达性 ===');
/** 递归收集所有 json（页面 + 组件） */
function collectJson(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      collectJson(full, out);
    } else if (name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}
const allJson = collectJson(MP);
let compChecked = 0;
let compBad = 0;
for (const jp of allJson) {
  const j = readJson(jp);
  if (!j || !j.usingComponents) continue;
  for (const [tag, rel] of Object.entries(j.usingComponents)) {
    compChecked++;
    if (!resolveComponent(jp, rel)) {
      compBad++;
      err('组件引用失效 <' + tag + '> 来自 ' + path.relative(ROOT, jp) + ' → ' + rel);
    }
  }
}
ok('共检查 ' + compChecked + ' 处组件引用，失效 ' + compBad + ' 处');

console.log('\n=== [3] 脚本依赖（require/import 相对路径）可达性 ===');
function collectScripts(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      collectScripts(full, out);
    } else if (/\.(js|ts)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}
// types/index 是纯声明文件（index.d.ts），必须纳入候选，否则会误报为缺失依赖
const EXT = ['.d.ts', '.ts', '.js', '.json', '.wxml', '.wxss', '/index.ts', '/index.js'];
function resolveModule(fromFile, rel) {
  const dir = path.dirname(fromFile);
  const candidates = [];
  if (rel.startsWith('/')) {
    const abs = path.join(MP, rel);
    candidates.push(abs);
    for (const e of EXT) candidates.push(abs + e);
  } else {
    const base = path.resolve(dir, rel);
    candidates.push(base);
    for (const e of EXT) candidates.push(base + e);
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
const allScripts = collectScripts(MP);
let depChecked = 0;
let depBad = 0;
const RE_REQUIRE = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
for (const f of allScripts) {
  if (f.endsWith('.d.ts')) continue;
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  // 跳过整行注释，避免把文档示例里的 import 误判为缺失依赖（如 tool-shell.ts 的用法注释）
  const code = src.split('\n').filter((ln) => ln.trim().indexOf('//') !== 0).join('\n');
  let m;
  RE_REQUIRE.lastIndex = 0;
  while ((m = RE_REQUIRE.exec(code))) {
    const rel = m[1];
    depChecked++;
    if (!resolveModule(f, rel)) {
      depBad++;
      err('依赖缺失 ' + path.relative(ROOT, f) + ' → ' + rel);
    }
  }
}
ok('共检查 ' + depChecked + ' 处相对依赖，缺失 ' + depBad + ' 处');

console.log('\n=== [4] 主包体积粗估（按打包规则排除） ===');
// 与 project.config.json 的 packOptions.ignore 对齐：.bak* / .md / .d.ts / app.sample.js / course-schedule/test
function shouldIgnore(name, full) {
  if (name.includes('.bak')) return true;
  if (name.endsWith('.md')) return true;
  if (name.endsWith('.d.ts')) return true;
  if (name.endsWith('app.sample.js')) return true;
  if (full.split(path.sep).includes('course-schedule') &&
      full.split(path.sep).includes('test')) return true;
  return false;
}
function dirSize(dir, isMain) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (shouldIgnore(name, full)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (isMain && name === 'subpackages') continue; // 子包单独算，不计入主包
      total += dirSize(full, isMain);
    } else total += st.size;
  }
  return total;
}
const mainSize = dirSize(MP, true);
const mainMB = (mainSize / 1024 / 1024).toFixed(2);
if (mainSize > 2 * 1024 * 1024) warn('主包（按打包规则排除后）约 ' + mainMB + ' MB，超过 2MB 上限，需进一步瘦身');
else ok('主包约 ' + mainMB + ' MB（上限 2MB）');

console.log('\n=== [5] 冗余文件扫描 ===');
let bakCount = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (/\.bak/.test(name)) { bakCount++; }
  }
})(MP);
if (bakCount) warn('miniprogram 内发现 ' + bakCount + ' 个 .bak* 备份文件（已配置打包忽略，但建议清理）');
else ok('无 .bak 冗余文件');

console.log('\n========== 体检结果 ==========');
console.log('ERROR: ' + errors.length + '   WARN: ' + warns.length);
if (errors.length) {
  console.log('\n失败明细：');
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
}
console.log('全部通过 ✅');
