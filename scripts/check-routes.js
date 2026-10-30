// scripts/check-routes.js —— 全站「入口可达性 + 组件注册」静态自检
//
// 目的：在不动一行业务代码的前提下，一次性查出会让用户「点了没反应 / 白屏 / 报 Component is not found」
// 的所有隐患。覆盖 6 类检查：
//
//   A. 注册表完整性：app.json 里每个页面的 .ts|.js / .wxml / .json 是否都在
//   B. 孤儿页面    ：磁盘上有页面文件，却没在 app.json 注册（永远进不去）
//   C. 组件注册    ：usingComponents 路径能否解析到真实组件文件
//   D. 标签注册    ：.wxml 里用到的自定义标签，是否都在本页 json 的 usingComponents 里声明
//                    （这是 "Component is not found in path xxx" 的唯一根因）
//   E. 路由可达    ：代码里硬编码的 /pages/... /subpackages/... 跳转目标是否都已注册
//   F. 工具表一致  ：utils/tools.ts 的 route 与 pages/tools/tools.ts 的 ROUTE_PATHS 是否一一对应，
//                    以及 widget 类型是否被 pages/tool/tool.ts 支持
//
// 用法：node scripts/check-routes.js
// 退出码：0 全通过 / 1 有 FAIL
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

let fail = 0;
let warn = 0;
const fails = [];
const warns = [];

function ok(msg) {
  console.log(`OK    ${msg}`);
}
function bad(msg) {
  console.log(`FAIL  ${msg}`);
  fails.push(msg);
  fail++;
}
function soft(msg) {
  console.log(`WARN  ${msg}`);
  warns.push(msg);
  warn++;
}
function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}
/** 递归收集文件，跳过备份文件与 node_modules */
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
      // 跳过 *.bak / *.bak-xxx 等备份
      if (/\.bak($|[-.])/.test(ent.name)) continue;
      out.push(full);
    }
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

console.log('==============================================');
console.log(' 全站入口可达性 + 组件注册自检');
console.log('==============================================\n');

const appJson = readJson(path.join(MP, 'app.json'));
if (!appJson) {
  console.error('致命：miniprogram/app.json 无法解析');
  process.exit(1);
}

/* ---------- 注册表 ---------- */

const routes = new Set();
const pageFiles = []; // 每个注册路由的绝对目录
for (const p of appJson.pages || []) {
  routes.add('/' + p);
  pageFiles.push({ route: '/' + p, dir: path.join(MP, p) });
}
for (const sp of appJson.subpackages || []) {
  for (const p of sp.pages || []) {
    const route = '/' + sp.root + '/' + p;
    routes.add(route);
    pageFiles.push({ route, dir: path.join(MP, sp.root, p) });
  }
}

console.log(`注册路由总数：${routes.size}（主包 ${(appJson.pages || []).length} + 分包 ${
  routes.size - (appJson.pages || []).length
}）\n`);

/* ---------- A. 注册表完整性 ---------- */

console.log('--- A. 注册表完整性 ---');
let aBad = 0;
for (const { route, dir } of pageFiles) {
  const hasScript = exists(dir + '.ts') || exists(dir + '.js');
  const hasWxml = exists(dir + '.wxml');
  const jsonPath = dir + '.json';
  if (!hasScript) {
    bad(`A ${route} 缺少脚本文件（.ts/.js）—— 打开必白屏`);
    aBad++;
  }
  if (!hasWxml) {
    bad(`A ${route} 缺少 .wxml —— 打开必白屏`);
    aBad++;
  }
  if (exists(jsonPath) && readJson(jsonPath) === null) {
    bad(`A ${route}.json 不是合法 JSON —— 页面配置失效`);
    aBad++;
  }
}
if (!aBad) ok(`A 全部 ${pageFiles.length} 个页面文件齐备`);

/* ---------- B. 孤儿页面 ---------- */

