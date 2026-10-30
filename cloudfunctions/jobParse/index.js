// 云函数 jobParse
// 粘贴招聘网页链接 → 自动提取公司名称 / 应聘岗位 / 工作地 / 薪资范围 / 经验 / 学历 / JD 正文。
//
// 设计要点：
//   1) 零第三方依赖：只用 Node 内置 https/http，装完即可上传部署，不用 npm install。
//   2) 不请求 Accept-Encoding: gzip，避免额外解压依赖。
//   3) 多策略解析：JSON-LD → 站点专属正则 → OG/ meta → title 拆解 → 正文正则兜底。
//   4) 反爬识别：BOSS直聘 / 前程无忧 / 猎聘 都有 JS 挑战或 WAF，抓不到时返回明确的
//      blocked 原因，前端据此降级为「粘贴分享文案解析」，而不是让用户对着空表单发呆。
//
// 已知限制（实测 2026-09）：
//   - zhipin.com：会 302 到 /web/passport/zp/security.html 的 JS 挑战页，服务端无法直接读取。
//   - 51job.com：阿里云 WAF 拦截。
//   - liepin.com：返回错误页。
//   可正常解析的站点：实习僧、智联、拉勾、牛客、Moka、北森、以及各家官网校招页（含 og / JSON-LD 的）。

const https = require('https');
const http = require('http');

const UA_PC =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const UA_WX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN';

const FETCH_TIMEOUT = 8000;
const MAX_REDIRECT = 3;
const MAX_HTML = 900 * 1024; // 只取前 900KB，够解析且省内存

/* ==================== 网络 ==================== */

function requestOnce(url, ua, cookie) {
  return new Promise((resolve) => {
    let mod = https;
    try {
      if (url.indexOf('http://') === 0) mod = http;
    } catch (e) {
      mod = https;
    }
    const headers = {
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Connection: 'close'
    };
    if (cookie) headers.Cookie = cookie;

    let req;
    try {
      req = mod.get(url, { headers, timeout: FETCH_TIMEOUT, rejectUnauthorized: false }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          if (size > MAX_HTML) return;
          size += c.length;
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks).toString('utf8'),
            finalUrl: url
          })
        );
      });
    } catch (e) {
      return resolve({ statusCode: 0, headers: {}, body: '', finalUrl: url, error: String(e && e.message) });
    }
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) {}
      resolve({ statusCode: 0, headers: {}, body: '', finalUrl: url, error: 'timeout' });
    });
    req.on('error', (e) =>
      resolve({ statusCode: 0, headers: {}, body: '', finalUrl: url, error: String(e && e.message) })
    );
  });
}

/** 跟随重定向抓取，最多 MAX_REDIRECT 跳 */
async function fetchHtml(startUrl, ua) {
  let url = startUrl;
  let cookie = '';
  for (let i = 0; i <= MAX_REDIRECT; i++) {
    const r = await requestOnce(url, ua, cookie);
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      const next = require('url').resolve(url, r.headers.location);
      const sc = r.headers['set-cookie'];
      if (sc) cookie = sc.map((c) => String(c).split(';')[0]).join('; ');
      url = next;
      continue;
    }
    r.finalUrl = url;
    return r;
  }
  return { statusCode: 0, headers: {}, body: '', finalUrl: url, error: 'too_many_redirects' };
}

/* ==================== 文本工具 ==================== */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–' };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCharCode(parseInt(d, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
}
function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
function compact(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function pick(re, text, group) {
  const m = String(text || '').match(re);
  if (!m) return '';
  return compact(m[group === undefined ? 1 : group]);
}

/* ==================== 结构化数据 ==================== */

/** 抽取 <script type="application/ld+json"> 中的 JobPosting */
function jsonLdJobs(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = m[1].trim();
    if (!raw) continue;
    try {
      let data = JSON.parse(raw);
      const walk = (n) => {
        if (!n) return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (typeof n !== 'object') return;
        if (n['@type'] === 'JobPosting' || (Array.isArray(n['@type']) && n['@type'].indexOf('JobPosting') >= 0)) out.push(n);
        Object.keys(n).forEach((k) => walk(n[k]));
      };
      walk(data);
    } catch (e) {
      /* 部分站点 JSON-LD 不合法，忽略 */
    }
  }
  return out;
}
function fromJsonLd(html) {
  const jobs = jsonLdJobs(html);
  if (!jobs.length) return null;
  const j = jobs[0];
  const org = j.hiringOrganization || {};
  const loc = j.jobLocation || j.jobLocationType || {};
  const addr = loc.address || {};
  const salary = j.baseSalary || {};
  const value = salary.value || {};
  let sal = '';
  if (value.minValue && value.maxValue) sal = `${value.minValue}-${value.maxValue}${value.unitText || ''}`;
  else if (typeof value === 'string') sal = value;
  else if (typeof value === 'number') sal = String(value);
  return {
    position: compact(j.title || ''),
    company: compact(typeof org === 'string' ? org : org.name || ''),
    location: compact(typeof addr === 'string' ? addr : addr.addressLocality || addr.addressRegion || ''),
    salary: compact(sal),
    experience: compact(j.experienceRequirements || ''),
    education: compact(j.educationRequirements || ''),
    jdText: stripTags(j.description || '').slice(0, 3000),
    // JobPosting 标准字段：datePosted = 发布日期，validThrough = 投递截止日
    publishDate: normalizeDate(j.datePosted || j.dateCreated || ''),
    deadline: normalizeDate(j.validThrough || j.expiresAt || ''),
    source: 'json-ld'
  };
}

