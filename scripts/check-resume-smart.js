// scripts/check-resume-smart.js
// 简历「智能化 + 模板多样化」离线冒烟：真编译、真加载、真跑数据。
//
// 覆盖这次升级新加的三块：
//   1) resume-smart：JD 关键词抽取 / 匹配报告（命中·缺失·覆盖率·相关度）/ 按岗位重排 / 标点规范
//   2) resume-doc：4 套版式（含新增简约一页版、紧凑多页版）、模板分组、默认模板回退
//   3) resume-adapt：版式 → 篇幅预算（一页纸收紧、紧凑版放开）
//
// 为什么要单独冒烟：这些都是本地确定性计算，tsc 只保证类型自洽，
// 「关键词抽错了」「重排把内容丢了」「版式预算给反了」这类问题一个字都不会报。
//
// 用法：node scripts/check-resume-smart.js
// 退出码：0 = 全通过；1 = 有失败
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const R = (p) => path.join(ROOT, 'miniprogram', 'subpackages', 'recruit', 'utils', p);
const ENTRIES = [R('resume-smart.ts'), R('resume-adapt.ts'), R('resume-doc.ts')];
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
// 用相对路径：与既有 check 脚本保持同一行为（绝对路径在某些环境会触发 EBUSY）
// 某些受限环境（沙箱 / CI）无法在子进程里再拉起 tsc，此时先手动编译好产物，
// 再用 RESUME_SMART_OUT=<目录> node scripts/check-resume-smart.js 直接跑断言。
const OUT = process.env.RESUME_SMART_OUT || '.tmp-resume-smart';
const SKIP_COMPILE = !!process.env.RESUME_SMART_OUT;

/* ==================== 1. 极简小程序运行时桩 ==================== */
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  getSystemInfoSync: () => ({ pixelRatio: 2 })
};

/* ==================== 2. 编译并加载 ==================== */
function compile() {
  if (SKIP_COMPILE) { console.log('（复用已编译产物：' + OUT + '，跳过 tsc）'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    execFileSync(process.execPath, ENTRIES.concat([
      '--outDir', OUT,
      '--module', 'commonjs',
      '--target', 'es2019',
      '--skipLibCheck',
      '--esModuleInterop'
    ]), { stdio: 'pipe' });
  } catch (e) {
    // 类型告警不影响 emit；只要目标 JS 生成就继续（与既有 check 脚本同策略）
  }
}
function load(name) {
  const p = path.resolve(OUT, name);
  if (!fs.existsSync(p)) throw new Error('编译失败：未生成 ' + name);
  return require(p);
}

/* ==================== 3. 断言 ==================== */
let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expect));
}
function section(t) { console.log('\n── ' + t + ' ──'); }

