# -*- coding: utf-8 -*-
"""
秋招助手 · 交互层静态自检

改动只加反馈、不动业务，所以自检重点是「有没有接错 / 接漏」：
  1) 七页 wxss 是否都引入了 interaction.wxss（否则按压反馈全部失效）
  2) wxml 里用到的交互类是否都能在 wxss 里找到定义（拼错的类名不会报错，只会静默失效）
  3) wxml 绑定的事件处理函数在页面 ts 里是否真的存在（防改名/漏实现）
  4) wxml 里引用的 data 字段是否在 ts 里被 setData 过（避免永远为空的绑定）
"""
import io, os, re, glob, sys

ROOT = r"C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram"
PAGES = os.path.join(ROOT, "miniprogram", "subpackages", "recruit", "pages", "recruit")

fails = []
notes = []


def read(p):
    return io.open(p, encoding="utf-8").read()


# ---------- 1. wxss 引入 ----------
for p in sorted(glob.glob(os.path.join(PAGES, "*.wxss"))):
    name = os.path.basename(p)
    if name == "_all.wxss":
        continue
    src = read(p)
    if "@import \"../../interaction.wxss\"" not in src:
        fails.append("[import] %s 未引入 interaction.wxss" % name)
if not os.path.exists(os.path.join(ROOT, "miniprogram", "subpackages", "recruit", "interaction.wxss")):
    fails.append("[import] interaction.wxss 不存在")

# ---------- 2. 交互类是否有定义 ----------
# wxml 中通过这些类启用反馈 / 禁用 / 骨架 / 忙碌
CHECK_CLASSES = [
    "ix-disabled", "ix-busy", "ix-skeleton", "ix-shake", "ix-mask", "ix-sheet",
    "ix-ease", "ix-press", "dt__input--err", "dt__picker--err", "dt__err",
    "dt__fbtn--disabled", "rm__input--err", "rm__err", "rm__btn--busy",
    "op__empty-btn", "rc__empty-btn",
]
for p in sorted(glob.glob(os.path.join(PAGES, "*.wxml"))):
    wxml = read(p)
    base = os.path.basename(p)[:-5]
    wxss_path = os.path.join(PAGES, base + ".wxss")
    if not os.path.exists(wxss_path):
        continue
    wxss = read(wxss_path)
    shared = read(os.path.join(ROOT, "miniprogram", "subpackages", "recruit", "interaction.wxss"))
    for c in CHECK_CLASSES:
        # 只在 wxml 里出现过的类才需要校验定义
        if re.search(r"[\s\"']" + re.escape(c) + r"[\s\"']", wxml):
            if ("." + c) not in wxss and ("." + c) not in shared:
                fails.append("[class] %s.wxml 用了 %s，但 wxss 中没有定义" % (base, c))

# ---------- 3. wxml 事件处理函数是否实现 ----------
for p in sorted(glob.glob(os.path.join(PAGES, "*.wxml"))):
    base = os.path.basename(p)[:-5]
    ts_path = os.path.join(PAGES, base + ".ts")
    if not os.path.exists(ts_path):
        continue
    wxml = read(p)
    ts = read(ts_path)
    handlers = set()
    for m in re.finditer(r'\b(?:bind|catch|capture-bind|capture-catch):?[a-z]+\s*=\s*"([^"]+)"', wxml):
        for h in m.group(1).split():
            if h and not h.startswith("{{"):
                handlers.add(h)
    for h in sorted(handlers):
        if re.search(r"\b" + re.escape(h) + r"\s*\(", ts) or re.search(r"\b" + re.escape(h) + r"\s*:", ts):
            continue
        fails.append("[handler] %s.wxml 绑定了 %s，但 ts 里没有实现" % (base, h))

# ---------- 4. 新增交互字段是否有 setData ----------
FIELD_MAP = {
    "recruit": ["parsing"],
    "detail": ["errors", "saving", "canSave"],
    "openings": ["loading"],
    "resume": ["nameErr"],
}
for page, fields in FIELD_MAP.items():
    ts = read(os.path.join(PAGES, page + ".ts"))
    wxml = read(os.path.join(PAGES, page + ".wxml"))
    for f in fields:
        if f not in wxml:
            continue
        # 数据里必须有初值，且至少被 setData 过一次
        # 至少出现两次「字段:」——一次是接口/初值声明，一次是 setData 里的赋值
        if len(re.findall(r"\b" + f + r"\s*:", ts)) < 2:
            fails.append("[field] %s.ts 里 %s 只有声明、没有看到 setData 赋值" % (page, f))

# ---------- 5. recruit-ui 导出是否齐全 ----------
ui = read(os.path.join(ROOT, "miniprogram", "subpackages", "recruit", "utils", "recruit-ui.ts"))
for fn in ["guardTap", "confirmDanger", "debounce", "cancelDebounce", "withLoading",
           "validateFields", "firstError", "haptic"]:
    if re.search(r"export\s+(?:async\s+)?function\s+" + fn + r"\b", ui) is None:
        fails.append("[ui] recruit-ui.ts 缺少导出 %s" % fn)

print("检查页面数：%d" % len(glob.glob(os.path.join(PAGES, "*.wxml"))))
if fails:
    print("失败 %d 项：" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("全部通过：交互层接入完整（import / 类定义 / 事件实现 / 字段初值 / 工具导出）")
print("CHECK_OK")