/** 把 2026年10月31日 / 2026/10/31 / 2026-10-31 / 2026.10.31 统一成 YYYY-MM-DD */
function normalizeDate(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  // ISO 带时间：2026-10-31T00:00:00+08:00 → 2026-10-31
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/.exec(s);
  if (m) {
    const mm = m[2].length === 1 ? '0' + m[2] : m[2];
    const dd = m[3].length === 1 ? '0' + m[3] : m[3];
    return `${m[1]}-${mm}-${dd}`;
  }
  return '';
}

/** 从正文里找「发布日期 / 更新时间」 */
function findPublishDate(text) {
  const t = String(text || '');
  const res = [
    /(?:发布(?:时间|日期)?|更新(?:时间|日期)?|发布于|posted\s*(?:on|date)?)[：:\s]*(\d{4}\s*[年/\-.]\s*\d{1,2}\s*[月/\-.]\s*\d{1,2}\s*日?)/i,
    /(?:发布(?:时间|日期)?|更新(?:时间|日期)?)[：:\s]*((?:今天|昨天|\d+\s*天前|\d+\s*(?:小时|分钟)前))/,
    /(\d{4}-\d{2}-\d{2})\s*(?:发布|更新)/
  ];
  for (const re of res) {
    const m = re.exec(t);
    if (!m) continue;
    if (/今天|昨天|天前|小时|分钟/.test(m[1])) return relativeToDate(m[1]);
    const d = normalizeDate(m[1]);
    if (d) return d;
  }
  return '';
}

/** 从正文里找「投递截止 / 报名截止 / 有效期至」 */
function findDeadline(text) {
  const t = String(text || '');
  const res = [
    /(?:投递)?(?:截止(?:时间|日期)?|报名截止|申请截止|结束时间|有效期至|截止至|截止到)[：:\s]*(\d{4}\s*[年/\-.]\s*\d{1,2}\s*[月/\-.]\s*\d{1,2}\s*日?)/i,
    /(\d{4}\s*[年/\-.]\s*\d{1,2}\s*[月/\-.]\s*\d{1,2}\s*日?)\s*(?:前)?(?:截止|停止投递|关闭)/i
  ];
  for (const re of res) {
    const m = re.exec(t);
    if (!m) continue;
    const d = normalizeDate(m[1]);
    if (d) return d;
  }
  // 只有月日没有年份：按当前年份补全（跨年取次年）
  const md = /(?:截止|截止至|截止到)[：:\s]*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*日?/.exec(t);
  if (md) {
    const now = new Date();
    const y = now.getFullYear();
    const mm = +md[1];
    const dd = +md[2];
    // 若该日期已过，认为是次年
    const guess = new Date(y, mm - 1, dd);
    const yy = guess.getTime() < now.getTime() ? y + 1 : y;
    return `${yy}-${mm < 10 ? '0' + mm : mm}-${dd < 10 ? '0' + dd : dd}`;
  }
  return '';
}

/** 今天/昨天/N天前 → 具体日期 */
function relativeToDate(s) {
  const now = new Date();
  if (/今天/.test(s)) now.setDate(now.getDate());
  else if (/昨天/.test(s)) now.setDate(now.getDate() - 1);
  else {
    const m = /(\d+)\s*天前/.exec(s);
    if (m) now.setDate(now.getDate() - Number(m[1]));
    else return '';
  }
  const y = now.getFullYear();
  const mm = now.getMonth() + 1;
  const dd = now.getDate();
  return `${y}-${mm < 10 ? '0' + mm : mm}-${dd < 10 ? '0' + dd : dd}`;
}

