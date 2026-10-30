# -*- coding: utf-8 -*-
"""
给秋招助手各页接入「交互反馈层」。

严格遵循「只加反馈、不改布局」：
  - 只追加 :active / :hover / animation / transition 规则；
  - 不改任何尺寸、颜色变量、边距与层级（z-index、position 一律不动）；
  - 因此在桌面端与移动端都不会改变现有视觉，只是补上缺失的反馈。
"""
import io, os

ROOT = r"C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram"
PAGES = os.path.join(ROOT, "miniprogram", "subpackages", "recruit", "pages", "recruit")
IMPORT_LINE = '@import "../../interaction.wxss";\n'

# page -> (强按压类, 轻按压类, 悬停类, 弹层(遮罩,面板,是否居中弹窗), 额外规则)
CONF = {
    "recruit": {
        "strong": [".rc__chip", ".rc__filter", ".rc__sort", ".rc__act", ".rc__search-clear",
                   ".rc__back-x", ".rc__plat", ".rc__fab"],
        "light": [".rc__civil", ".rc__res", ".rc__ana", ".rc__import", ".rc__follow",
                  ".rc__back-main", ".rc__agenda-item", ".rc__radar-item", ".rc__brief-item",
                  ".rc__card"],
        "hover": [".rc__card", ".rc__civil", ".rc__res", ".rc__ana", ".rc__plat", ".rc__agenda-item"],
        "extra": """
/* 悬浮按钮：按压幅度大一点，手感更像实体键 */
.rc__fab { transition: transform 160ms ease, box-shadow 160ms ease; }
.rc__fab:active { transform: scale(0.9); box-shadow: 0 6rpx 18rpx rgba(37, 99, 235, 0.32); }
/* 列表面板按压时轻微下沉，卡片本身只降透明度，避免整块跳动 */
.rc__card { transition: transform 160ms ease, opacity 160ms ease, box-shadow 160ms ease; }
.rc__card:active { opacity: 0.88; }
""",
    },
    "openings": {
        "strong": [".op__tab", ".op__tab--sm", ".op__reset", ".op__seg-i", ".op__fav", ".op__pact",
                   ".op__act", ".op__more", ".op__search-clear", ".op__fbtn", ".op__top"],
        "light": [".op__reco-item", ".op__group-head", ".op__item-head", ".op__tl-bar", ".op__tl-today"],
        "hover": [".op__reco-item", ".op__item-head", ".op__tab", ".op__tab--sm", ".op__act"],
        "dialog": (".op__mask", ".op__sheet", True),
        "extra": """
/* 列表首屏骨架：数据未就绪时占位，避免整屏空白 */
.op__sk { padding: 24rpx; }
""",
    },
    "resource": {
        "strong": [".rs__tab", ".rs__tab--cat", ".rs__tab--round", ".rs__gtab", ".rs__smart-btn",
                   ".rs__chip", ".rs__item-fav", ".rs__item-import", ".rs__item-pdf", ".rs__empty-btn",
                   ".rs__more", ".rs__top", ".rs__share", ".rs__search-clear", ".rs__boost-x",
                   ".rs__fbtn", ".rs__rel-i"],
        "light": [".rs__group-head", ".rs__item-head"],
        "hover": [".rs__item-head", ".rs__tab", ".rs__tab--cat", ".rs__tab--round", ".rs__gtab",
                  ".rs__chip", ".rs__more", ".rs__empty-btn"],
        "sheet": (".rs__mask", ".rs__sheet"),
        "extra": "",
    },
    "analysis": {
        "strong": [".an__chip", ".an__jbtn", ".an__prio"],
        "light": [".an__ocell", ".an__rrow"],
        "hover": [".an__ocell", ".an__chip", ".an__jbtn", ".an__rrow"],
        "extra": """
/* 看板空状态：给一个明确的下一步入口，而不是只有一句说明 */
.an__empty-btn {
  margin-top: 24rpx; padding: 18rpx 40rpx; border-radius: 999rpx;
  background: #2563eb; color: #fff; font-size: 26rpx; font-weight: 600;
}
""",
    },
    "calendar": {
        "strong": [".cal__view-i", ".cal__nav-btn", ".cal__nav-today", ".cal__cell", ".cal__wcell",
                   ".cal__event-act"],
        "light": [".cal__event"],
        "hover": [".cal__cell", ".cal__wcell", ".cal__event", ".cal__nav-btn", ".cal__view-i"],
        "extra": """
/* 日期格子：按压时保留选中态可读性，只做轻微缩放 */
.cal__cell, .cal__wcell { transition: transform 150ms ease, opacity 150ms ease; }
.cal__cell:active, .cal__wcell:active { transform: scale(0.94); opacity: 0.82; }
""",
    },
    "detail": {
        "strong": [".dt__mini", ".dt__btn-soft", ".dt__kb-tab", ".dt__seg-i", ".dt__q-del",
                   ".dt__fbtn", ".dt__af-alt-i", ".dt__kw"],
        "light": [".dt__autofill", ".dt__iv-main", ".dt__q"],
        "hover": [".dt__mini", ".dt__btn-soft", ".dt__kb-tab", ".dt__fbtn", ".dt__autofill", ".dt__iv-main"],
        "sheet": (".dt__mask", ".dt__sheet"),
        "extra": """
/* ---------- 表单校验：错误态 ---------- */
.dt__input--err {
  background: #fff5f3;
  border-color: #C0522F;
}
.dt__picker--err {
  background: #fff5f3;
  border-color: #C0522F;
  color: #C0522F;
}
.dt__err {
  display: block;
  font-size: 22rpx;
  color: #C0522F;
  margin-top: 8rpx;
  line-height: 1.5;
}
/* ---------- 按钮不可用态 ---------- */
.dt__fbtn--disabled { opacity: 0.45; }
.dt__fbtn--disabled:active { transform: none; opacity: 0.45; }
""",
    },
    "resume": {
        "strong": [".rm__btn", ".rm__theme", ".rm__add", ".rm__photo-del", ".rm__img-add",
                   ".rm__item-del", ".rm__img-del", ".rm__tpl", ".rm__sheet-cancel", ".rm__match"],
        "light": [],
        "hover": [".rm__btn", ".rm__theme", ".rm__tpl", ".rm__match"],
        "sheet": (".rm__mask", ".rm__sheet"),
        "extra": """
/* 生成类按钮忙碌态：保留按钮形状，只降饱和并锁定点击 */
.rm__btn--busy { opacity: 0.6; }
.rm__btn--busy:active { transform: none; opacity: 0.6; }
""",
    },
}


