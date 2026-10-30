// utils/profile-store.ts
// 个人资料：本地存储 + 预留云端。
// 覆盖维度：头像、姓名、性别、出生日期、联系方式、居住地、职业、个人简介、
//         兴趣爱好、技能特长、教育经历、工作经历（后两项为结构化数组）。
//
// 头像来源：
//   - avatarSrc 存“本地文件路径”（相册选图 → 临时路径）或“内置预设标识”（如 preset:1）；
//   - 相册路径是临时缓存，重启/清理后可能失效，属预期（本地离线方案）；内置预设最稳。
import { get, set } from './storage';

export type Gender = '男' | '女' | '其他' | '保密';

/** 教育经历单条 */
export interface EduEntry {
  id: string;
  school: string;
  degree: string; // 学历/学位
  major: string;  // 专业
  period: string; // 起止，如 "2019.09 - 2023.06"
  desc: string;   // 备注
}
/** 工作经历单条 */
export interface WorkEntry {
  id: string;
  company: string;
  role: string;      // 职位
  period: string;    // 起止
  desc: string;      // 工作内容/成就
}

export interface ContactItem {
  type: string; // 手机 / 微信 / 邮箱 / QQ …
  value: string;
}

export interface Profile {
  /** 头像：preset:N 或本地路径（wx 临时/本地缓存路径） */
  avatar: string;
  name: string;
  gender: Gender;
  /** yyyy-mm-dd */
  birthday: string;
  /** 联系方式（支持多条） */
  contacts: ContactItem[];
  /** 居住地，如 "上海 · 杨浦" */
  location: string;
  /** 职业，如 "产品经理" */
  job: string;
  /** 一句话/多行简介 */
  bio: string;
  /** 兴趣爱好（顿号分隔或数组转逗号存储） */
  hobbies: string;
  /** 技能特长（顿号分隔） */
  skills: string;
  /** 教育经历 */
  education: EduEntry[];
  /** 工作经历 */
  work: WorkEntry[];
  /** 最近填写时间 */
  updateTime: number;
  /** 云端预留 id */
  cloudId?: string;
}

const KEY = 'profile_v1';

/** 内置头像预设（emoji/图案，稳定可靠） */
export const AVATAR_PRESETS = [
  { id: 'preset:1', emoji: '🙋', name: '阳光' },
  { id: 'preset:2', emoji: '🦊', name: '机灵' },
  { id: 'preset:3', emoji: '🐼', name: '可爱' },
  { id: 'preset:4', emoji: '🐱', name: '猫咪' },
  { id: 'preset:5', emoji: '🦁', name: '狮子' },
  { id: 'preset:6', emoji: '🐧', name: '企鹅' },
  { id: 'preset:7', emoji: '🌻', name: '向日葵' },
  { id: 'preset:8', emoji: '🚀', name: '冲鸭' },
  { id: 'preset:9', emoji: '🎨', name: '创意' },
  { id: 'preset:10', emoji: '⭐', name: '星愿' }
];

/** 性别选项 */
export const GENDER_OPTIONS: Gender[] = ['男', '女', '其他', '保密'];
/** 学历选项 */
export const DEGREE_OPTIONS = ['初中及以下', '高中/中专', '大专', '本科', '硕士', '博士'];

export function uid(prefix = 'p'): string {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function emptyProfile(): Profile {
  return {
    avatar: AVATAR_PRESETS[0].id,
    name: '',
    gender: '保密',
    birthday: '',
    contacts: [],
    location: '',
    job: '',
    bio: '',
    hobbies: '',
    skills: '',
    education: [],
    work: [],
    updateTime: 0
  };
}

export function loadProfile(): Profile {
  const p = get<Profile | null>(KEY, null);
  if (p && typeof p === 'object' && p !== null) return { ...emptyProfile(), ...p };
  return emptyProfile();
}

export function saveProfile(p: Profile): Profile {
  const next = { ...p, updateTime: Date.now() };
  set(KEY, next);
  return next;
}

/** 头像展示资源：返回可直接用于 <image> 或 emoji-text 的信息 */
export function avatarRes(src: string): { kind: 'preset' | 'file' | 'empty'; emoji?: string; path?: string } {
  if (!src) return { kind: 'empty' };
  if (src.indexOf('preset:') === 0) {
    const id = src;
    const p = AVATAR_PRESETS.find((x) => x.id === id);
    return { kind: 'preset', emoji: p ? p.emoji : '🙂' };
  }
  return { kind: 'file', path: src };
}

/** 校验是否“已有实名/任一可展示字段”，用于设置页入口角标等 */
export function profileCompleted(p: Profile): boolean {
  return !!(p && (p.name || p.birthday || p.job || p.location || p.bio || p.hobbies || p.skills ||
    (p.contacts && p.contacts.length) || (p.education && p.education.length) || (p.work && p.work.length)));
}

/** 统计已填写的字段数（用于“完整度”） */
export function profileProgress(p: Profile): number {
  let n = 0;
  const checks: boolean[] = [
    !!p.avatar, !!p.name, !!p.gender && p.gender !== '保密', !!p.birthday,
    !!(p.contacts && p.contacts.length), !!p.location, !!p.job, !!p.bio,
    !!p.hobbies, !!p.skills, !!(p.education && p.education.length),
    !!(p.work && p.work.length)
  ];
  for (const c of checks) if (c) n++;
  return n;
}

export const PROFILE_FIELDS_TOTAL = 12;

/** 分隔字符串 → 数组（按中英文逗号/顿号/分号） */
export function splitItems(s: string): string[] {
  return (s || '').split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
}