function metaContent(html, keys) {
  for (const k of keys) {
    const re = new RegExp(
      `<meta[^>]*(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']*)["']`,
      'i'
    );
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).trim();
    const re2 = new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${k}["']`,
      'i'
    );
    const m2 = html.match(re2);
    if (m2) return decodeEntities(m2[1]).trim();
  }
  return '';
}

/* ==================== 字段抽取 ==================== */

const CITIES = ('北京 上海 广州 深圳 杭州 南京 成都 武汉 西安 苏州 天津 重庆 长沙 郑州 青岛 合肥 宁波 东莞 无锡 佛山 福州 厦门 济南 大连 沈阳 哈尔滨 长春 昆明 贵阳 南宁 南昌 太原 石家庄 兰州 海口 珠海 中山 惠州 温州 常州 徐州 烟台 洛阳 唐山 保定 廊坊 燕郊 香港 澳门 台湾 海外 全国 远程').split(/\s+/);

function findCity(text) {
  const t = String(text || '');
  for (const c of CITIES) {
    if (t.indexOf(c) >= 0) return c;
  }
  const m = t.match(/([\u4e00-\u9fa5]{2,8})(?:市|地区)/);
  return m ? m[1] : '';
}

const SALARY_RE = /(\d+(?:\.\d+)?)\s*[-~–—到至]\s*(\d+(?:\.\d+)?)\s*(千|万|k|K|元)?/;
function findSalary(text) {
  const t = String(text || '');
  // 优先 K 写法：8-13K / 8k-13k / 8-13k·13薪
  let m = t.match(/(\d+(?:\.\d+)?)\s*[kK]\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) return `${m[1]}-${m[2]}K`;
  m = t.match(/(\d+(?:\.\d+)?)\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) return `${m[1]}-${m[2]}K`;
  m = t.match(SALARY_RE);
  if (m) {
    const unit = m[3] || '';
    if (unit === '万') return `${m[1]}-${m[2]}万`;
    if (unit === '千') return `${m[1]}-${m[2]}K`;
    if (unit === '元' || unit === '') {
      // 8000-13000 元 → 归一成 8-13K
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      if (a >= 1000 && b >= 1000) return `${a / 1000}-${b / 1000}K`;
      return `${a}-${b}`;
    }
    return `${m[1]}-${m[2]}${unit}`;
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*[kK]\s*以上/);
  if (m) return `${m[1]}K以上`;
  if (/薪资?面议|面议/.test(t)) return '面议';
  return '';
}

function findExperience(text) {
  const t = String(text || '');
  // 只接受「像经验」的值，避免把「公司性质」这类相邻字段误抓进来
  const looksLikeExp = (v) => /不限|\d|应届|在校|毕业生|实习/.test(v);
  let m = t.match(/经验[：:\s]*([^\s，,。；;|]{1,12})/);
  if (m) {
    const v = compact(m[1]);
    if (looksLikeExp(v)) return v;
  }
  m = t.match(/(\d+)\s*[-~–]\s*(\d+)\s*年/);
  if (m) return `${m[1]}-${m[2]}年`;
  m = t.match(/(\d+)\s*年以上/);
  if (m) return `${m[1]}年以上`;
  if (/应届|在校|毕业生/.test(t)) return '应届生';
  if (/经验不限|不限经验/.test(t)) return '经验不限';
  return '';
}

function findEducation(text) {
  const t = String(text || '');
  const m = t.match(/(博士|硕士|研究生|本科|大专|高中|中专|初中|学历不限)/);
  return m ? m[1] : '';
}

/* ==================== 站点专属解析 ==================== */