/* ==================== 4. 主流程 ==================== */
function main() {
  let smart;
  let doc;
  let adapt;
  try {
    compile();
    smart = load('resume-smart.js');
    adapt = load('resume-adapt.js');
    doc = load('resume-doc.js');
  } catch (e) {
    console.error('加载失败：', (e && e.stack) || e);
    process.exit(1);
  }

  /* ---------- 1. 关键词抽取 ---------- */
  section('1. JD 关键词抽取（extractJobKeywords）');
  const jd = '岗位：后端开发工程师。要求熟悉 Java / Spring Boot，掌握 MySQL 索引与事务，' +
    '了解 Redis 缓存与 Kafka 消息队列，有高并发系统设计经验者优先，英语 CET-6。';
  const kws = smart.extractJobKeywords(jd, 24);
  ok('抽出成词关键词（Java）', kws.some((k) => /java/i.test(k)), JSON.stringify(kws));
  ok('抽出成词关键词（Redis）', kws.some((k) => /redis/i.test(k)));
  ok('抽出中文关键词（高并发）', kws.indexOf('高并发') >= 0, JSON.stringify(kws));
  ok('不产出噪音词（如「岗位要求」这类 4 字切片）', kws.indexOf('岗位要求') < 0 && kws.indexOf('工程师负') < 0, JSON.stringify(kws));
  ok('空文本返回空数组（不瞎猜）', smart.extractJobKeywords('', 24).length === 0);
  ok('数量不超过 limit', smart.extractJobKeywords(jd, 5).length <= 5);

  /* ---------- 2. 匹配报告 ---------- */
  section('2. 匹配报告（matchReport：命中 / 缺失 / 覆盖率 / 相关度）');
  const profile = {
    name: '测试员',
    headline: '应聘后端开发工程师',
    contacts: ['138-0000-0000'],
    sections: [
      { key: 'edu', title: '教育背景', items: [
        { primary: '某大学', secondary: '计算机科学与技术', meta: '2023.09 - 2027.06', bullets: ['核心课程：数据结构、操作系统'] }
      ] },
      { key: 'proj', title: '项目经历', items: [
        { primary: '订单系统重构', secondary: '主要负责人', meta: '2026.03 - 2026.06',
          bullets: ['用 Java + Spring Boot 重构下单链路', '热点库存预热到 Redis，P99 从 800ms 降到 180ms'] },
        { primary: '校园二手平台', secondary: '独立开发', meta: '2025.09',
          bullets: ['用 MySQL 设计了 8 张表'] }
      ] },
      { key: 'skill', title: '技能与证书', text: 'Java · MySQL · Redis · CET-6' }
    ]
  };
  const rep = smart.matchReport(profile, { target: '后端开发', keywords: kws });
  ok('命中关键词非空', rep.hits.length > 0, JSON.stringify(rep.hits));
  ok('命中项含 MySQL', rep.hits.some((h) => /mysql/i.test(h.word)));
  ok('缺失项排除已命中词', rep.gaps.every((g) => !rep.hits.some((h) => h.word === g)), JSON.stringify(rep.gaps));
  ok('缺失项含未写进简历的 Kafka（若 JD 里有）',
    kws.some((k) => /kafka/i.test(k)) ? rep.gaps.some((g) => /kafka/i.test(g)) : true, JSON.stringify(rep.gaps));
  ok('覆盖率 0-100', rep.coverage >= 0 && rep.coverage <= 100, 'coverage=' + rep.coverage);
  ok('相关经历已按分排序（降序）', rep.ranked.every((r, i) => i === 0 || rep.ranked[i - 1].score >= r.score));
  ok('高相关经历排在前面（订单系统重构）', /订单系统/.test(rep.ranked[0].primary), rep.ranked[0].primary);
  ok('highlights 最多 3 条', rep.highlights.length <= 3);
  ok('给出了「怎么补」建议', Array.isArray(rep.tips) && rep.tips.length > 0);

  const repNone = smart.matchReport(profile, { target: '', keywords: [] });
  ok('无岗位上下文 → noContext=true（不给出吓人的 0% 结论）', repNone.noContext === true);
  ok('无岗位上下文 → 覆盖率 0 且无缺失词', repNone.coverage === 0 && repNone.gaps.length === 0);

  /* ---------- 3. 按岗位重排（只排序，不改写、不丢内容） ---------- */
  section('3. 按岗位重排（smartArrange：只排序，一个字都不改）');
  const before = JSON.stringify(profile.sections.map((s) => (s.items || []).map((it) => it.bullets)));
  const arr = smart.smartArrange(profile, { target: '后端开发', keywords: kws });
  const afterBullets = arr.sections.reduce((acc, s) => acc.concat((s.items || []).reduce((a, it) => a.concat(it.bullets || []), [])), []);
  const beforeBullets = profile.sections.reduce((acc, s) => acc.concat((s.items || []).reduce((a, it) => a.concat(it.bullets || []), [])), []);
  eq('重排后要点总数不变（没丢内容）', afterBullets.length, beforeBullets.length);
  ok('重排后要点内容集合不变（没改写）',
    JSON.stringify(afterBullets.slice().sort()) === JSON.stringify(beforeBullets.slice().sort()));
  const projSec = arr.sections.find((s) => s.key === 'proj');
  // 真正要保证的不变量：每条经历内部，要点按「命中分」从高到低排列
  const firstBullets = projSec.items[0].bullets || [];
  const scores = firstBullets.map((b) => smart.scoreOf({ primary: '', bullets: [b] }, kws));
  ok('同一经历内要点按命中分降序排列', scores.every((s, i) => i === 0 || scores[i - 1] >= s), JSON.stringify(scores));
  ok('排序确实生效（最高分那条排到了第一）', scores[0] >= Math.max.apply(null, scores), JSON.stringify(scores));
  ok('相关度高的经历在模块内前置', /订单系统/.test(projSec.items[0].primary), projSec.items[0].primary);
  ok('给出了重排说明（透明，不静默改内容）', Array.isArray(arr.notes) && arr.notes.length > 0);

  const arrNone = smart.smartArrange(profile, { target: '', keywords: [] });
  ok('无关键词时不擅自改顺序', JSON.stringify(arrNone.sections) === JSON.stringify(profile.sections));

  /* ---------- 4. 标点规范（保守清洗） ---------- */
  section('4. 标点规范（tidyProfile：只清口水话与标点，不动事实）');
  const dirty = {
    name: '测试员', headline: '', contacts: [],
    sections: [{ key: 'proj', title: '项目经历', items: [
      { primary: '订单系统', secondary: '', meta: '', bullets: ['  然后我就用Redis做了缓存，QPS提升40%  ', '负责 MySQL 分库分表'] }
    ] }]
  };
  const tidied = smart.tidyProfile(dirty);
  const b0 = tidied.profile.sections[0].items[0].bullets[0];
  ok('去掉口水话「然后我就」', b0.indexOf('然后') < 0, b0);
  ok('中英文之间补了空格', /Redis 做了|用 Redis/.test(b0), b0);
  ok('量化结果原样保留（40%）', b0.indexOf('40%') >= 0, b0);
  ok('结尾补了句号', /。$/.test(b0), b0);
  ok('报告了改动条数', tidied.changed >= 1, 'changed=' + tidied.changed);

  /* ---------- 5. 版式（样式层，与内容解耦） ---------- */
  section('5. 版式注册表（4 套：分节 / 经典 / 简约 / 紧凑）');
  const keys = doc.RESUME_LAYOUTS.map((l) => l.key);
  ok('含分节完整版', keys.indexOf('sectioned') >= 0);
  ok('含经典一页纸', keys.indexOf('classic') >= 0);
  ok('含新增简约一页版', keys.indexOf('minimal') >= 0);
  ok('含新增紧凑多页版', keys.indexOf('compact') >= 0);
  ok('每套版式都有名称 / 说明 / 风格定位',
    doc.RESUME_LAYOUTS.every((l) => !!l.name && !!l.desc && !!l.style && !!l.color));
  // 视觉层：四套版式共用一套「淡彩 + 细线 + 时间线」语言 —— 没有大色块，主题色只做点缀
  const tune = (k) => doc.tuningOf(k);
  ok('每套版式都有细节调校（条目留白 / 标题徽标 / 要点符号 / 时间线 / 面板）',
    keys.every((k) => {
      const t = tune(k);
      return !!t && typeof t.itemGap === 'number' && !!t.secBadge && !!t.bullet && !!t.tlDot
        && typeof t.textPanel === 'boolean' && typeof t.headerBand === 'boolean';
    }));
  eq('分节版用编号徽标 + 淡彩底板 + 文本面板', tune('sectioned').secBadge + '/' + tune('sectioned').secBand + '/' + tune('sectioned').textPanel, 'num/true/true');
  eq('经典版用圆点徽标 + 方点要点', tune('classic').secBadge + '/' + tune('classic').bullet, 'dot/square');
  eq('极简版零装饰：无徽标 + 中性细线 + 无页眉带', tune('minimal').secBadge + '/' + tune('minimal').rule + '/' + tune('minimal').headerBand, 'none/hair/false');
  ok('紧凑版条目留白最小、极简版最松',
    tune('compact').itemGap < tune('sectioned').itemGap && tune('minimal').itemGap >= tune('sectioned').itemGap);
  ok('紧凑版保留结构装饰（徽标/面板）只退底板', tune('compact').secBadge === 'num' && tune('compact').secBand === false);
  ok('页眉不铺色块：顶部主题色细条 ≤ 8px', doc.TOP_BAR <= 8, 'TOP_BAR=' + doc.TOP_BAR);
  ok('配色主题 ≥ 7 套（藏青 / 酒红 / 暖橙 / 青碧 / 松绿）', doc.RESUME_THEMES.length >= 7, 'len=' + doc.RESUME_THEMES.length);
  ok('主题色都是深色系（白底上可读，不会显廉价）', doc.RESUME_THEMES.every((t) => {
    const hex = t.accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 150; // 亮度 < 150：深色调
  }));

  /* ---------- 5b. 背景层次：派生淡彩必须「淡而不灰」 ---------- */
  section('5b. 背景层次（mixHex 派生淡彩：有色彩倾向但绝不被误当成正文底色）');
  const tint = doc.mixHex('#1d4ed8', '#ffffff', 0.14);
  ok('淡彩是合法 6 位 hex', /^#[0-9a-f]{6}$/.test(tint), tint);
  const t2 = tint.replace('#', '');
  const tr = parseInt(t2.slice(0, 2), 16), tg = parseInt(t2.slice(2, 4), 16), tb = parseInt(t2.slice(4, 6), 16);
  ok('淡彩亮度 > 225（接近白，不压正文可读性）', (0.299 * tr + 0.587 * tg + 0.114 * tb) > 225, tint);
  ok('淡彩保留主题色色相倾向（蓝 > 红，经典蓝）', tb > tr, `r=${tr} b=${tb}`);
  eq('非法色值安全回退到基色', doc.mixHex('not-a-color', '#123456', 0.5), '#123456');

  /* ---------- 5c. 联系方式图标识别 ---------- */
  section('5c. 联系方式图标（iconOfContact：邮箱 / 链接 / 电话 / 兜底圆点）');
  eq('邮箱识别为 mail', doc.iconOfContact('linzy@example.com'), 'mail');
  eq('链接识别为 link', doc.iconOfContact('https://github.com/linzy'), 'link');
  eq('手机号识别为 phone', doc.iconOfContact('138-0000-0000'), 'phone');
  eq('带横线的固话也识别为 phone', doc.iconOfContact('0571-88888888'), 'phone');
  eq('猜不出时兜底小圆点（不硬猜）', doc.iconOfContact('随时到岗'), 'dot');

  /* ---------- 6. 版式 → 篇幅预算 ---------- */
  section('6. 版式预算（budgetOfLayout：一页纸收紧，紧凑版放开）');
  const bClassic = adapt.budgetOfLayout('classic');
  const bMinimal = adapt.budgetOfLayout('minimal');
  const bCompact = adapt.budgetOfLayout('compact');
  const bDefault = adapt.budgetOfLayout('sectioned');
  ok('简约一页版容量最小', bMinimal.maxTotalBullets <= bClassic.maxTotalBullets);
  ok('紧凑多页版容量最大', bCompact.maxTotalBullets > bDefault.maxTotalBullets);
  ok('未知版式回退默认预算', adapt.budgetOfLayout('__nope__') === adapt.DEFAULT_BUDGET);
  ok('预算字段完整', [bClassic, bMinimal, bCompact, bDefault].every((b) =>
    typeof b.maxBulletsHigh === 'number' && typeof b.maxTotalChars === 'number'));

  /* ---------- 7. 模板多样化（分组 + 回退） ---------- */
  section('7. 模板注册表（分组齐全 + 兜底必须是通用模板）');
  ok('模板总数 ≥ 20（新增嵌入式 / 大模型 / 供应链 / 机械 / 法务 / 教师）',
    doc.RESUME_TEMPLATES.length >= 20, 'len=' + doc.RESUME_TEMPLATES.length);
  ok('含技术岗模板（后端 / 前端 / 算法 / 嵌入式 / 大模型）',
    ['后端开发', '前端开发', '算法工程师', '嵌入式', 'AI应用'].every((k) => doc.RESUME_TEMPLATES.some((t) => t.key === k)));
  ok('含产品运营岗模板（产品经理 / 运营 / 市场）',
    ['产品经理', '运营', '市场'].every((k) => doc.RESUME_TEMPLATES.some((t) => t.key === k)));
  ok('每份模板都有 profile 与 sections',
    doc.RESUME_TEMPLATES.every((t) => t.profile && Array.isArray(t.profile.sections)));
  ok('每份模板都有 key / title 且唯一',
    new Set(doc.RESUME_TEMPLATES.map((t) => t.key)).size === doc.RESUME_TEMPLATES.length);

  const grouped = {};
  doc.TEMPLATE_GROUPS.forEach((g) => g.keys.forEach((k) => { grouped[k] = true; }));
  const ungrouped = doc.RESUME_TEMPLATES.filter((t) => !grouped[t.key]).map((t) => t.key);
  ok('所有模板都落在某个分组里（弹层里不会漏）', ungrouped.length === 0, JSON.stringify(ungrouped));
  ok('分组至少覆盖技术岗 / 产品运营 / 通用',
    ['tech', 'pmops', 'general'].every((k) => doc.TEMPLATE_GROUPS.some((g) => g.key === k)));

  eq('未知分类回退「通用」模板（不再回退到数开）', doc.templateByCategory('__不存在__').key, '通用');
  eq('按 key 精确命中模板', doc.templateByCategory('嵌入式').key, '嵌入式');

  /* ---------- 8. 四种版式的排版与绘制（假 canvas 上下文，验证不炸且页数合理） ---------- */
  section('8. 排版与绘制（layout / drawPage：4 种版式都跑一遍）');

  /** 极简 2D 上下文桩：只提供 resume-doc 用到的绘图接口，measureText 按字数估宽 */
  function fakeCtx() {
    const noop = () => {};
    const grad = { addColorStop: noop };
    return {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'top',
      globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
      measureText: (t) => ({ width: String(t || '').length * 12 }),
      createLinearGradient: () => grad,
      fillText: noop, fillRect: noop, strokeRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      arcTo: noop, arc: noop, rect: noop, closePath: noop, fill: noop, stroke: noop, save: noop, restore: noop,
      clip: noop, drawImage: noop, setLineDash: noop, scale: noop, translate: noop
    };
  }

  // 内容较多的简历：用来观察「紧凑版页数 ≤ 分节版页数」
  const longProfile = {
    name: '测试员',
    headline: '应聘后端开发工程师',
    expectedSalary: '15K-20K',
    expectedCity: '上海',
    contacts: ['138-0000-0000', 'a@b.com'],
    sections: []
  };
  for (let i = 0; i < 6; i++) {
    longProfile.sections.push({
      key: 'proj', title: '项目经历', items: [{
        primary: '项目 ' + i, secondary: '主要负责人', meta: '2026.0' + (i + 1) + ' - 2026.0' + (i + 2),
        bullets: ['用 Java 与 Spring Boot 重构核心链路，接口 P99 从 800ms 降到 180ms',
          '把热点数据预热到 Redis，命中率提升到 96%',
          '补充压测与监控告警，单机 QPS 从 600 提升到 2100',
          '推动灰度发布流程落地，线上故障环比下降 25%']
      }]
    });
  }
  longProfile.sections.push({ key: 'skill', title: '技能与证书', text: 'Java · Spring Boot · MySQL · Redis · Kafka · Docker · CET-6' });

  const theme = doc.RESUME_THEMES[0];
  const pageCount = {};
  ['sectioned', 'classic', 'minimal', 'compact'].forEach((lk) => {
    let err = null;
    let pages = [];
    try {
      const ctx = fakeCtx();
      const r = doc.layout(ctx, longProfile, lk, false);
      pages = r.pages;
      ok(lk + '：分页结果非空', pages.length > 0, 'pages=' + pages.length);
      // 逐页绘制一遍（含页眉 / 页脚 / 小节标题 / 要点 / 图片占位 / 续页页眉 / 时间线）
      for (let i = 0; i < pages.length; i++) {
        doc.drawPage(ctx, r.measured, pages[i], i + 1, pages.length, theme, lk, undefined, undefined, undefined, '测试员 · 应聘后端开发工程师');
      }
    } catch (e) { err = e; }
    ok(lk + '：绘制全程不抛错', !err, err && ((err.stack || err.message || String(err)) + '').slice(0, 200));
    pageCount[lk] = pages.length || 99;
  });

  ok('紧凑多页版页数 ≤ 分节完整版（同样内容更省纸）',
    pageCount.compact <= pageCount.sectioned, JSON.stringify(pageCount));
  ok('简约一页版不会比紧凑版更省（留白更多）',
    pageCount.minimal >= pageCount.compact, JSON.stringify(pageCount));

  // 带证件照：页眉右列收窄 + 照片竖向空间补偿，最容易错位的一条路径
  const photoImg = { img: {}, width: 300, height: 300 };
  ['sectioned', 'minimal'].forEach((lk) => {
    let err = null;
    try {
      const ctx = fakeCtx();
      const r = doc.layout(ctx, longProfile, lk, true);
      doc.drawPage(ctx, r.measured, r.pages[0], 1, r.pages.length, theme, lk, photoImg, '');
    } catch (e) { err = e; }
    ok(lk + '：带证件照排版绘制不抛错', !err, err && ((err.stack || err.message || String(err)) + '').slice(0, 200));
  });

  /* ---------- 收尾 ---------- */
  if (!SKIP_COMPILE) fs.rmSync(OUT, { recursive: true, force: true });
  console.log('\n' + '='.repeat(52));
  console.log('简历智能化 / 模板多样化冒烟：' + pass + ' 通过 / ' + fail + ' 失败');
  if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  · ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
}

main();
