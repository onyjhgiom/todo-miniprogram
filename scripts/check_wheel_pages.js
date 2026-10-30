/**
 * 万能转盘页面静态自检（不依赖微信开发者工具）
 *
 * 检查项：
 *  1) 四件套齐全（.ts/.wxml/.wxss/.json）且 JSON 可解析
 *  2) app.json 的 subpackages 里确实注册了这三个页面
 *  3) WXML 标签配对（栈式匹配，忽略自闭合与 void 元素、跳过注释）
 *  4) WXML 里绑定的每个事件处理器，在对应 .ts 中都存在同名方法
 *  5) WXML 里用到的 {{变量}}（一层字段）在 .ts 的 data 里有初始值
 *
 * 用法：node scripts/check_wheel_pages.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const SUBPKG = 'subpackages/tools';
const PAGES = [
  'pages/wheel/index',
  'pages/wheel/edit',
  'pages/wheel/history'
];
const VOID = new Set(['input', 'image', 'icon', 'import', 'include', 'wxs', 'slot', 'br', 'hr',
  'progress', 'switch', 'slider', 'checkbox', 'radio', 'open-data', 'ad', 'textarea']);

function checkTags(file) {
  const src = fs.readFileSync(file, 'utf8');
  const stack = [];
  const errs = [];
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
    if (ch !== '<') continue;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i);
      if (e < 0) break;
      for (let k = i; k < e; k++) if (src[k] === '\n') line++;
      i = e + 2;
      continue;
    }
    const m = /^<\/?([a-zA-Z][\w-]*)/.exec(src.slice(i, i + 40));
    if (!m) continue;
    const closing = src[i + 1] === '/';
    const name = m[1];
    const gt = src.indexOf('>', i);
    const selfClose = gt > 0 && src[gt - 1] === '/';
    if (closing) {
      const top = stack.pop();
      if (!top) errs.push(`第 ${line} 行：多余的 </${name}>`);
      else if (top.name !== name) errs.push(`第 ${line} 行：</${name}> 与第 ${top.line} 行 <${top.name}> 不匹配`);
    } else if (!selfClose && !VOID.has(name)) {
      stack.push({ name, line });
    }
  }
  stack.forEach((s) => errs.push(`第 ${s.line} 行的 <${s.name}> 未闭合`));
  return errs;
}

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const registered = [];
(appJson.subpackages || []).forEach((sp) => {
  if (sp.root === SUBPKG) (sp.pages || []).forEach((p) => registered.push(`${SUBPKG}/${p}`));
});

let bad = 0;
for (const page of PAGES) {
  const abs = path.join(ROOT, SUBPKG, page);
  const base = path.basename(page);
  const errs = [];
  ['ts', 'wxml', 'wxss', 'json'].forEach((e) => {
    if (!fs.existsSync(`${abs}.${e}`)) errs.push(`缺 ${base}.${e}`);
  });
  if (!errs.length) {
    try {
      JSON.parse(fs.readFileSync(`${abs}.json`, 'utf8'));
    } catch (e) {
      errs.push('json 解析失败');
    }
    errs.push(...checkTags(`${abs}.wxml`));
    if (!registered.includes(`${SUBPKG}/${page}`)) errs.push('未在 app.json 注册');

    const ts = fs.readFileSync(`${abs}.ts`, 'utf8');
    const wxml = fs.readFileSync(`${abs}.wxml`, 'utf8');

    // 事件处理器存在性
    const handlers = new Set();
    const re = /bind(?:tap|change|input|longpress|confirm|blur|focus)="([A-Za-z_$][\w$]*)"/g;
    let m;
    while ((m = re.exec(wxml))) handlers.add(m[1]);
    handlers.forEach((h) => {
      if (ts.indexOf(`${h}(`) < 0 && ts.indexOf(`${h}:`) < 0 && ts.indexOf(`${h} (`) < 0) {
        errs.push(`事件 ${h} 在 ts 中没有实现`);
      }
    });

    // 顶层变量是否都在 data 里初始化（只查一层字段，够用）
    const dataBlock = /(?:data:\s*\{)([\s\S]*?)(?:\n  \},|\n  \}\s*\n)/.exec(ts);
    const declared = new Set();
    if (dataBlock) {
      const dre = /^\s{4}([A-Za-z_$][\w$]*):/gm;
      let d;
      while ((d = dre.exec(dataBlock[1]))) declared.add(d[1]);
    }
    const used = new Set();
    const ure = /\{\{\s*([A-Za-z_$][\w$]*)\s*[\}|\)]/g;
    while ((m = ure.exec(wxml))) {
      // 字面量（show-scrollbar="{{false}}" 之类）不是 data 字段
      if (['true', 'false', 'null', 'undefined'].indexOf(m[1]) >= 0) continue;
      used.add(m[1]);
    }
    // wx:for 内置变量 + 自定义 wx:for-item / wx:for-index 声明的变量，都不是 data 字段
    ['item', 'index'].forEach((k) => used.delete(k));
    const fre = /wx:for-(?:item|index)="([A-Za-z_$][\w$]*)"/g;
    let f;
    while ((f = fre.exec(wxml))) used.delete(f[1]);
    used.forEach((k) => {
      if (!declared.has(k)) errs.push(`wxml 用了 {{${k}}}，但 data 里没有初始化`);
    });
  }
  if (errs.length) bad++;
  console.log(`${errs.length ? '❌' : '✅'} ${page}${errs.length ? '\n   - ' + errs.join('\n   - ') : ''}`);
}
console.log(bad ? `\n共 ${bad} 个页面有问题` : '\n✅ 转盘三个页面：四件套齐全、标签配对、事件与变量均已落地');
process.exit(bad ? 1 : 0);
