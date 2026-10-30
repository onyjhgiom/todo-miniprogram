// scripts/check-wxml-tags.js —— WXML 标签配对自检
// 用法：node scripts/check-wxml-tags.js <file.wxml> [more.wxml ...]
//
// 【2026-10-07 升级为调用官方 wcc】
// 旧实现是正则配平，在属性含 {{ }} 表达式（单引号 / === / >）时会误判：
// 实测一份官方 wcc 判定「end tag missing」的文件，旧实现却报「全部配对」——假绿灯。
// 现在直接调用微信开发者工具自带的 wcc.exe，与工具/真机表现一致。
//
// wcc 路径可用环境变量 WCC_PATH 覆盖；找不到时自动回退到正则实现（降级但不阻断）。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WCC_CANDIDATES = [
  process.env.WCC_PATH,
  'C:/Program Files (x86)/Tencent/微信web开发者工具/code/package.nw/node_modules/wcc-exec/wcc.exe',
  'C:/Program Files/Tencent/微信web开发者工具/code/package.nw/node_modules/wcc-exec/wcc.exe'
].filter(Boolean);

function findWcc() {
  for (const p of WCC_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** 正则兜底实现（wcc 不可用时用；已知在 {{ }} 表达式上可能误判，仅作降级） */
function regexCheck(f) {
  // WXML 允许 image/input 等写成自闭合或成对，因此不能放进 VOID，否则一处错位会连锁误报
  const VOID = new Set(['import', 'include', 'wxs', 'block-self']);
  const src = fs.readFileSync(f, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    // 关键：先把 {{...}} 整段挖空，否则表达式里的单引号会打乱属性引号配对
    .replace(/\{\{[\s\S]*?\}\}/g, (m) => m.replace(/[^\s]/g, ' '));
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, close, tag, , selfClose] = m;
    const line = src.slice(0, m.index).split('\n').length;
    if (close) {
      const top = stack.pop();
      if (!top) return `多余的 </${tag}>（第 ${line} 行）`;
      if (top.tag !== tag) return `</${tag}>（第 ${line} 行）与 <${top.tag}>（第 ${top.line} 行）不匹配`;
    } else if (!selfClose && !VOID.has(tag)) {
      stack.push({ tag, line });
    }
  }
  return stack.length ? stack.map((s) => `<${s.tag}> 未闭合（第 ${s.line} 行）`).join('; ') : null;
}

const wcc = findWcc();
const useRegex = !wcc;
if (useRegex) {
  console.warn('[check-wxml-tags] 未找到 wcc.exe，回退到正则实现（{{ }} 表达式上可能误判）');
}

let bad = 0;
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) {
    console.log(`FAIL ${f} 文件不存在`);
    bad++;
    continue;
  }
  if (useRegex) {
    const err = regexCheck(f);
    if (err) {
      console.log(`FAIL ${f}: ${err}`);
      bad++;
    } else {
      console.log(`OK   ${f} 标签全部配对`);
    }
    continue;
  }
  // 只看 stderr：stdout 是编译产物（含 console.error 等运行时代码），不能拿来判错
  const r = spawnSync(wcc, [f], { encoding: 'utf8' });
  const err = (r.stderr || '').trim();
  if (err) {
    console.log(`FAIL ${f}: ${err.split('\n')[0]}`);
    bad++;
  } else {
    console.log(`OK   ${f} 标签全部配对`);
  }
}
process.exit(bad ? 1 : 0);