// scripts/gen-todo-panel-preview.js
// 待办清单视觉保真预览（对齐参考稿 待办清单.html）。
//
// 做法：读真实 WXSS → 换算 rpx→px → 生成 HTML → headless Chrome 截图。
// 进度环与页签图标都**跑真实的绘制逻辑**（与页面 drawRing / todo-glyph.draw 同源），
// 不手抄——抄一遍就等于没验证。
//
// ⚠️ 截图窗口宽度必须用「实测 clientWidth」而不是想当然的 402：
//    Chrome headless 带 --force-device-scale-factor=2 时，实际视口会被放大
//    （实测 --window-size=402 时 clientWidth 是 511），
//    截图按 402 裁剪 → 看起来「右边被切了」，其实布局完全没溢出。
//    本脚本因此在页面里塞了自动探针，按实测宽度再截一次。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'miniprogram/pages/todo-panel');
const GLYPH = path.join(ROOT, 'miniprogram/components/todo-glyph/todo-glyph.ts');
const OUT = path.join(ROOT, 'preview');

// iPhone 17 Pro 逻辑宽 402，1rpx = 402/750
const W = 402;
const U = W / 750;

function wxss2css(text) {
  return text
    // ⚠️ 先剥注释再换算：注释里的 rpx 被替换后长度变化，会让 */ 边界错乱，
    // 导致后面的整条选择器被当成注释吞掉（曾导致覆盖规则凭空消失）。
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(-?[\d.]+)rpx/g, (_, n) => (parseFloat(n) * U).toFixed(3) + 'px')
    .replace(/env\(safe-area-inset-bottom\)/g, '0px');
}

const pageWxss = fs.readFileSync(path.join(PAGE, 'todo-panel.wxss'), 'utf8');
const shellWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/styles/tool-shell.wxss'), 'utf8');
const css = wxss2css(pageWxss.replace(/@import[^;]+;/g, '') + '\n' + shellWxss);

/* 浅色主题变量（与 utils/theme 的 light 主题一致） */
const vars = {
  '--color-text': '#22243a',
  '--color-text-soft': '#5b5f75',
  '--color-text-mute': '#8a8da3',
  '--color-border': '#e4e6f0',
  '--color-bg-soft': '#f3f4f9',
  '--color-bg-elevated': '#ffffff',
  '--color-overlay': 'rgba(20,21,28,.45)',
  '--color-ring': '#c9ccdc',
  '--color-primary': '#5c72e8',
  '--color-primary-soft': '#eef1ff',
  '--color-bar': 'rgba(92,114,232,.22)',
  '--color-bar': 'rgba(92,114,232,.22)',
  '--color-primary-shadow': 'rgba(92,114,232,.32)',
  '--color-success': '#6fa384',
  '--color-success-soft': '#e6f1ea',
  '--color-danger': '#c35c66',
  '--color-danger-soft': '#fbebed',
  '--color-warning': '#b9742f',
  '--color-warning-soft': '#fbf0e3',
  '--color-card': '#ffffff',
  '--color-bg': '#f4f6fb',
  '--shadow-md': '0 1px 2px rgba(34,36,58,.05), 0 10px 28px rgba(34,36,58,.08)',
  '--u': U + 'px',
  '--u-fs-xs': 26 * U + 'px',
  '--u-fs-sm': 24 * U + 'px'
};
const varsCss = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('');

/* ---------- 示例数据（形态与 recompute() 输出一致） ---------- */
const pct = 62;
const dims = [
  { key: 'day', label: '日待办', icon: 'sun', n: 3 },
  { key: 'month', label: '月待办', icon: 'month', n: 5 },
  { key: 'year', label: '年待办', icon: 'year', n: 9 },
  { key: 'all', label: '全部', icon: 'all', n: 14 }
];
const bars = [
  { label: '周四', pct: 55 },
  { label: '周五', pct: 100 },
  { label: '周六', pct: 22 },
  { label: '周日', pct: 70 },
  { label: '周一', pct: 34 },
  { label: '周二', pct: 82 },
  { label: '今天', pct: 62, on: true }
];

const groups = [
  {
    key: 'late', title: '已逾期', count: 2, rows: [
      { content: '回复重要工作邮件', dueText: '逾期 1 天', cat: '工作', color: '#7B8CD0', pri: '' },
      { content: '预约牙科复查', dueText: '逾期 3 天', cat: '健康', color: '#62AE93', pri: '' }
    ]
  },
  {
    key: 'todo', title: '待处理', count: 3, rows: [
      { content: '完成产品方案整理', dueText: '今天 14:30', cat: '工作', color: '#7B8CD0', pri: '重要' },
      { content: '读完《设计心理学》第 3 章', dueText: '今天', cat: '学习', color: '#9A86C8', pri: '' },
      { content: '确认明天的会议室', dueText: '明天 09:30', cat: '工作', color: '#7B8CD0', pri: '' }
    ]
  },
  {
    key: 'done', title: '已完成', count: 2, rows: [
      { content: '晨间阅读 20 分钟', dueText: '今天 08:30', cat: '学习', color: '#9A86C8', done: true },
      { content: '整理本周账单', dueText: '昨天', cat: '生活', color: '#E0A06A', done: true }
    ]
  }
];