console.log('\n--- B. 孤儿页面（有文件但未注册） ---');
// 注册的是「页面文件基路径」（不含扩展名），如 .../pages/astro/index
const registeredBase = new Set(pageFiles.map((p) => path.normalize(p.dir)));
// 组件目录：路径里带 /components/，或 dir 名 === 文件名（components/todo-card/todo-card.wxml）
const componentDirs = new Set();
for (const f of walk(MP)) {
  if (!f.endsWith('.wxml')) continue;
  const base = f.slice(0, -'.wxml'.length);
  if (/[\\/]components[\\/]/.test(base)) componentDirs.add(path.normalize(base));
  else if (path.basename(base) === path.basename(path.dirname(base))) componentDirs.add(path.normalize(base));
}
let bBad = 0;
for (const f of walk(MP)) {
  if (!f.endsWith('.wxml')) continue;
  const base = f.slice(0, -'.wxml'.length);
  const jsonPath = base + '.json';
  // 页面三件套里 .json 是必需的；没有 json 的更可能是模板片段
  if (!exists(jsonPath)) continue;
  if (componentDirs.has(path.normalize(base))) continue;
  if (registeredBase.has(path.normalize(base))) continue;
  soft(`B 疑似孤儿页面（有 .wxml/.json 但未在 app.json 注册）：${rel(f)}`);
  bBad++;
}
if (!bBad) ok('B 未发现孤儿页面（所有页面文件都已在 app.json 注册）');

/* ---------- C. 组件注册解析 ---------- */

console.log('\n--- C. usingComponents 解析 ---');
const allJson = walk(MP).filter((f) => f.endsWith('.json') && !f.endsWith('app.json') && !f.endsWith('sitemap.json'));
let cBad = 0;
let cTotal = 0;
for (const jf of allJson) {
  const json = readJson(jf);
  if (!json || !json.usingComponents) continue;
  const dir = path.dirname(jf);
  for (const [tag, spec] of Object.entries(json.usingComponents)) {
    cTotal++;
    if (typeof spec !== 'string' || !spec) {
      bad(`C ${rel(jf)} → <${tag}> 声明为空`);
      cBad++;
      continue;
    }
    // 插件组件 plugin:// 跳过
    if (spec.startsWith('plugin://')) continue;
    const target = spec.startsWith('/') ? path.join(MP, spec.slice(1)) : path.resolve(dir, spec);
    const hasWxml = exists(target + '.wxml');
    const hasScript = exists(target + '.ts') || exists(target + '.js');
    if (!hasWxml || !hasScript) {
      bad(`C ${rel(jf)} → <${tag}> 指向 ${spec}，${!hasWxml ? '缺 .wxml ' : ''}${
        !hasScript ? '缺 .ts/.js' : ''
      } —— 渲染该标签必报 Component is not found`);
      cBad++;
    }
  }
}
if (!cBad) ok(`C 全部 ${cTotal} 条 usingComponents 声明均指向真实组件`);

/* ---------- D. WXML 自定义标签是否已注册 ---------- */

