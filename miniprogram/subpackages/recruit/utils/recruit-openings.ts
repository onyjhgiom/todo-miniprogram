// utils/recruit-openings.ts
// 「岗位开放」模块：按「公司 × 招聘类型 × 岗位类别」三维度追踪开放与截止日期。
// 数据量大，种子数据单独放在 recruit-openings-data.ts。
//
// 数据诚实性约定（重要）：
//   1) 每条记录都带 source（来源）与 updatedAt（更新时间），用户可以自己判断可信度；
//   2) 官方已公布具体日期的，写具体日期；只说「X 月启动」的，写该月月初并标注「具体日期待确认」；
//   3) 官方尚未公布的，openDate / deadline 写「待公布」，并在 lastYearRef 给出去年同期的实际节奏作参考；
//   4) rolling=true 表示「招满即止」——公告上的截止日期往往不是真实截止时间，
//      热门岗位实际会提前关岗，UI 上要显式提示，避免用户踩坑。
//   5) 页面顶部固定展示免责声明：一切以企业官方招聘渠道为准。

import { OPENING_ROWS } from './recruit-openings-data';
import type { OpeningRow } from './recruit-openings-data';

/** 招聘类型 */
export type RecruitType = '提前批' | '秋招正式批' | '春招' | '暑期实习' | '日常实习' | '专项计划' | '社招';

/** 行业分类 */
export type CompanyType =
  | '互联网' | '事务所' | '咨询' | '银行' | '央国企' | '快消' | '制造'
  | '金融' | '医药' | '能源' | '地产' | '半导体' | '游戏' | '物流' | '教育' | '其他';

/** 企业性质：外企 / 国资 / 民营 / 合资 */
export type Ownership = '外资' | '国资' | '民营' | '合资';

/** 派生状态 */
export type OpeningStatus = 'upcoming' | 'open' | 'closing' | 'closed' | 'tba';

export interface JobOpening {
  _id: string;
  /** 公司名 */
  company: string;
  /** 行业 */
  companyType: CompanyType;
  /** 企业性质 */
  ownership: Ownership;
  /** 事业群 / 分所 / 业务线，如「天健·杭州总所」「腾讯·职能线」 */
  group: string;
  /** 岗位类别，如「财务/会计」「技术-后端」「审计」 */
  jobCategory: string;
  recruitType: RecruitType;
  /** 开放开始日期 YYYY-MM-DD，或「待公布」 */
  openDate: string;
  /** 截止日期 YYYY-MM-DD /「招满即止」/「待公布」 */
  deadline: string;
  /** 是否滚动招聘（招满即止） */
  rolling: boolean;
  /** 信息来源 */
  source: string;
  /** 来源链接 */
  sourceUrl: string;
  /** 该条数据的更新时间 YYYY-MM-DD */
  updatedAt: string;
  /** 官方未公布时，给出去年同期的实际节奏作参考 */
  lastYearRef: string;
  /** 投递入口 */
  applyUrl: string;
  /** 备注 / 投递建议 */
  note: string;
}

/** 数据整体更新时间（页面顶部展示） */
export const OPENINGS_DATA_VERSION = '2026-09-13';

/* ==================== 状态计算 ==================== */

function parseDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return isNaN(t) ? null : t;
}

export const STATUS_LABEL: Record<OpeningStatus, string> = {
  upcoming: '未开始',
  open: '进行中',
  closing: '即将截止',
  closed: '已截止',
  tba: '待公布'
};

/** 根据当前时间推导状态 */
export function statusOf(o: JobOpening, now = Date.now()): OpeningStatus {
  const open = parseDate(o.openDate);
  const due = parseDate(o.deadline);
  if (open === null && due === null) return 'tba';
  if (open !== null && open > now) return 'upcoming';
  if (due === null) return o.rolling ? 'open' : 'tba';
  if (due < now) return 'closed';
  const days = Math.ceil((due - now) / 86400000);
  if (days <= 7) return 'closing';
  return 'open';
}

/** 距截止天数；无法计算返回 null */
export function daysLeft(o: JobOpening, now = Date.now()): number | null {
  const due = parseDate(o.deadline);
  if (due === null) return null;
  return Math.ceil((due - now) / 86400000);
}

/** 展示用文案：「已截止」/「今天截止」/「剩 12 天」/「招满即止」 */
export function dueText(o: JobOpening, now = Date.now()): string {
  const st = statusOf(o, now);
  if (st === 'tba') return '待公布';
  if (o.rolling && parseDate(o.deadline) === null) return '招满即止';
  const d = daysLeft(o, now);
  if (d === null) return o.deadline;
  if (d < 0) return `已截止 ${Math.abs(d)} 天`;
  if (d === 0) return '今天截止';
  if (d === 1) return '明天截止';
  return `${o.deadline} 截止 · 剩 ${d} 天`;
}

/* ==================== 种子数据装配 ==================== */

