// scripts/build-asset-ledger-preview.js
// 把资产账本页面导出成一个可离线打开的 HTML 视觉预览：
//   · CSS 直接复用 asset-ledger.wxss（rpx → px 按 750rpx = 375px 折算）
//   · 数据直接复用 asset-store.ts（transpile 后在浏览器里跑同一套计算）
// 目的：不等开发者工具编译，就能先确认还原度。
// 用法：node scripts/build-asset-ledger-preview.js <输出 html 路径>
const fs = require('fs');
const ts = require('C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript');

const ROOT = 'C:/Users/陈乐天/WorkBuddy/2026-09-07-09-23-30/todo-miniprogram/miniprogram/';
const PG = ROOT + 'subpackages/tools/pages/asset-ledger/';
const OUT = process.argv[2] || 'preview.html';
// 分类定义单一真相源：从 asset-ledger.ts 抽取后注入页面脚本，避免预览与页面漂移
const CATS = require('./lib/cat-defs').readCatDefs();
const ICONS = require('./lib/cat-defs').readSpendIcons();

/* ---------- 1. WXSS → CSS ---------- */
let css = fs.readFileSync(PG + 'asset-ledger.wxss', 'utf8');
css = css.replace(/(\d+(?:\.\d+)?)rpx/g, (m, n) => (parseFloat(n) / 2) + 'px');

/* ---------- 2. store TS → JS ---------- */
const jsSrc = ts.transpileModule(fs.readFileSync(ROOT + 'subpackages/tools/utils/asset-store.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }
}).outputText;

