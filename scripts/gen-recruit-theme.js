// scripts/gen-recruit-theme.js —— 生成秋招模块的深色主题覆盖样式
//
// 背景：recruit 下 7 个页面此前把 themeStyle 当 class 名用（它其实是 CSS 变量文本），
// 且根节点没有 data-theme，导致 .themed[data-theme=...] 的变量永远读不到 —— 主题彻底失效。
// 页面 WXSS 里又大量硬编码浅色，所以除了补根属性，还要按类名逐条覆盖。
//
// 本脚本按「语义分组」展开主题选择器，避免手写 8 套主题 × 上百个类名时漏项。
// 用法：node scripts/gen-recruit-theme.js   （会重写 recruit/recruit-theme.wxss）
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'miniprogram', 'app.wxss');
const MARK_BEGIN = '/* ===== BEGIN recruit-theme（由 scripts/gen-recruit-theme.js 生成，勿手改） ===== */';
const MARK_END = '/* ===== END recruit-theme ===== */';

/** 需要适配的主题（light 不列：浅色主题保持原样，避免任何像素变化） */
const THEMES = ['dark', 'rose', 'forest', 'twilight', 'scarlet', 'jade', 'indigo', 'custom'];

/**
 * 展开选择器。
 * 不用「8 套主题 × N 个类名」的笛卡尔积 —— 那样光这一个文件就 65KB，
 * 而 tools 分包已经在 2MB 红线上（曾直接把分包顶到 101%）。
 * 改用一条否定选择器覆盖除 light 外的全部主题，体积降到 1KB 级。
 */
const ALL_DARK = ".themed[data-theme]:not([data-theme='light'])";
function sel(classes) {
  return classes.map((c) => `${ALL_DARK} ${c}`).join(',\n');
}

/* 容器 / 面板：浅底 → 卡片色，去掉亮色阴影 */
const SINK = [
  '.rc__radar', '.rc__card', '.rc__platforms', '.rc__plat', '.rc__import',
  '.rc__search-box', '.rc__filter', '.rc__agenda',
  '.dt__card', '.dt__kb-tab', '.dt__btn-soft', '.dt__footer', '.dt__fbtn--ghost',
  '.dt__sheet', '.dt__mini--ghost', '.dt__mini', '.dt__iv-note',
  '.op__item', '.op__note', '.op__act', '.op__sheet', '.op__fbtn--ghost',
  '.op__group-head', '.op__tl-card', '.op__tl-scroll', '.op__prep', '.op__pact',
  '.rs__search', '.rs__item', '.rs__sticky', '.rs__group', '.rs__group-head',
  '.rs__share', '.rs__sheet', '.rs__sum', '.rs__sum-sec', '.rs__sum-tag',
  '.rs__sum-topic', '.rs__sum-kp', '.rs__rel', '.rs__chip', '.rs__fbtn--ghost',
  '.rm__card', '.rm__item', '.rm__sheet', '.rm__tpl', '.rm__btn--ghost', '.rm__btn--line',
  '.an__card', '.an__tip', '.an__jbtn',
  '.cal__event', '.cal__timeline', '.cal__wcell', '.cal__event-act'
];

/* 输入类：浅底 → soft 底（比卡片再低一档，保持输入框可辨识） */
const FIELD = [
  '.rc__search-input',
  '.dt__input', '.dt__picker', '.dt__area', '.dt__seg-i',
  '.op__search-input',
  '.rs__input', '.rs__area',
  '.rm__input', '.rm__area'
];

/* 主文字 */
const TEXT_MAIN = [
  '.rc__radar-title', '.rc__card-co-name', '.rc__agenda-title', '.rc__agenda-co',
  '.dt__card-title', '.dt__label', '.dt__q-q', '.dt__ck-text', '.dt__sheet-title',
  '.dt__tl-label', '.dt__input', '.dt__picker', '.dt__area', '.dt__iv-date',
  '.op__co', '.op__k', '.op__v', '.op__group-label', '.op__sheet-title',
  '.op__prep-title', '.op__tl-title', '.op__tl-side-co', '.op__tl-month',
  '.op__tl-bar-date', '.op__prep-focus', '.op__prep-li',
  '.rs__item-title', '.rs__seg', '.rs__gname', '.rs__sum-scope', '.rs__sum-h',
  '.rs__sum-tname', '.rs__sum-kp-t', '.rs__sheet-title', '.rs__input', '.rs__area',
  '.rm__card-title', '.rm__label', '.rm__input', '.rm__area', '.rm__sheet-title', '.rm__tpl',
  '.an__card-title', '.an__ocell', '.an__rco', '.an__tip', '.an__rnum',
  '.an__frow-label', '.an__ref-label', '.an__plabel',
  '.cal__day', '.cal__wcell-day', '.cal__panel-title', '.cal__event-co'
];

