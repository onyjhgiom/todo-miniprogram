// pages/profile/profile.ts
// 个人信息页：模块化填写 + 头像选择 + 完整回看。
// 组件综合使用 view / image（头像、头部卡、标签、经历条目）。资料存本地 wx.storage。
// 头像：内置预设（emoji 图卡）或相册上传（本地临时/缓存路径）。字段覆盖：
// 姓名 / 性别 / 出生日期 / 联系方式 / 居住地 / 职业 / 个人简介 /
// 兴趣爱好 / 技能特长 / 教育经历 / 工作经历。
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast } from '../../utils/cloud';
import {
  loadProfile, saveProfile, emptyProfile,
  AVATAR_PRESETS, GENDER_OPTIONS, DEGREE_OPTIONS,
  avatarRes, uid, profileProgress, PROFILE_FIELDS_TOTAL, splitItems,
  type Profile, type EduEntry, type WorkEntry, type ContactItem
} from '../../utils/profile-store';
import type { ThemeKey } from '../../types/index';

type ViewMode = 'edit' | 'view';

interface TagRow { id: string; label: string; value: string; }

interface ProfileData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  fxMode: string;
  fxLevel: number;
  fxSrc: string;
  fxFull: boolean;
  bgStyle: string;
  today: string;
  mode: ViewMode;
  p: Profile;
  /** 头像展示态 */
  avatarKind: 'preset' | 'file' | 'empty';
  avatarEmoji: string;
  avatarPath: string;
  presets: { id: string; emoji: string; name: string }[];
  genderOptions: GenderOpt[];
  degreeOptions: string[];
  showAvatarPicker: boolean;
  /** 联系方式 UI */
  contactRows: TagRow[];
  /** 教育经历 UI（字符串态） */
  eduUI: EduUIRow[];
  /** 工作经历 UI */
  workUI: WorkUIRow[];
  /** 新增经历弹层 */
  eduEditorOpen: boolean;
  eduEditingId: string;
  eduForm: EduEntry;
  workEditorOpen: boolean;
  workEditingId: string;
  workForm: WorkEntry;
  contactError: string;
  progress: number;
  totalFields: number;
  /** 兴趣爱好/技能特长 UI 态（逗号分隔字符串直接编辑） */
  hobbiesText: string;
  skillsText: string;
  /** 视图态标签数组 */
  hobbyTags: string[];
  skillTags: string[];
  bioText: string;
  savedAt: string;
}

type GenderOpt = { key: string; label: string };interface EduUIRow { id: string; school: string; degree: string; major: string; period: string; }
interface WorkUIRow { id: string; company: string; role: string; period: string; }

const EMPTY_EDU: EduEntry = { id: '', school: '', degree: '本科', major: '', period: '', desc: '' };
const EMPTY_WORK: WorkEntry = { id: '', company: '', role: '', period: '', desc: '' };

function genderOpts(): GenderOpt[] {
  return GENDER_OPTIONS.map((g) => ({ key: g, label: g }));
}

function profileToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

