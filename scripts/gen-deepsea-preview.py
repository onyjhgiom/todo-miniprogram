# -*- coding: utf-8 -*-
"""
生成「深海蓝金 · 上海」主题的静态效果稿（HTML），
色值与压暗/玻璃层算法与小程序 app.wxss / theme.ts 完全一致，
用于在不启动开发者工具的情况下直观看皮肤观感。
"""
import base64

jpg = open('scripts/scene-shanghai-user.jpg', 'rb').read()
uri = 'data:image/jpeg;base64,' + base64.b64encode(jpg).decode()
hjpg = open('scripts/scene-lujiazui-hero.jpg', 'rb').read()
hero_uri = 'data:image/jpeg;base64,' + base64.b64encode(hjpg).decode()
hero_bg = ('linear-gradient(90deg, rgba(8,15,34,.88) 0%, rgba(8,15,34,.52) 44%, rgba(8,15,34,.08) 100%), '
           'url(' + hero_uri + ');background-size:cover;background-position:center;')

# 与 utils/theme.ts buildSceneBgStyle 相同的压暗幕
dark_layer = (
    'linear-gradient(180deg, rgba(0,0,0,.42) 0%, rgba(0,0,0,.26) 14%,'
    'rgba(0,0,0,.30) 34%, rgba(0,0,0,.24) 54%, rgba(0,0,0,.12) 72%,'
    'rgba(0,0,0,0) 88%, #08111F 100%)'
)

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>深海蓝金 · 上海 — 皮肤效果稿</title>
<style>
  :root{
    /* ===== 与 app.wxss .themed[data-theme='deepsea'] 完全一致的 token ===== */
    --color-bg:#08111F;
    --color-bg-elevated:#0E1B2E;
    --color-bg-soft:#12233B;
    --color-card:rgba(17,32,54,.72);
    --color-text:#EDF2FA;
    --color-text-soft:#A6B6CC;
    --color-text-mute:#6E8098;
    --color-border:rgba(122,154,196,.16);
    --color-primary:#4C7DE0;
    --color-primary-deep:#3562C4;
    --color-primary-ink:#0E2244;
    --color-primary-ink-2:#17345F;
    --color-primary-soft:rgba(76,125,224,.16);
    --color-accent:#D3AC74;
    --glass-bg:rgba(17,32,54,.62);
    --glass-bg-strong:rgba(20,38,64,.86);
    --glass-border:rgba(211,172,116,.16);
    --home-card-r:30rpx;
    --gold:#D3AC74;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{
    margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    background:#05090F;color:var(--color-text);
    display:flex;justify-content:center;padding:28px 12px 60px;
  }
  .phone{
    position:relative;width:390px;height:844px;border-radius:44px;overflow:hidden;
    box-shadow:0 40px 90px rgba(0,0,0,.7),0 0 0 1px rgba(211,172,116,.22);
    background-color:var(--color-bg);
    background-image:__DARK__,url(__URI__);
    background-size:100% 100%,100% 100%;
    background-repeat:no-repeat,no-repeat;
    display:flex;flex-direction:column;
  }
  .status{display:flex;justify-content:space-between;padding:14px 26px 0;font-size:13px;color:rgba(237,242,250,.72)}
  .scroll{flex:1;overflow:hidden;padding:10px 18px 0}

  /* ===== hero 面板（stats-card）===== */
  .hero{
    position:relative;padding:20px 20px 16px;border-radius:20px;overflow:hidden;
    background:linear-gradient(165deg,var(--color-primary-ink) 0%,var(--color-primary-ink-2) 46%,var(--color-primary-ink) 100%);
    border:1px solid rgba(211,172,116,.22);
    box-shadow:0 22px 52px rgba(2,6,14,.55),0 0 0 1px rgba(211,172,116,.18),inset 0 1px 0 rgba(186,210,244,.14);
  }
  .hero__halo{position:absolute;border-radius:50%;filter:blur(38px);pointer-events:none}
  .hero__halo--1{width:170px;height:170px;right:-56px;top:-66px;background:radial-gradient(circle,rgba(76,125,224,.42),transparent 70%)}
  .hero__halo--2{width:130px;height:130px;right:46px;bottom:-56px;background:radial-gradient(circle,rgba(211,172,116,.28),transparent 70%)}
  .hero__skyline{
    position:absolute;left:0;right:0;bottom:0;height:56px;opacity:.52;pointer-events:none;
    background-repeat:no-repeat;
    background-image:
      radial-gradient(circle,rgba(211,172,116,.55) 0 2.5px,rgba(211,172,116,0) 3px),
      linear-gradient(rgba(186,210,244,.34),rgba(186,210,244,.12)),
      linear-gradient(rgba(186,210,244,.30),rgba(186,210,244,.10)),
      linear-gradient(rgba(186,210,244,.26),rgba(186,210,244,.09)),
      linear-gradient(rgba(186,210,244,.22),rgba(186,210,244,.08)),
      linear-gradient(rgba(186,210,244,.18),rgba(186,210,244,.06)),
      linear-gradient(rgba(186,210,244,.14),rgba(186,210,244,.05));
    background-size:10px 10px,2.5px 29px,13px 49px,12px 37px,10px 30px,15px 21px,11px 16px;
    background-position:84% 72%,84% 100%,12% 100%,31% 100%,45% 100%,60% 100%,72% 100%;
  }
  .hero__horizon{position:absolute;left:0;right:0;bottom:55px;height:1px;pointer-events:none;
    background:linear-gradient(90deg,rgba(211,172,116,0),rgba(211,172,116,.5) 22%,rgba(211,172,116,.26) 58%,rgba(211,172,116,0))}
  .hero__head{display:flex;justify-content:space-between;align-items:flex-start;position:relative}
  .hero__greet{font-size:11px;letter-spacing:2.5px;color:rgba(242,237,228,.42);margin-bottom:5px}
  .hero__title{font-family:Georgia,"Songti SC",serif;font-size:24px;font-weight:700;letter-spacing:1px;line-height:1.12;color:#F2EDE4}
  .hero__sub{margin-top:6px;font-size:12px;letter-spacing:.3px;color:rgba(242,237,228,.56)}
  .hero__streak{display:inline-flex;align-items:baseline;gap:3px;padding:5px 10px;border-radius:999px;
    background:rgba(255,255,255,.07);border:1px solid rgba(242,237,228,.14);font-size:11px;font-weight:500;
    box-shadow:0 0 0 .5px rgba(255,255,255,.16),0 3px 9px rgba(0,0,0,.16)}
  .hero__streak b{font-size:15px;color:#E0A06A}
  .hero__streak span{color:rgba(242,237,228,.62)}
  .hero__stats{position:relative;display:flex;margin-top:16px;padding:12px 6px;border-radius:16px;
    background:rgba(255,255,255,.06);border:1px solid rgba(242,237,228,.12)}
  .hero__stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
  .hero__stat-num{font-size:18px;font-weight:700;line-height:1.1;color:#F2EDE4;text-shadow:0 1px 2px rgba(60,30,0,.14)}
  .hero__stat--main .hero__stat-num{font-size:29px;
    background:linear-gradient(180deg,#FFF8EC 0%,#F0DCB4 62%,#D9BE8C 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .hero__stat-label{font-size:11px;color:rgba(242,237,228,.72);letter-spacing:.3px}
  .hero__divider{width:1px;align-self:stretch;background:linear-gradient(180deg,rgba(242,237,228,0),rgba(242,237,228,.22) 50%,rgba(242,237,228,0))}

  /* ===== 视图切换（列表 / 日历 / 看板）===== */
  .seg{display:flex;gap:4px;margin:14px 0 12px;padding:4px;border-radius:999px;
    background:var(--glass-bg);border:1px solid var(--glass-border);
    box-shadow:0 8px 32px rgba(2,6,14,.5),inset 0 1px 0 rgba(186,210,244,.14)}
  .seg div{flex:1;text-align:center;padding:8px 0;font-size:13px;color:var(--color-text-soft);border-radius:999px}
  .seg .on{background:linear-gradient(135deg,#5E8CEC,#3562C4);color:#fff;font-weight:600;
    box-shadow:0 6px 18px rgba(53,98,196,.4),inset 0 1px 0 rgba(255,255,255,.24)}

  /* ===== 搜索 + 筛选 ===== */
  .search{display:flex;align-items:center;gap:8px;padding:11px 14px;border-radius:999px;
    background:var(--glass-bg);border:1px solid rgba(122,154,196,.28);color:var(--color-text-mute);font-size:13px;
    box-shadow:inset 0 1px 0 rgba(186,210,244,.1)}
  .chips{display:flex;gap:8px;margin:12px 0 14px;flex-wrap:wrap}
  .chip{padding:6px 13px;border-radius:999px;font-size:12px;color:var(--color-text-soft);
    background:rgba(17,32,54,.62);border:1px solid var(--glass-border)}
  .chip.on{color:#fff;background:linear-gradient(135deg,rgba(76,125,224,.9),rgba(53,98,196,.9));border-color:rgba(211,172,116,.4)}

  /* ===== 任务卡片 ===== */
  .card{position:relative;display:flex;gap:12px;align-items:flex-start;padding:15px 16px;margin-bottom:11px;border-radius:15px;
    background:var(--glass-bg);border:1px solid var(--glass-border);
    box-shadow:0 12px 30px rgba(2,6,14,.42),inset 0 1px 0 rgba(186,210,244,.1),0 0 0 1px rgba(211,172,116,.12)}
  .check{width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(122,154,196,.5);flex:0 0 auto;margin-top:1px}
  .check.on{background:linear-gradient(135deg,#5E8CEC,#3562C4);border-color:transparent;position:relative}
  .check.on:after{content:"✓";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff}
  .body{flex:1;min-width:0}
  .t{font-size:15px;font-weight:500;color:var(--color-text)}
  .meta{display:flex;gap:8px;align-items:center;margin-top:7px;font-size:11.5px;color:var(--color-text-mute);flex-wrap:wrap}
  .tag{padding:2.5px 8px;border-radius:6px;background:rgba(76,125,224,.14);color:#9DB8EE;border:1px solid rgba(76,125,224,.22)}
  .gold{color:var(--gold)}
  .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;margin-top:7px}
  .dot--high{background:#C09A5E;box-shadow:0 0 0 2px rgba(192,154,94,.14)}
  .dot--mid{background:#6E8E6E;box-shadow:0 0 0 2px rgba(110,142,110,.14)}
  .dot--low{background:#94a3b8;box-shadow:0 0 0 2px rgba(148,163,184,.14)}
  .done{opacity:.5}
  .done .t{text-decoration:line-through}

  /* ===== 空态 / 悬浮按钮 / 底部导航 ===== */
  .fab{position:absolute;right:22px;bottom:118px;width:58px;height:58px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;
    background:radial-gradient(120% 120% at 30% 22%,rgba(186,210,244,.28),rgba(186,210,244,0) 58%),
               linear-gradient(140deg,rgba(76,125,224,.92),rgba(53,98,196,.92));
    box-shadow:0 14px 34px rgba(2,6,14,.55),0 4px 10px rgba(2,6,14,.3),0 0 0 8px rgba(17,32,54,.5),0 0 0 2px rgba(211,172,116,.5),inset 0 2px 0 rgba(255,255,255,.24)}
  .tabbar{position:absolute;left:16px;right:16px;bottom:16px;display:flex;padding:9px 6px;border-radius:999px;
    background:var(--glass-bg-strong);border:1px solid var(--glass-border);
    box-shadow:0 16px 40px rgba(2,6,14,.55),0 0 0 1px rgba(211,172,116,.16),inset 0 1px 0 rgba(186,210,244,.12)}
  .tab{flex:1;text-align:center;font-size:10.5px;color:var(--color-text-mute)}
  .tab i{display:block;font-size:17px;font-style:normal;margin-bottom:2px;opacity:.7}
  .tab.on{color:var(--gold)}
  .tab.on i{opacity:1}
  .legend{margin:16px auto 0;max-width:390px;color:#8FA2BC;font-size:12px;line-height:1.8}
  .legend b{color:#D3AC74}
</style>
</head>
<body>
<div>
<div class="phone">
  <div class="status"><span>9:41</span><span>上海 · 22°</span></div>
  <div class="scroll">
    <div class="hero" style="background-image:__HERO_BG__">
      <div class="hero__halo hero__halo--1"></div>
      <div class="hero__halo hero__halo--2"></div>
      <div class="hero__head">
        <div>
          <div class="hero__greet">中午好 · 9月29日 · 周二</div>
          <div class="hero__title">你的待办清单</div>
          <div class="hero__sub">把今天该做的事，一件一件完成。</div>
        </div>
        <div class="hero__streak"><span>▲</span><b>7</b><span>天连续</span></div>
      </div>
      <div class="hero__stats">
        <div class="hero__stat hero__stat--main"><div class="hero__stat-num">5</div><div class="hero__stat-label">进行中</div></div>
        <div class="hero__divider"></div>
        <div class="hero__stat"><div class="hero__stat-num">3</div><div class="hero__stat-label">今日完成</div></div>
        <div class="hero__divider"></div>
        <div class="hero__stat"><div class="hero__stat-num">18</div><div class="hero__stat-label">本周完成</div></div>
        <div class="hero__divider"></div>
        <div class="hero__stat"><div class="hero__stat-num">126</div><div class="hero__stat-label">已完成</div></div>
      </div>
    </div>

    <div class="seg"><div class="on">列表</div><div>日历</div><div>看板</div></div>

    <div class="search">🔍 搜索任务、地点、人物、标签…</div>
    <div class="chips">
      <div class="chip on">全部</div><div class="chip">进行中</div><div class="chip">已完成</div>
      <div class="chip">优先级</div><div class="chip">地点</div><div class="chip">标签</div>
    </div>

    <div class="card">
      <div class="check"></div>
      <div class="body">
        <div class="t">完成线性代数第三章习题</div>
        <div class="meta"><span class="tag">学习</span><span>14:00</span><span>图书馆 3F</span></div>
      </div>
      <div class="dot dot--high"></div>
    </div>
    <div class="card">
      <div class="check"></div>
      <div class="body">
        <div class="t">和导师沟通开题方向</div>
        <div class="meta"><span class="tag">科研</span><span class="gold">倒计时 2 天</span><span>线上会议</span></div>
      </div>
      <div class="dot dot--mid"></div>
    </div>
    <div class="card">
      <div class="check"></div>
      <div class="body">
        <div class="t">投递暑期实习简历</div>
        <div class="meta"><span class="tag">求职</span><span>18:00</span><span>上海 · 张江</span></div>
      </div>
      <div class="dot dot--low"></div>
    </div>
    <div class="card done">
      <div class="check on"></div>
      <div class="body">
        <div class="t">晨读英语外刊 30 分钟</div>
        <div class="meta"><span>已完成 08:20</span></div>
      </div>
    </div>
  </div>

  <div class="fab">＋</div>
  <div class="tabbar">
    <div class="tab on"><i>🏠</i>首页</div>
    <div class="tab"><i>📅</i>日历</div>
    <div class="tab"><i>🗂️</i>看板</div>
    <div class="tab"><i>🧰</i>工具</div>
    <div class="tab"><i>👤</i>我的</div>
  </div>
</div>

<div class="legend">
  <b>深海蓝金 · 上海</b>：深海蓝底 + 半透明玻璃卡片 + 香槟金发丝边；<br/>
  蓝=主操作/进度（列表/搜索筛选/悬浮新增），金=核心数据/倒计时/品牌元素；<br/>
  背景为程序化绘制的陆家嘴天际线与黄浦江倒影（蓝金黄昏、非旅游式灯光）。
</div>
</div>
</body>
</html>
"""

html = HTML.replace('__DARK__', dark_layer).replace('__URI__', uri)
open('preview/deepsea-preview.html', 'w', encoding='utf-8').write(html.replace('__HERO_BG__', hero_bg))
print('preview written:', len(html), 'bytes')
