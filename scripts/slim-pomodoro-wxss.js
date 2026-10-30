/**
 * 按实测数据收敛 subpackages/pomodoro（工具中心番茄钟）页面与各组件的尺寸。
 *
 * 基线（375px 屏，1rpx=0.5px，探针实测）：
 *   .pd=813px / .hd=139 / .moti=31 / .core=200 / .tabs=36 / .intent=12
 *   .task=87 / .cta=44 / .stats=62 / .streak=72 / .tags=26 / .pd__foot=12
 * 可用高度 768px（812 - 44 状态栏）→ 溢出 45px；iPhone X 状态栏 88px 还更溢。
 * 目标：压到 ~686px，留 ~80px 呼吸余白。
 *
 * 原则：不是等比缩小（等比会把小字压到不可读），而是「大件多缩、小字少缩」：
 *   大件（环 400→340 / CTA 88→78 / tabs 72→64 / 按钮 56→48）→ 多缩
 *   小字说明（18~20u）→ 只缩 1u，保住真机可读性
 */
const fs = require('fs');
const path = require('path');

const POMO = path.resolve(__dirname, '../miniprogram/subpackages/pomodoro');

/** 在某个选择器块内替换一条属性值；找不到就直接抛错，避免静默漏改 */
function setProp(css, sel, prop, val) {
  const idx = css.indexOf(sel + ' {');
  if (idx < 0) throw new Error('选择器未找到: ' + sel);
  const end = css.indexOf('}', idx);
  let block = css.slice(idx, end);
  const re = new RegExp(prop + '\\s*:\\s*[^;]+;');
  if (!re.test(block)) throw new Error('属性未找到: ' + prop + ' @ ' + sel);
  block = block.replace(re, prop + ': ' + val + ';');
  return css.slice(0, idx) + block + css.slice(end);
}

const CHANGES = {
  'pages/index/index.wxss': [
    // 顶部：标题区再收一档（38u 标题仍抢戏）
    ['.hd', 'padding-bottom', 'calc(10 * var(--u))'],
    ['.hd__titles', 'margin-top', 'calc(8 * var(--u))'],
    ['.hd__t', 'font-size', 'calc(33 * var(--u))'],
    ['.hd__s', 'font-size', 'calc(18 * var(--u))'],
    ['.hd__s', 'margin-top', 'calc(1 * var(--u))'],
    // 核心：环是全页最大元素，400u 占 200px（26% 屏高）→ 340u
    ['.core__stage', 'width', 'calc(340 * var(--u))'],
    ['.core__stage', 'height', 'calc(340 * var(--u))'],
    ['.core__center', 'padding', '0 calc(54 * var(--u))'],
    ['.core__emoji', 'font-size', 'calc(28 * var(--u))'],
    ['.core__mode', 'font-size', 'calc(21 * var(--u))'],
    ['.core__mode', 'margin-top', 'calc(4 * var(--u))'],
    ['.core__time', 'font-size', 'calc(64 * var(--u))'],
    ['.core__round', 'font-size', 'calc(19 * var(--u))'],
    ['.core__round', 'margin-top', 'calc(4 * var(--u))'],
    // 区块节奏：14u→10u，跨组 16u→12u
    ['.pd__sec', 'margin', '0 calc(22 * var(--u)) calc(10 * var(--u))'],
    ['.pd__sec--brk', 'margin-top', 'calc(12 * var(--u))'],
    // 主按钮
    ['.cta', 'height', 'calc(78 * var(--u))'],
    ['.cta__label', 'font-size', 'calc(26 * var(--u))'],
    ['.cta__sub', 'margin-top', 'calc(8 * var(--u))'],
    // 页脚装饰
    ['.tags', 'margin', 'calc(14 * var(--u)) calc(22 * var(--u)) 0'],
    ['.tags__g', 'font-size', 'calc(21 * var(--u))'],
    ['.tags__l', 'font-size', 'calc(18 * var(--u))'],
    ['.pd__foot', 'margin-top', 'calc(14 * var(--u))'],
    ['.pd__foot', 'font-size', 'calc(17 * var(--u))'],
    ['.pd', 'padding-bottom', 'calc(38 * var(--u))']
  ],
  'components/motivation-card/motivation-card.wxss': [
    ['.moti', 'padding', 'calc(11 * var(--u, 1rpx)) calc(22 * var(--u, 1rpx))'],
    ['.moti', 'gap', 'calc(12 * var(--u, 1rpx))'],
    ['.moti__bar', 'height', 'calc(21 * var(--u, 1rpx))'],
    ['.moti__tx', 'font-size', 'calc(19 * var(--u, 1rpx))']
  ],
  'components/focus-mode-tabs/focus-mode-tabs.wxss': [
    ['.tabs', 'height', 'calc(64 * var(--u, 1rpx))'],
    ['.tabs__item', 'height', 'calc(54 * var(--u, 1rpx))'],
    ['.tabs__item', 'padding', '0 calc(20 * var(--u, 1rpx))']
  ],
  'components/task-card/task-card.wxss': [
    ['.task', 'padding', 'calc(14 * var(--u, 1rpx)) calc(22 * var(--u, 1rpx))'],
    ['.task__title-wrap', 'margin-top', 'calc(8 * var(--u, 1rpx))'],
    ['.task__title', 'font-size', 'calc(24 * var(--u, 1rpx))'],
    ['.task__bar', 'margin-top', 'calc(10 * var(--u, 1rpx))'],
    ['.task__meta', 'margin-top', 'calc(8 * var(--u, 1rpx))'],
    ['.task__empty', 'margin-top', 'calc(8 * var(--u, 1rpx))'],
    ['.task__add', 'margin-top', 'calc(10 * var(--u, 1rpx))'],
    ['.task__add', 'height', 'calc(48 * var(--u, 1rpx))']
  ],
  'components/focus-stats/focus-stats.wxss': [
    ['.stats', 'padding', 'calc(13 * var(--u, 1rpx)) calc(20 * var(--u, 1rpx))'],
    ['.stats__cell', 'gap', 'calc(3 * var(--u, 1rpx))'],
    ['.stats__ico', 'font-size', 'calc(19 * var(--u, 1rpx))'],
    ['.stats__num', 'font-size', 'calc(29 * var(--u, 1rpx))']
  ],
  'components/streak-card/streak-card.wxss': [
    ['.streak', 'padding', 'calc(14 * var(--u, 1rpx)) calc(22 * var(--u, 1rpx))'],
    ['.streak__cap', 'font-size', 'calc(21 * var(--u, 1rpx))'],
    ['.streak__days-n', 'font-size', 'calc(27 * var(--u, 1rpx))'],
    ['.streak__dots', 'margin-top', 'calc(11 * var(--u, 1rpx))'],
    ['.streak__msg', 'margin-top', 'calc(10 * var(--u, 1rpx))'],
    ['.streak__msg', 'font-size', 'calc(19 * var(--u, 1rpx))']
  ]
};

for (const rel of Object.keys(CHANGES)) {
  const file = path.join(POMO, rel);
  let css = fs.readFileSync(file, 'utf8');
  let n = 0;
  for (const [sel, prop, val] of CHANGES[rel]) {
    css = setProp(css, sel, prop, val);
    n++;
  }
  fs.writeFileSync(file, css);
  console.log('OK  ' + rel + '  (' + n + ' 条)');
}
console.log('全部完成');