console.log('\n--- D. WXML 标签注册检查 ---');
// 微信内置标签
const BUILTIN = new Set([
  'view',
  'text',
  'image',
  'button',
  'input',
  'textarea',
  'scroll-view',
  'swiper',
  'swiper-item',
  'navigator',
  'form',
  'label',
  'picker',
  'picker-view',
  'picker-view-column',
  'checkbox',
  'checkbox-group',
  'radio',
  'radio-group',
  'slider',
  'switch',
  'audio',
  'video',
  'camera',
  'canvas',
  'map',
  'cover-view',
  'cover-image',
  'icon',
  'progress',
  'rich-text',
  'movable-area',
  'movable-view',
  'web-view',
  'ad',
  'ad-custom',
  'official-account',
  'open-data',
  'functional-page-navigator',
  'contact-button',
  'live-player',
  'live-pusher',
  'page-meta',
  'navigation-bar',
  'voip-room',
  'editor',
  'keyboard-accessory',
  'match-media',
  'share-element',
  'block',
  'template',
  'import',
  'include',
  'wxs',
  'slot',
  'page-container',
  'root-portal',
  'grid-view',
  'list-view',
  'sticky-header',
  'sticky-section',
  'snapshot',
  'double-tap-gesture-handler',
  'scale-gesture-handler',
  'pan-gesture-handler',
  'tap-gesture-handler',
  'vertical-drag-gesture-handler',
  'horizontal-drag-gesture-handler',
  'force-press-gesture-handler',
  'longpress-gesture-handler',
  'draggable-sheet',
  'nested-scroll-header',
  'nested-scroll-body',
  'span',
  'open-container',
  'route-builder',
  'channels-live',
  'channel-live',
  'channel-video',
  'mpx-view'
]);
let dBad = 0;
let dTotal = 0;
const wxmls = walk(MP).filter((f) => f.endsWith('.wxml'));
for (const wf of wxmls) {
  const jsonPath = wf.slice(0, -'.wxml'.length) + '.json';
  const json = exists(jsonPath) ? readJson(jsonPath) : null;
  const declared = new Set(Object.keys((json && json.usingComponents) || {}));
  const src = fs.readFileSync(wf, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const seen = new Set();
  const re = /<([a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1];
    if (BUILTIN.has(tag)) continue;
    if (declared.has(tag)) continue;
    seen.add(tag);
  }
  for (const tag of seen) {
    dTotal++;
    bad(`D ${rel(wf)} 用到 <${tag}>，但本页 json 的 usingComponents 未声明 —— 渲染必报 not found`);
    dBad++;
  }
}
if (!dBad) ok(`D ${wxmls.length} 个 wxml 中的自定义标签全部已声明（共 ${dTotal} 处问题）`);

/* ---------- E. 代码中的硬编码路由 ---------- */

console.log('\n--- E. 硬编码跳转目标可达性 ---');
const srcFiles = walk(MP).filter(
  (f) =>
    (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.wxml')) &&
    !f.endsWith('check-routes.js')
);
// 匹配字符串字面量中的 /pages/... /subpackages/... /course-schedule/... 路径。
// 强制要求前面是引号，避免把注释头（// subpackages/... ）和 require('./xx/yy') 当成路由。
const ROUTE_RE = /['"`](\/(?:pages|subpackages|course-schedule)\/[A-Za-z0-9_\-/]*[A-Za-z0-9_\-])/g;
const uniq = new Map(); // route -> Set(files)
for (const f of srcFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = ROUTE_RE.exec(src))) {
    let r = m[1];
    if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
    if (!uniq.has(r)) uniq.set(r, new Set());
    uniq.get(r).add(rel(f));
  }
}
/** 静态资源（图片/音频）路径，不是路由 */
const isAsset = (r) => /\/assets?\//.test(r) || /\.(png|jpg|jpeg|gif|webp|svg|mp3|wav|m4a|json|js|ts)$/i.test(r);
/** 是否为「动态拼接的前缀」：某个已注册路由以它 + '/' 开头 */
const isDynamicPrefix = (r) => [...routes].some((route) => route.startsWith(r + '/'));

let eBad = 0;
let eSkipped = 0;
for (const [r, files] of uniq) {
  if (routes.has(r)) continue;
  if (isAsset(r)) {
    eSkipped++;
    continue;
  }
  if (isDynamicPrefix(r)) {
    eSkipped++;
    continue;
  }
  const list = [...files].slice(0, 3).join(', ');
  bad(`E 跳转目标未注册：${r}（出现于 ${list}${files.size > 3 ? ' 等' : ''}）—— 点击会走 nav 兜底并提示"打开失败"`);
  eBad++;
}
if (!eBad) {
  ok(`E 代码中出现的 ${uniq.size} 个路由字面量全部可达（自动忽略 ${
    eSkipped || 0
  } 个静态资源 / 动态前缀）`);
}

/* ---------- F. 工具表一致性 ---------- */

console.log('\n--- F. 工具注册表一致性 ---');
const toolsSrc = fs.readFileSync(path.join(MP, 'utils', 'tools.ts'), 'utf8');
const toolsPageSrc = fs.readFileSync(path.join(MP, 'pages', 'tools', 'tools.ts'), 'utf8');

// 解析 ROUTE_PATHS 表
const rpBlock = toolsPageSrc.match(/const ROUTE_PATHS[\s\S]*?=\s*\{([\s\S]*?)\};/);
const routePaths = {};
if (rpBlock) {
  const re = /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(rpBlock[1]))) routePaths[m[1]] = m[2];
}