const SITES = [
  {
    key: 'boss',
    test: /zhipin\.com/i,
    parse(html) {
      return {
        position: pick(/"jobName"\s*:\s*"([^"]+)"/, html),
        company: pick(/"brandName"\s*:\s*"([^"]+)"/, html) || pick(/"companyName"\s*:\s*"([^"]+)"/, html),
        salary: pick(/"salaryDesc"\s*:\s*"([^"]+)"/, html),
        location: pick(/"cityName"\s*:\s*"([^"]+)"/, html) || pick(/"locationName"\s*:\s*"([^"]+)"/, html),
        experience: pick(/"jobExperience"\s*:\s*"([^"]+)"/, html),
        education: pick(/"jobDegree"\s*:\s*"([^"]+)"/, html),
        source: 'zhipin'
      };
    }
  },
  {
    key: 'job51',
    test: /51job\.com/i,
    parse(html) {
      return {
        position: pick(/"jobName"\s*:\s*"([^"]+)"/, html) || pick(/"jobTitle"\s*:\s*"([^"]+)"/, html),
        company: pick(/"companyName"\s*:\s*"([^"]+)"/, html) || pick(/"company"\s*:\s*"([^"]+)"/, html),
        salary: pick(/"jobSalary"\s*:\s*"([^"]+)"/, html) || pick(/"salary"\s*:\s*"([^"]+)"/, html),
        location: pick(/"jobArea"\s*:\s*"([^"]+)"/, html) || pick(/"cityName"\s*:\s*"([^"]+)"/, html),
        experience: pick(/"jobYear"\s*:\s*"([^"]+)"/, html),
        education: pick(/"jobDegree"\s*:\s*"([^"]+)"/, html),
        source: '51job'
      };
    }
  },
  {
    key: 'liepin',
    test: /liepin\.com|lietou\.com/i,
    parse(html) {
      return {
        position: pick(/"jobTitle"\s*:\s*"([^"]+)"/, html),
        company: pick(/"compName"\s*:\s*"([^"]+)"/, html),
        salary: pick(/"salary"\s*:\s*"([^"]+)"/, html),
        location: pick(/"dq"\s*:\s*"([^"]+)"/, html) || pick(/"cityName"\s*:\s*"([^"]+)"/, html),
        experience: pick(/"requireWorkYears"\s*:\s*"([^"]+)"/, html),
        education: pick(/"requireEduLevel"\s*:\s*"([^"]+)"/, html),
        source: 'liepin'
      };
    }
  },
  {
    key: 'lagou',
    test: /lagou\.com/i,
    parse(html) {
      return {
        position: pick(/"positionName"\s*:\s*"([^"]+)"/, html),
        company: pick(/"companyName"\s*:\s*"([^"]+)"/, html),
        salary: pick(/"salary"\s*:\s*"([^"]+)"/, html),
        location: pick(/"city"\s*:\s*"([^"]+)"/, html),
        experience: pick(/"workYear"\s*:\s*"([^"]+)"/, html),
        education: pick(/"education"\s*:\s*"([^"]+)"/, html),
        source: 'lagou'
      };
    }
  },
  {
    key: 'shixiseng',
    test: /shixiseng\.com/i,
    parse(html) {
      const nd = pick(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/, html);
      if (nd) {
        try {
          const data = JSON.parse(nd);
          const p = (data.props || {}).pageProps || {};
          const it = p.intern || p.job || p.data || {};
          return {
            position: compact(it.name || it.title || ''),
            company: compact(it.companyName || it.orgName || (it.company || {}).name || ''),
            salary: compact(it.salary || it.daySalary || ''),
            location: compact(it.city || it.cityName || ''),
            experience: compact(it.education || ''),
            education: compact(it.degree || ''),
            source: 'shixiseng'
          };
        } catch (e) { /* fallthrough */ }
      }
      return { source: 'shixiseng' };
    }
  },
  {
    key: 'zhaopin',
    test: /zhaopin\.com/i,
    parse(html) {
      return {
        position: pick(/"jobName"\s*:\s*"([^"]+)"/, html) || pick(/"name"\s*:\s*"([^"]+)"/, html),
        company: pick(/"companyName"\s*:\s*"([^"]+)"/, html),
        salary: pick(/"salary"\s*:\s*"([^"]+)"/, html),
        location: pick(/"cityName"\s*:\s*"([^"]+)"/, html) || pick(/"city"\s*:\s*"([^"]+)"/, html),
        experience: pick(/"workExperience"\s*:\s*"([^"]+)"/, html),
        education: pick(/"education"\s*:\s*"([^"]+)"/, html),
        source: 'zhaopin'
      };
    }
  }
];

/* ==================== title 拆解兜底 ==================== */

