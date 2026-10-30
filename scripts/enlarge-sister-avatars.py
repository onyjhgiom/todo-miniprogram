# -*- coding: utf-8 -*-
"""
姐姐聊天页头像优化（可重复运行）：
1. WXSS：所有含 avatar 的选择器，width/height 在 48~120rpx 的统一放大 25%（取偶数）
2. WXML：所有 <image> 头像加 catchtap="onPreviewAvatar" + data-url（点击全屏看图）
3. TS：Page({ 后插入 onPreviewAvatar（wx.previewImage，基础库 2.14.0+ 支持代码包路径）
报告输出到 scripts/sister-avatar-report.md
"""
import io
import glob
import os
import re

# ---- 1. 用锚点文件定位项目（astro-data.ts 一定存在） ----
anchors = []
for pat in [
    r'C:\\Users\\*\\WorkB*\\*\\todo*\\miniprogram\\subpackages\\tools\\utils\\astro-data.ts',
    r'C:\\Users\\*\\WorkB*\\*\\todo*\\miniprogram\\subpackages\\tools\\utils\\astro-data.ts',
]:
    anchors += glob.glob(pat)
anchors = sorted(set(anchors))
if not anchors:
    raise SystemExit('ANCHOR NOT FOUND')

tools_dir = os.path.dirname(os.path.dirname(anchors[0]))          # .../subpackages/tools
pages_dir = os.path.join(tools_dir, 'pages')
report = ['# 姐姐头像放大 + 点击看图 改造报告', '']

# ---- 2. 遍历 pages 目录找 sisterchat 相关文件 ----
targets = {'wxml': None, 'wxss': None, 'ts': None}
common_wxss = None
for cur, _dirs, files in os.walk(pages_dir):
    for fn in files:
        low = fn.lower()
        p = os.path.join(cur, fn)
        if 'sisterchat' in low.replace('_', ''):
            ext = os.path.splitext(fn)[1][1:]
            if ext in targets and targets[ext] is None:
                targets[ext] = p
        if fn == 'astro-common.wxss':
            common_wxss = p

report.append('定位文件：')
for k, v in targets.items():
    report.append('- %s -> %s (%sB)' % (k, v, os.path.getsize(v) if v else 'MISSING'))
report.append('')

# ---- 3. WXSS 头像尺寸放大 25% ----
def bump_wxss(path):
    css = io.open(path, encoding='utf-8').read()
    changes = []

    def bump_val(m):
        prop, n, unit = m.group(1), int(m.group(2)), m.group(3)
        if unit == 'rpx' and 48 <= n <= 120:
            v = int(round(n * 1.25 / 2.0)) * 2
            changes.append('%s: %d -> %d rpx' % (prop.strip(), n, v))
            return '%s: %drpx' % (prop, v)
        return m.group(0)

    rule_re = re.compile(r'([^{}]+)\{([^}]*)\}')

    def rule_fn(rm):
        sel, body = rm.group(1), rm.group(2)
        if 'avatar' not in sel.lower():
            return rm.group(0)
        return sel + '{' + re.sub(r'(width|height):\s*(\d+)(rpx)', bump_val, body) + '}'

    css2 = rule_re.sub(rule_fn, css)
    if css2 != css:
        io.open(path, 'w', encoding='utf-8').write(css2)
    return changes

if targets['wxss']:
    report.append('## WXSS 尺寸放大（sisterChat.wxss）')
    report += ['- ' + c for c in bump_wxss(targets['wxss'])] or ['- （无匹配尺寸）']
    report.append('')

# astro-common.wxss 里的头像规则只报告不改动（避免影响其他页面）
if common_wxss:
    css = io.open(common_wxss, encoding='utf-8').read()
    hits = re.findall(r'([^{}]*avatar[^{}]*)\{([^}]*)\}', css, re.I)
    if hits:
        report.append('## astro-common.wxss 中的 avatar 规则（仅记录，未改动）')
        for sel, body in hits:
            report.append('- %s { %s }' % (sel.strip().splitlines()[-1].strip(), body.strip()[:120]))
        report.append('')

# ---- 4. WXML 头像加点击预览 ----
if targets['wxml']:
    wxml = io.open(targets['wxml'], encoding='utf-8').read()
    fixed = []

    def fix_tag(m):
        tag = m.group(0)
        if 'avatar' not in tag.lower() or 'src=' not in tag:
            return tag
        sm = re.search(r'src="([^"]*)"', tag)
        if not sm:
            return tag
        src = sm.group(1)
        if 'data-url=' not in tag:
            tag = tag.replace('src="%s"' % src, 'src="%s" data-url="%s"' % (src, src), 1)
        if 'catchtap="onPreviewAvatar"' in tag:
            pass
        elif 'catchtap=' in tag:
            tag = re.sub(r'catchtap="[^"]*"', 'catchtap="onPreviewAvatar"', tag, count=1)
        elif 'bindtap=' in tag:
            tag = re.sub(r'bindtap="[^"]*"', 'catchtap="onPreviewAvatar"', tag, count=1)
        else:
            core = tag.rstrip()
            if core.endswith('/>'):
                tag = core[:-2].rstrip() + ' catchtap="onPreviewAvatar" />'
            else:
                tag = core[:-1].rstrip() + ' catchtap="onPreviewAvatar">'
        cls = re.search(r'class="([^"]*)"', tag)
        fixed.append(cls.group(1) if cls else '(unknown class)')
        return tag

    wxml2 = re.sub(r'<image\b[^>]*>', fix_tag, wxml)
    if wxml2 != wxml:
        io.open(targets['wxml'], 'w', encoding='utf-8').write(wxml2)
    report.append('## WXML 加点击预览（catchtap + data-url）')
    report += ['- ' + c for c in fixed] or ['- （未找到头像 image）']
    report.append('')

# ---- 5. TS 插入 onPreviewAvatar ----
if targets['ts']:
    ts = io.open(targets['ts'], encoding='utf-8').read()
    if 'onPreviewAvatar' in ts:
        report.append('## TS：onPreviewAvatar 已存在，跳过')
    else:
        method = (
            '\n  /** 点击头像：全屏查看照片（wx.previewImage 基础库 2.14.0+ 支持代码包路径） */\n'
            '  onPreviewAvatar(e: any) {\n'
            "    const url = ((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) || '') as string;\n"
            '    if (!url) return;\n'
            "    wx.previewImage({\n"
            '      current: url,\n'
            '      urls: [url],\n'
            "      fail: () => wx.showToast({ title: '预览失败，请升级微信', icon: 'none' })\n"
            '    });\n'
            '  },\n'
        )
        idx = ts.find('Page({')
        anchor_name = 'Page({'
        if idx < 0:
            idx = ts.find('Component({')
            anchor_name = 'Component({'
        if idx >= 0:
            j = idx + len(anchor_name)
            ts2 = ts[:j] + method + ts[j:]
            io.open(targets['ts'], 'w', encoding='utf-8').write(ts2)
            report.append('## TS：已在 %s 后插入 onPreviewAvatar' % anchor_name)
        else:
            report.append('## TS：未找到 Page({ / Component({ 锚点，未插入！')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sister-avatar-report.md')
io.open(out, 'w', encoding='utf-8').write('\n'.join(report))
print('REPORT_OK')
