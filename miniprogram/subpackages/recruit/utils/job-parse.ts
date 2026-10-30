// utils/job-parse.ts
// 岗位链接解析：粘贴招聘网页链接 → 调云函数 jobParse → 结构化岗位字段。
// 云函数抓不到时（BOSS / 前程无忧 / 猎聘 有反爬）返回 blocked，由调用方降级为「粘贴分享文案解析」。

import { callFn } from '../../../utils/cloud';
import { isHttpUrl, extractUrl, platformKeyByUrl } from './recruit-store';
import { parseJobFromText } from './recruit-store';

/** 云函数 jobParse 的原始返回 */
interface JobParseRaw {
  success?: boolean;
  ok?: boolean;
  blocked?: boolean;
  reason?: string;
  hint?: string;
  platform?: string;
  confidence?: 'high' | 'mid' | 'low';
  data?: {
    company?: string;
    position?: string;
    location?: string;
    salary?: string;
    experience?: string;
    education?: string;
  };
  jdText?: string;
}

export interface ParsedJobLink {
  /** 是否成功提取到字段 */
  ok: boolean;
  /** 是否被目标站点反爬拦截 */
  blocked: boolean;
  /** 拦截原因码；ok 为 true 时为空 */
  reason: string;
  /** 面向用户的提示文案 */
  hint: string;
  company: string;
  position: string;
  location: string;
  salary: string;
  experience: string;
  education: string;
  jdText: string;
  platform: string;
  confidence: 'high' | 'mid' | 'low';
  /** 解析所针对的原始链接 */
  url: string;
}

const EMPTY: ParsedJobLink = {
  ok: false,
  blocked: false,
  reason: '',
  hint: '',
  company: '',
  position: '',
  location: '',
  salary: '',
  experience: '',
  education: '',
  jdText: '',
  platform: '',
  confidence: 'low',
  url: ''
};

/** 反爬原因码 → 用户能看懂的提示 */
const BLOCK_HINT: Record<string, string> = {
  zhipin_guard: 'BOSS直聘对网页做了安全校验，服务端读不到岗位内容。',
  waf: '前程无忧启用了网页防火墙，服务端读不到岗位内容。',
  liepin_guard: '猎聘返回了拦截页，服务端读不到岗位内容。',
  captcha: '该站点要求人机验证，无法自动读取。',
  empty: '打开的是一个空白/跳转页，没能读到岗位内容。',
  exception: '解析服务异常，请稍后重试。',
  no_url: '没有找到可用链接。'
};

/**
 * 解析岗位链接。
 * 云函数未部署 / 不可用时不会抛异常，而是返回 blocked，交由上层降级。
 */
export async function parseJobLink(url: string): Promise<ParsedJobLink> {
  const link = extractUrl(url) || String(url || '').trim();
  if (!link || !isHttpUrl(link)) {
    return { ...EMPTY, blocked: true, reason: 'bad_url', hint: '没识别到有效的网页链接（需以 http/https 开头）。' };
  }
  let raw: JobParseRaw;
  try {
    raw = await callFn<JobParseRaw>('jobParse', { url: link });
  } catch (e) {
    return {
      ...EMPTY,
      url: link,
      blocked: true,
      reason: 'cloud_unavailable',
      hint: '解析云函数 jobParse 未部署或不可用。请在开发者工具右键上传部署后再试，或改用「粘贴文案解析」。',
      platform: platformKeyByUrl(link)
    };
  }
  const r = raw || {};
  if (r.ok === false || r.blocked) {
    return {
      ...EMPTY,
      url: link,
      blocked: true,
      reason: r.reason || 'unknown',
      hint: r.hint || BLOCK_HINT[r.reason || ''] || '该链接无法自动解析。',
      platform: r.platform || platformKeyByUrl(link)
    };
  }
  const d = r.data || {};
  return {
    ok: true,
    blocked: false,
    reason: '',
    hint: '',
    company: d.company || '',
    position: d.position || '',
    location: d.location || '',
    salary: d.salary || '',
    experience: d.experience || '',
    education: d.education || '',
    jdText: r.jdText || '',
    platform: r.platform || platformKeyByUrl(link),
    confidence: r.confidence || 'mid',
    url: link
  };
}

/**
 * 兜底解析：把用户在招聘 App 里复制的「分享文案 / JD 文本」解析成字段。
 * BOSS 等平台复制出来的通常是一段包含公司、岗位、薪资、城市的文字，命中率很高。
 */
export function parseJobText(raw: string) {
  const p = parseJobFromText(raw);
  return {
    company: p.company,
    position: p.position,
    location: p.location,
    salary: p.salary,
    experience: p.experience,
    education: p.education,
    jdText: p.jdText,
    keywords: p.keywords
  };
}

/** 读取剪贴板（兼容旧版类型声明） */
export function readClipboard(): Promise<string> {
  return new Promise((resolve) => {
    (wx as any).getClipboardData({
      success: (r: any) => resolve(String((r && r.data) || '')),
      fail: () => resolve('')
    });
  });
}

/** 展示用的「base」拼接：工作地 · 经验 · 学历 */
export function composeBase(location: string, experience: string, education: string): string {
  return [location, experience, education].filter((s) => s && s.trim()).join(' · ');
}