function fromTitle(html) {
  const title = decodeEntities(pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html)).trim();
  if (!title) return {};
  // 常见形态：
  //   「Java开发工程师-阿里巴巴集团-深圳-BOSS直聘」
  //   「【腾讯】财务分析实习生（深圳）招聘 - 实习僧」
  //   「字节跳动招聘财务BP_字节跳动财务BP招聘信息-猎聘」
  const parts = title
    .split(/[-_|｜·•（）()【】\[\]]|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const noise = /招聘|求职|BOSS直聘|猎聘|前程无忧|51job|实习僧|智联|拉勾|牛客|官网|校园招聘|社会招聘|最新|职位|job|Job|JOB/i;
  const clean = parts.filter((p) => !noise.test(p) || p.length > 6);
  let position = '';
  let company = '';
  if (clean.length >= 2) {
    // 通常岗位在前、公司在后
    position = clean[0];
    company = clean[1];
  } else if (clean.length === 1) {
    position = clean[0];
  }
  // 岗位里若带城市/薪资，剥离出来
  const m = position.match(/^(.*?)[\(（]([^)）]+)[\)）]\s*$/);
  if (m) {
    position = m[1].trim();
    if (!company) company = '';
  }
  return { position: compact(position).slice(0, 40), company: compact(company).slice(0, 40), source: 'title' };
}

/* ==================== 反爬识别 ==================== */

function detectBlock(html, finalUrl) {
  const u = String(finalUrl || '');
  const h = String(html || '');
  if (!h) return { blocked: true, reason: 'empty', hint: '目标页面返回空内容。' };
  if (/zp\/security\.html|请稍候\s*-\s*BOSS直聘|您的环境存在异常/.test(h) || /passport\/zp\/security/.test(u)) {
    return {
      blocked: true,
      reason: 'zhipin_guard',
      hint: 'BOSS直聘对网页做了 JS 安全校验，服务端无法直接读取岗位内容。'
    };
  }
  if (/aliyun_waf|reject\.51job|waf_captcha|请开启JavaScript并刷新/.test(h)) {
    return {
      blocked: true,
      reason: 'waf',
      hint: '前程无忧启用了 Web 防火墙，服务端无法直接读取岗位内容。'
    };
  }
  if (/error-main-container/.test(h) && h.length < 30000) {
    return {
      blocked: true,
      reason: 'liepin_guard',
      hint: '猎聘返回了拦截页，服务端无法直接读取岗位内容。'
    };
  }
  if (h.length < 1500 && /验证|安全校验|captcha|访问受限|请求过于频繁|robot/i.test(h)) {
    return { blocked: true, reason: 'captcha', hint: '目标站点要求人机验证。' };
  }
  if (h.length < 800) {
    return { blocked: true, reason: 'empty', hint: '目标页面内容过少，可能是跳转页或拦截页。' };
  }
  return { blocked: false };
}

/* ==================== 主流程 ==================== */

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  return u;
}

function hostOf(u) {
  const m = String(u || '').match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].toLowerCase() : '';
}

