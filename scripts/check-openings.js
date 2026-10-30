// scripts/check-openings.js
// 校验「岗位开放」种子数据：字段完整性、日期合法性、类型取值、覆盖度统计。
// 做法：先用 tsc 把 TS 数据文件编译成 CommonJS 再 require，避免正则解析出错。
// 用法：node scripts/check-openings.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'miniprogram', 'subpackages', 'recruit', 'utils', 'recruit-openings-data.ts');
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
const OUT = path.join(ROOT, '.tmp-check-openings');

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [
    TSC, SRC,
    '--outDir', OUT,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck'
  ], { stdio: 'pipe' });
  const js = path.join(OUT, 'recruit-openings-data.js');
  if (!fs.existsSync(js)) throw new Error('编译失败：未生成 JS');
  return require(js).OPENING_ROWS;
}

const COMPANY_TYPES = ['互联网', '事务所', '咨询', '银行', '央国企', '金融', '快消', '医药',
  '制造', '能源', '地产', '半导体', '游戏', '物流', '教育', '其他'];
const OWNERSHIPS = ['外资', '国资', '民营', '合资'];
const RECRUIT_TYPES = ['提前批', '秋招正式批', '春招', '暑期实习', '日常实习', '专项计划', '社招'];

const FIELD_NAMES = ['公司', '行业', '性质', '事业群', '岗位类别', '招聘类型',
  '开放日', '截止日', '招满即止', '来源', '链接', '往年参考', '备注'];

function main() {
  let rows;
  try {
    rows = compile();
  } catch (e) {
    console.error('编译数据文件失败：', e.message || e);
    process.exit(1);
  }

  const problems = [];
  const iOf = (i) => `[第 ${i + 1} 行] ${rows[i][0] || '(空公司)'}`;

  rows.forEach((r, i) => {
    if (!Array.isArray(r)) { problems.push(`${iOf(i)} 不是数组`); return; }
    if (r.length !== 13) {
      problems.push(`${iOf(i)} 字段数 ${r.length} != 13（缺：${FIELD_NAMES.slice(r.length).join('/') || '—'}）`);
    }
    if (!r[0]) problems.push(`${iOf(i)} 公司名为空`);
    if (COMPANY_TYPES.indexOf(r[1]) < 0) problems.push(`${iOf(i)} 行业取值非法：${r[1]}`);
    if (OWNERSHIPS.indexOf(r[2]) < 0) problems.push(`${iOf(i)} 性质取值非法：${r[2]}`);
    if (RECRUIT_TYPES.indexOf(r[5]) < 0) problems.push(`${iOf(i)} 招聘类型取值非法：${r[5]}`);
    if (r[8] !== 0 && r[8] !== 1) problems.push(`${iOf(i)} 招满即止必须是 0/1，实为：${r[8]}`);
    if (!r[9]) problems.push(`${iOf(i)} 来源为空`);
    if (!r[10]) problems.push(`${iOf(i)} 链接为空`);
    if (!r[11]) problems.push(`${iOf(i)} 往年参考为空（无日期时必须给出参考节奏）`);

    // 日期合法性：YYYY-MM-DD / 待公布 / 招满即止
    [['开放日', r[6]], ['截止日', r[7]]].forEach((pair) => {
      const name = pair[0];
      const v = pair[1];
      const s = String(v || '');
      const ok = s === '待公布' || s === '招满即止' || /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (!ok) problems.push(`${iOf(i)} ${name} 格式非法：${s}`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(s + 'T00:00:00Z');
        if (isNaN(d.getTime())) problems.push(`${iOf(i)} ${name} 不是真实日期：${s}`);
      }
    });

    const a = String(r[6]);
    const b = String(r[7]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && a > b) {
      problems.push(`${iOf(i)} 开放日 ${a} 晚于截止日 ${b}`);
    }
    // 语义矛盾：截止写「招满即止」就必须 rolling=1
    if (b === '招满即止' && r[8] !== 1) {
      problems.push(`${iOf(i)} 截止写「招满即止」但 rolling=0`);
    }
    // rolling=1 且给了具体日期是合法组合（「滚动招聘，最迟 X 日收口」），不报错
  });

  // 重复检测：同公司 + 同岗位类别 + 同招聘类型
  const seen = new Map();
  rows.forEach((r, i) => {
    const k = `${r[0]}|${r[4]}|${r[5]}`;
    if (seen.has(k)) problems.push(`重复条目：${k}（第 ${seen.get(k) + 1} 行 与 第 ${i + 1} 行）`);
    else seen.set(k, i);
  });

  /* ---------- 统计 ---------- */
  const companies = new Set(rows.map((r) => r[0]));
  const byType = {};
  const byOwn = {};
  const byRecruit = {};
  rows.forEach((r) => {
    byType[r[1]] = (byType[r[1]] || 0) + 1;
    byOwn[r[2]] = (byOwn[r[2]] || 0) + 1;
    byRecruit[r[5]] = (byRecruit[r[5]] || 0) + 1;
  });
  const tba = rows.filter((r) => r[6] === '待公布').length;

  console.log('=== 岗位开放数据校验 ===');
  console.log(`总条数：${rows.length}`);
  console.log(`覆盖公司：${companies.size} 家`);
  console.log(`有具体日期：${rows.length - tba} 条；待公布：${tba} 条`);

  console.log('\n--- 按行业 ---');
  Object.keys(byType).sort((a, b) => byType[b] - byType[a]).forEach((k) => console.log(`  ${k}: ${byType[k]}`));
  console.log('\n--- 按企业性质 ---');
  Object.keys(byOwn).sort((a, b) => byOwn[b] - byOwn[a]).forEach((k) => console.log(`  ${k}: ${byOwn[k]}`));
  console.log('\n--- 按招聘类型 ---');
  Object.keys(byRecruit).sort((a, b) => byRecruit[b] - byRecruit[a]).forEach((k) => console.log(`  ${k}: ${byRecruit[k]}`));

  const fin = rows.filter((r) => /财务|会计|审计|计财|精算/.test(`${r[4]}${r[3]}`));
  console.log(`\n--- 财务/会计/审计相关：${fin.length} 条，覆盖 ${new Set(fin.map((r) => r[0])).size} 家公司`);

  if (problems.length) {
    console.log(`\n❌ 发现 ${problems.length} 个问题：`);
    problems.slice(0, 40).forEach((p) => console.log('  - ' + p));
    process.exitCode = 1;
  } else {
    console.log('\n✅ 全部校验通过');
  }
}

main();