Page<ProfileData>({
  data: {
    theme: 'light',
    fxMode: 'sunset',
    fxLevel: 8,
    fxSrc: '',
    fxFull: false,
    bgStyle: '',
    themeStyle: '',
    heroGradient: '',
    today: profileToday(),
    mode: 'edit',
    p: emptyProfile(),
    avatarKind: 'preset',
    avatarEmoji: '🙋',
    avatarPath: '',
    presets: AVATAR_PRESETS,
    genderOptions: genderOpts(),
    degreeOptions: DEGREE_OPTIONS,
    showAvatarPicker: false,
    contactRows: [],
    eduUI: [],
    workUI: [],
    eduEditorOpen: false,
    eduEditingId: '',
    eduForm: { ...EMPTY_EDU },
    workEditorOpen: false,
    workEditingId: '',
    workForm: { ...EMPTY_WORK },
    contactError: '',
    progress: 0,
    totalFields: PROFILE_FIELDS_TOTAL,
    hobbiesText: '',
    skillsText: '',
    hobbyTags: [],
    skillTags: [],
    bioText: '',
    savedAt: ''
  },

  onLoad() {
    this.applyTheme();
    this.loadFromStore();
  },
  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({
      theme: s.theme,
      themeStyle: s.themeStyle,
      heroGradient: s.heroGradient,
      fxMode: s.fxMode,
      fxLevel: s.fxLevel,
      fxSrc: s.fxSrc,
      fxFull: s.fxFull,
      bgStyle: s.bgStyle
    } as Record<string, unknown>);
    syncNavBar(s);
  },

  loadFromStore() {
    const p = loadProfile();
    const av = avatarRes(p.avatar);
    this.setData({
      p,
      mode: 'view',
      avatarKind: av.kind,
      avatarEmoji: av.emoji || '🙂',
      avatarPath: av.path || '',
      hobbiesText: p.hobbies || '',
      skillsText: p.skills || '',
      bioText: p.bio || '',
      hobbyTags: splitItems(p.hobbies || ''),
      skillTags: splitItems(p.skills || ''),
      contactRows: (p.contacts || []).map((c, i) => ({ id: String(i), label: c.type, value: c.value })),
      eduUI: (p.education || []).map((e) => ({ id: e.id, school: e.school, degree: e.degree, major: e.major, period: e.period })),
      workUI: (p.work || []).map((w) => ({ id: w.id, company: w.company, role: w.role, period: w.period })),
      progress: profileProgress(p),
      savedAt: p.updateTime ? this.fmtTime(p.updateTime) : ''
    });
  },

  fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // ============ 视图切换 ============
  toEdit() {
    this.setData({ mode: 'edit' });
  },
  toView() {
    this.commitTextFields();
    this.loadFromStore();
    this.setData({ mode: 'view' });
  },

  // ============ 头像 ============
  onAvatarTap() {
    this.setData({ showAvatarPicker: true });
  },
  onAvatarPickerStop() { /* noop */ },
  onAvatarClose() {
    this.setData({ showAvatarPicker: false });
  },
  onPickPreset(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || AVATAR_PRESETS[0].id;
    const res = avatarRes(id);
    this.setData({
      'p.avatar': id,
      avatarKind: res.kind,
      avatarEmoji: res.emoji || '🙂',
      avatarPath: res.path || '',
      showAvatarPicker: false
    });
  },
  onUploadAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        this.setData({
          'p.avatar': file.tempFilePath,
          avatarKind: 'file',
          avatarPath: file.tempFilePath,
          avatarEmoji: '',
          showAvatarPicker: false
        });
      },
      fail: () => {
        /* 用户取消等 */
      }
    });
  },

  // ============ 基础字段 ============
  onName(e: WechatMiniprogram.InputEvent) { this.setData({ 'p.name': e.detail.value }); },
  onGender(e: WechatMiniprogram.TouchEvent) { this.setData({ 'p.gender': (e.currentTarget.dataset.v as string) }); },
  onBirthday(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ 'p.birthday': String(e.detail.value) }); },
  onLocation(e: WechatMiniprogram.InputEvent) { this.setData({ 'p.location': e.detail.value }); },
  onJob(e: WechatMiniprogram.InputEvent) { this.setData({ 'p.job': e.detail.value }); },
  onBio(e: WechatMiniprogram.InputEvent) { this.setData({ bioText: e.detail.value }); },
  onHobbies(e: WechatMiniprogram.InputEvent) { this.setData({ hobbiesText: e.detail.value }); },
  onSkills(e: WechatMiniprogram.InputEvent) { this.setData({ skillsText: e.detail.value }); },

  commitTextFields() {
    const s = this.data;
    this.setData({
      'p.bio': s.bioText,
      'p.hobbies': s.hobbiesText,
      'p.skills': s.skillsText
    });
  },

  // ============ 联系方式（支持多条） ============
  onContactType(e: WechatMiniprogram.InputEvent) {
    const i = Number((e.currentTarget.dataset.i as string) || 0);
    const rows = this.data.contactRows.slice();
    if (!rows[i]) return;
    rows[i] = { ...rows[i], label: e.detail.value };
    this.setData({ contactRows: rows });
  },
  onContactValue(e: WechatMiniprogram.InputEvent) {
    const i = Number((e.currentTarget.dataset.i as string) || 0);
    const rows = this.data.contactRows.slice();
    if (!rows[i]) return;
    rows[i] = { ...rows[i], value: e.detail.value };
    this.setData({ contactRows: rows });
  },
  onContactAdd() {
    const rows = this.data.contactRows.slice();
    rows.push({ id: String(rows.length + Math.random()), label: '微信', value: '' });
    this.setData({ contactRows: rows });
  },
  onContactRemove(e: WechatMiniprogram.TouchEvent) {
    const i = Number((e.currentTarget.dataset.i as string) || 0);
    const rows = this.data.contactRows.filter((_, idx) => idx !== i);
    this.setData({ contactRows: rows });
  },

  // ============ 教育经历 ============
  onEduAdd() {
    this.setData({ eduEditorOpen: true, eduEditingId: '', eduForm: { ...EMPTY_EDU, id: uid('ed') } });
  },
  onEduEdit(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const item = this.data.eduUI.find((x) => x.id === id);
    if (!item) return;
    const src = (this.data.p.education || []).find((x) => x.id === id);
    this.setData({
      eduEditorOpen: true,
      eduEditingId: id,
      eduForm: src || { id, school: item.school, degree: item.degree, major: item.major, period: item.period, desc: '' }
    });
  },
  onEduField(e: WechatMiniprogram.InputEvent) {
    const f = e.currentTarget.dataset.f as string;
    this.setData({ ['eduForm.' + f]: e.detail.value });
  },
  onEduDegree(e: WechatMiniprogram.PickerChangeEvent) {
    const v = String(e.detail.value);
    this.setData({ 'eduForm.degree': DEGREE_OPTIONS[Number(v)] || '本科' });
  },
  onEduEditorClose() { this.setData({ eduEditorOpen: false }); },
  onEduSheetStop() { /* noop */ },
  onEduSave() {
    const f = this.data.eduForm;
    if (!f.school.trim()) { toast('请填写学校/机构'); return; }
    const list = (this.data.p.education || []).filter((x) => x.id !== f.id);
    list.push(f);
    list.sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    this.setData({
      'p.education': list,
      eduUI: list.map((e) => ({ id: e.id, school: e.school, degree: e.degree, major: e.major, period: e.period })),
      eduEditorOpen: false
    });
  },
  onEduDelete(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const list = (this.data.p.education || []).filter((x) => x.id !== id);
    this.setData({ 'p.education': list, eduUI: list.map((x) => ({ id: x.id, school: x.school, degree: x.degree, major: x.major, period: x.period })) });
    toast('已删除该条经历');
  },

  // ============ 工作经历 ============
  onWorkAdd() {
    this.setData({ workEditorOpen: true, workEditingId: '', workForm: { ...EMPTY_WORK, id: uid('wk') } });
  },
  onWorkEdit(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const item = this.data.workUI.find((x) => x.id === id);
    if (!item) return;
    const src = (this.data.p.work || []).find((x) => x.id === id);
    this.setData({
      workEditorOpen: true,
      workEditingId: id,
      workForm: src || { id, company: item.company, role: item.role, period: item.period, desc: '' }
    });
  },
  onWorkField(e: WechatMiniprogram.InputEvent) {
    const f = e.currentTarget.dataset.f as string;
    this.setData({ ['workForm.' + f]: e.detail.value });
  },
  onWorkEditorClose() { this.setData({ workEditorOpen: false }); },
  onWorkSheetStop() { /* noop */ },
  onWorkSave() {
    const f = this.data.workForm;
    if (!f.company.trim()) { toast('请填写公司/单位'); return; }
    const list = (this.data.p.work || []).filter((x) => x.id !== f.id);
    list.push(f);
    list.sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    this.setData({
      'p.work': list,
      workUI: list.map((w) => ({ id: w.id, company: w.company, role: w.role, period: w.period })),
      workEditorOpen: false
    });
  },
  onWorkDelete(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const list = (this.data.p.work || []).filter((x) => x.id !== id);
    this.setData({ 'p.work': list, workUI: list.map((x) => ({ id: x.id, company: x.company, role: x.role, period: x.period })) });
    toast('已删除该段经历');
  },

  // ============ 保存 ============
  onSave() {
    this.commitTextFields();
    // 联系方式：合并进 p.contacts
    const contacts: ContactItem[] = this.data.contactRows
      .filter((r) => r.value.trim())
      .map((r) => ({ type: (r.label || '').trim() || '其他', value: r.value.trim() }));
    // 兴趣爱好/技能：转存为顿号分隔
    const finalProfile: Profile = {
      ...this.data.p,
      contacts,
      hobbies: this.data.hobbiesText,
      skills: this.data.skillsText,
      bio: this.data.bioText
    };
    const saved = saveProfile(finalProfile);
    this.setData({ p: saved, progress: profileProgress(saved), savedAt: this.fmtTime(saved.updateTime) });
    toast('已保存 ✔');
    this.setData({ mode: 'view' });
    this.loadFromStore();
  }
});
