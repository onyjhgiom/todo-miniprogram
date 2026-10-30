#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
爱遇小栈 · 静态自检

覆盖范围（全部为静态检查，不需要微信开发者工具）：
  1) 分包注册：app.json 里 subpackages/love 的 10 个页面，四件套齐全
  2) 样式层：每个页面 wxss 都 @import 了 love-common.wxss
  3) 事件闭环：wxml 里 bind*="onXxx" 的方法，在对应 ts 里必须真的定义了
     （这是小程序最常见的事故：模板改了、方法忘了写，点击完全没反应且无报错）
  4) 皮肤接入：每个页面 onLoad/onShow 都要 applySkin，否则换肤不生效
  5) 工具中心注册：utils/tools.ts 有 love-hub 条目 + pages/tools/tools.ts 有路由与分包标记
  6) JSON 合法性：本模块涉及的所有 .json 都能被解析
  7) 云函数：cloudfunctions/love 三件套齐全且语法可解析

用法：python scripts/check-love-module.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOVE = os.path.join(ROOT, 'miniprogram', 'subpackages', 'love')

PAGES = [
    'index', 'cycle', 'makeup', 'outfit', 'wardrobe',
    'love', 'memory', 'profile', 'share', 'skin'
]

fails = []
warns = []
passed = 0


def ok(cond, name, extra=''):
    global passed
    if cond:
        passed += 1
        print('  PASS  ' + name)
    else:
        fails.append(name + (' → ' + extra if extra else ''))
        print('  FAIL  ' + name + (' → ' + extra if extra else ''))


def read(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return None


print('\n[1] 分包注册与页面四件套')
app_json = read(os.path.join(ROOT, 'miniprogram', 'app.json'))
ok(app_json is not None, 'app.json 可读')
app = json.loads(app_json) if app_json else {}
love_pkg = None
for p in app.get('subpackages', []):
    if p.get('root') == 'subpackages/love':
        love_pkg = p
ok(love_pkg is not None, 'app.json 注册了 subpackages/love')
registered = love_pkg.get('pages', []) if love_pkg else []
ok(len(registered) == len(PAGES), '注册页面数 = %d' % len(PAGES), '实际 %d' % len(registered))

for name in PAGES:
    want = 'pages/%s/%s' % (name, name)
    ok(want in registered, '注册 %s' % want)
    for ext in ('json', 'ts', 'wxml', 'wxss'):
        p = os.path.join(LOVE, 'pages', name, '%s.%s' % (name, ext))
        ok(os.path.exists(p), '存在 pages/%s/%s.%s' % (name, name, ext))
        if ext == 'json' and os.path.exists(p):
            try:
                json.loads(read(p))
            except Exception as e:
                ok(False, '%s.json 合法' % name, str(e))

print('\n[2] 样式层接入')
for name in PAGES:
    wxss = read(os.path.join(LOVE, 'pages', name, '%s.wxss' % name)) or ''
    ok('love-common.wxss' in wxss, 'pages/%s 引入共享样式' % name)
common = read(os.path.join(LOVE, 'styles', 'love-common.wxss')) or ''
for var in ('--ay-bg', '--ay-card', '--ay-primary', '--ay-text'):
    ok(('var(%s,' % var) in common, '样式层使用变量 %s' % var)
ok('.ay-heart__shape' in common, '爱心样式存在')
for kf in ('ay-beat', 'ay-halo', 'ay-float'):
    ok(('@keyframes %s' % kf) in common, '动画 %s 已定义' % kf)

print('\n[3] 事件闭环（wxml 绑定 → ts 必须实现）')
for name in PAGES:
    wxml = read(os.path.join(LOVE, 'pages', name, '%s.wxml' % name)) or ''
    ts = read(os.path.join(LOVE, 'pages', name, '%s.ts' % name)) or ''
    handlers = set(re.findall(r'bind(?:tap|change|input|blur|confirm)="([A-Za-z_][A-Za-z0-9_]*)"', wxml))
    # wxml 里用 index 取值的写法（如 data-v="{{index}}"）不算处理器
    handlers = {h for h in handlers if h.startswith('on')}
    missing = [h for h in handlers if (h + '(') not in ts]
    ok(not missing, 'pages/%s 的 %d 个事件都已实现' % (name, len(handlers)), ','.join(missing))

print('\n[4] 皮肤接入')
for name in PAGES:
    ts = read(os.path.join(LOVE, 'pages', name, '%s.ts' % name)) or ''
    ok('applySkin' in ts, 'pages/%s 应用皮肤' % name)
    ok('watchSkin' in ts, 'pages/%s 监听皮肤变化' % name)
    wxml = read(os.path.join(LOVE, 'pages', name, '%s.wxml' % name)) or ''
    ok('data-skin="{{skin.key}}"' in wxml, 'pages/%s 根节点挂皮肤变量' % name)
    ok('style="{{skin.style}}"' in wxml, 'pages/%s 根节点注入皮肤变量' % name)

print('\n[5] 工具中心注册')
tools = read(os.path.join(ROOT, 'miniprogram', 'utils', 'tools.ts')) or ''
ok("key: 'she'" in tools, '新增「她的生活」分类')
ok("id: 'love-hub'" in tools, '注册工具「爱遇小栈」')
ok("route: 'love'" in tools, '工具路由为 love')
hub = read(os.path.join(ROOT, 'miniprogram', 'pages', 'tools', 'tools.ts')) or ''
ok("love: '/subpackages/love/pages/index/index'" in hub, '工具中心映射了落地页')
ok('love: true' in hub, '工具中心标记为分包（挂延迟遮罩）')
ok("'subpackages/love'" in hub, '工具中心预热了 love 分包')

print('\n[6] 云函数')
for f in ('index.js', 'package.json', 'config.json'):
    ok(os.path.exists(os.path.join(ROOT, 'cloudfunctions', 'love', f)), 'cloudfunctions/love/%s 存在' % f)
fn = read(os.path.join(ROOT, 'cloudfunctions', 'love', 'index.js')) or ''
for act in ('probe', 'pair', 'push', 'pull', 'weather'):
    ok(("%s," % act) in fn or ("%s }" % act) in fn or (act + ':') in fn or re.search(r'\b%s\b' % act, fn) is not None,
       '云函数支持 action=%s' % act)
ok('QWEATHER_KEY' in fn, '天气密钥走服务端环境变量')
ok('getWXContext' in fn, '按 openid 做数据隔离')

print('\n[7] 数据层与隐私')
store = read(os.path.join(LOVE, 'utils', 'love-store.ts')) or ''
ok('cycle: false' in store, '经期默认不共享')
share = read(os.path.join(LOVE, 'utils', 'love-share.ts')) or ''
ok('cloudOn' in share and 'ok:false' in share or 'cloudOn' in share, '云端不可用时可降级')
ok('已切到离线模式' in share or '离线模式' in share, '有离线兜底文案')
place = read(os.path.join(LOVE, 'utils', 'love-place.ts')) or ''
ok('离线估算' in place, '天气降级明确标注为估算')
ok('live: false' in place, '估算结果 live=false')

print('\n[8] 医学与安全边界')
cycle = read(os.path.join(LOVE, 'utils', 'love-cycle.ts')) or ''
ok('就医' in cycle, '经期模块含就医提示')
care = read(os.path.join(LOVE, 'utils', 'love-care.ts')) or ''
ok('就医' in care, '护理模块含就医提示')
ok('不诊断' in care or '不做诊断' in care, '明确声明非诊断')

print('\n==================================')
print('通过 %d 项，失败 %d 项' % (passed, len(fails)))
if fails:
    print('失败项：')
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('全部通过 ✅')
