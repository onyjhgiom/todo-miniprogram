/**
 * 生成 subpackages/pomodoro 番茄钟页的**真机保真**预览（2026-10-07 重写为「成长中心」版式）。
 *
 * 与上一版（旧版式预览）的区别：
 *   1. 结构完全对齐当前 index.wxml：顶部品牌区 → 今日目标 → 核心环（左窄栏/居中环/右竖排切换）
 *      → 主按钮+环境音 → 三列数据 → 任务卡 → 成长计划 → 连续专注 → 底部导航；
 *   2. 样式直接读**当前** index.wxss 与各组件 wxss，改样式即改预览，不会手抄失真；
 *   3. 场景背景直接读 utils/pomo-bg.ts 里的 base64（就是真机用的那张图）；
 *   4. 按真实设备度量 iPhone 17 Pro = 402×874pt，1rpx = 402/750 = 0.536px；
 *      headerPadTop = statusBarH(59) + 44 = 103。
 *
 * 探针（<pre id="probe"> / document.title）会写回：内容总高、环与窄栏的上下边、
 * 是否横向溢出、底部导航是否压住页脚。用 headless Chrome --dump-dom 读回。
 */
const fs = require('fs');
const path = require('path');

const POMO = path.resolve(__dirname, '../miniprogram/subpackages/pomodoro');
const OUT_DIR = path.resolve(__dirname, '../preview');

const read = (p) => fs.readFileSync(path.join(POMO, p), 'utf8');

const css = [
  read('pages/index/index.wxss'),
  read('components/focus-mode-tabs/focus-mode-tabs.wxss'),
  read('components/task-card/task-card.wxss'),
  read('components/focus-ring/focus-ring.wxss')
].join('\n\n');

/* 真实场景背景（base64 data URI）直接从 pomo-bg.ts 抽出 */
const bgTs = read('utils/pomo-bg.ts');
const bgMatch = bgTs.match(/'data:image\/[^']+'/);
const BG_URI = bgMatch ? bgMatch[0].slice(1, -1) : '';

/* ---- 设备度量：iPhone 17 Pro ---- */
const DEV = { name: 'iPhone 17 Pro', w: 402, h: 874, statusBar: 59 };
const U = (DEV.w / 750).toFixed(4);          // 0.5360 px
const HEADER_PAD = DEV.statusBar + 44;       // 103

/* 环的 size 属性从源码读，避免手抄失真 */
const wxml = read('pages/index/index.wxml');
const ringM = wxml.match(/<focus-ring[\s\S]*?size="\{\{ringSize\}\}"/);
const RING_SIZE = /ringSize:\s*(\d+)/.exec(read('pages/index/index.ts'));
const RING = RING_SIZE ? Number(RING_SIZE[1]) : 340;

/* ---- 样例数据（全部是「真实统计」口径，仅用于看版式） ---- */
const STATS = [
  { icon: '🍅', label: '今日专注', value: '50', unit: '分钟', bar: -1, sub: '完成 2 轮' },
  { icon: '🔥', label: '连续坚持', value: '4', unit: '天', bar: -1, sub: '还在坚持，别断' },
  { icon: '🎯', label: '今日目标', value: '2', unit: '/ 4 轮', bar: 50, sub: '' }
];
const PLAN = [
  { glyph: '✔', text: '开启今日第一段专注', state: 'done' },
  { glyph: '✔', text: '完成今日目标一半（2 轮）', state: 'done' },
  { glyph: '③', text: '达成今日 4 轮目标', state: 'active' },
  { glyph: '✔', text: '连续打卡不间断', state: 'done' }
];

const ringSvg = (size) => {
  const C = 2 * Math.PI * 44;        // r=44 in viewBox 100
  const off = C * (1 - 0.35);        // 35% 进度
  return `<svg class="ringsvg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7188D1"/><stop offset="1" stop-color="#8EA6E8"/></linearGradient></defs>
    <circle cx="50" cy="50" r="44" fill="none" stroke="#E3EAF5" stroke-width="3.4"/>
    <circle cx="50" cy="50" r="44" fill="none" stroke="url(#rg)" stroke-width="3.4" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 50 50)"/>
  </svg>`;
};