/* 次要文字 */
const TEXT_SOFT = [
  '.rc__radar-pos', '.rc__card-co-pos', '.rc__meta', '.rc__plat-desc', '.rc__import',
  '.rc__sort', '.rc__last', '.rc__empty', '.rc__empty-tip', '.rc__radar-sub', '.rc__plats-title',
  '.rc__agenda-day', '.rc__agenda-meta',
  '.dt__hint', '.dt__seg-i', '.dt__kb-tab', '.dt__btn-soft', '.dt__fbtn--ghost',
  '.dt__q-a', '.dt__sec', '.dt__tl-date', '.dt__tl-ago', '.dt__tl-note',
  '.dt__ck-text--done', '.dt__q-title',
  '.dt__iv-mode', '.dt__iv-sub',
  '.op__type', '.op__date', '.op__due', '.op__note', '.op__act', '.op__sheet-body',
  '.op__fbtn--ghost', '.op__count', '.op__foot', '.op__tl-sub', '.op__lg',
  '.op__tl-tip', '.op__tl-d-status', '.op__prep-tag', '.op__prep-when', '.op__prep-bt',
  '.rs__item-cat', '.rs__count', '.rs__gtab', '.rs__gcount', '.rs__item-content',
  '.rs__sum-tcount', '.rs__sum-tsample', '.rs__sum-kp-p', '.rs__sum-foot', '.rs__rel-i',
  '.rs__tab',
  '.rm__tip', '.rm__item-no', '.rm__btn--ghost', '.rm__sheet-sub', '.rm__sheet-cancel',
  '.an__card-sub', '.an__note', '.an__frow-sub', '.an__tcol-l', '.an__tcol-n',
  '.an__ref-val', '.an__pval', '.an__rpos', '.an__rtip', '.an__ocell--lbl',
  '.cal__tl-text', '.cal__tl-tip', '.cal__panel-sub', '.cal__event-place',
  '.cal__wd', '.cal__wcell-wd'
];

/* 弱化文字 */
const TEXT_MUTE = [
  '.rs__empty-t', '.rs__empty-s', '.an__empty-tip', '.an__empty-sub',
  '.op__empty', '.cal__empty'
];

const parts = [];
parts.push('/* 秋招模块深色主题覆盖');
parts.push(' *');
parts.push(' * 页面 WXSS 大量硬编码浅色，只补 data-theme 会出现「深色页面底色 + 白色卡片」的割裂感。');
parts.push(' * 这里把主要容器与文字按主题变量统一覆盖；语义色（徽标、进度条、状态点）保持原样不覆盖，');
parts.push(' * 避免把「进行中 / 已截止」这类颜色语义抹平。');
parts.push(' * 浅色主题不在此列 —— 必须保证浅色下与改动前逐像素一致。');
parts.push(' *');
parts.push(' * 为什么放主包的 app.wxss 而不是 recruit 自己的 wxss：');
parts.push(' * tools 分包已到 98% 的 2MB 红线，这 12KB 放分包里会挤压余量；');
parts.push(' * 选择器都以各页专属前缀（rc__ / dt__ / op__ / rs__ / rm__ / an__ / cal__）限定，');
parts.push(' * 写在全局与写在页面内效果一致，不会误伤其它页面。 */');
parts.push('');
parts.push('/* 容器 / 面板 → 卡片色 */');
parts.push(sel(SINK) + ' {');
parts.push('  background: var(--color-card);');
parts.push('  box-shadow: none;');
parts.push('  border-color: var(--color-border);');
parts.push('}');
parts.push('');
parts.push('/* 输入类 → 次级底色 */');
parts.push(sel(FIELD) + ' {');
parts.push('  background: var(--color-bg-soft);');
parts.push('  border-color: var(--color-border);');
parts.push('  color: var(--color-text);');
parts.push('}');
parts.push('');
parts.push('/* 主文字 */');
parts.push(sel(TEXT_MAIN) + ' {');
parts.push('  color: var(--color-text);');
parts.push('}');
parts.push('');
parts.push('/* 次要文字 */');
parts.push(sel(TEXT_SOFT) + ' {');
parts.push('  color: var(--color-text-soft);');
parts.push('}');
parts.push('');
parts.push('/* 弱化文字 */');
parts.push(sel(TEXT_MUTE) + ' {');
parts.push('  color: var(--color-text-mute);');
parts.push('}');
parts.push('');

const block = MARK_BEGIN + '\n' + parts.join('\n') + MARK_END + '\n';
let css = fs.readFileSync(OUT, 'utf8');

// 幂等重写：有标记就替换标记之间，没有就追加到末尾
const b = css.indexOf(MARK_BEGIN);
const e = css.indexOf(MARK_END);
if (b >= 0 && e > b) {
  css = css.slice(0, b) + block + css.slice(e + MARK_END.length + 1);
} else {
  if (!css.endsWith('\n')) css += '\n';
  css += '\n' + block;
}
fs.writeFileSync(OUT, css, 'utf8');

const lines = block.split('\n').length;
console.log('已写入 ' + path.relative(path.resolve(__dirname, '..'), OUT) +
  '（recruit-theme 段 ' + lines + ' 行 / ' + Buffer.byteLength(block, 'utf8') + ' 字节）');