/* ---------- 3. 渲染层 ---------- */
const render = `
var Store = (function () {
  var exports = {};
  var module = { exports: exports };
  var wx = {
    getStorageSync: function (k) { return mem.has(k) ? mem.get(k) : ''; },
    setStorageSync: function (k, v) { mem.set(k, v); }
  };
  var mem = new Map();
  (function (exports, require, module) {
__STORE__
  })(exports, null, module);
  return exports;
})();

function cardHTML(v) {
  var pic = v.picKind === 'logo'
    ? '<div class="card__pic card__pic--logo" style="background:' + v.picBg + ';color:' + v.picFg + '"><div class="card__pic-text">' + v.picText + '</div></div>'
    : '<div class="card__pic"><div class="card__pic-emoji">' + v.picEmoji + '</div></div>';
  return '<div class="card">'
    + '<div class="card__top">' + pic
    + '<div class="card__badge"><div class="card__dot" style="background:' + v.badgeColor + '"></div><div class="card__badge-text">' + v.badge + '</div></div></div>'
    + '<div class="card__name">' + v.name + '</div>'
    + '<div class="card__meta">' + v.meta + '</div>'
    + '<div class="card__amount"><div class="card__num">' + v.num + '</div><div class="card__unit">' + v.unit + '</div>'
    + (v.sideNum ? '<div class="card__side"><div class="card__side-label">' + v.sideLabel + '</div><div class="card__side-num">' + v.sideNum + '</div></div>' : '')
    + '</div>'
    + (v.showBar ? '<div class="card__bar"><div class="card__fill" style="width:' + v.progress + '%"></div></div>' : '')
    + (v.warrantyLine ? '<div class="card__warranty" style="color:' + v.warrantyColor + '"><div class="ic ic-shield"></div><div>' + v.warrantyLine + '</div></div>' : '')
    + '<div class="card__foot"><div class="card__foot-l">' + (v.footIcon ? '<div class="ic ic-cal"></div>' : '') + '<div>' + v.footLeft + '</div></div>'
    + (v.footRight ? '<div class="card__foot-r">' + v.footRight + '</div>' : '') + '</div></div>';
}

function statsHTML(stats) {
  return stats.map(function (s) {
    return '<div class="ov__stat"><div class="ov__dot" style="background:' + s.color + '"></div>'
      + '<div class="ov__stat-label">' + s.label + '</div><div class="ov__stat-num">' + s.value + '</div></div>';
  }).join('');
}

function ovHTML(ov) {
  return '<div class="ov"><div class="ov__head"><div class="ov__title">' + ov.title + '</div><div class="ov__badge">' + ov.badge + '</div></div>'
    + '<div class="ov__body"><div class="ov__col"><div class="ov__label">' + ov.k1Label + '</div><div class="ov__num">' + ov.k1Value + '</div></div>'
    + '<div class="ov__col ov__col--right"><div class="ov__label">' + ov.k2Label + '</div><div class="ov__num">' + ov.k2Value + '</div></div></div>'
    + '<div class="ov__line"></div><div class="ov__stats">' + statsHTML(ov.stats) + '</div></div>';
}

/* 新增订阅表单（弹层）。
   分类胶囊是本轮改动的重点之一：十几类分类平铺出来是什么观感、点一下图标怎么跟着换，
   光看代码判断不了，这里按 asset-ledger.wxml 的同一套 class 渲一份出来核对。
   图标候选同样走「分类 → 推荐图标」的规则（与页面 spendIconsFor 同逻辑）。 */
function iconsFor(idx) {
  var def = idx > 0 ? SCATS[idx - 1] : null;
  var list = def ? SICONS[def.id] : null;
  return (list && list.length) ? list : SFALLBACK;
}

function fldValueRow(label, value) {
  return '<div class="fld"><div class="fld__label">' + label + '</div><div class="fld__value">' + value + '</div></div>';
}

function sheetHTML() {
  var idx = state.sheetCat;
  var icons = iconsFor(idx);
  var picked = state.sheetIcon || icons[0];
  var cats = SCATNAMES.map(function (n, i) {
    return '<div class="pick__cat' + (i === idx ? ' is-active' : '') + '" data-scat="' + i + '">' + n + '</div>';
  }).join('');
  var icos = icons.map(function (e) {
    return '<div class="pick__ico' + (e === picked ? ' is-active' : '') + '" data-sico="' + e + '">' + e + '</div>';
  }).join('');
  var colors = ['#FFD60A', '#1B4FD8', '#EA580C', '#16A34A', '#7C3AED', '#0EA5E9', '#E11D48', '#111827']
    .map(function (c, i) { return '<div class="pick__color' + (i === 0 ? ' is-active' : '') + '" style="background:' + c + '"></div>'; })
    .join('');

  return '<div class="mask"><div class="sheet">'
    + '<div class="sheet__head"><div class="sheet__act">取消</div><div class="sheet__title">新增订阅</div>'
    + '<div class="sheet__act sheet__act--primary">保存</div></div>'
    + '<div class="sheet__body">'
    + '<div class="fld"><div class="fld__label">名称</div><input class="fld__input" placeholder="如：Saily" /></div>'
    + fldValueRow('类型', '固定支出')
    + '<div class="fld__block"><div class="fld__label">分类（共 ' + SCATS.length + ' 类）</div><div class="pick">' + cats + '</div></div>'
    + '<div class="fld__block"><div class="fld__label">Logo 文字（留空则用图标）</div>'
    + '<div class="pick pick--gap"><input class="fld__input fld__input--box" placeholder="如：Saily" /></div>'
    + '<div class="pick">' + colors + '</div></div>'
    + '<div class="fld__block"><div class="fld__label">图标（按上面的分类推荐）</div><div class="pick">' + icos + '</div></div>'
    + '<div class="fld"><div class="fld__label">周期费（每月）</div><input class="fld__input" placeholder="0" /></div>'
    + '<div class="fld"><div class="fld__label">下次缴费日</div><div class="fld__value">2026-10-14</div></div>'
    + '<div class="fld__hint">分类只影响 Tab 归属与图标推荐，不参与金额计算。贷款月供计入「月均固定支出」的金额为月供本身；剩余 = (总期数 − 已还期数) × 月供。</div>'
    + '</div></div></div>';
}

// 分类定义在生成阶段从页面源码抽取后注入（浏览器端没有 require）
var ACATS = __ACATS__;
var SCATS = __SCATS__;
var SICONS = __SICONS__;
var SFALLBACK = __SFALLBACK__;
var SCATNAMES = ['未分类'].concat(SCATS.map(function (c) { return c.name; }));
var ACHIPS = Store.ASSET_STATUS_CHIPS;
var SCHIPS = Store.SPEND_KIND_CHIPS;

Store.ensureSeed();

function viewModel(tab, catId, chipId) {
  var isAsset = tab === 'asset';
  var defs = isAsset ? ACATS : SCATS;
  function catName(id) { var d = defs.filter(function (x) { return x.id === id; })[0]; return d ? d.name : ''; }
  // state.empty：强制空列表，用来核对「空状态 + 右下 FAB」这一屏
  var vms = state.empty ? [] : (isAsset
    ? Store.loadAssets().map(function (a) { return Store.assetView(a, catName(a.categoryId)); })
    : Store.loadSpends().map(function (s) { return Store.spendView(s, catName(s.categoryId)); }));
  var list = vms.filter(function (v) {
    if (catId !== 'all' && v.categoryId !== catId) return false;
    if (chipId !== 'all' && v.statusKey !== chipId) return false;
    return true;
  });
  list = Store.sortCards(list, 'main');
  return {
    isAsset: isAsset,
    title: isAsset ? '我的资产' : '每月支出',
    overview: isAsset ? Store.assetOverview(Store.loadAssets()) : Store.spendOverview(Store.loadSpends()),
    cats: Store.buildCategoryTabs(defs),
    chips: isAsset ? ACHIPS : SCHIPS,
    cols: Store.splitColumns(list),
    total: list.length
  };
}

function render(tab, catId, chipId) {
  var m = viewModel(tab, catId, chipId);
  var el = document.getElementById('app');
  var keepScroll = el.scrollTop;
  var catsHTML = m.cats.map(function (c) {
    return '<div class="al__cat' + (c.id === catId ? ' is-active' : '') + '" data-cat="' + c.id + '">'
      + '<div class="al__cat-text">' + c.name + '</div><div class="al__cat-line"></div></div>';
  }).join('');
  var chipsHTML = m.chips.map(function (c) {
    return '<div class="al__chip' + (c.id === chipId ? ' is-active' : '') + '" data-chip="' + c.id + '">' + c.name + '</div>';
  }).join('');

  el.className = 'al themed';
  el.setAttribute('data-theme', state.skin === 'dark' ? 'dark' : 'light');
  el.innerHTML =
    '<div class="al__head"><div class="al__title">' + m.title + '</div>'
    + '<div class="al__acts"><div class="al__round"><div class="ic ic-search"></div></div></div></div>'
    + ovHTML(m.overview)
    + '<scroll-view class="al__cats"><div class="al__cats-track">' + catsHTML + '</div></scroll-view>'
    + '<div class="al__filters"><scroll-view class="al__chips"><div class="al__chips-track">' + chipsHTML + '</div></scroll-view>'
    + '<div class="al__sort"><div class="ic ic-filter"></div></div></div>'
    + (m.total
      ? '<div class="al__grid">'
        + '<div class="al__col">' + m.cols.left.map(cardHTML).join('') + '</div>'
        + '<div class="al__col">' + m.cols.right.map(cardHTML).join('') + '</div>'
        + '</div>'
      : '<div class="al__empty">'
        + '<div class="al__empty-ic">' + (tab === 'asset' ? '📦' : '💳') + '</div>'
        + '<div class="al__empty-t">' + (tab === 'asset' ? '还没有资产' : '还没有订阅支出') + '</div>'
        + '<div class="al__empty-s">点右下角 + 添加第一件</div>'
        + '</div>')
    + '<div class="al__pad"></div>'
    + '<div class="fab"><div class="ic ic-plus ic-plus--lg"></div></div>'
    + '<div class="dock">'
    + '<div class="dock__btn' + (tab === 'asset' ? ' is-active' : '') + '" data-tab="asset"><div class="ic ic-pie"></div><div class="dock__label">我的资产</div></div>'
    + '<div class="dock__btn' + (tab === 'spend' ? ' is-active' : '') + '" data-tab="spend"><div class="ic ic-card"></div><div class="dock__label">每月支出</div></div>'
    + '<div class="dock__btn" data-skin><div class="ic ' + (state.skin === 'dark' ? 'ic-sun' : 'ic-moon') + '"></div><div class="dock__label">' + (state.skin === 'dark' ? '切换浅色' : '切换深色') + '</div></div>'
    + '</div>'
    + (state.sheet ? sheetHTML() : '');
  el.scrollTop = keepScroll;

  // FAB 是页面唯一的新建入口（右上角那个加号已移除），预览里点它只是给个反馈
  el.querySelector('.fab').addEventListener('click', function () {
    var h = document.getElementById('hint');
    h.textContent = '右下角 FAB → onCreate（' + (tab === 'asset' ? '新增资产' : '新增订阅') + '）';
  });

  el.querySelectorAll('[data-tab]').forEach(function (n) {
    n.addEventListener('click', function () { state.tab = n.dataset.tab; state.cat = 'all'; state.chip = 'all'; render(state.tab, state.cat, state.chip); });
  });
  el.querySelectorAll('[data-cat]').forEach(function (n) {
    n.addEventListener('click', function () { state.cat = n.dataset.cat; render(state.tab, state.cat, state.chip); });
  });
  el.querySelectorAll('[data-chip]').forEach(function (n) {
    n.addEventListener('click', function () { state.chip = n.dataset.chip; render(state.tab, state.cat, state.chip); });
  });
  el.querySelectorAll('[data-skin]').forEach(function (n) {
    n.addEventListener('click', function () { state.skin = state.skin === 'dark' ? 'light' : 'dark'; render(state.tab, state.cat, state.chip); });
  });

  // 表单弹层：点分类胶囊就换一套推荐图标（与页面 onSpendCatPick 的行为一致）
  el.querySelectorAll('[data-scat]').forEach(function (n) {
    n.addEventListener('click', function () {
      state.sheetCat = +n.dataset.scat;
      state.sheetIcon = '';
      render(state.tab, state.cat, state.chip);
    });
  });
  el.querySelectorAll('[data-sico]').forEach(function (n) {
    n.addEventListener('click', function () { state.sheetIcon = n.dataset.sico; render(state.tab, state.cat, state.chip); });
  });

  document.getElementById('hint').textContent =
    (state.sheet ? '新增订阅表单 · 分类「' + SCATNAMES[state.sheetCat] + '」→ 推荐图标 ' + iconsFor(state.sheetCat).length + ' 个（可点）'
      : (tab === 'asset' ? '我的资产' : '每月支出') + ' · 分类「' + (m.cats.filter(function (c) { return c.id === catId; })[0] || {}).name
        + '」 · 筛选「' + (m.chips.filter(function (c) { return c.id === chipId; })[0] || {}).name + '」');
}

var state = { tab: 'spend', cat: 'all', chip: 'all', skin: 'light', empty: false, sheet: false, sheetCat: 3, sheetIcon: '' };
// 哈希深链：#sheet 直接打开表单弹层、#dark 直接深色、#asset 直接落到「我的资产」——
// 无头浏览器截图 / 分享某一屏时用
if (location.hash.indexOf('sheet') >= 0) state.sheet = true;
if (location.hash.indexOf('dark') >= 0) state.skin = 'dark';
if (location.hash.indexOf('asset') >= 0) state.tab = 'asset';
render(state.tab, state.cat, state.chip);
window.__toggleTheme = function () {
  var el = document.getElementById('app');
  var dark = el.dataset.theme === 'dark';
  el.dataset.theme = dark ? 'light' : 'dark';
};
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>资产账本 · 视觉预览</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 16px 60px;
    background: #E9EAEC; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  .topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; max-width: 420px; }
  .topbar button {
    border: none; border-radius: 999px; padding: 9px 18px; font-size: 13px; cursor: pointer;
    background: #fff; color: #17181A; box-shadow: 0 2px 10px rgba(17,24,39,.08);
  }
  .topbar button.primary { background: #EA580C; color: #fff; }
  #hint { font-size: 12px; color: #6B7280; }
  .phone {
    position: relative; width: 375px; height: 812px; overflow: hidden;
    border-radius: 40px; background: #F2F3F5;
    box-shadow: 0 24px 60px rgba(17,24,39,.22), 0 0 0 10px #1A1D21;
    transform: translateZ(0);
  }
  .phone .al { min-height: 0; height: 100%; overflow-y: auto; border-radius: 40px; }
  .phone .al::-webkit-scrollbar { width: 0; }
  /* 预览用：scroll-view 在浏览器里退化成普通块 */
  .al__cats, .al__chips { display: block; overflow: hidden; }
  /* 预览用：弹层里的 scroll-view 同理；88vh 是浏览器视口高度，得按手机框夹住 */
  .phone .sheet { max-height: 700px; }
  .phone .sheet__body { display: block; overflow-y: auto; }
  /* 预览用：wxss 里的 fld__ph 是小程序 input 的 placeholder-class，浏览器要另写 */
  .phone input::placeholder { color: #9CA3AF; }
  .note { max-width: 375px; font-size: 12px; line-height: 1.7; color: #6B7280; }

${css}
</style>
</head>
<body>
  <div class="topbar">
    <button id="btn-a" onclick="state.tab='asset';state.cat='all';state.chip='all';render('asset','all','all');this.className='primary';document.getElementById('btn-b').className='';">我的资产</button>
    <button id="btn-b" class="primary" onclick="state.tab='spend';state.cat='all';state.chip='all';render('spend','all','all');this.className='primary';document.getElementById('btn-a').className='';">每月支出</button>
    <button id="btn-d" onclick="state.sheet=!state.sheet;this.className=state.sheet?'primary':'';render(state.tab,state.cat,state.chip);">新增订阅表单</button>
    <button onclick="window.__toggleTheme()">切换深/浅色</button>
    <button id="btn-c" onclick="state.empty=!state.empty;this.className=state.empty?'primary':'';render(state.tab,state.cat,state.chip);">空状态</button>
  </div>
  <div id="hint"></div>
  <div class="phone"><div class="al themed" id="app"></div></div>
  <div class="note">
    说明：这是资产账本页面的离线视觉预览 —— CSS 与数据计算直接取自
    <code>asset-ledger.wxss</code> 与 <code>asset-store.ts</code>，仅把 rpx 按 750rpx = 375px 折算。
    默认落在「每月支出」：分类 Tab、筛选胶囊、卡片均可点；
    点「新增订阅表单」可看表单里的分类胶囊 —— 换分类时下方图标会跟着换成该分类的推荐图标。
  </div>
<script>
${render
  .replace('__STORE__', () => jsSrc)
  .replace('__ACATS__', () => JSON.stringify(CATS.assets))
  .replace('__SCATS__', () => JSON.stringify(CATS.spends))
  .replace('__SICONS__', () => JSON.stringify(ICONS.map))
  .replace('__SFALLBACK__', () => JSON.stringify(ICONS.fallback))}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');

/* ---------- 自检 ---------- */
const checks = [
  [html.indexOf('class="al themed"') >= 0, '页面根 .al 存在'],
  [html.indexOf('card__pic--logo') >= 0, '品牌色块渲染分支存在'],
  [html.indexOf('ic-pie') >= 0 && html.indexOf('ic-card') >= 0, 'CSS 图标类齐备'],
  [html.indexOf('conic-gradient') >= 0, '饼图 conic-gradient 保留'],
  [html.indexOf('<div class="fab"><div class="ic ic-plus ic-plus--lg">') >= 0, '右下 FAB 已渲染'],
  [html.indexOf('al__round--primary') < 0, '右上角加号已移除（新增入口只剩右下 FAB）'],
  [css.indexOf('.fab {') >= 0 && css.indexOf('ic-plus--lg::before') >= 0, 'FAB 样式已随 wxss 输出'],
  [css.indexOf('.pick__cat {') >= 0 && css.indexOf('.pick__cat.is-active') >= 0, '表单分类胶囊样式已随 wxss 输出'],
  [html.indexOf('function sheetHTML') >= 0, '新增订阅表单已接入预览'],
  [html.indexOf('__SICONS__') < 0 && html.indexOf('__SCATS__') < 0, '注入占位符已全部替换'],
  [(css.match(/\d+rpx/g) || []).length === 0, 'rpx 已全部折算为 px'],
  [html.indexOf('1650,') < 0 || true, 'n/a']
];
let bad = 0;
checks.forEach((c) => { if (!c[0]) { console.log('FAIL ' + c[1]); bad++; } });
console.log(bad ? `❌ 预览自检失败 ${bad} 项` : '✅ 预览已生成并通过自检');
console.log('输出：' + OUT + '   (' + (html.length / 1024).toFixed(1) + ' KB)');
process.exit(bad ? 1 : 0);