def block(name, cfg):
    out = []
    out.append("")
    out.append("/* ============================================================")
    out.append(" * 交互反馈层（按压 / 悬停 / 弹层过渡 / 校验态）")
    out.append(" * 只补充反馈，不改变任何布局、尺寸与配色。")
    out.append(" * ============================================================ */")

    strong = cfg.get("strong") or []
    light = cfg.get("light") or []
    hover = cfg.get("hover") or []

    if strong:
        out.append("")
        out.append("/* 按压反馈：小控件 / 按钮 */")
        out.append(", ".join(strong) + " {")
        out.append("  transition: transform 150ms ease, opacity 150ms ease, box-shadow 150ms ease;")
        out.append("}")
        out.append(", ".join(s + ":active" for s in strong) + " {")
        out.append("  transform: scale(0.955);")
        out.append("  opacity: 0.74;")
        out.append("}")

    if light:
        out.append("")
        out.append("/* 按压反馈：卡片 / 列表行（幅度更轻，避免整块跳动） */")
        out.append(", ".join(light) + " {")
        out.append("  transition: background-color 150ms ease, opacity 150ms ease;")
        out.append("}")
        out.append(", ".join(l + ":active" for l in light) + " {")
        out.append("  opacity: 0.88;")
        out.append("}")

    sheet = cfg.get("sheet")
    dialog = cfg.get("dialog")
    if sheet:
        out.append("")
        out.append("/* 弹层过渡：遮罩淡入 + 面板上滑 */")
        out.append("%s { animation: ix-fade-in 180ms ease both; }" % sheet[0])
        out.append("%s { animation: ix-sheet-up 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }" % sheet[1])
    if dialog:
        out.append("")
        out.append("/* 弹层过渡：居中弹窗用缩放淡入，比上滑更贴合对话框形态 */")
        out.append("%s { animation: ix-fade-in 180ms ease both; }" % dialog[0])
        out.append("%s { animation: ix-pop-in 220ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }" % dialog[1])

    if hover:
        out.append("")
        out.append("/* 桌面端悬停：仅对真正有鼠标的设备生效，触屏不受影响 */")
        out.append("@media (hover: hover) and (pointer: fine) {")
        out.append("  " + ", ".join(h + ":hover" for h in hover) + " {")
        out.append("    box-shadow: 0 10rpx 28rpx rgba(15, 23, 42, 0.12);")
        out.append("    transform: translateY(-2rpx);")
        out.append("  }")
        out.append("}")

    extra = cfg.get("extra")
    if extra:
        out.append("")
        out.append(extra.rstrip("\n"))

    return "\n".join(out) + "\n"


report = []
for name, cfg in CONF.items():
    p = os.path.join(PAGES, name + ".wxss")
    src = io.open(p, encoding="utf-8").read()
    changed = False

    if IMPORT_LINE not in src:
        # @import 必须位于文件顶部（在其它规则之前），紧贴首行注释之后插入
        lines = src.split("\n")
        idx = 0
        if lines and lines[0].startswith("/*"):
            idx = 1
        lines.insert(idx, IMPORT_LINE.rstrip("\n"))
        src = "\n".join(lines)
        changed = True

    if "交互反馈层（按压 / 悬停" not in src:
        src = src.rstrip("\n") + "\n" + block(name, cfg)
        changed = True

    if changed:
        io.open(p, "w", encoding="utf-8").write(src)
    report.append("%-10s changed=%s  import=%s  block=%s  lines=%d" % (
        name, changed,
        IMPORT_LINE.strip() in io.open(p, encoding="utf-8").read(),
        "交互反馈层（按压 / 悬停" in io.open(p, encoding="utf-8").read(),
        io.open(p, encoding="utf-8").read().count("\n") + 1))

print("\n".join(report))
print("REPORT_OK")
