// utils/job-link.ts
// 岗位链接的「离线结构化分析」：不联网，只从 URL 本身提取能确定的信息。
//
// 为什么要单独做这一层：
//   BOSS直聘 / 前程无忧 / 猎聘 的岗位详情页都有反爬（JS 安全挑战 / WAF / 拦截页），
//   服务端读不到正文。但 URL 里藏着一个稳定、有用的信息——岗位 ID。
//   把它先提取出来，用户即便抓不到页面，也能拿到一个可存档、可复查的唯一标识。
//
// 设计原则（诚实优先）：
//   · 能确定的，标 source='url'，UI 显示「已从链接识别」
//   · 确定不了的，明确写 missing 并给出原因，绝不用猜测值填充
//   · securityId / utm_* / from 等一次性或追踪参数一律剔除，不作为岗位标识

/** 平台定义：识别规则 + 岗位 ID 提取规则 + 能从 URL 推断出的字段 */
interface LinkRule {
  key: string;
  name: string;
  /** 域名特征 */
  host: RegExp;
  /** 岗位 ID 提取：返回 [id, 匹配到的完整片段] */
  id: RegExp;
  /** 从 URL 推断城市（可选） */
  city?: RegExp;
  /** 从 URL 推断岗位类别（可选，命中率低，仅作参考） */
  category?: RegExp;
}

const RULES: LinkRule[] = [
  {
    key: 'zhipin',
    name: 'BOSS直聘',
    host: /(^|\.)zhipin\.com$/i,
    // https://www.zhipin.com/job_detail/229254ab3ab1a1380nN709m7FVZS.html?securityId=...
    id: /job_detail\/([A-Za-z0-9_-]{6,64})\.html/i
  },
  {
    key: '51job',
    name: '前程无忧',
    host: /(^|\.)51job\.com$/i,
    // https://jobs.51job.com/shanghai-pdxq/155827998.html
    id: /\/(\d{6,20})\.html?$/i,
    // 路径首段是城市拼音
    city: /\.com\/([a-z]+)-/i
  },
  {
    key: 'liepin',
    name: '猎聘',
    host: /(^|\.)liepin\.com$/i,
    // https://www.liepin.com/job/1956473826.shtml
    id: /\/job\/(\d{5,20})/i
  },
  {
    key: 'zhilian',
    name: '智联招聘',
    host: /(^|\.)zhaopin\.com$/i,
    id: /\/(\d{8,24})\.htm/i
  },
  {
    key: 'lagou',
    name: '拉勾',
    host: /(^|\.)lagou\.com$/i,
    id: /\/jobs\/(\d{4,12})\.html/i
  },
  {
    key: 'shixiseng',
    name: '实习僧',
    host: /(^|\.)shixiseng\.com$/i,
    id: /\/(?:intern|job)\/([A-Za-z0-9_-]{4,64})/i
  },
  {
    key: 'nowcoder',
    name: '牛客',
    host: /(^|\.)nowcoder\.com$/i,
    id: /\/(?:jobs|discuss)\/(\d{4,20})/i
  },
  {
    key: 'moka',
    name: 'Moka（企业校招官网）',
    host: /(^|\.)moka\.com$/i,
    id: /\/[a-z]+\/([A-Za-z0-9_-]{6,64})/i
  },
  {
    key: 'boshi',
    name: '北森（企业校招官网）',
    host: /(^|\.)beisen\.com$/i,
    id: /\/[a-z]+\/(\d{4,20})/i
  }
];

/** 需要从 URL 中剔除的参数：一次性票据、追踪参数、跳转来源 */
const NOISE_PARAMS = [
  'securityid', 'sid', 'token', 'ticket', 'sign', 'signature', 'code', 'state',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'from', 'source', 'share', 'sharefrom', 'spm', 'scene', 'sessionid', 'timestamp', '_t', 't'
];

export interface UrlParts {
  /** 原始链接 */
  raw: string;
  /** 清洗后的规范链接（去掉噪声参数，适合存档与复查） */
  canonical: string;
  host: string;
  path: string;
}

