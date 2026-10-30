/**
 * scripts/lib/cat-defs.js —— 分类定义的单一真相源读取器
 *
 * 为什么需要它：
 * check / preview 两个脚本原先各自硬编码了一份分类数组副本，
 * 于是出现「页面分类改了、脚本还拿着旧的」造成的**假失败**
 * （移除 esim 分类时就踩到了：页面已改，脚本仍断言旧分类，自检报错）。
 * 现在两个脚本统一从这里取，脚本自身不再保留副本。
 *
 * 解析对象：asset-ledger.ts 里的 `const ASSET_CAT_DEFS` / `const SPEND_CAT_DEFS`，
 * 只认 `{ id: '..', name: '..' }` 这种字面量，注释里的说明文字不会被误抓。
 */
const fs = require('fs');

const ROOT = 'C:/Users/陈乐天/WorkBuddy/2026-09-07-09-23-30/todo-miniprogram/miniprogram/';
const PAGE_TS = ROOT + 'subpackages/tools/pages/asset-ledger/asset-ledger.ts';

function extractCats(src, constName) {
  const block = src.match(new RegExp('const ' + constName + '([\\s\\S]*?)=\\s*\\[([\\s\\S]*?)\\n\\];'));
  if (!block) throw new Error('未在 asset-ledger.ts 中找到 ' + constName);
  const out = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'\s*\}/g;
  let m;
  while ((m = re.exec(block[2]))) out.push({ id: m[1], name: m[2] });
  if (!out.length) throw new Error(constName + ' 解析结果为空');
  return out;
}

/** @returns {{ assets: {id:string,name:string}[], spends: {id:string,name:string}[] }} */
function readCatDefs() {
  const src = fs.readFileSync(PAGE_TS, 'utf8');
  return {
    assets: extractCats(src, 'ASSET_CAT_DEFS'),
    spends: extractCats(src, 'SPEND_CAT_DEFS')
  };
}

/**
 * 解析页面里的 `SPEND_CAT_ICONS`（分类 id → 推荐图标）与 `SPEND_ICON_FALLBACK`。
 * 预览要把「新增订阅」表单也渲出来，图标清单同样不能存副本 ——
 * 页面加了分类、改了推荐图标，预览必须跟着变。
 */
function readSpendIcons() {
  const src = fs.readFileSync(PAGE_TS, 'utf8');
  const block = (src.match(/const SPEND_CAT_ICONS[\s\S]*?= \{([\s\S]*?)\n\};/) || [])[1];
  if (!block) throw new Error('未在 asset-ledger.ts 中找到 SPEND_CAT_ICONS');
  const map = {};
  const re = /^\s{2}(\w+):\s*\[([^\]]*)\]/gm;
  let m;
  while ((m = re.exec(block))) {
    map[m[1]] = (m[2].match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
  }
  if (!Object.keys(map).length) throw new Error('SPEND_CAT_ICONS 解析结果为空');

  const fb = (src.match(/const SPEND_ICON_FALLBACK = \[([\s\S]*?)\n\];/) || [])[1];
  if (!fb) throw new Error('未在 asset-ledger.ts 中找到 SPEND_ICON_FALLBACK');
  const fallback = (fb.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
  if (!fallback.length) throw new Error('SPEND_ICON_FALLBACK 解析结果为空');

  return { map, fallback };
}

module.exports = { readCatDefs, readSpendIcons, extractCats, PAGE_TS };
