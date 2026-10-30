/**
 * 把 tool.wxss 中「番茄时钟」段（.pomo*）的 rpx 数值
 * 统一改写为 calc(N * var(--u)) 并按分层系数缩小，解决整体过大/拥挤。
 * 只影响 START..END 行区间，其它工具的样式不动。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(
  __dirname,
  '../miniprogram/subpackages/toolbox/pages/tool/tool.wxss'
);

const START_MARK = '/* ===== 番茄时钟（专业版） ===== */';
const END_MARK = '/* ===== 倒数日 v2（事件列表：卡片 · 弹层 · 筛选） ===== */';

/**
 * 分层系数（与「待办里的番茄钟」保持同一舒适度，环形约 185px @375 屏）：
 *   大件（环 420 / 时间字 96 / 按钮高 96 等）→ 0.88，环形落到 ~370rpx
 *   正文与标题字号 → 0.88
 *   小字（18-25rpx）→ 0.90，保证真机可读不糊
 *   极细线（<=17rpx）→ 0.94，避免缩成发丝
 */
function scale(v) {
  let k;
  if (v >= 100) k = 0.88;
  else if (v >= 60) k = 0.88;
  else if (v >= 36) k = 0.88;
  else if (v >= 26) k = 0.88;
  else if (v >= 18) k = 0.90;
  else k = 0.94;
  const out = Math.round(v * k);
  return Math.max(2, out);
}

const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);
const nl = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';

const s = lines.findIndex((l) => l.includes(START_MARK));
const e = lines.findIndex((l) => l.includes(END_MARK));
if (s < 0 || e < 0 || e <= s) {
  console.error('MARK NOT FOUND', s, e);
  process.exit(1);
}

let count = 0;
for (let i = s; i < e; i++) {
  lines[i] = lines[i].replace(/(\d+(?:\.\d+)?)rpx/g, (_m, d) => {
    const v = parseFloat(d);
    // 圆形/超大圆角保持原值语义，避免缩放后不够圆
    if (v >= 500) return `${d}rpx`;
    count++;
    return `calc(${scale(v)} * var(--u))`;
  });
}

// 在 .pomo 规则上补默认 --u 兜底
const pomoIdx = lines.findIndex((l) => /^\.pomo \{/.test(l));
if (pomoIdx >= 0 && !lines[pomoIdx + 1].includes('--u')) {
  lines.splice(pomoIdx + 1, 0, '  --u: 1rpx;');
}

fs.writeFileSync(FILE, lines.join(nl));
console.log('replaced rpx count =', count, ' lines', s, '->', e);
