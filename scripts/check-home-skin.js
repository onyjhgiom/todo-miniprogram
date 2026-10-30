/**
 * scripts/check-home-skin.js
 * 主页「风格 + 背景」双维度四元组一致性自检。
 *
 * 为什么需要：风格/背景各由四处定义共同决定，任何一处漏改都会造成
 * 「界面上能选，但选中后没效果」的静默失效 —— 微信小程序对不存在的 class
 * 不报任何错，只会在真机上白跑一次。
 *   ① utils/home-skin.ts 的联合类型
 *   ② utils/home-skin.ts 的 XXXS 常量数组
 *   ③ utils/home-skin.ts 的 XXX_CHIPS 选择器
 *   ④ pages/index/index.wxss 的 .home-style-X / .ambient-layer--X 规则
 *
 * 用法：node scripts/check-home-skin.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const skin = fs.readFileSync(path.join(ROOT, 'utils/home-skin.ts'), 'utf8');
const idxWxss = fs.readFileSync(path.join(ROOT, 'pages/index/index.wxss'), 'utf8');

const uniq = (a) => [...new Set(a)].sort();
const cmp = (a, b) => JSON.stringify(uniq(a)) === JSON.stringify(uniq(b));

/** 截取两个标记之间的文本（start 取首次出现，end 取其后首次出现） */
function slice(s, startMark, endMark) {
  const i = s.indexOf(startMark);
  if (i < 0) return '';
  const j = s.indexOf(endMark, i + startMark.length);
  return j < 0 ? s.slice(i) : s.slice(i, j);
}

/** 从 "  'a' | 'b' | 'c';" 这类文本里取出所有单引号字符串 */
const quoted = (s) => (s.match(/'([a-z]+)'/g) || []).map((x) => x.replace(/'/g, ''));

/** 从 chips 数组文本里取 key: 'x' 的 x */
const chipKeys = (s) => (s.match(/key:\s*'([a-z]+)'/g) || []).map((x) => x.replace(/.*'([a-z]+)'.*/, '$1'));

/** 从 wxss 文本里取类名（去重后排序） */
const wxssKeys = (s, re) => {
  const out = [];
  let m;
  const r = new RegExp(re.source, 'g');
  while ((m = r.exec(s))) out.push(m[1]);
  return out;
};

let failed = 0;

function dim(name, unionMark, constMark, chipMark, wxssRe) {
  const union = uniq(quoted(slice(skin, unionMark[0], unionMark[1])));
  const arr = uniq(quoted(slice(skin, constMark[0], constMark[1])));
  const chips = uniq(chipKeys(slice(skin, chipMark[0], chipMark[1])));
  const cls = uniq(wxssKeys(idxWxss, wxssRe));

  const checks = [
    ['类型 == 常量数组', cmp(union, arr)],
    ['常量数组 == 选择器 chips', cmp(arr, chips)],
    ['常量数组 == WXSS 类名', cmp(arr, cls)]
  ];

  console.log(`\n=== ${name} ===`);
  console.log('  类型  :', union.join(' ') || '(空)');
  console.log('  常量  :', arr.join(' ') || '(空)');
  console.log('  chips :', chips.join(' ') || '(空)');
  console.log('  wxss  :', cls.join(' ') || '(空)');
  checks.forEach(([label, ok]) => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
    if (!ok) failed++;
  });
}

dim('主页风格 homeStyle',
  ['export type HomeStyle =', ';'],
  ['export const HOME_STYLES', '];'],
  ['export const HOME_STYLE_CHIPS', '];'],
  /\.themed\.home-style-([a-z]+)\s*\{/);

dim('主页背景 homeBg',
  ['export type HomeBg =', ';'],
  ['export const HOME_BGS', '];'],
  ['export const HOME_BG_CHIPS', '];'],
  /\.ambient-layer--([a-z]+)/);

console.log(`\n结果：${failed === 0 ? '全部通过 ✅' : failed + ' 项不一致 ❌'}`);
process.exit(failed === 0 ? 0 : 1);
