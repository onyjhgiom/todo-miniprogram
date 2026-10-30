// scripts/check-asset-ledger.js
// 资产账本自检：
//   ① 用真实 store 代码（stub 掉 wx）跑一遍计算口径，逐项核对参考图上的数字
//   ② WXML 事件绑定 ↔ TS 方法、template 字段 ↔ ICardVM、WXSS 括号配平、页面注册
//
// 用法：node scripts/check-asset-ledger.js
const fs = require('fs');
const ts = require('C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript');

const ROOT = 'C:/Users/陈乐天/WorkBuddy/2026-09-07-09-23-30/todo-miniprogram/miniprogram/';
const PG = ROOT + 'subpackages/tools/pages/asset-ledger/';
const STORE_TS = ROOT + 'subpackages/tools/utils/asset-store.ts';

let fail = 0;
const ok = (cond, label, extra) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? '  → ' + extra : ''}`);
  if (!cond) fail++;
};

/* ==================== ① 载入 store 并核对数字 ==================== */

const mem = new Map();
global.wx = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); }
};

const jsSrc = ts.transpileModule(fs.readFileSync(STORE_TS, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }
}).outputText;

const mod = { exports: {} };
new Function('exports', 'require', 'module', jsSrc)(mod.exports, require, mod);
const S = mod.exports;

S.ensureSeed();

const assets = S.loadAssets();
const spends = S.loadSpends();

const aOv = S.assetOverview(assets);
const sOv = S.spendOverview(spends);
const aViews = assets.map((a) => S.assetView(a, ''));
const sViews = spends.map((s) => S.spendView(s, ''));

console.log('=== 参考图数字核对（图1 我的资产）===');
ok(aOv.badge === '4 件', '资产总览徽章 = 4 件', aOv.badge);
ok(aOv.k1Value === '¥315,597', '资产总额 = ¥315,597', aOv.k1Value);
ok(aOv.k2Value === '¥1,580.58', '日均成本 = ¥1,580.58', aOv.k2Value);
ok(aOv.stats[0].value === 4 && aOv.stats[1].value === 0 && aOv.stats[2].value === 0,
  '服役中 4 / 已退役 0 / 已卖出 0',
  aOv.stats.map((s) => s.label + ' ' + s.value).join(' / '));

const want = {
  特斯拉: { meta: '¥300,000 · 已用 207 天', num: '¥1,449.28', remain: '可用 3446 天' },
  'Mac mini m4': { meta: '¥3,799 · 已用 127 天', num: '¥29.91', remain: '可用 1699 天' },
  'iphone air': { meta: '¥5,299 · 已用 56 天', num: '¥94.63', remain: '可用 309 天' },
  'Applewatch Ultra2': { meta: '¥6,499 · 已用 960 天', num: '¥6.77', remain: '可用 866 天' }
};
aViews.forEach((v) => {
  const w = want[v.name];
  if (!w) { ok(false, `未知资产 ${v.name}`); return; }
  ok(v.meta === w.meta, `${v.name} 副信息`, `${v.meta}  (期望 ${w.meta})`);
  ok(v.num === w.num, `${v.name} 日均成本`, `${v.num}/天  (期望 ${w.num})`);
  ok(v.footRight === w.remain, `${v.name} 可用天数`, `${v.footRight}  (期望 ${w.remain})`);
  ok(v.badge === '服役中', `${v.name} 状态徽章`, v.badge);
});

console.log('\n=== 资产质保行（本轮新增）===');
const wWant = {
  特斯拉: { line: '剩 1254 天', color: '#22C55E' },
  'Mac mini m4': { line: '剩 238 天', color: '#22C55E' },
  'iphone air': { line: '剩 309 天', color: '#22C55E' },
  'Applewatch Ultra2': { line: '已过保 595 天', color: '#9CA3AF' }
};
aViews.forEach((v) => {
  const w = wWant[v.name];
  if (!w) { ok(false, `未知资产质保 ${v.name}`); return; }
  ok(v.warrantyLine.indexOf(w.line) >= 0, `${v.name} 质保行`, `${v.warrantyLine}  (含 "${w.line}")`);
  ok(v.warrantyColor === w.color, `${v.name} 质保配色`, v.warrantyColor);
});

console.log('\n=== 参考图数字核对（图2 每月支出）===');
// 示例数据已从「只有 3 条数码 / 通信」扩到覆盖十几个分类（见 seedSpends）：
// 前三项仍与参考图逐字段一致，下面的逐项期望值里 Saily / Tello / 特斯拉 就是那三条。
ok(sOv.badge === '14 项', '支出总览徽章 = 14 项', sOv.badge);
ok(sOv.k1Value === '¥8,709', '月均固定支出 = ¥8,709', sOv.k1Value);
ok(sOv.k2Value === '¥8,709', '本月待支付 = ¥8,709', sOv.k2Value);
ok(sOv.stats[0].value === 2 && sOv.stats[1].value === 12 && sOv.stats[2].value === 3,
  '贷款月供 2 / 固定支出 12 / 近 7 天 3',
  sOv.stats.map((s) => s.label + ' ' + s.value).join(' / '));

const sWant = {
  特斯拉: { meta: '¥300,000 · 已还 7/60 期', num: '¥3,060', unit: '/月', side: '¥162,180', foot: '已还 7/60 期', footR: '还有 23 天', bar: true },
  Saily: { meta: '周期费 ¥7 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 28 天', footR: '', bar: false },
  Tello: { meta: '周期费 ¥39 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 26 天', footR: '', bar: false },
  'iPhone 17 Pro': { meta: '¥8,999 · 已还 3/12 期', num: '¥750', unit: '/月', side: '¥6,750', foot: '已还 3/12 期', footR: '还有 12 天', bar: true },
  // 订阅类：累计 = 已缴期数 × 周期费；月均 = 累计 ÷ 已用月数
  // （示例里给了 6 期、半年前开始的历史，所以月均正好等于周期费；0 期的两项则是 ¥0）
  Netflix: { meta: '周期费 ¥75 · 每月', num: '¥450', unit: '累计', side: '¥75', foot: '距缴费还有 9 天', footR: '', bar: false },
  Spotify: { meta: '周期费 ¥15 · 每月', num: '¥90', unit: '累计', side: '¥15', foot: '距缴费还有 18 天', footR: '', bar: false },
  ChatGPT: { meta: '周期费 ¥140 · 每月', num: '¥840', unit: '累计', side: '¥140', foot: '距缴费还有 20 天', footR: '', bar: false },
  'iCloud+': { meta: '周期费 ¥21 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 15 天', footR: '', bar: false },
  原神月卡: { meta: '周期费 ¥30 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 11 天', footR: '', bar: false },
  房租: { meta: '周期费 ¥3,200 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 3 天', footR: '', bar: false },
  健身房月卡: { meta: '周期费 ¥299 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 25 天', footR: '', bar: false },
  百万医疗险: { meta: '周期费 ¥58 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 5 天', footR: '', bar: false },
  外卖会员: { meta: '周期费 ¥15 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 8 天', footR: '', bar: false },
  家用生活费: { meta: '周期费 ¥1,000 · 每月', num: '¥0', unit: '累计', side: '¥0', foot: '距缴费还有 1 天', footR: '', bar: false }
};
sViews.forEach((v) => {
  const w = sWant[v.name];
  if (!w) { ok(false, `未知订阅 ${v.name}`); return; }
  ok(v.meta === w.meta, `${v.name} 副信息`, `${v.meta}  (期望 ${w.meta})`);
  ok(v.num === w.num && v.unit === w.unit, `${v.name} 主金额`, `${v.num} ${v.unit}  (期望 ${w.num} ${w.unit})`);
  ok(v.sideNum === w.side, `${v.name} 右侧金额`, `${v.sideLabel} ${v.sideNum}  (期望 ${w.side})`);
  ok(v.footLeft === w.foot, `${v.name} 底部左`, `${v.footLeft}  (期望 ${w.foot})`);
  ok(v.footRight === w.footR, `${v.name} 底部右`, `"${v.footRight}"  (期望 "${w.footR}")`);
  ok(v.showBar === w.bar, `${v.name} 进度条显隐`, String(v.showBar));
  ok(v.showBar === false || (v.progress > 0 && v.progress < 100), `${v.name} 进度值合理`, v.progress.toFixed(2) + '%');
});
// 示例数据必须真的铺开分类，否则「每月支出」看着还像只有数码产品那两类
const seededCats = [...new Set(spends.map((s) => s.categoryId))];
ok(seededCats.length >= 10, '示例数据覆盖 ≥10 个分类', seededCats.join(','));
ok(spends.filter((s) => s.kind === 'loan').length === 2, '示例含 2 笔分期月供',
  spends.filter((s) => s.kind === 'loan').map((s) => s.name).join(','));

console.log('\n=== 图片内品牌色块 ===');
const saily = sViews.find((v) => v.name === 'Saily');
const tello = sViews.find((v) => v.name === 'Tello');
ok(saily.picKind === 'logo' && saily.picText === 'Saily', 'Saily 用品牌色块', `${saily.picKind}/${saily.picText}`);
ok(saily.picBg === '#FFD60A', 'Saily 黄底', saily.picBg);
ok(tello.picKind === 'logo' && tello.picBg === '#1B4FD8', 'Tello 蓝底', `${tello.picBg}`);
ok(sViews[0].picKind === 'emoji', '特斯拉贷款用 emoji 图', sViews[0].picEmoji);

console.log('\n=== 分类 Tab 动态生成 ===');
// 分类定义从页面源码抽取（不再在脚本里存副本，避免与页面漂移）
const CATS = require('./lib/cat-defs').readCatDefs();
const aCats = S.buildCategoryTabs(CATS.assets);
const sCats = S.buildCategoryTabs(CATS.spends);
ok(aCats.map((c) => c.name).join('/') === ['全部', ...CATS.assets.map((c) => c.name)].join('/'),
  '资产分类 Tab（全部 12 类固定展示）', aCats.map((c) => c.name).join('/'));
ok(sCats.map((c) => c.name).join('/') === ['全部', ...CATS.spends.map((c) => c.name)].join('/'),
  '订阅分类 Tab（全部分类固定展示）', sCats.map((c) => c.name).join('/'));
console.log(`     资产分类清单（${CATS.assets.length} 类）：${CATS.assets.map((c) => c.name).join(' / ')}`);
console.log(`     订阅分类清单（${CATS.spends.length} 类）：${CATS.spends.map((c) => c.name).join(' / ')}`);
ok(!CATS.assets.concat(CATS.spends).some((c) => /esim/i.test(c.id) || /esim/i.test(c.name)),
  'esim 分类已移除', '资产与订阅分类里都不含 esim');

// 订阅分类的丰富度：不该只有数码 / 通信两类（这是最初的坑）
ok(CATS.spends.length >= 12, '订阅分类 ≥12 类（与「我的资产」同级）', String(CATS.spends.length));
ok(['digital', 'telecom'].every((id) => CATS.spends.some((c) => c.id === id)),
  '老分类 digital / telecom 保留（旧数据不丢归属）',
  CATS.spends.filter((c) => ['digital', 'telecom'].indexOf(c.id) >= 0).map((c) => c.name).join('/'));

// 每个分类都要有推荐图标清单，且清单内 emoji 不重复（wxml 用 wx:key="*this"，重复会告警）
{
  const tsPageSrc = fs.readFileSync(PG + 'asset-ledger.ts', 'utf8');
  const iconBlock = (tsPageSrc.match(/const SPEND_CAT_ICONS[\s\S]*?= \{([\s\S]*?)\n\};/) || [])[1] || '';
  const iconKeys = (iconBlock.match(/^\s{2}(\w+):\s*\[/gm) || [])
    .map((s) => s.trim().replace(/:\s*\[$/, ''));
  const noIcon = CATS.spends.filter((c) => iconKeys.indexOf(c.id) < 0);
  ok(iconKeys.length > 0 && noIcon.length === 0, `每个订阅分类都有推荐图标（${iconKeys.length} 组）`,
    iconKeys.length ? (noIcon.length ? '缺：' + noIcon.map((c) => c.name).join(',') : '全部命中') : '未解析到 SPEND_CAT_ICONS');
  const dup = [];
  (iconBlock.match(/^\s{2}\w+:\s*\[([^\]]*)\]/gm) || []).forEach((line) => {
    const list = (line.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
    if (new Set(list).size !== list.length) dup.push(line.trim().split(':')[0]);
  });
  ok(dup.length === 0, '推荐图标清单内无重复 emoji', dup.length ? '重复：' + dup.join(',') : '无重复');
}

console.log('\n=== 筛选与排序 ===');
const serving = aViews.filter((v) => v.statusKey === 'serving');
ok(serving.length === 4, '服役中筛选', String(serving.length));
const loans = sViews.filter((v) => v.statusKey === 'loan');
ok(loans.length === 2 && loans.map((v) => v.name).join(',') === '特斯拉,iPhone 17 Pro',
  '贷款月供筛选', loans.map((v) => v.name).join(','));
const sorted = S.sortCards(aViews, 'main');
ok(sorted[0].name === '特斯拉', '按日均成本降序 → 特斯拉居首', sorted.map((v) => v.name).join(' > '));
const { left, right } = S.splitColumns(sorted);
ok(left.length === 2 && right.length === 2, '两列分列 2/2', `${left.length}/${right.length}`);
ok(left[0].name === sorted[0].name, '首个元素进左列', left[0].name);

console.log('\n=== 金额格式（整数不带小数 / 有零头带两位）===');
ok(S.money(31559700) === '¥315,597', 'money(31559700)', S.money(31559700));
ok(S.money(158058) === '¥1,580.58', 'money(158058)', S.money(158058));
ok(S.money(0) === '¥0', 'money(0)', S.money(0));
ok(S.money(16218000) === '¥162,180', 'money(16218000)', S.money(16218000));

/* ==================== ② 静态一致性 ==================== */

console.log('\n=== 静态一致性 ===');
const wxml = fs.readFileSync(PG + 'asset-ledger.wxml', 'utf8');
const wxss = fs.readFileSync(PG + 'asset-ledger.wxss', 'utf8');
const tsPage = fs.readFileSync(PG + 'asset-ledger.ts', 'utf8');

// 事件绑定 ↔ 方法
const handlers = [...new Set(
  (wxml.match(/\b(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g) || [])
    .map((s) => s.replace(/.*="([^"]*)"/, '$1'))
)];
const missing = handlers.filter((h) => !new RegExp(`\\n  ${h}\\s*\\(`).test(tsPage));
ok(missing.length === 0, `事件绑定 ↔ 方法（${handlers.length} 个）`, missing.length ? '缺：' + missing.join(',') : '全部存在');

// template 字段 ↔ ICardVM
function vmInterface() {
  const src = fs.readFileSync(STORE_TS, 'utf8');
  const m = src.match(/export interface ICardVM \{([\s\S]*?)\n\}/);
  return m ? m[1] : '';
}
const vmFields = new Set(
  (vmInterface().match(/^\s{2}([A-Za-z_$][\w$]*)\??:/gm) || []).map((s) => s.trim().replace(/\??:$/, ''))
);
const tplBlock = (wxml.match(/<template name="cardTpl">([\s\S]*?)<\/template>/) || [])[1] || '';
const tplIds = new Set();
(tplBlock.match(/\{\{([\s\S]*?)\}\}/g) || []).forEach((raw) => {
  const expr = raw.slice(2, -2).replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  (expr.match(/[A-Za-z_$][\w$]*/g) || []).forEach((id) => {
    if (['true', 'false', 'null', 'undefined'].indexOf(id) >= 0) return;
    tplIds.add(id);
  });
});
const badFields = [...tplIds].filter((id) => !vmFields.has(id));
ok(badFields.length === 0, `template 字段 ⊆ ICardVM（用到 ${tplIds.size} 个）`,
  badFields.length ? '多余：' + badFields.join(',') : '全部命中');

// 必填字段存在
['id', 'name', 'num', 'unit', 'badge', 'meta', 'footLeft', 'progress'].forEach((f) => {
  if (!vmFields.has(f)) { ok(false, `ICardVM 缺字段 ${f}`); }
});

// WXSS 括号配平
const ob = (wxss.match(/\{/g) || []).length;
const cb = (wxss.match(/\}/g) || []).length;
ok(ob === cb, `WXSS 大括号配平 ${ob}/${cb}`, ob === cb ? '' : 'MISMATCH');

// 右下 FAB 几何验算：位置、与 dock 的间距、底部占位是否足以让最后一行卡片不被压住。
// 只改 wxss 里任一个数字（dock 高度 / FAB 尺寸 / .al__pad），这里就会亮红。
{
  const num = (re) => { const m = wxss.match(re); return m ? parseFloat(m[1]) : NaN; };
  const dockPad = num(/\.dock \{[^}]*padding: 0 40rpx calc\((\d+)rpx/);
  const dockBtn = num(/\.dock__btn \{[^}]*height: (\d+)rpx/);
  const fabBottom = num(/\.fab \{[^}]*bottom: calc\((\d+)rpx/);
  const fabSize = num(/\.fab \{[^}]*width: (\d+)rpx/);
  const fabHot = num(/\.fab::after \{[^}]*top: -(\d+)rpx/) * 2;
  const pad = num(/\.al__pad \{[^}]*height: (\d+)rpx/);

  ok(dockPad === 26 && dockBtn === 92, 'dock 几何（下内边距 26 / 按钮高 92）', `${dockPad} / ${dockBtn}`);
  const dockTop = dockPad + dockBtn;
  const gap = fabBottom - dockTop;
  ok(gap === 34, 'FAB 底边与 dock 顶边间距 34rpx', `${gap}rpx`);
  ok(fabBottom - fabHot / 2 > dockTop, 'FAB 外扩热区不侵入 dock（不会误触底部按钮）',
    `热区底 ${fabBottom - fabHot / 2}rpx > dock 顶 ${dockTop}rpx`);
  ok(pad >= fabBottom + fabSize, '底部占位 ≥ FAB 顶边距屏幕底（滚到底不压最后一行卡片）',
    `pad ${pad}rpx ≥ ${fabBottom + fabSize}rpx`);
  // 热区换算：rpx → px 取决于屏宽，取最窄的 320px 机型做下限（320 / 750）
  const hotPx = ((fabSize + fabHot) * 320) / 750;
  ok(hotPx >= 44, 'FAB 可点范围在 320px 窄屏 ≥ 44px', `${hotPx.toFixed(1)}px`);
  ok(/bindtap="onCreate"/.test(wxml.split('class="fab"')[1] || ''), 'FAB 绑定 onCreate', '右下加号复用新增入口');
  ok(/点右下角/.test(wxml), '空状态文案指向右下角', '避免指向已搬迁的入口');

  // 入口唯一性：右上角的橙色加号已移除，新增只能走右下 FAB。
  // 顺带清掉随它一起失效的按下态样式，避免留下永远不会被触发的死代码。
  ok(!/al__round--primary/.test(wxml) && !/al__round--primary/.test(wxss),
    '右上角加号已移除（wxml 无节点、wxss 无样式）');
  ok(!/al__round--press/.test(wxml) && !/al__round--press/.test(wxss),
    '加号按下态样式一并清理', 'al__round--press 已无用');
  const onCreateCount = (wxml.match(/bindtap="onCreate"/g) || []).length;
  ok(onCreateCount === 1, 'onCreate 全页仅一处绑定（右下 FAB）', `${onCreateCount} 处`);
}

// WXML 标签配对（复用已有脚本的简化版）
const VOID = new Set(['image', 'input', 'icon', 'progress', 'slider', 'switch', 'textarea']);
{
  const src = wxml.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m; let bad = 0;
  while ((m = re.exec(src))) {
    const [, close, tag, , selfClose] = m;
    if (close) {
      const top = stack.pop();
      if (!top || top !== tag) bad++;
    } else if (!selfClose && !VOID.has(tag)) stack.push(tag);
  }
  ok(bad === 0 && stack.length === 0, 'WXML 标签配对', bad || stack.length ? `未配对 ${bad} / 未闭合 ${stack.length}` : '全部配对');
}

// 页面注册与入口
const appJson = JSON.parse(fs.readFileSync(ROOT + 'app.json', 'utf8'));
const pkg = (appJson.subpackages || []).find((p) => p.root === 'subpackages/tools');
ok(!!pkg && pkg.pages.indexOf('pages/asset-ledger/asset-ledger') >= 0,
  'app.json 分包注册', pkg ? String(pkg.pages.indexOf('pages/asset-ledger/asset-ledger') >= 0) : 'no pkg');

const toolSrc = fs.readFileSync(ROOT + 'utils/tools.ts', 'utf8');
ok(/id: 'asset-ledger'/.test(toolSrc), 'utils/tools.ts 工具条目');
ok(/asset-ledger/.test(tsPage) && /asset-ledger/.test(fs.readFileSync(ROOT + 'pages/tools/tools.ts', 'utf8')),
  'pages/tools 路由表');

// 四个页面文件齐全
['ts', 'wxml', 'wxss', 'json'].forEach((ext) => {
  ok(fs.existsSync(PG + 'asset-ledger.' + ext), `页面文件 asset-ledger.${ext}`);
});

/* ==================== ③ 老数据增量补种 ==================== */

console.log('\n=== 老数据增量补种（v1 三条示例 → 完整示例）===');
// 模拟「v1 时代装过、只灌了 3 条示例、用户一行没动」的本地存储
mem.clear();
mem.set('al_seed_v1', 1);
mem.set('al_assets_v1', []);
mem.set('al_spends_v1', spends.slice(0, 3));
S.ensureSeed();
ok(S.loadSpends().length === 14, '没动过的老数据 → 补成完整示例', `${S.loadSpends().length} 条`);

// 用户自己加过一条：一条都不能覆盖（安全性优先于「让用户看到新示例」）
mem.clear();
mem.set('al_seed_v1', 1);
mem.set('al_assets_v1', []);
mem.set('al_spends_v1', spends.slice(0, 3).concat([{
  id: 'mine', name: '我的订阅', logoText: '', logoBg: '', logoFg: '', icon: '🎬',
  amount: 0, fee: 100, kind: 'fixed', categoryId: 'media', periods: 0, paidPeriods: 0,
  nextDueAt: Date.now(), createTime: Date.now()
}]));
S.ensureSeed();
const kept = S.loadSpends();
ok(kept.length === 4 && kept[3].name === '我的订阅', '用户动过的数据 → 一条都不补', `${kept.length} 条`);

console.log(`\n${fail ? '❌ 失败 ' + fail + ' 项' : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
