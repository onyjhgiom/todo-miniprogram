/**
 * scripts/check-civil-apply-link.js
 *
 * 门禁：岗位必须附带「可报名的官方链接」。
 *
 * 覆盖两条岗位线：
 *   · 体制内（tools/utils/civil-data.ts 的 CIVIL_JOBS，含国考/省考/事业编/央国企）
 *   · 校招社招（recruit/utils/recruit-openings.ts 的 OPENINGS）
 *
 * 为什么要这条门禁：
 *   岗位没有报名链接，用户看完「这个岗不错」却不知道去哪投，等于信息断头路。
 *   而体制内模块原本**整条线都没有链接字段**——这类缺失不会报编译错误、不会白屏，
 *   只会让功能静默失效，所以必须由断言兜住。
 *
 * 同时守卫「不能编造链接」：
 *   所有 host 必须在 OFFICIAL_HOSTS 白名单内（政府机关 / 部委 / 央企集团 / 企业官方校招域名），
 *   任何新增入口都要先核实主办单位再进白名单，禁止把商业招聘站当官方入口。
 *
 * 用法：node scripts/check-civil-apply-link.js
 */

const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmp-check-apply');
const TSC = path.join(
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc'
);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  ✅ ' + name);
  } else {
    fail += 1;
    const msg = name + (extra ? ' —— ' + extra : '');
    failures.push(msg);
    console.log('  ❌ ' + msg);
  }
}
function eq(name, actual, expected, extra) {
  ok(name, actual === expected, extra || `实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}`);
}
function section(t) {
  console.log('\n' + t);
}