/** 拆分并清洗 URL；解析失败返回 null */
export function parseUrlParts(input: string): UrlParts | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const m = /^(https?:\/\/)?([^/?#]+)([^?#]*)(.*)$/i.exec(raw);
  if (!m) return null;
  const hasScheme = !!m[1];
  const host = (m[2] || '').replace(/:\d+$/, '');
  const path = m[3] || '/';
  const rest = m[4] || '';
  if (!host || host.indexOf('.') < 0) return null;

  // 拆 query / hash
  const hashIdx = rest.indexOf('#');
  const queryStr = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const hash = hashIdx >= 0 ? rest.slice(hashIdx) : '';

  const kept: string[] = [];
  queryStr.replace(/^[?]/, '').split('&').forEach((kv) => {
    if (!kv) return;
    const eq = kv.indexOf('=');
    const k = (eq >= 0 ? kv.slice(0, eq) : kv).toLowerCase();
    if (NOISE_PARAMS.indexOf(k) >= 0) return;   // 剔除一次性票据与追踪参数
    kept.push(kv);
  });

  const canonical =
    (hasScheme ? m[1] : 'https://') + host + path +
    (kept.length ? '?' + kept.join('&') : '') + hash;

  return { raw, canonical, host, path };
}

/** 识别链接属于哪个平台 */
export function detectPlatform(parts: UrlParts): LinkRule | null {
  const host = parts.host.replace(/^www\./i, '').replace(/^m\./i, '');
  for (const r of RULES) {
    if (r.host.test(host)) return r;
  }
  return null;
}

/** 岗位字段的识别状态 */
export type FieldStatus = 'ok' | 'missing' | 'blocked';

export interface LinkField {
  value: string;
  status: FieldStatus;
  /** 值从哪来：url=链接本身 / none=未识别 */
  source: 'url' | 'none';
  /** 未识别时的原因（面向用户） */
  why: string;
}

export interface JobLinkInfo {
  ok: boolean;
  /** 是否至少拿到了岗位 ID */
  hasId: boolean;
  platformKey: string;
  platformName: string;
  /** 清洗后的链接 */
  canonicalUrl: string;
  host: string;
  /** 结构化字段 */
  fields: {
    jobId: LinkField;
    company: LinkField;
    position: LinkField;
    category: LinkField;
    location: LinkField;
    publishDate: LinkField;
    deadline: LinkField;
  };
  /** 已识别/未识别字段数，用于 UI 显示进度 */
  identifiedCount: number;
  totalCount: number;
  /** 无法识别时的整体说明 */
  summary: string;
  /** 建议的补救步骤 */
  suggestions: string[];
}

const MISS_ID = '链接里没有岗位编号（通常出现在 /job_detail/xxx 这类路径中）。';
const MISS_FROM_URL = '岗位名称不在链接里，必须读取页面正文才能得到，而该站点会拦截服务端抓取。';
const MISS_COMPANY = '公司名称不在链接里，必须读取页面正文才能得到，而该站点会拦截服务端抓取。';
const MISS_DATE = '开放与截止日期只存在于页面正文或岗位公告中，链接本身不含日期信息。';

function f(value: string, status: FieldStatus, source: 'url' | 'none', why: string): LinkField {
  return { value, status, source, why: value ? '' : why };
}

/**
 * 离线解析岗位链接。只做「确定能做的事」，其余如实标注缺失原因。
 */
export function analyzeJobLink(input: string): JobLinkInfo {
  const parts = parseUrlParts(input);
  const emptyField = (why: string) => f('', 'missing', 'none', why);

  if (!parts) {
    return {
      ok: false,
      hasId: false,
      platformKey: '',
      platformName: '未知',
      canonicalUrl: String(input || '').slice(0, 200),
      host: '',
      fields: {
        jobId: emptyField('没有识别到 http/https 开头的有效链接。'),
        company: emptyField(MISS_COMPANY),
        position: emptyField(MISS_FROM_URL),
        category: emptyField('岗位类别不在链接里。'),
        location: emptyField('工作地不在链接里。'),
        publishDate: emptyField(MISS_DATE),
        deadline: emptyField(MISS_DATE)
      },
      identifiedCount: 0,
      totalCount: 7,
      summary: '没有识别到有效链接，请粘贴以 http:// 或 https:// 开头的完整岗位链接。',
      suggestions: ['在招聘 App 里点「分享 → 复制链接」，再回来粘贴。']
    };
  }

  const rule = detectPlatform(parts);
  const idMatch = rule ? rule.id.exec(parts.raw) : null;
  const jobId = idMatch ? idMatch[1] : '';

  // 城市：仅部分平台把城市写在路径里（如 51job 的 /shanghai-pdxq/）
  let city = '';
  if (rule && rule.city) {
    const cm = rule.city.exec(parts.raw);
    if (cm) city = normalizeCity(cm[1]);
  }

  const fields = {
    jobId: jobId
      ? f(jobId, 'ok', 'url', MISS_ID)
      : f('', 'missing', 'none', rule ? MISS_ID : '暂不支持该站点，无法从链接提取岗位编号。'),
    company: emptyField(MISS_COMPANY),
    position: emptyField(MISS_FROM_URL),
    category: emptyField('岗位类别只存在于页面正文中。'),
    location: city
      ? f(city, 'ok', 'url', '工作地不在链接里。')
      : emptyField('工作地只在页面正文中，或该平台不把城市写进链接。'),
    publishDate: emptyField(MISS_DATE),
    deadline: emptyField(MISS_DATE)
  };

  const identifiedCount = Object.keys(fields).filter((k) => (fields as any)[k].value).length;

  const suggestions: string[] = [];
  if (jobId) {
    suggestions.push(`岗位编号 ${jobId} 已存档，可在投递卡里随时回查这条岗位。`);
  }
  // 反爬平台的通用补救：分享文案
  if (rule && ['zhipin', '51job', 'liepin'].indexOf(rule.key) >= 0) {
    suggestions.push('在 App 内点「分享」复制岗位文案，回到本页用「粘贴文案解析」自动补全公司、岗位、薪资、城市。');
    suggestions.push('或直接用「招聘平台快捷入口」跳转小程序，投递后回来一键回填。');
  } else {
    suggestions.push('该站点未做强制拦截，可尝试「解析链接」由服务端读取岗位正文。');
  }

  const summary = rule
    ? `识别为「${rule.name}」的岗位链接${jobId ? `，已提取岗位编号` : '，但没找到岗位编号'}。` +
      `公司名、岗位名、开放与截止日期都不在链接里，需读取页面正文${isBlockedPlatform(rule.key) ? '——而该站点会拦截服务端抓取' : ''}。`
    : `识别为「${parts.host}」的自定义站点，暂无对应的解析规则。`;

  return {
    ok: !!jobId,
    hasId: !!jobId,
    platformKey: rule ? rule.key : '',
    platformName: rule ? rule.name : parts.host,
    canonicalUrl: parts.canonical,
    host: parts.host,
    fields,
    identifiedCount,
    totalCount: 7,
    summary,
    suggestions
  };
}

/** 已知会拦截服务端抓取的平台 */
export function isBlockedPlatform(key: string): boolean {
  return key === 'zhipin' || key === '51job' || key === 'liepin';
}

/** 常见城市拼音 → 中文 */
const CITY_MAP: Record<string, string> = {
  beijing: '北京', shanghai: '上海', guangzhou: '广州', shenzhen: '深圳',
  hangzhou: '杭州', nanjing: '南京', wuhan: '武汉', chengdu: '成都',
  xian: '西安', chongqing: '重庆', suzhou: '苏州', tianjin: '天津',
  changsha: '长沙', zhengzhou: '郑州', qingdao: '青岛', jinan: '济南',
  dalian: '大连', shenyang: '沈阳', harbin: '哈尔滨', changchun: '长春',
  shijiazhuang: '石家庄', taiyuan: '太原', hefei: '合肥', fuzhou: '福州',
  xiamen: '厦门', nanchang: '南昌', kunming: '昆明', guiyang: '贵阳',
  nanning: '南宁', lanzhou: '兰州', wulumuqi: '乌鲁木齐', huhehaote: '呼和浩特',
  yinchuan: '银川', xining: '西宁', lhasa: '拉萨', haikou: '海口', sanya: '三亚'
};

function normalizeCity(pinyin: string): string {
  const k = String(pinyin || '').toLowerCase();
  return CITY_MAP[k] || '';
}

/** 从一段文字里抽出第一个链接 */
export function pickUrl(text: string): string {
  const m = /https?:\/\/[^\s"'<>()，。；！？）】]+/i.exec(String(text || ''));
  return m ? m[0] : '';
}

/* ==================================================================
 * 微信小程序 shortLink（#小程序://xxx/token）
 * ================================================================== */

export interface ShortLinkInfo {
  /** 原始文本中匹配到的完整 shortLink */
  raw: string;
  /** 小程序名，如「前程无忧」 */
  appName: string;
  /** 尾部 token，如 6DjrqGLxYFukacB */
  token: string;
  /** 是否可以在微信内直接跳转 */
  canJump: boolean;
  /** 为什么解析不出岗位字段（面向用户） */
  reason: string;
  /** 补救步骤 */
  steps: string[];
}

// #小程序://前程无忧/6DjrqGLxYFukacB
const SHORT_LINK_RE = /#小程序:\/\/([^\/\s?#]+)(?:\/([A-Za-z0-9_-]+))?/;

/**
 * 识别微信小程序 shortLink。
 *
 * 【为什么读不出岗位内容——有官方文档依据】
 *   1. ShortLink 是微信**服务端生成**的（接口 /wxa/genwxashortlink），生成结果就是这种
 *      「#小程序://小程序名称/xxxx」格式；
 *   2. 尾部的 xxxx 是一个**加密令牌**，微信服务器在里面绑定了目标小程序的
 *      appId + 页面路径 + 查询参数；官方明确说明「开发者无法也无须解密这个令牌」；
 *   3. 微信只开放了「生成」接口，**没有任何反解接口**；
 *   4. 小程序页面不是网页，服务端无从抓取。
 *
 * 【那这条链接还有什么用——它的真正价值是可回跳】
 *   微信官方支持 wx.navigateToMiniProgram({ shortLink })，点一下就能精确回到这个岗位页。
 *   所以正确做法不是「解析它」，而是「存下它」：存进投递卡后，日后随时一键回到该岗位。
 *   岗位的公司名/岗位名，则通过「打开后复制分享文案」或手动填写来补全。
 */
export function parseShortLink(text: string): ShortLinkInfo | null {
  const m = SHORT_LINK_RE.exec(String(text || ''));
  if (!m) return null;
  const appName = decodeURIComponent(m[1] || '').trim();
  const token = m[2] || '';
  const raw = m[0];

  const name = appName || '目标';
  const steps: string[] = [];
  if (token) {
    steps.push(`点「打开岗位」可由微信直接拉起「${name}」的这个页面（链接已存档，日后随时可回跳）。`);
  }
  steps.push(`在「${name}」里看到岗位后，点右上角「··· → 分享」，复制它的分享文案；`);
  steps.push('回到本页点「粘贴文案解析」，即可自动填出公司、岗位、薪资、城市。');
  steps.push('若对方不提供分享，也可直接在下方手填公司名与岗位名——链接会一并保存。');

  return {
    raw,
    appName: appName || '未知小程序',
    token,
    canJump: !!appName && !!token,
    reason:
      '这是微信小程序链接（ShortLink），不是网页。它的页面标识由微信服务端加密，官方只提供「生成」接口、没有提供任何「解析」接口，且小程序页面不是网页、服务端抓不到——因此无法从这条链接里读出公司名、岗位名、开放与截止时间。',
    steps
  };
}

/** 文本里是否包含 shortLink */
export function hasShortLink(text: string): boolean {
  return SHORT_LINK_RE.test(String(text || ''));
}
