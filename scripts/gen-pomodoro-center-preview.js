/**
 * 生成 subpackages/pomodoro（工具中心番茄钟）页面的桌面预览：
 * 真实 WXSS（页面 + 5 个组件）+ 手工展开的等价 HTML，用 headless Chrome 截图。
 * 附带高度探针：把各区块实测像素高度写进 document.title，可用 --dump-dom 读回。
 */
const fs = require('fs');
const path = require('path');

const POMO = path.resolve(__dirname, '../miniprogram/subpackages/pomodoro');
const OUT = path.resolve(__dirname, '../preview/pomodoro-center.html');

const read = (p) => fs.readFileSync(path.join(POMO, p), 'utf8');

const css = [
  read('pages/index/index.wxss'),
  read('components/motivation-card/motivation-card.wxss'),
  read('components/focus-mode-tabs/focus-mode-tabs.wxss'),
  read('components/task-card/task-card.wxss'),
  read('components/focus-stats/focus-stats.wxss'),
  read('components/streak-card/streak-card.wxss')
].join('\n\n');

const STATS_ITEMS = [
  { icon: '🍅', value: '3', unit: '轮', label: '今日完成' },
  { icon: '⏱', value: '75', unit: '分', label: '专注时长' },
  { icon: '✓', value: '5', unit: '项', label: '完成任务' },
  { icon: '🔥', value: '4', unit: '天', label: '连续坚持' }
];
const TAGS = [
  { glyph: '🌱', label: '自律' },
  { glyph: '📚', label: '积累' },
  { glyph: '🧘', label: '专注' },
  { glyph: '🚀', label: '成长' }
];

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>pomodoro preview</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #22252B; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 20px; }
.phone {
  width: 375px; height: 812px; position: relative; overflow: hidden;
  border-radius: 18px; border: 1px solid rgba(255,255,255,.18);
}
.statusbar { height: 44px; }
${css}
/* 预览用边框山替代 canvas 环 */
.core__stage::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  border: calc(22 * var(--u)) solid #DCE6F7;
  border-top-color: #7188D1; border-right-color: #7188D1;
  z-index: 1;
}
</style>
</head>
<body>
<div class="phone">
  <div class="statusbar"></div>
  <div class="pd" style="--u: 0.5px">
    <div class="pd__bg"></div>
    <div class="pd__peaks">
      <div class="pd__peak pd__peak--1"></div>
      <div class="pd__peak pd__peak--2"></div>
      <div class="pd__peak pd__peak--3"></div>
    </div>

    <div class="hd" style="padding-top:64px">
      <div class="hd__bar">
        <div class="hd__back">‹</div>
        <div class="hd__pills">
          <div class="pill">无干扰</div>
          <div class="pill">统计</div>
          <div class="pill">设置</div>
        </div>
      </div>
      <div class="hd__titles">
        <div class="hd__t">番茄时钟</div>
        <div class="hd__s">专注当下 · 遇见更好的自己</div>
      </div>
    </div>

    <div class="pd__cols">
      <div class="pd__col pd__col--a">
        <div class="pd__sec">
          <div class="moti"><div class="moti__bar"></div><div class="moti__tx">保持节奏，专注的每一分钟都在悄悄积累。</div></div>
        </div>

        <div class="core">
          <div class="core__stage">
            <div class="core__center">
              <div class="core__emoji">🍅</div>
              <div class="core__mode">专注</div>
              <div class="core__time">25:00</div>
              <div class="core__round">第 1 / 4 轮</div>
            </div>
          </div>
        </div>

        <div class="pd__sec">
          <div class="tabs">
            <div class="tabs__item is-active"><div class="tabs__emoji">🍅</div><div class="tabs__tx">专注</div></div>
            <div class="tabs__item"><div class="tabs__emoji">☕</div><div class="tabs__tx">短休息</div></div>
            <div class="tabs__item"><div class="tabs__emoji">🛌</div><div class="tabs__tx">长休息</div></div>
          </div>
          <div class="intent">
            <div class="intent__line"></div>
            <div class="intent__tx">专注 25 分钟，点亮更好的自己</div>
            <div class="intent__line"></div>
          </div>
        </div>
      </div>

      <div class="pd__col pd__col--b">
        <div class="pd__sec pd__sec--brk">
          <div class="task">
            <div class="task__head">
              <div class="task__cap">正在专注</div>
            </div>
            <div class="task__empty">今天准备完成什么？</div>
            <div class="task__add"><div class="task__add-tx">＋ 添加学习任务</div></div>
          </div>
        </div>

        <div class="pd__sec">
          <div class="cta"><div class="cta__tx"><div class="cta__ico">▶</div><div class="cta__label">开始专注</div></div></div>
        </div>

        <div class="pd__sec pd__sec--brk">
          <div class="stats">
            ${STATS_ITEMS.map(
              (i) => `<div class="stats__cell"><div class="stats__ico">${i.icon}</div>
              <div class="stats__numrow"><div class="stats__num">${i.value}</div><div class="stats__unit">${i.unit}</div></div>
              <div class="stats__label">${i.label}</div></div>`
            ).join('\n')}
          </div>
        </div>

        <div class="pd__sec">
          <div class="streak">
            <div class="streak__top">
              <div class="streak__cap">坚持记录</div>
              <div class="streak__days"><div class="streak__days-n">4</div><div class="streak__days-u"> 天</div></div>
            </div>
            <div class="streak__dots">
              ${[1, 1, 1, 1, 0, 0, 0].map((d) => `<div class="streak__dot ${d ? 'is-on' : ''}"></div>`).join('')}
            </div>
            <div class="streak__msg">已经连续 4 天，别断在今天</div>
          </div>
        </div>
      </div>
    </div>

    <div class="tags">
      ${TAGS.map((t) => `<div class="tags__item"><div class="tags__g">${t.glyph}</div><div class="tags__l">${t.label}</div></div>`).join('')}
    </div>

    <div class="pd__foot">一天一轮，一个月就是一轮新的自己</div>
  </div>
</div>

<script>
function probe() {
  var sel = ['.pd', '.hd', '.moti', '.core', '.tabs', '.intent', '.task', '.cta', '.stats', '.streak', '.tags', '.pd__foot'];
  var out = sel.map(function (s) {
    var el = document.querySelector(s);
    return s + '=' + (el ? Math.round(el.getBoundingClientRect().height) : 'NA');
  });
  var pd = document.querySelector('.pd');
  out.push('TOTAL=' + (pd ? Math.round(pd.scrollHeight) : 'NA'));
  var txt = out.join(' | ');
  document.title = txt;
  var node = document.createElement('pre');
  node.id = 'probe';
  node.textContent = txt;
  document.body.appendChild(node);
}
// 脚本位于 body 末尾，所有节点已就绪；同步执行以兼容 --dump-dom 时序
probe();
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('written', OUT);