function buildOpenings(): JobOpening[] {
  return OPENING_ROWS.map((r: OpeningRow, i: number) => ({
    _id: `op_${i}`,
    company: r[0],
    companyType: r[1],
    ownership: r[2],
    group: r[3],
    jobCategory: r[4],
    recruitType: r[5],
    openDate: r[6],
    deadline: r[7],
    rolling: r[8] === 1,
    source: r[9],
    sourceUrl: r[10],
    updatedAt: OPENINGS_DATA_VERSION,
    lastYearRef: r[11],
    applyUrl: r[10],
    note: r[12]
  }));
}

let cache: JobOpening[] | null = null;

export function loadOpenings(): JobOpening[] {
  if (!cache) cache = buildOpenings();
  return cache;
}

/* ==================== 筛选 ==================== */

export const RECRUIT_TYPES: RecruitType[] = ['秋招正式批', '提前批', '暑期实习', '日常实习', '春招', '专项计划', '社招'];
export const COMPANY_TYPES: CompanyType[] = [
  '互联网', '事务所', '咨询', '银行', '央国企', '金融', '快消', '医药',
  '制造', '能源', '地产', '半导体', '游戏', '物流', '教育', '其他'
];
export const OWNERSHIPS: Ownership[] = ['外资', '国资', '民营', '合资'];

/** 岗位类别（从数据中去重提取，保证与数据同步） */
export function allJobCategories(): string[] {
  const s = new Set<string>();
  loadOpenings().forEach((o) => o.jobCategory.split('/').forEach((c) => s.add(c.trim())));
  return Array.from(s);
}

export interface OpeningsFilter {
  kw: string;
  companyType: string;   // 'all' 不限
  ownership: string;     // 'all' 不限
  recruitType: string;   // 'all' 不限
  status: string;        // 'all' | OpeningStatus
}

/** 排序权重：进行中 → 即将截止 → 未开始 → 待公布 → 已截止 */
const STATUS_WEIGHT: Record<OpeningStatus, number> = {
  closing: 0, open: 1, upcoming: 2, tba: 3, closed: 4
};

/** 财务 / 财会 / 审计类岗位判定（用于「财务优先」置顶显示） */
const FINANCE_RE = /财务|会计|审计|税务|精算|投行|投研|财富|评估|资产|计财|财经/;
export function isFinanceJob(o: JobOpening): boolean {
  return FINANCE_RE.test(o.jobCategory) || o.companyType === '事务所';
}

export function searchOpenings(f: OpeningsFilter): JobOpening[] {
  const kw = (f.kw || '').trim().toLowerCase();
  const list = loadOpenings().filter((o) => {
    if (f.companyType && f.companyType !== 'all' && o.companyType !== f.companyType) return false;
    if (f.ownership && f.ownership !== 'all' && o.ownership !== f.ownership) return false;
    if (f.recruitType && f.recruitType !== 'all' && o.recruitType !== f.recruitType) return false;
    if (f.status && f.status !== 'all' && statusOf(o) !== f.status) return false;
    if (!kw) return true;
    const hay = `${o.company} ${o.group} ${o.jobCategory} ${o.recruitType} ${o.note} ${o.companyType} ${o.ownership}`.toLowerCase();
    return hay.indexOf(kw) >= 0;
  });
  const now = Date.now();
  return list.sort((a, b) => {
    const sa = STATUS_WEIGHT[statusOf(a, now)];
    const sb = STATUS_WEIGHT[statusOf(b, now)];
    if (sa !== sb) return sa - sb;
    const da = parseDate(a.deadline);
    const db = parseDate(b.deadline);
    // 有明确截止日的排前面（越近越靠前），招满即止/待公布排后面
    if (da === null && db === null) return a.company.localeCompare(b.company, 'zh');
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/* ==================== 分组浏览 ==================== */

export type GroupBy = 'none' | 'companyType' | 'ownership' | 'recruitType' | 'status';

export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  none: '不分组',
  companyType: '按行业',
  ownership: '按性质',
  recruitType: '按招聘类型',
  status: '按状态'
};

export interface OpeningGroup {
  key: string;
  label: string;
  count: number;
  items: JobOpening[];
  expand: boolean;
}

/** 按指定维度分组；组内已按 searchOpenings 的排序保持 */
export function groupOpenings(list: JobOpening[], by: GroupBy): OpeningGroup[] {
  if (by === 'none') {
    return [{ key: 'all', label: '全部', count: list.length, items: list, expand: true }];
  }
  const map = new Map<string, JobOpening[]>();
  list.forEach((o) => {
    const key =
      by === 'companyType' ? o.companyType :
      by === 'ownership' ? o.ownership :
      by === 'recruitType' ? o.recruitType :
      statusOf(o);
    const arr = map.get(key);
    if (arr) arr.push(o);
    else map.set(key, [o]);
  });
  const labelOf = (k: string): string => {
    if (by === 'status') return STATUS_LABEL[k as OpeningStatus] || k;
    return k;
  };
  return Array.from(map.entries()).map(([k, arr]) => ({
    key: k,
    label: labelOf(k),
    count: arr.length,
    items: arr,
    // 默认只展开第一组，避免超长列表一次性铺开
    expand: false
  }));
}