// 解析 TOOLS 里每个工具的 id / route / widget
const toolRe = /\{\s*id:\s*'([^']+)'[\s\S]*?\}/g;
let tm;
let fBad = 0;
const toolIds = new Set();
while ((tm = toolRe.exec(toolsSrc))) {
  const block = tm[0];
  const id = tm[1];
  toolIds.add(id);
  const route = (block.match(/route:\s*'([^']+)'/) || [])[1];
  const widget = (block.match(/widget:\s*'([^']+)'/) || [])[1];
  const shortLink = /shortLink:/.test(block);
  const soon = /soon:/.test(block);
  if (!route) {
    if (!shortLink && !soon) soft(`F 工具 ${id} 既无 route 也无 shortLink/soon —— 点击只会提示"开发中"`);
    continue;
  }
  if (route === 'tool') {
    if (!widget) {
      bad(`F 工具 ${id} route=tool 但缺 widget —— 点击只会提示"功能开发中"`);
      fBad++;
    }
    continue;
  }
  if (!routePaths[route]) {
    bad(`F 工具 ${id} 的 route='${route}' 在 pages/tools/tools.ts 的 ROUTE_PATHS 中未配置 —— 点击只会提示"功能开发中"`);
    fBad++;
  }
}
// ROUTE_PATHS 中配置的路径必须真实注册
for (const [key, p] of Object.entries(routePaths)) {
  if (!routes.has(p)) {
    bad(`F ROUTE_PATHS['${key}'] = ${p} 未在 app.json 注册`);
    fBad++;
  }
}
// 未被任何工具使用的 ROUTE_PATHS 条目（预留位，无害，仅在汇总里提一句）
const idleRouteKeys = [];
for (const key of Object.keys(routePaths)) {
  const used = new RegExp(`route:\\s*'${key}'`).test(toolsSrc);
  if (!used) idleRouteKeys.push(key);
}
if (!fBad) {
  ok(
    `F ${toolIds.size} 个工具的 route 配置与落地页一一对应${
      idleRouteKeys.length ? `（另有 ${idleRouteKeys.length} 个预留 route：${idleRouteKeys.join('、')}）` : ''
    }`
  );
}

/* ---------- G. module-router 落地页 ---------- */

console.log('\n--- G. 模块路由表落地页 ---');
const mrSrc = fs.readFileSync(path.join(MP, 'utils', 'module-router.ts'), 'utf8');
let gBad = 0;
const mrRe = /kind:\s*'(page|tool)'[\s\S]*?path:\s*'([^']*)'/g;
let gm;
while ((gm = mrRe.exec(mrSrc))) {
  const kind = gm[1];
  const p = gm[2];
  if (!p) continue; // 空 path = 由调用方特殊处理（如 detail-new）
  if (kind === 'tool') continue; // tool 走 /pages/tool/tool?type=
  if (!routes.has(p)) {
    bad(`G 模块路由表 path=${p} 未在 app.json 注册`);
    gBad++;
  }
}
if (!gBad) ok('G 模块路由表落地页全部可达');

/* ---------- H. 模块导入解析 ---------- */

console.log('\n--- H. 模块导入解析（import / require） ---');
const codeFiles = walk(MP).filter(
  (f) =>
    (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.wxs')) &&
    !f.endsWith('check-routes.js') &&
    // *.sample.js 是「复制到 app.js 位置使用」的模板，其中的相对路径按目标位置书写，
    // 放到当前目录本来就不解析，属预期行为，不参与本项校验。
    !/\.sample\.(js|ts)$/.test(f)
);
// import ... from 'x' | import 'x' | export ... from 'x' | require('x')
const IMPORT_RE = /(?:^|[^\w.])(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 剥离注释，避免把「文档里示范的 import 写法」当成真实依赖 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/^[ \t]*\/\/.*$/gm, '');    // 整行注释
}

function resolveModule(fromFile, spec) {
  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, spec);
  const cands = [
    base,
    base + '.ts',
    base + '.js',
    base + '.json',
    base + '.d.ts',
    path.join(base, 'index.ts'),
    path.join(base, 'index.js')
  ];
  return cands.find(exists) || null;
}

let hBad = 0;
let hTotal = 0;
const hSeen = new Set();
for (const f of codeFiles) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const raw = m[1] || m[2];
    if (!raw) continue;
    // 只校验相对路径（wx.* / 小程序基础库模块 / 绝对别名都跳过）
    if (!raw.startsWith('.')) continue;
    // 小程序里 import 带 .js 后缀指向 .ts 源文件是合法的，纯后缀差异不算错
    hTotal++;
    const key = rel(f) + ' -> ' + raw;
    if (hSeen.has(key)) continue;
    hSeen.add(key);
    if (!resolveModule(f, raw)) {
      bad(`H ${rel(f)} 引用了不存在的模块 "${raw}" —— 加载该模块会抛错，所在页面/组件会白屏`);
      hBad++;
    }
  }
}
if (!hBad) ok(`H ${hTotal} 条相对导入全部能解析到真实文件`);

/* ---------- 汇总 ---------- */

console.log('\n==============================================');
console.log(` 结果：FAIL ${fail} 项 / WARN ${warn} 项`);
console.log('==============================================');
if (fail) {
  console.log('\n需修复：');
  fails.forEach((f) => console.log('  · ' + f));
}
if (warn) {
  console.log('\n建议关注（不影响运行）：');
  warns.forEach((f) => console.log('  · ' + f));
}
process.exit(fail ? 1 : 0);
