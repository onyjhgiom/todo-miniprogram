/**
 * scripts/check-navbar.js —— 自定义导航避让胶囊的度量验算
 *
 * 直接用真实 utils/navbar.ts 编译后的代码，在多种机型参数下断言：
 *   ① 导航总高 = 状态栏 + 行高（box-sizing:border-box 下 height 就是它）
 *   ② 行高不会把 64rpx 的圆形按钮挤出行外
 *   ③ 自绘操作区右边界停在胶囊左侧（不然点击会被层级更高的胶囊抢走）
 *   ④ 让出胶囊后标题仍有足够宽度，不会被压没
 *   ⑤ 拿不到胶囊信息（接口报错）时兜底值依然可用
 *
 * 用法：node scripts/check-navbar.js
 */
const fs = require('fs');
const path = require('path');

/** typescript 定位：优先项目内，其次托管环境（与 check-openings / check-helper-ai 保持一致） */
function loadTs() {
  const candidates = [
    process.env.TSC_MODULE,
    path.join(__dirname, '..', 'node_modules', 'typescript'),
    path.join(require('os').homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript')
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (_e) { /* 继续找 */ }
  }
  return null;
}
const ts = loadTs();
if (!ts) {
  console.error('未找到 typescript：可用 TSC_MODULE 指定模块路径');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');

/**
 * navbar.ts 的位置。
 * 该模块曾被移入 tools 分包，脚本里的路径没跟着改，导致门禁长期报 ENOENT（假失败）。
 * 这里按候选列表查找，避免再因为目录搬迁而误报。
 */
const NAVBAR_CANDIDATES = [
  path.join(ROOT, 'miniprogram', 'utils', 'navbar.ts'),
  path.join(ROOT, 'miniprogram', 'subpackages', 'tools', 'utils', 'navbar.ts')
];
const NAVBAR_TS = NAVBAR_CANDIDATES.find((p) => fs.existsSync(p));
if (!NAVBAR_TS) {
  console.error('未找到 navbar.ts，尝试过：\n  ' + NAVBAR_CANDIDATES.join('\n  '));
  process.exit(1);
}

const NAVBAR_JS = ts.transpileModule(fs.readFileSync(NAVBAR_TS, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 }
}).outputText;

/** 页面自身左右 padding（rpx），对应 asset-ledger.wxss 的 .al { padding: 0 40rpx } */
const PAGE_PAD_RPX = 40;
/** 返回钮占宽（rpx）：64 裸箭头热区 + 与标题 8rpx 间距 */
const BACK_RPX = 64 + 8;
/** 标题「我的资产」= 4 字 × 字号，字号按屏宽三档（对应 wxss 的三个 @media） */
function titleRpxOf(winW) {
  if (winW <= 380) return 36 * 4;
  if (winW <= 414) return 40 * 4;
  return 44 * 4;
}
/** 操作区组内宽度（rpx）：右上角只剩一个 64rpx 搜索圆钮，无组内间距。
 *  （原先这里的橙色加号已迁到内容区右下角的浮动按钮，不再参与胶囊避让的宽度竞争） */
const ACTS_RPX = 64;
/** 胶囊惯例尺寸 */
const CAPSULE_W = 87;
const CAPSULE_RIGHT_OFFSET = 7;

let failed = 0;
function ok(label, cond, detail) {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? '  → ' + detail : ''}`);
  if (!cond) failed++;
}

/** 用给定的 wx 桩跑一遍真实 navbar 模块 */
function runNav(win, capsuleFn) {
  const mod = { exports: {} };
  const wxStub = { getWindowInfo: () => win, getMenuButtonBoundingClientRect: capsuleFn };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'wx', NAVBAR_JS)(mod, mod.exports, wxStub);
  return mod.exports.getNavMetrics(PAGE_PAD_RPX);
}

const DEVICES = [
  { name: 'iPhone SE (320)', winW: 320, sbh: 20, capTop: 24 },
  { name: '小屏 Android (360)', winW: 360, sbh: 22, capTop: 26 },
  { name: 'iPhone 13 mini (375)', winW: 375, sbh: 44, capTop: 48 },
  { name: 'iPhone 13/14 (390)', winW: 390, sbh: 47, capTop: 51 },
  { name: 'Android (412)', winW: 412, sbh: 24, capTop: 28 },
  { name: 'iPhone 14 Pro Max (430)', winW: 430, sbh: 59, capTop: 63 },
  { name: '拿不到胶囊信息（接口抛错）', winW: 375, sbh: 44, capTop: 48, broken: true }
];

console.log('\n=== 自定义导航胶囊避让验算 ===\n');

for (const d of DEVICES) {
  const rpx = d.winW / 750;
  const capRight = d.winW - CAPSULE_RIGHT_OFFSET;
  const capLeft = capRight - CAPSULE_W;
  const capsuleFn = d.broken
    ? () => {
        throw new Error('not supported');
      }
    : () => ({
        top: d.capTop,
        bottom: d.capTop + 32,
        left: capLeft,
        right: capRight,
        width: CAPSULE_W,
        height: 32
      });

  const nav = runNav({ windowWidth: d.winW, statusBarHeight: d.sbh }, capsuleFn);

  const pagePad = PAGE_PAD_RPX * rpx;
  const actsW = ACTS_RPX * rpx;
  const backW = BACK_RPX * rpx;
  const roundH = 64 * rpx;
  const titleW = titleRpxOf(d.winW) * rpx;
  const btnRightEdge = d.winW - pagePad - nav.rightGap; // 操作区右边界（距屏幕左）
  const titleSpace = btnRightEdge - pagePad;

  console.log(
    `${d.name}  |  状态栏 ${nav.statusBarHeight}  行高 ${nav.navHeight}  总高 ${nav.navTotalHeight}  右让 ${nav.rightGap}`
  );

  ok('总高 = 状态栏 + 行高', nav.navTotalHeight === nav.statusBarHeight + nav.navHeight,
    `${nav.navTotalHeight} = ${nav.statusBarHeight} + ${nav.navHeight}`);
  ok('行高容得下 64rpx 圆钮（上下各留 ≥2px）', nav.navHeight >= roundH + 4,
    `行高 ${nav.navHeight} ≥ 按钮 ${roundH.toFixed(1)} + 4`);
  ok('操作区停在胶囊左侧', btnRightEdge <= nav.capsule.left - 6,
    `按钮右边界 ${btnRightEdge.toFixed(1)} ≤ 胶囊左 ${nav.capsule.left} - 6`);
  ok('标题 + 返回钮 + 按钮组放得下', titleSpace >= titleW + backW + actsW,
    `可用 ${titleSpace.toFixed(1)} ≥ 标题 ${titleW.toFixed(1)} + 返回 ${backW.toFixed(1)} + 按钮组 ${actsW.toFixed(1)}`);
  console.log('');
}

console.log(failed ? `❌ ${failed} 项未通过` : '✅ 全部通过');
process.exit(failed ? 1 : 0);
