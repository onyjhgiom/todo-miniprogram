/** 生成工具中心「番茄时钟」页面预览（真实 WXSS + 等价 HTML），用于 headless 截图验证排版 */
const fs = require('fs');
const path = require('path');

const WXSS = path.resolve(__dirname, '../miniprogram/subpackages/toolbox/pages/tool/tool.wxss');
const OUT = path.resolve(__dirname, '../preview/pomo-tool-preview.html');

const wxss = fs.readFileSync(WXSS, 'utf8');
const lines = wxss.split(/\r?\n/);
const s = lines.findIndex((l) => l.includes('/* ===== 番茄时钟（专业版） ===== */'));
const e = lines.findIndex((l) => l.includes('/* ===== 倒数日 v2（事件列表：卡片 · 弹层 · 筛选） ===== */'));
// 真实 WXSS 里 .pomo 自己声明了 --u: 1rpx（浏览器不认 rpx），
// 预览时用更高优先级的选择器换成等效 px 值：375px 屏 → 1rpx = 0.5px
const pomoCss =
  lines.slice(s, e).join('\n') +
  '\n.phone .pomo { --u: 0.5px; }\n.phone--wide .pomo { --u: 0.52px; }\n';

const THEME = `
  --color-bg: #15110D;
  --color-bg-soft: #2C2318;
  --color-card: rgba(40, 31, 22, 0.72);
  --color-text: #F3EAD9;
  --color-text-soft: #DCD1BA;
  --color-text-mute: #B3A78E;
  --color-border: rgba(226, 178, 115, 0.16);
  --color-primary: #E2B273;
  --color-primary-shadow: rgba(0, 0, 0, 0.5);
  --gradient-primary: linear-gradient(135deg, #E2B273 0%, #C9955C 100%);
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工具中心 · 番茄时钟 排版预览</title>
<style>
:root {${THEME}}
* { box-sizing: border-box; margin: 0; }
body {
  background: #15110D;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  display: flex; gap: 24px; padding: 24px; align-items: flex-start; flex-wrap: wrap;
}
.phone {
  width: 375px; height: 812px; position: relative;
  background: var(--color-bg); border-radius: 20px; overflow: hidden;
  border: 1px solid rgba(226,178,115,.25);
  /* 1rpx = 0.5px（375px 宽屏） */
  --u: 0.5px;
}
.phone--wide { width: 390px; height: 844px; --u: 0.52px; }
.navbar {
  height: 88px; background: #15110D; color: #F3EAD9;
  display: flex; align-items: flex-end; justify-content: center;
  font-size: 17px; font-weight: 600; padding-bottom: 10px;
  border-bottom: 1px solid rgba(226,178,115,.12);
}
.viewport { height: calc(100% - 88px); overflow: hidden; }
.page {
  min-height: 100%;
  background: var(--color-bg);
  padding: 12px 16px 24px;
}
.title-row { margin-bottom: 14px; }
.title { font-size: 20px; font-weight: 700; color: var(--color-text); }
${pomoCss}
.tag {
  color: var(--color-text-mute); font-size: 12px; text-align: center;
  margin-top: 8px; font-family: sans-serif;
}
/* switch 是原生组件，这里只做视觉近似 */
.sw { width: 44px; height: 26px; border-radius: 13px; background: #2C2318; position: relative; flex: 0 0 auto; }
.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%; background: #B3A78E; }
.sw.on { background: #E2B273; }
.sw.on::after { left: 20px; background: #fff; }
</style>
</head>
<body>

<!-- 状态：专注中 running + 已关联待办 -->
<div>
<div class="phone"><div class="navbar">番茄时钟</div><div class="viewport"><div class="page themed">
  <!-- title 与原生导航栏重复，已隐藏 -->
  <div class="pomo">
    <div class="pomo__topbar">
      <div class="pomo__phase">
        <span class="pomo__phase-dot pomo__phase-dot--focus"></span>
        <span class="pomo__phase-text">专注中</span>
      </div>
      <div class="pomo__top-actions">
        <div class="pomo__chip">🧘 无干扰</div>
        <div class="pomo__chip">📊 统计</div>
        <div class="pomo__chip">⚙️ 设置</div>
      </div>
    </div>
    <div class="pomo__ring-wrap">
      <div class="pomo__ring pomo__ring--focus">
        <div class="pomo__ring-inner">
          <span class="pomo__time">18:42</span>
          <span class="pomo__mode-label">专注</span>
          <span class="pomo__round">第 2 / 4 轮</span>
        </div>
      </div>
      <div class="pomo__progress-arc" style="background: conic-gradient(var(--color-primary) 100deg, var(--color-bg-soft) 0deg);"></div>
    </div>
    <div class="pomo__modes">
      <div class="pomo__mode is-active">🍅 专注</div>
      <div class="pomo__mode">☕ 短休息</div>
      <div class="pomo__mode">🛌 长休息</div>
    </div>
    <div class="pomo__todo">
      <div class="pomo__todo-card">
        <span class="pomo__todo-emoji">📌</span>
        <span class="pomo__todo-title">完成数据结构第 3 章习题</span>
        <div class="pomo__todo-act">解绑</div>
        <div class="pomo__todo-act pomo__todo-act--primary">标记完成</div>
      </div>
    </div>
    <div class="pomo__controls">
      <div class="pomo__btn pomo__btn--ghost">暂停</div>
    </div>
    <div class="pomo__sec">
      <div class="pomo__sec-btn">放弃本轮</div>
    </div>
    <div class="pomo__quick">
      <div class="pomo__quick-card"><span class="pomo__quick-num">3</span><span class="pomo__quick-label">今日完成</span></div>
      <div class="pomo__quick-card"><span class="pomo__quick-num">75</span><span class="pomo__quick-label">今日分钟</span></div>
      <div class="pomo__quick-card"><span class="pomo__quick-num">5</span><span class="pomo__quick-label">连续打卡</span></div>
      <div class="pomo__quick-card"><span class="pomo__quick-num">42</span><span class="pomo__quick-label">累计完成</span></div>
    </div>
  </div>
</div></div></div>
<div class="tag">375×812 · 专注中</div>
</div>

<!-- 状态：准备开始 idle + 未关联待办 -->
<div>
<div class="phone"><div class="navbar">番茄时钟</div><div class="viewport"><div class="page themed">
  <!-- title 与原生导航栏重复，已隐藏 -->
  <div class="pomo">
    <div class="pomo__topbar">
      <div class="pomo__phase">
        <span class="pomo__phase-dot pomo__phase-dot--focus"></span>
        <span class="pomo__phase-text">准备开始</span>
      </div>
      <div class="pomo__top-actions">
        <div class="pomo__chip">🧘 无干扰</div>
        <div class="pomo__chip">📊 统计</div>
        <div class="pomo__chip">⚙️ 设置</div>
      </div>
    </div>
    <div class="pomo__ring-wrap">
      <div class="pomo__ring pomo__ring--focus">
        <div class="pomo__ring-inner">
          <span class="pomo__time">25:00</span>
          <span class="pomo__mode-label">专注</span>
          <span class="pomo__round">第 1 / 4 轮</span>
        </div>
      </div>
      <div class="pomo__progress-arc" style="background: conic-gradient(var(--color-primary) 0deg, var(--color-bg-soft) 0deg);"></div>
    </div>
    <div class="pomo__modes">
      <div class="pomo__mode is-active">🍅 专注</div>
      <div class="pomo__mode">☕ 短休息</div>
      <div class="pomo__mode">🛌 长休息</div>
    </div>
    <div class="pomo__todo">
      <div class="pomo__todo-empty">+ 关联待办（聚焦到具体任务）</div>
    </div>
    <div class="pomo__controls">
      <div class="pomo__btn pomo__btn--primary">开始</div>
    </div>
    <div class="pomo__quick">
      <div class="pomo__quick-card"><span class="pomo__quick-num">0</span><span class="pomo__quick-label">今日完成</span></div>
      <div class="pomo__quick-card"><span class="pomo__quick-num">0</span><span class="pomo__quick-label">今日分钟</span></div>
      <div class="pomo__quick-card"><span class="pomo__quick-num">0</span><span class="pomo__quick-label">连续打卡</span></div>
      <div class="pomo__quick-card"><span class="pomo__quick-num">42</span><span class="pomo__quick-label">累计完成</span></div>
    </div>
  </div>
</div></div></div>
<div class="tag">375×812 · 准备开始</div>
</div>

<!-- 状态：设置弹层 -->
<div>
<div class="phone"><div class="navbar">番茄时钟</div><div class="viewport"><div class="page themed">
  <div class="pomo__panel-mask" style="position:absolute">
    <div class="pomo__panel" style="max-height:660px">
      <div class="pomo__panel-title">⚙️ 番茄设置</div>
      <div class="pomo__panel-section">
        <div class="pomo__panel-h">时长设置（分钟）</div>
        <div class="pomo__dur-row"><div class="pomo__dur-name">🍅 专注</div><div class="pomo__dur-step">−</div><div class="pomo__dur-val">25</div><div class="pomo__dur-step">+</div></div>
        <div class="pomo__dur-row"><div class="pomo__dur-name">☕ 短休息</div><div class="pomo__dur-step">−</div><div class="pomo__dur-val">5</div><div class="pomo__dur-step">+</div></div>
        <div class="pomo__dur-row"><div class="pomo__dur-name">🛌 长休息</div><div class="pomo__dur-step">−</div><div class="pomo__dur-val">15</div><div class="pomo__dur-step">+</div></div>
        <div class="pomo__dur-row"><div class="pomo__dur-name">每 N 轮长休</div><div class="pomo__dur-step">−</div><div class="pomo__dur-val">4</div><div class="pomo__dur-step">+</div></div>
      </div>
      <div class="pomo__panel-section">
        <div class="pomo__panel-h">计时模式</div>
        <div class="pomo__seg"><div class="pomo__seg-item is-active">倒计时</div><div class="pomo__seg-item">正计时</div></div>
      </div>
      <div class="pomo__panel-section">
        <div class="pomo__panel-h">自动行为</div>
        <div class="pomo__switch-row"><div>完成后自动进入下一轮</div><div class="sw on"></div></div>
        <div class="pomo__switch-row"><div>休息自动开始</div><div class="sw"></div></div>
        <div class="pomo__switch-row"><div>智能休息（按专注时长与今日番茄数自动加长）</div><div class="sw on"></div></div>
      </div>
      <div class="pomo__panel-section">
        <div class="pomo__panel-h">结束音</div>
        <div class="pomo__tone-grid">
          <div class="pomo__tone is-active"><div class="pomo__tone-emoji">🔔</div><div class="pomo__tone-label">清脆</div></div>
          <div class="pomo__tone"><div class="pomo__tone-emoji">🎵</div><div class="pomo__tone-label">柔和</div></div>
          <div class="pomo__tone"><div class="pomo__tone-emoji">🌊</div><div class="pomo__tone-label">海浪</div></div>
          <div class="pomo__tone"><div class="pomo__tone-emoji">🐦</div><div class="pomo__tone-label">鸟鸣</div></div>
          <div class="pomo__tone"><div class="pomo__tone-emoji">🔇</div><div class="pomo__tone-label">静音</div></div>
        </div>
      </div>
      <div class="pomo__panel-close">完成</div>
    </div>
  </div>
</div></div></div>
<div class="tag">375×812 · 设置弹层</div>
</div>

</body>
</html>`;

// WXSS 是按块级 <view> 写的；HTML 里统一用 div，避免行内 span 把布局压成一行
const normalized = html.replace(/<span /g, '<div ').replace(/<\/span>/g, '</div>');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, normalized);
console.log('written', OUT, 'css lines', e - s);