async function parseUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return { success: false, error: '链接为空' };
  if (!/^https?:\/\//i.test(url)) return { success: false, error: '只支持 http/https 链接' };

  let res = await fetchHtml(url, UA_PC);
  // PC UA 被一些站点拒，换微信 UA 再试一次
  if ((res.statusCode !== 200 || !res.body) && hostOf(url)) {
    const retry = await fetchHtml(url, UA_WX);
    if (retry.body && retry.body.length > (res.body || '').length) res = retry;
  }

  const html = res.body || '';
  const guard = detectBlock(html, res.finalUrl);
  if (guard.blocked) {
    // 注意：这里 success 恒为 true，用 ok / blocked 表达业务结果。
    // 前端 utils/cloud.ts 的 callFn 遇到 success:false 会直接 reject，
    // 而「被反爬拦截」是可预期的业务分支，不该走异常通道。
    return {
      success: true,
      ok: false,
      blocked: true,
      reason: guard.reason,
      hint: guard.hint,
      url,
      host: hostOf(url),
      platform: platformKey(hostOf(url))
    };
  }

  const text = stripTags(html);

  // 1) JSON-LD（最规范）
  let data = fromJsonLd(html) || {};
  // 2) 站点专属
  const site = SITES.find((s) => s.test.test(url));
  let siteData = {};
  if (site) {
    try { siteData = site.parse(html) || {}; } catch (e) { siteData = {}; }
  }
  // 3) OG / meta
  const ogTitle = metaContent(html, ['og:title', 'twitter:title']);
  const ogDesc = metaContent(html, ['og:description', 'description', 'Description']);
  const ogSite = metaContent(html, ['og:site_name']);
  // 4) title 拆解
  const titleData = fromTitle(html);

  const merged = {
    company: data.company || siteData.company || titleData.company || '',
    position: data.position || siteData.position || titleData.position || '',
    location: data.location || siteData.location || '',
    salary: data.salary || siteData.salary || '',
    experience: data.experience || siteData.experience || '',
    education: data.education || siteData.education || '',
    publishDate: data.publishDate || siteData.publishDate || '',
    deadline: data.deadline || siteData.deadline || '',
    jdText: data.jdText || '',
    source: data.source || siteData.source || titleData.source || 'meta'
  };

  // 5) 正文 / meta 正则兜底
  const hay = `${ogTitle} ${ogDesc} ${text.slice(0, 2500)}`;
  if (!merged.company) {
    merged.company =
      pick(/([\u4e00-\u9fa5A-Za-z0-9()（）]{2,20}?(?:公司|科技|网络技术|信息技术|集团|控股|股份|银行|证券|研究院|事务所))/,
        text.slice(0, 1500)) || compact(ogSite);
  }
  if (!merged.position) merged.position = pick(/(?:职位|岗位|招聘)[：:\s]*([^\s，,。；;|]{2,24})/, hay);
  if (!merged.location) merged.location = findCity(`${ogDesc} ${text.slice(0, 1200)}`);
  if (!merged.salary) merged.salary = findSalary(hay);
  if (!merged.experience) merged.experience = findExperience(hay);
  if (!merged.education) merged.education = findEducation(hay);
  if (!merged.jdText) merged.jdText = compact(ogDesc) || text.slice(0, 2000);
  if (!merged.publishDate) merged.publishDate = findPublishDate(hay) || findPublishDate(text.slice(0, 2000));
  if (!merged.deadline) merged.deadline = findDeadline(hay) || findDeadline(text.slice(0, 2000));

  merged.company = compact(merged.company).slice(0, 40);
  merged.position = compact(merged.position).slice(0, 40);
  merged.salary = compact(merged.salary).slice(0, 24);

  const filled = ['company', 'position', 'location', 'salary'].filter((k) => merged[k]).length;
  return {
    success: true,
    ok: true,
    blocked: false,
    url,
    host: hostOf(url),
    platform: platformKey(hostOf(url)),
    data: merged,
    jdText: (merged.jdText || '').slice(0, 3000),
    confidence: filled >= 3 ? 'high' : filled >= 2 ? 'mid' : 'low',
    // 逐字段标注来源与缺失，供 UI 明确展示「识别到了什么、没识别到什么」
    fields: buildFields(merged)
  };
}

/** 生成字段级明细：value + 是否有值 + 没值时说明原因 */
function buildFields(d) {
  const why = {
    company: '页面里没找到公司名称。',
    position: '页面里没找到岗位名称。',
    location: '页面里没写明工作城市。',
    salary: '岗位未标注薪资范围。',
    experience: '岗位未标注经验要求。',
    education: '岗位未标注学历要求。',
    publishDate: '页面未标注发布/更新日期，可手动填写或到「岗位开放」查该公司节奏。',
    deadline: '页面未标注截止日期。多数平台为「招满即止」，可到「岗位开放」查往年节奏。'
  };
  const keys = ['company', 'position', 'location', 'salary', 'experience', 'education', 'publishDate', 'deadline'];
  const out = {};
  keys.forEach((k) => {
    const v = String((d && d[k]) || '').trim();
    out[k] = { value: v, ok: !!v, why: v ? '' : why[k] };
  });
  return out;
}

function platformKey(host) {
  const h = String(host || '');
  if (/zhipin\.com/.test(h)) return 'boss';
  if (/51job\.com/.test(h)) return 'job51';
  if (/liepin\.com|lietou\.com/.test(h)) return 'liepin';
  if (/lagou\.com/.test(h)) return 'lagou';
  if (/shixiseng\.com/.test(h)) return 'shixiseng';
  if (/zhaopin\.com/.test(h)) return 'zhaopin';
  return 'other';
}

exports.main = async (event) => {
  const { url } = event || {};
  try {
    if (!url || !String(url).trim()) {
      return { success: true, ok: false, blocked: true, reason: 'no_url', hint: '请先粘贴岗位链接。' };
    }
    return await parseUrl(url);
  } catch (err) {
    console.error('[jobParse] error:', err);
    return {
      success: true,
      ok: false,
      blocked: true,
      reason: 'exception',
      hint: '解析服务异常，请稍后重试，或改用「粘贴文案解析」。',
      error: err && err.message ? err.message : String(err)
    };
  }
};

// 仅供本地测试脚本使用，云函数运行时不会调用
module.exports._test = { normalizeDate, findPublishDate, findDeadline, relativeToDate };