function taskHtml(t) {
  return `<div class="tl-task ${t.done ? 'is-done' : ''} ${t.key === 'late' ? 'is-late' : ''}">
  <div class="tl-task__check ${t.done ? 'is-done' : ''}"><span class="tl-task__tick">✓</span></div>
  <div class="tl-task__bd">
    <span class="tl-task__title">${t.content}</span>
    <div class="tl-task__meta">
      <div class="tl-task__cat"><i class="tl-task__cdot" style="background:${t.color}"></i><span class="tl-task__cat-l">${t.cat}</span></div>
      <span class="tl-task__due ${t.key === 'late' ? 'is-late' : ''}">${t.dueText}</span>
      ${t.pri ? `<span class="tl-task__pri">${t.pri}</span>` : ''}
    </div>
  </div>
  <div class="tl-task__more"><span class="tl-task__more-g">›</span></div>
</div>`;
}

// 让每个 task 知道自己属于哪个分组（用于逾期红条）
function renderGroups() {
  return groups.map((g) => {
    const rows = g.rows.map((t) => taskHtml(Object.assign({ key: g.key }, t))).join('');
    const label = g.title
      ? `<div class="tl-glabel ${g.key === 'late' ? 'is-late' : ''}"><span class="tl-glabel__t">${g.title} ${g.count}</span></div>`
      : '';
    return `<div class="tl-group">${label}<div class="tl-list">${rows}</div></div>`;
  }).join('');
}

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
body{margin:0;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;background:#dfe3ec;}
${css}
.tl{${varsCss}}
.tl-ring__cv,.tg__cv{display:block;}
</style></head>
<body>
<div class="tl tshell tshell-ps-glass tshell-bg-none" id="root" style="${varsCss}">

  <!-- 问候头 -->
  <div class="tl__top">
    <div class="tl__hello">
      <span class="tl__date">10月7日 · 周三</span>
      <span class="tl__greet">下午好，今天也稳稳推进</span>
    </div>
    <div class="tl__paint"><span class="tl__paint-g">🎨</span></div>
  </div>

  <!-- Hero 汇总卡 -->
  <div class="tl-hero">
    <div class="tl-hero__top">
      <div class="tl-ring">
        <canvas id="ring" class="tl-ring__cv" width="${Math.round(176 * U * 2)}" height="${Math.round(176 * U * 2)}"></canvas>
        <div class="tl-ring__tx">
          <span class="tl-ring__n">${pct}<span class="tl-ring__s">%</span></span>
          <span class="tl-ring__l">完成率</span>
        </div>
      </div>
      <div class="tl-hero__tx">
        <span class="tl-eye">今日进度</span>
        <div class="tl-big"><span class="tl-big__a">5</span><span class="tl-big__b">/ 8</span><span class="tl-big__em">件</span></div>
        <span class="tl-hint">还剩 3 件，另有 2 件已逾期</span>
      </div>
    </div>

    <div class="tl-stats">
      <div class="tl-stats__c"><span class="tl-stats__n tl-stats__n--pend">14</span><span class="tl-stats__l">待处理</span></div>
      <div class="tl-stats__c"><span class="tl-stats__n tl-stats__n--done">23</span><span class="tl-stats__l">已完成</span></div>
      <div class="tl-stats__c"><span class="tl-stats__n">3</span><span class="tl-stats__l">今日</span></div>
      <div class="tl-stats__c"><span class="tl-stats__n tl-stats__n--late">2</span><span class="tl-stats__l">已逾期</span></div>
    </div>

    <div>
      <div class="tl-week__hd"><span class="tl-eye">近 7 天完成</span><span class="tl-week__total">共 26 件</span></div>
      <div class="tl-bars">
        ${bars.map((b) => `<div class="tl-bar ${b.on ? 'is-on' : ''}">
          <div class="tl-bar__col" style="height:${b.pct}%"></div>
          <span class="tl-bar__l">${b.label}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- 下一件事 -->
  <div class="tl-focus">
    <div class="tl-focus__check"><span class="tl-focus__tick">✓</span></div>
    <div class="tl-focus__tx">
      <span class="tl-focus__tag">下一件</span>
      <span class="tl-focus__t">完成产品方案整理</span>
    </div>
    <span class="tl-focus__when">14:30</span>
  </div>

  <!-- 四维页签 -->
  <div class="tl-tabs" style="--i:0">
    <div class="tl-tabs__ind"></div>
    ${dims.map((d, i) => `<div class="tl-tab ${i === 0 ? 'is-on' : ''}">
      <canvas class="tg__cv" data-glyph="${d.icon}" width="${Math.round(46 * U * 2)}" height="${Math.round(46 * U * 2)}"></canvas>
      <span class="tl-tab__l">${d.label}</span>
      ${d.n > 0 ? `<span class="tl-tab__badge">${d.n}</span>` : ''}
    </div>`).join('')}
  </div>

  <!-- 区块标题 -->
  <div class="tl-sec">
    <span class="tl-sec__t">今天到期的任务 · 10月7日</span>
    <span class="tl-sec__c">3 项待处理</span>
  </div>

  <!-- 分组任务 -->
  ${renderGroups()}
</div>

<!-- 悬浮新建 -->
<div class="tl-fab"><span class="tl-fab__ico">＋</span><span class="tl-fab__t">新建待办</span></div>

<script>
/* ===== 进度环：与页面 drawRing() 完全同源 ===== */
(function(){
  var cv = document.getElementById('ring');
  if(!cv) return;
  var dpr = 2, S = cv.width / dpr;
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  var ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  var p = ${pct} / 100;
  var cx = S/2, cy = S/2;
  var lw = Math.max(5, S * 0.08);
  var r = S/2 - lw/2 - S * 0.04;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.strokeStyle = 'rgba(113,136,209,.16)'; ctx.lineWidth = lw;
  ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  if(p > 0.001){
    var g = ctx.createLinearGradient(cx-r, cy-r, cx+r, cy+r);
    g.addColorStop(0, '#7188C1'); g.addColorStop(1, '#8EA6E8');
    ctx.strokeStyle = g; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + p*Math.PI*2); ctx.stroke();
  }
})();

/* ===== 页签线性图标：与 components/todo-glyph 同源 ===== */
var GLYPH_PATHS = ${JSON.stringify({
  sun: [[[12,5],[12,8]],[[12,16],[12,19]],[[5,12],[8,12]],[[16,12],[19,12]],
        [[7.05,7.05],[9.2,9.2]],[[14.8,14.8],[16.95,16.95]],
        [[7.05,16.95],[9.2,14.8]],[[14.8,9.2],[16.95,7.05]]],
  month: [[[4,7],[4,19],[20,19],[20,7],[4,7]],[[4,11],[20,11]],[[8,4.5],[8,7]],[[16,4.5],[16,7]],
          [[8.5,14.5],[8.6,14.5]],[[12,14.5],[12.1,14.5]],[[15.5,14.5],[15.6,14.5]],
          [[8.5,17.5],[8.6,17.5]],[[12,17.5],[12.1,17.5]]],
  year: [[[4,7],[4,19],[20,19],[20,7],[4,7]],[[4,11],[20,11]],[[8,4.5],[8,7]],[[16,4.5],[16,7]],
         [[9,15.5],[11,17.5],[15.5,12.5]]],
  all: [[[12,4.5],[20.5,9],[12,13.5],[3.5,9],[12,4.5]],
        [[3.5,12.5],[12,17],[20.5,12.5]],
        [[3.5,16.2],[12,20.7],[20.5,16.2]]]
})};
var GLYPH_CIRCLES = ${JSON.stringify({ sun: [[12,12,3.4]] })};

Array.prototype.forEach.call(document.querySelectorAll('canvas[data-glyph]'), function (cv) {
  var name = cv.getAttribute('data-glyph');
  var paths = GLYPH_PATHS[name]; if (!paths) return;
  var dpr = 2, S = cv.width / dpr;
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  var ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  // 页签选中态用深色、未选中用灰色（与 WXML 的 color 绑定一致）
  var on = cv.closest('.tl-tab').classList.contains('is-on');
  ctx.save();
  ctx.translate(0, 0);
  ctx.scale(S / 24, S / 24);
  ctx.strokeStyle = on ? '#4A4E8C' : '#8A8DA3';
  ctx.lineWidth = Math.max(1, 0.07 * 24);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  var circles = GLYPH_CIRCLES[name] || [];
  circles.forEach(function (c) { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, Math.PI*2); ctx.stroke(); });
  paths.forEach(function (pts) {
    if (pts.length === 2 && Math.abs(pts[0][0]-pts[1][0]) < 0.2 && Math.abs(pts[0][1]-pts[1][1]) < 0.2) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[0][0]+0.01, pts[0][1]); ctx.stroke(); return;
    }
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  });
  ctx.restore();
});

/* ===== 自动探针：把实测宽度与关键块边界写进 title，供截图脚本读取 ===== */
window.addEventListener('load', function(){
  var out = ['CW=' + document.documentElement.clientWidth,
             'SW=' + document.documentElement.scrollWidth];
  var root = document.getElementById('root');
  out.push('ROOT_R=' + root.getBoundingClientRect().right.toFixed(0));
  ['.tl-tabs', '.tl-tab:last-child', '.tl-sec', '.tl-fab', '.tl-hero'].forEach(function (sel) {
    var el = document.querySelector(sel); if (!el) return;
    out.push(sel + '_R=' + el.getBoundingClientRect().right.toFixed(0));
  });
  document.title = out.join('|');
});
</script>
</body></html>`;

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, 'todo-panel-preview.html');
fs.writeFileSync(outFile, html);
console.log('生成：' + outFile);
console.log('设计宽：' + W + '  U=' + U.toFixed(3) + 'px');
console.log('提示：截图前先读探针 title 里的 CW= 实际视口宽，按它设置 --window-size');
void GLYPH;