const tabsItem = (emoji, label, min, active) =>
  `<div class="tabs__item ${active ? 'is-active' : ''}">
     <div class="tabs__emoji">${emoji}</div>
     <div class="tabs__body"><div class="tabs__tx">${label}</div><div class="tabs__min">${min} 分钟</div></div>
   </div>`;

const body = (full) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>pomo device preview</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #2A2D33; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 0; }
.phone { width: ${DEV.w}px; ${full ? 'min-height: 100px;' : `height: ${DEV.h}px;`} position: relative; overflow: hidden;
         background: #EEF3FA; }
${css}
/* ---- 预览专用覆盖（把 fixed 改成 phone 内定位，否则会贴浏览器窗口） ---- */
.phone .pd { position: relative; min-height: ${full ? '0' : DEV.h + 'px'}; }
.phone .pd__bg, .phone .pd__veil { position: absolute; }
.phone .dock { position: absolute; }
.phone .mask { position: absolute; }
.ringsvg { display:block; width:100%; height:100%; }
</style></head>
<body>
<div class="phone">
  <div class="pd" style="--u: ${U}px">
    <div class="pd__bg" style="background-image:url('${BG_URI}')"></div>
    <div class="pd__veil"></div>

    <div class="hd" style="padding-top:${HEADER_PAD}px;padding-right:24px">
      <div class="hd__brand">
        <div class="hd__logo"><div class="hd__logo-tx">🍅</div></div>
        <div class="hd__titles"><div class="hd__t">番茄时钟</div><div class="hd__s">专注学习 · 遇见更好的自己</div></div>
      </div>
      <div class="hd__acts"><div class="act">无干扰</div><div class="act">设置</div></div>
    </div>

    <div class="pd__cols">
      <div class="pd__col pd__col--a">
        <div class="goal">
          <div class="goal__main">
            <div class="goal__ico">◎</div>
            <div class="goal__bd">
              <div class="goal__t">今日目标</div>
              <div class="goal__d">完成 4 轮专注，向更好的自己出发！</div>
              <div class="goal__bar"><div class="goal__bar-in" style="width:50%"></div></div>
            </div>
            <div class="goal__n">2 / 4</div>
          </div>
          <div class="goal__side">
            <div class="goal__sico">✦</div>
            <div class="goal__sbd"><div class="goal__sk">本周</div><div class="goal__sv">9 轮</div></div>
          </div>
        </div>

        <div class="core">
          <div class="core__aside core__aside--l">
            <div class="mside">
              <div class="mside__ico">◎</div>
              <div class="mside__k">专注模式</div>
              <div class="mside__v">专注学习</div>
            </div>
            <div class="core__quote">“专注是这个时代最稀缺的能力。”</div>
          </div>
          <div class="core__ring">
            <div class="core__stage">
              <div class="ring">${ringSvg(RING)}</div>
              <div class="core__center">
                <div class="core__emoji">🍅</div>
                <div class="core__mode">专注学习</div>
                <div class="core__time">25:00</div>
                <div class="core__round">第 3 / 4 轮</div>
              </div>
            </div>
          </div>
          <div class="core__aside core__aside--r">
            <div class="tabs">
              ${tabsItem('🍅', '专注', 25, true)}
              ${tabsItem('☕', '短休息', 5, false)}
              ${tabsItem('🌙', '长休息', 15, false)}
            </div>
          </div>
        </div>

        <div class="ctarow">
          <div class="cta"><div class="cta__ico">▶</div><div class="cta__label">开始专注</div></div>
          <div class="amb"><div class="amb__g">♪</div></div>
        </div>
      </div>

      <div class="pd__col pd__col--b">
        <div class="stats3">
          ${STATS.map((s) => `<div class="stats3__col">
            <div class="stats3__hd"><div class="stats3__ico">${s.icon}</div><div class="stats3__k">${s.label}</div></div>
            <div class="stats3__vrow"><div class="stats3__v">${s.value}</div><div class="stats3__u">${s.unit}</div></div>
            ${s.bar >= 0 ? `<div class="stats3__bar"><div class="stats3__bar-in" style="width:${s.bar}%"></div></div>` : `<div class="stats3__sub">${s.sub}</div>`}
          </div>`).join('')}
        </div>

        <div class="pd__sec">
          <div class="task">
            <div class="task__head"><div class="task__cap">正在专注</div><div class="task__unbind">换一项</div></div>
            <div class="task__title-wrap"><div class="task__title">复习英语单词 Unit 5</div></div>
            <div class="task__bar"><div class="task__bar-in" style="width:50%"></div></div>
            <div class="task__meta"><div class="task__meta-k">今日目标</div><div class="task__meta-v">2 / 4 项</div></div>
          </div>
        </div>

        <div class="plan">
          <div class="plan__hd">
            <div class="plan__hd-l"><div class="plan__ico">▤</div><div class="plan__t">今日成长计划</div></div>
            <div class="plan__more"><div class="plan__more-tx">查看全部</div><div class="plan__more-g">›</div></div>
          </div>
          <div class="plan__bd">
            <div class="plan__list">
              ${PLAN.map((n, i) => `<div class="pnode pnode--${n.state}">
                <div class="pnode__rail"><div class="pnode__dot"><div class="pnode__gl">${n.glyph}</div></div>
                ${i < PLAN.length - 1 ? '<div class="pnode__line"></div>' : ''}</div>
                <div class="pnode__tx">${n.text}</div>
              </div>`).join('')}
            </div>
            <div class="plan__tip">
              <div class="plan__tip-crown">♛</div>
              <div class="plan__tip-tx">已完成 2 轮，还差 2 轮达成今日目标</div>
              <div class="plan__tip-btn"><div class="plan__tip-btn-tx">继续加油</div><div class="plan__tip-btn-g">→</div></div>
            </div>
          </div>
        </div>

        <div class="streakbar">
          <div class="streakbar__medal">🏅</div>
          <div class="streakbar__bd"><div class="streakbar__t">连续专注 4 天</div><div class="streakbar__s">还在坚持，别断开哦</div></div>
          <div class="streakbar__g">›</div>
        </div>
      </div>
    </div>

    <div class="pd__foot">一天一轮，一个月就是一轮新的自己</div>

    <div class="dock">
      <div class="dock__item"><div class="dock__ico">⌂</div><div class="dock__l">首页</div></div>
      <div class="dock__item is-on"><div class="dock__ico">▥</div><div class="dock__l">统计</div></div>
      <div class="dock__item"><div class="dock__ico">☆</div><div class="dock__l">成就</div></div>
      <div class="dock__item"><div class="dock__ico">⚇</div><div class="dock__l">我的</div></div>
    </div>
  </div>
</div>
<script>
window.addEventListener('load', function () {
  var q = function (s) { return document.querySelector(s); };
  var r = function (s) { var e = q(s); if (!e) return null; var b = e.getBoundingClientRect();
    return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
  var out = {
    devW: ${DEV.w}, devH: ${DEV.h},
    pdScrollW: q('.pd') ? q('.pd').scrollWidth : 0,
    docScrollW: document.documentElement.scrollWidth,
    pdScrollH: q('.pd') ? q('.pd').scrollHeight : 0,
    core: r('.core'), ring: r('.core__stage'), asideL: r('.core__aside--l'), asideR: r('.core__aside--r'),
    goal: r('.goal'), ctarow: r('.ctarow'), stats3: r('.stats3'), plan: r('.plan'),
    streak: r('.streakbar'), foot: r('.pd__foot'), dock: r('.dock')
  };
  var pre = document.createElement('pre'); pre.id = 'probe'; pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
  document.title = 'PROBE ' + JSON.stringify(out);
});
</script>
</body></html>`;

fs.writeFileSync(path.join(OUT_DIR, 'pomo-device.html'), body(false));
fs.writeFileSync(path.join(OUT_DIR, 'pomo-device-full.html'), body(true));
console.log('written: preview/pomo-device.html + preview/pomo-device-full.html');
console.log('RING =', RING, '| U =', U, '| bg len =', BG_URI.length);
