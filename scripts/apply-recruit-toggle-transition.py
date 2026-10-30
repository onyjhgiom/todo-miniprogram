# -*- coding: utf-8 -*-
"""
给标签 / 分段控件补「选中态过渡」。

之前切换标签时背景色与文字色是瞬间跳变（其它属性已有过渡，
但 transition 属性会被整条覆盖，所以必须写在最后才会生效）。
"""
import io, os

ROOT = r"C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram"
PAGES = os.path.join(ROOT, "miniprogram", "subpackages", "recruit", "pages", "recruit")

TOGGLE = {
    "recruit": [".rc__filter", ".rc__sort"],
    "openings": [".op__tab", ".op__tab--sm", ".op__seg-i"],
    "resource": [".rs__tab", ".rs__tab--cat", ".rs__tab--round", ".rs__gtab", ".rs__chip"],
    "analysis": [".an__chip"],
    "calendar": [".cal__view-i"],
    "detail": [".dt__kb-tab", ".dt__seg-i"],
    "resume": [".rm__theme"],
}

MARK = "选中态过渡（标签 / 分段控件）"

for page, classes in TOGGLE.items():
    p = os.path.join(PAGES, page + ".wxss")
    src = io.open(p, encoding="utf-8").read()
    if MARK in src:
        print("%-10s skip" % page)
        continue
    src = src.rstrip("\n") + "\n\n/* " + MARK + " */\n" + ", ".join(classes) + " {\n" + \
        "  transition: background-color 160ms ease, color 160ms ease,\n" \
        "              transform 160ms ease, opacity 160ms ease, box-shadow 160ms ease;\n}\n"
    io.open(p, "w", encoding="utf-8").write(src)
    print("%-10s added (%d)" % (page, len(classes)))
print("TOGGLE_OK")