/** 用隔离工作区的 tsc 把 TS 编成 CommonJS，返回产物目录 */
function compile(files) {
  fs.rmSync(OUT, { recursive: true, force: true });
  const args = files
    .concat([
      '--outDir', OUT,
      '--rootDir', path.join(ROOT, 'miniprogram'),
      '--module', 'commonjs',
      '--target', 'es2018',
      '--skipLibCheck'
    ]);
  const r = cp.spawnSync(process.execPath, [TSC].concat(args), { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('编译失败：\n' + (r.stdout || '') + (r.stderr || ''));
    process.exit(1);
  }
  return OUT;
}

/**
 * 官方域名白名单。
 * 收录标准：政府机关 / 部委 / 央企集团 / 企业官方校招域名。
 * 新增前必须核实主办单位，绝不能把第三方商业招聘站塞进来。
 */
const OFFICIAL_HOSTS = {
  'bm.scs.gov.cn': '国家公务员局 · 国考专题',
  'zp.cpta.com.cn': '人社部人事考试中心 · 全国人事考试服务平台',
  'www.cpta.com.cn': '人社部人事考试中心 · 中国人事考试网',
  'job.mohrss.gov.cn': '人社部 · 中国公共招聘网',
  'www.mohrss.gov.cn': '人社部 · 事业单位公开招聘服务平台',
  'cujiuye.iguopin.com': '国务院国资委 · 国资央企招聘平台',
  'gpxd.iguopin.com': '国聘行动（国资委/教育部等主办）',
  'www.iguopin.com': '国聘平台',
  'zhaopin.sgcc.com.cn': '国家电网 · 人力资源招聘平台',
  'www.ncss.cn': '教育部 · 国家大学生就业服务平台'
};

/** 企业官方校招域名（recruit 线），按主域判断 */
const CORP_HOST_SUFFIX = [
  'bytedance.com', 'alibaba.com', 'antgroup.com', 'qq.com', 'tencent.com',
  'baidu.com', 'meituan.com', 'kuaishou.cn', 'xiaomi.com', 'jd.com',
  '163.com', 'netease.com', 'huawei.com', 'zhaopin.com', 'shengting.com'
];

function hostOf(url) {
  const m = /^(https?:\/\/)?([^/?#]+)/i.exec(String(url || ''));
  return m ? m[2].toLowerCase().replace(/^www\./, '') : '';
}

(async function main() {
  console.log('='.repeat(60));
  console.log('岗位报名链接守卫');
  console.log('='.repeat(60));

  /* ---------- 编译 ---------- */
  const outDir = compile([
    path.join(ROOT, 'miniprogram/subpackages/tools/utils/civil-data.ts'),
    path.join(ROOT, 'miniprogram/subpackages/recruit/utils/recruit-openings.ts')
  ]);

  const civil = require(path.join(outDir, 'subpackages/tools/utils/civil-data.js'));
  const openings = require(path.join(outDir, 'subpackages/recruit/utils/recruit-openings.js'));

  const jobs = civil.CIVIL_JOBS || [];
  // OPENING_ROWS 是元组，需经 loadOpenings() 装配成 JobOpening 才有 applyUrl 字段
  const ops = typeof openings.loadOpenings === 'function' ? openings.loadOpenings() : [];

  /* ---------- 1. 体制内：每个岗位都要有链接 ---------- */
  section('1. 体制内岗位（国考/省考/事业编/央国企）');
  ok('岗位库非空', jobs.length > 0, '共 ' + jobs.length + ' 条');

  const noUrl = jobs.filter((j) => !j.apply || !j.apply.url);
  eq('每个岗位都有报名链接 URL', noUrl.length, 0,
    noUrl.slice(0, 5).map((j) => j.title + '(' + j.id + ')').join('、'));

  const badScheme = jobs.filter((j) => j.apply && !/^https?:\/\//i.test(j.apply.url));
  eq('链接都是 http(s) 开头', badScheme.length, 0,
    badScheme.slice(0, 3).map((j) => j.apply.url).join('、'));

  const noName = jobs.filter((j) => !j.apply || !j.apply.name || !j.apply.host || !j.apply.note);
  eq('每条链接都有名称/域名/使用说明（便于用户核对真伪）', noName.length, 0,
    noName.slice(0, 3).map((j) => j.title).join('、'));

  // 入口短名：列表卡片空间有限，靠它一眼看出「去哪报名」
  const noShort = jobs.filter((j) => !j.apply || !j.apply.short);
  eq('每条链接都有入口短名（列表卡片露出用）', noShort.length, 0,
    noShort.slice(0, 3).map((j) => j.title).join('、'));

  // 检索路径：入口是体系级的，必须再给一条「本岗位在入口内怎么找」
  const noPath = jobs.filter((j) => !j.applyPath);
  eq('每个岗位都有专属检索路径（让入口对应该岗位）', noPath.length, 0,
    noPath.slice(0, 3).map((j) => j.title).join('、'));
  const pathNoTitle = jobs.filter((j) => j.applyPath && j.applyPath.indexOf(j.title) < 0);
  eq('检索路径里带上本岗位职位名（否则定位不到）', pathNoTitle.length, 0,
    pathNoTitle.slice(0, 3).map((j) => j.applyPath).join('、'));

  // host 必须在官方白名单
  const badHost = jobs.filter((j) => j.apply && !OFFICIAL_HOSTS[hostOf(j.apply.url)]);
  eq('链接 host 全部在官方域名白名单内', badHost.length, 0,
    badHost.slice(0, 5).map((j) => j.apply.host).join('、'));

  // host 字段与实际 URL 一致（防止手改 URL 后忘记同步展示用的 host）
  const hostMismatch = jobs.filter((j) => j.apply && hostOf(j.apply.url) !== j.apply.host.replace(/^www\./, '').toLowerCase());
  eq('展示用 host 与 URL 实际域名一致', hostMismatch.length, 0,
    hostMismatch.slice(0, 3).map((j) => j.apply.host + ' ≠ ' + hostOf(j.apply.url)).join('、'));

  /* ---------- 2. 四大赛道各自都要有对应入口 ---------- */
  section('2. 四大赛道覆盖');
  ['gk', 'sk', 'sy', 'yg'].forEach((t) => {
    const list = jobs.filter((j) => j.track === t);
    const covered = list.filter((j) => j.apply && j.apply.url);
    eq(`赛道 ${t}（${list.length} 条）全部有入口`, covered.length, list.length,
      `${covered.length}/${list.length}`);
  });

  // 电网必须落到国网招聘平台（官方公告明确的唯一渠道）
  const grid = jobs.filter((j) => j.industry === '能源电力');
  const gridOk = grid.filter((j) => hostOf(j.apply.url) === 'zhaopin.sgcc.com.cn');
  eq('电网岗位全部指向国网招聘平台', gridOk.length, grid.length,
    `${gridOk.length}/${grid.length}（官方公告称其为唯一渠道）`);

  // 单位自招（考试自定）与统考要分流到不同入口
  const selfHire = jobs.filter((j) => j.track === 'sy' && j.examTime.indexOf('自定') >= 0);
  const selfOk = selfHire.filter((j) => hostOf(j.apply.url) === 'job.mohrss.gov.cn');
  eq('单位自招岗位走「中国公共招聘网」而非统考平台', selfOk.length, selfHire.length,
    `${selfOk.length}/${selfHire.length}`);

  /* ---------- 3. 国考年度专题链接的时效处理 ---------- */
  section('3. 国考年度专题链接（专题未开放时不能给用户 404）');
  // 2026-09-22：2027 年度专题尚未开放（每年 10 月中旬才开）
  const beforeOpen = civil.gkApplyPortal(new Date('2026-09-22').getTime());
  eq('专题未开放时给根域而非 kl{次年}（否则 404）', beforeOpen.url, 'http://bm.scs.gov.cn',
    beforeOpen.url);
  ok('说明里写清了开放时间与届时网址',
    beforeOpen.note.indexOf('kl2027') >= 0 && beforeOpen.note.indexOf('10 月') >= 0,
    beforeOpen.note);

  const afterOpen = civil.gkApplyPortal(new Date('2026-10-20').getTime());
  eq('专题开放后指向当年年度专题', afterOpen.url, 'http://bm.scs.gov.cn/kl2027', afterOpen.url);
  ok('专题未开放时短名为「国考专题站」', beforeOpen.short === '国考专题站', beforeOpen.short);
  ok('专题开放后短名带上年度（列表层能看出是哪一年度）',
    afterOpen.short.indexOf('2027 年度专题') >= 0, afterOpen.short);

  /* ---------- 4. 校招社招（recruit 线） ---------- */
  section('4. 校招/社招岗位（recruit 模块）');
  ok('岗位库非空', ops.length > 0, '共 ' + ops.length + ' 条');

  const opNoUrl = ops.filter((o) => !o.applyUrl);
  eq('每个岗位都有投递链接', opNoUrl.length, 0,
    opNoUrl.slice(0, 5).map((o) => `${o.company}/${o.jobCategory}`).join('、'));

  const opBad = ops.filter((o) => o.applyUrl && !/^https?:\/\//i.test(o.applyUrl));
  eq('链接都是 http(s) 开头', opBad.length, 0,
    opBad.slice(0, 3).map((o) => o.applyUrl).join('、'));

  // recruit 线是企业官方校招域名，不能出现第三方招聘站
  const THIRD_PARTY = ['zhipin.com', 'liepin.com', '51job.com', 'lagou.com', 'boss.com', 'gwy.com'];
  const opThird = ops.filter((o) => {
    const h = hostOf(o.applyUrl);
    return THIRD_PARTY.some((d) => h === d || h.endsWith('.' + d));
  });
  eq('不使用第三方商业招聘站当投递入口', opThird.length, 0,
    opThird.slice(0, 5).map((o) => `${o.company} → ${hostOf(o.applyUrl)}`).join('、'));

  // 短链（dwz.cn / t.cn 等）无法核验主办方、且随时失效，一律不允许作为投递入口
  const SHORT_LINK = ['dwz.cn', 't.cn', 'url.cn', 'tinyurl.com', 'suo.im', 'm.tb.cn', 'cutt.ly', 'bit.ly', 'is.gd'];
  const opShort = ops.filter((o) => {
    const h = hostOf(o.applyUrl);
    return SHORT_LINK.some((d) => h === d || h.endsWith('.' + d));
  });
  eq('不使用短链（无法核验主办方且易失效）', opShort.length, 0,
    opShort.slice(0, 5).map((o) => `${o.company} → ${hostOf(o.applyUrl)}`).join('、'));

  // 投递入口与来源必须同源：本模块 applyUrl 取自官方渠道 URL，
  // 若两者被拆开（投递跳第三方、来源写官网）需人工复核
  const opSplit = ops.filter((o) => o.sourceUrl && o.applyUrl && hostOf(o.sourceUrl) !== hostOf(o.applyUrl));
  eq('投递入口与官方来源同源（未跳第三方）', opSplit.length, 0,
    opSplit.slice(0, 5).map((o) => `${o.company}: ${hostOf(o.sourceUrl)} → ${hostOf(o.applyUrl)}`).join('、'));

  const allHosts = Array.from(new Set(ops.map((o) => hostOf(o.applyUrl))));
  console.log('     覆盖企业官方域 ' + allHosts.length + ' 个，示例：' + allHosts.slice(0, 6).join('、'));
  ok('投递入口全部指向企业/机构自有域（无第三方聚合站、无短链）',
    opThird.length === 0 && opShort.length === 0);

  /* ---------- 4.5 列表层也要能看到入口 ---------- */
  section('4.5 列表层（首页热门 + 赛道页）也要露出报名入口');
  const homeTs = fs.readFileSync(
    path.join(ROOT, 'miniprogram/subpackages/tools/pages/civil/civil.ts'), 'utf8');
  const homeWxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/subpackages/tools/pages/civil/civil.wxml'), 'utf8');
  const trackTs = fs.readFileSync(
    path.join(ROOT, 'miniprogram/subpackages/tools/pages/civil/track.ts'), 'utf8');
  const trackWxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/subpackages/tools/pages/civil/track.wxml'), 'utf8');

  ok('首页热门岗位带 applyHost 字段', /applyHost: j\.apply/.test(homeTs));
  ok('首页模板渲染了入口', /item\.applyHost/.test(homeWxml));
  ok('赛道页岗位带 applyHost 字段', /applyHost: j\.apply/.test(trackTs));
  ok('赛道页模板渲染了入口', /item\.applyHost/.test(trackWxml));

  // 光显示域名不够：列表层必须能一键把「本岗位对应的入口」复制走
  const pairs = [
    ['首页', homeTs, homeWxml],
    ['赛道页', trackTs, trackWxml]
  ];
  pairs.forEach(([label, ts, wxml]) => {
    ok(`${label}岗位带 applyUrl 字段（列表层可复制）`, /applyUrl: j\.apply/.test(ts), label);
    ok(`${label}岗位带 applyName 短名`, /applyName: j\.apply/.test(ts), label);
    ok(`${label}有复制链接按钮`, /data-url="\{\{item\.applyUrl\}\}"/.test(wxml), label);
    ok(`${label}复制按钮用 catchtap（否则会连带跳详情页）`,
      /catchtap="onCopyApply"/.test(wxml), label);
    ok(`${label}实现了 onCopyApply`, /onCopyApply\(e: WechatMiniprogram\.TouchEvent\)/.test(ts), label);
    ok(`${label}复制走剪贴板`, /setClipboardData/.test(ts), label);
  });

  /* ---------- 5. 页面层确实渲染了入口 ---------- */
  section('5. 岗位详情页渲染与复制入口');
  const jobWxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/subpackages/tools/pages/civil/job.wxml'), 'utf8');
  const jobTs = fs.readFileSync(
    path.join(ROOT, 'miniprogram/subpackages/tools/pages/civil/job.ts'), 'utf8');

  ok('模板里有「官方报名入口」区块', jobWxml.indexOf('官方报名入口') >= 0);
  ok('模板绑定了 apply 数据', jobWxml.indexOf('{{apply.name}}') >= 0 && jobWxml.indexOf('{{apply.host}}') >= 0);
  ok('有复制链接的点击事件', /bindtap="onCopyApply"/.test(jobWxml));
  ok('页面实现了 onCopyApply', /onCopyApply\(\)/.test(jobTs));
  ok('复制走剪贴板（小程序不能直跳外部政务站）', /setClipboardData/.test(jobTs));
  ok('render 把 job.apply 写进 data', /apply: job\.apply/.test(jobTs));

  // 入口是体系级的，详情页必须再给出「本岗位在入口内的检索路径」
  ok('详情页渲染检索路径', /\{\{applyPath\}\}/.test(jobWxml));
  ok('详情页可复制检索路径', /bindtap="onCopyPath"/.test(jobWxml));
  ok('页面实现了 onCopyPath', /onCopyPath\(\)/.test(jobTs));
  ok('render 把 job.applyPath 写进 data', /applyPath: job\.applyPath/.test(jobTs));

  /* ---------- 汇总 ---------- */
  fs.rmSync(OUT, { recursive: true, force: true });

  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + pass + ' / 失败 ' + fail + '（体制内 ' + jobs.length + ' 条 + 校招社招 ' + ops.length + ' 条）');
  if (fail) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('脚本自身异常：', err);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
});
