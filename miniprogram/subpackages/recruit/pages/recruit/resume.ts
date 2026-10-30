// pages/recruit/resume.ts
// 我的简历：结构化填写 → canvas 渲染 → 云函数封装成 PDF → 预览 / 保存 / 转发。
//
// 中文字体说明：canvas 用系统字体渲染，中文不会乱码；PDF 只负责把整页图摆进去，
// 因此不需要在云函数里嵌几 MB 的中文字体。代价是 PDF 里的文字不可选中。
//
// 智能化升级（2026-09）：
//   1) 草稿读写改走 recruit-intel.ts 的共享层（之前是页面私有 STORE_KEY，
//      导致「简历诊断 / 岗位匹配」这类需要读简历的模块拿不到数据 → 信息孤岛）。
//   2) 新增「简历诊断」面板：结构 40 + 内容 60 评分，每条扣分都给「怎么补」。
//   3) 新增「目标匹配」：把你填的求职意向 / 最近投递，和已有投递的 JD 做匹配度排序，
//      缺意向时引导先填，而不是给一份空泛的通用结论。
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast, callFn } from '../../../../utils/cloud';
import { uploadAttachImage } from '../../../../utils/attach';
import { go } from '../../../../utils/nav';
import {
  PAGE_W, PAGE_H, layout, drawPage, RESUME_TEMPLATES, RESUME_THEMES, RESUME_LAYOUTS, templateByCategory,
  buildPdfBytes, jpegSizeOf, TEMPLATE_GROUPS, TEMPLATE_DESC
} from '../../utils/resume-doc';
import type {
  ResumeProfile, ResumeSection, ResumeTemplate, ResumeTheme, PdfPageImage, ResumeLayout,
  LoadedImage, ResumeImage
} from '../../utils/resume-doc';
import type { ThemeKey } from '../../../../types/index';
import {
  loadResumeDraft, saveResumeDraft, draftToProfile, defaultResumeDraft,
  emptyItem, defaultSections, sortSectionsCanonical,
  diagnoseResume, currentGoal, matchResumeToJob, smartJobOf
} from '../../utils/recruit-intel';
import type { EditItem, EditSection, ResumeDraft, ResumeDiag, JobGoal } from '../../utils/recruit-intel';
import { loadApps } from '../../utils/recruit-store';
// 生成链路的两层增强：容错清洗（占位符/空壳剔除）+ 岗位自适应编排（顺序/详略/篇幅）
import { sanitizeProfile, normalizeSectionKey, sectionDef, looksEmpty } from '../../utils/resume-schema';
import { adaptProfile, budgetOfLayout } from '../../utils/resume-adapt';
import type { JobContext } from '../../utils/resume-adapt';
// 智能化：岗位关键词抽取 + 匹配报告 + 按相关度重排（只排序，不改写）
import { matchReport, smartArrange, tidyProfile } from '../../utils/resume-smart';
import type { MatchReport } from '../../utils/resume-smart';
// 交互层：防抖（输入时不卡）与防连点
import { debounce, guardTap } from '../../utils/recruit-ui';

interface MatchRow {
  appId: string;
  company: string;
  position: string;
  score: number;
  level: string;
  hit: number;
  total: number;
}

/** 模板弹层里的分组项（一键切换时只影响内容骨架，不动版式/配色） */
interface TemplateEntry {
  idx: number;
  title: string;
  desc: string;
}

interface ResumePageData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  name: string;
  /** 姓名校验失败：PDF 页眉必填，为空时输入框标红并给出字段级提示 */
  nameErr: boolean;
  headline: string;
  contacts: string;
  skills: string;
  summary: string;
  salary: string;
  city: string;
  sections: EditSection[];
  /** 证件照（可选） */
  photo: ResumeImage | null;
  /** 正在生成 PDF */
  generating: boolean;
  /** 正在 AI 补充润色 */
  enhancing: boolean;
  /** 生成结果：PDF 的云文件 ID（云端链路成功时有值） */
  pdfFileId: string;
  /** 生成结果：本地 PDF 路径（云端不可用时走本地兜底） */
  pdfPath: string;
  showTemplates: boolean;
  /** 按岗位分组后的模板（技术岗 / 产品运营 / 职能 …），一键切换不丢内容 */
  templateGroups: { key: string; name: string; items: TemplateEntry[] }[];
  /** 目标岗位（匹配用） */
  jobTarget: string;
  /** 目标岗位 JD 原文（可选，粘进来自动抽关键词） */
  jdText: string;
  /** 智能匹配报告：命中 / 缺失 / 相关经历排序 */
  match: MatchReport | null;
  /** 本地智能提炼中（重排 + 规范标点） */
  polishing: boolean;
  /** 简历语言选择（中文默认且排第一），控制 AI 润色输出语言 */
  langList: { key: 'zh' | 'en'; name: string; color: string }[];
  lang: 'zh' | 'en';
  /** PDF 版式选择（样式层：雅致分节版 / 经典一页纸 / 极简留白版 / 紧凑多页版） */
  layoutList: { key: ResumeLayout; name: string; desc: string; color: string; style: string }[];
  layout: ResumeLayout;
  /** PDF 配色主题（名称 + 主色），供页面选择 */
  themeList: { name: string; accent: string }[];
  /** 当前选中的配色主题索引 */
  themeIdx: number;
  tip: string;
  /** 诊断是否已计算（避免空简历时闪烁） */
  diagReady: boolean;
  /** 简历诊断结果 */
  diag: ResumeDiag | null;
  /** 求职意向（来自简历或最近投递） */
  goal: JobGoal;
  /** 与目标/简历最匹配的投递（取前 5） */
  matchList: MatchRow[];
}

/** 按岗位分组组织模板列表（技术岗 / 产品运营 / 职能 …） */
function buildTemplateGroups(): { key: string; name: string; items: TemplateEntry[] }[] {
  const byKey: Record<string, number> = {};
  RESUME_TEMPLATES.forEach((t, i) => { byKey[t.key] = i; });
  const used: Record<string, boolean> = {};
  const groups = TEMPLATE_GROUPS.map((g) => ({
    key: g.key,
    name: g.name,
    items: g.keys
      .filter((k) => byKey[k] !== undefined)
      .map((k) => {
        used[k] = true;
        const t = RESUME_TEMPLATES[byKey[k]];
        return { idx: byKey[k], title: t.title, desc: t.desc || TEMPLATE_DESC[k] || '' };
      })
  })).filter((g) => g.items.length > 0);

  // 兜底：注册表里没写进任何分组的模板也要出现在弹层里（不能凭空消失）
  const rest = RESUME_TEMPLATES.map((t, i) => ({ t, i })).filter((x) => !used[x.t.key]);
  if (rest.length) {
    groups.push({
      key: 'other',
      name: '其他',
      items: rest.map((x) => ({ idx: x.i, title: x.t.title, desc: x.t.desc || TEMPLATE_DESC[x.t.key] || '' }))
    });
  }
  return groups;
}

function canvasToTemp(canvas: any): Promise<string> {
  return new Promise((resolve, reject) => {
    // 旧版类型声明缺 canvasToTempFilePath，用 as any 兼容真实存在的 API。
    // ⚠️ type="2d" 的 canvas 必须显式传 x/y/width/height/destWidth/destHeight：
    // 省略时部分基础库版本会把整张画布当成 0 尺寸，导出空白图或直接失败，
    // 表现为「点了生成却拿到空白 PDF / 导出失败」。这里用 canvas 的像素缓冲尺寸兜底。
    const w = canvas.width || PAGE_W;
    const h = canvas.height || PAGE_H;
    // 真机双重试：第一回合失败/返回空路径时重试一次
    const attempt = (round: number) => {
      (wx as any).canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: w,
        height: h,
        destWidth: w,
        destHeight: h,
        fileType: 'jpg',
        quality: 0.95,
        success: (r: any) => {
          const p = String(r.tempFilePath || '');
          if (!p && round === 1) {
            setTimeout(() => attempt(2), 50);
          } else {
            resolve(p);
          }
        },
        fail: (e: any) => {
          if (round === 1) {
            setTimeout(() => attempt(2), 50);
          } else {
            reject(new Error((e && e.errMsg) || '导出图片失败'));
          }
        }
      });
    };
    attempt(1);
  });
}

/** 用 canvas 预加载图片为可绘制对象（drawImage 需要 CanvasImageSource）。
 * 失败（路径失效 / 解码错误）时 reject，调用方捕获后画占位块，不中断整份简历生成。 */
function loadCanvasImage(canvas: any, path: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage ? canvas.createImage() : null;
    if (!img) { reject(new Error('createImage 不支持')); return; }
    img.onload = () => resolve({ img, width: img.width || 1, height: img.height || 1 });
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = path;
  });
}

/** base64 → 字节；优先用官方 API，缺失时手动解码兜底 */
function base64ToBytes(b64: string): Uint8Array {
  const api = (wx as any).base64ToArrayBuffer;
  if (typeof api === 'function') {
    try {
      return new Uint8Array(api.call(wx, b64));
    } catch (e) {
      // 落到下面的手动解码
    }
  }
  const T =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const s = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c0 = T.indexOf(s[i]);
    const c1 = T.indexOf(s[i + 1]);
    const c2 = T.indexOf(s[i + 2]);
    const c3 = T.indexOf(s[i + 3]);
    if (c1 >= 0) out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out.subarray(0, p);
}

/**
 * 本地兜底：把页图直接拼成 PDF 写到 USER_DATA_PATH 并返回本地路径。
 * 不依赖任何云函数，云端不可用时也能拿到可打开的 PDF。
 */
function buildPdfLocal(tempFiles: string[]): string {
  // 旧版类型声明缺 readFileSync / writeFileSync，用 as any 兼容真实存在的 API
  const fs = wx.getFileSystemManager() as any;
  const images: PdfPageImage[] = [];
  for (const fp of tempFiles) {
    const b64 = fs.readFileSync(fp, 'base64') as string;
    const bytes = base64ToBytes(b64);
    const size = jpegSizeOf(bytes);
    images.push({
      bytes,
      width: size ? size.width : PAGE_W,
      height: size ? size.height : PAGE_H
    });
  }
  const pdf = buildPdfBytes(images);
  const out = `${wx.env.USER_DATA_PATH}/resume-${Date.now()}.pdf`;
  // ⚠️ data 是 ArrayBuffer 时不能传 encoding（'binary' 在部分真机会写入 0 字节/损坏文件，
  // 导致 openDocument 报误导性的「filePath should be String instead of Undefined」）
  fs.writeFileSync(out, pdf.buffer as ArrayBuffer);
  // 写入后校验：文件必须存在且非空，否则立刻抛错走「生成失败」提示，不让 openDocument 报玄学错误
  const stat = fs.statSync(out) as { size: number };
  if (!stat || !stat.size) throw new Error('本地 PDF 写入异常（0 字节），请重试');
  return out;
}

Page<ResumePageData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    name: '',
    nameErr: false,
    headline: '',
    contacts: '',
    skills: '',
    summary: '',
    salary: '',
    city: '',
    sections: [],
    photo: null,
    generating: false,
    enhancing: false,
    pdfFileId: '',
    pdfPath: '',
    showTemplates: false,
    templateGroups: buildTemplateGroups(),
    jobTarget: '',
    jdText: '',
    match: null,
    polishing: false,
    langList: [
      { key: 'zh', name: '中文', color: '#1d4ed8' },
      { key: 'en', name: 'English', color: '#475569' }
    ],
    lang: 'zh',
    layoutList: RESUME_LAYOUTS.map((l) => ({ key: l.key, name: l.name, desc: l.desc, color: l.color, style: l.style })),
    layout: 'sectioned',
    themeList: RESUME_THEMES.map((t) => ({ name: t.name, accent: t.accent })),
    themeIdx: 0,
    tip: '填经历 → 填目标岗位（或粘 JD）→「按岗位突出经历」/「AI 提炼润色」→ 生成 PDF；版式与配色可随时一键切换，内容不受影响',
    diagReady: false,
    diag: null,
    goal: { target: '', city: '', salary: '', keywords: [], source: '', has: false },
    matchList: []
  },

  onLoad(query: Record<string, string | undefined>) {
    this.applyTheme();
    this.restore();
    this.refreshIntelligence();
    // 从资源库「生成 PDF 模板」进入：套用对应岗位的模板骨架。
    // 已经填过真实内容时只套结构、不覆盖 —— 从资源库点进来不该把写了半小时的经历冲掉。
    if (query && query.tpl) {
      const cat = decodeURIComponent(String(query.tpl));
      const tpl = templateByCategory(cat);
      if (this.hasRealContent()) this.applyTemplateStructure(tpl);
      else this.applyTemplate(tpl, true);
    }
  },
  onShow() {
    this.applyTheme();
    // 从其它页面（如投递详情）回填了简历后，回到这里刷新诊断
    this.refreshIntelligence();
  },
  applyTheme() {
    const s = getCareerState(); // 秋招助手固定「求职工作台」深蓝视觉，不随全局主题漂移
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /** 把当前表单数据收口成共享草稿模型 */
  currentDraft(): ResumeDraft {
    const d = this.data;
    return {
      name: d.name, headline: d.headline, contacts: d.contacts,
      skills: d.skills, summary: d.summary, salary: d.salary, city: d.city,
      sections: d.sections, photo: d.photo, lang: d.lang, layout: d.layout,
      themeIdx: d.themeIdx, jobTarget: d.jobTarget, jdText: d.jdText
    };
  },

  restore() {
    const s = loadResumeDraft();
    this.setData({
      name: s.name, headline: s.headline, contacts: s.contacts,
      skills: s.skills, summary: s.summary, salary: s.salary, city: s.city,
      sections: s.sections, photo: s.photo || null, lang: s.lang || 'zh', layout: s.layout || 'sectioned',
      themeIdx: typeof s.themeIdx === 'number' ? s.themeIdx : 0,
      jobTarget: s.jobTarget || '',
      jdText: s.jdText || ''
    });
  },
  /** 收口到共享草稿存储：诊断 / 匹配 / 推荐从此都能读到同一份简历 */
  persist() {
    saveResumeDraft(this.currentDraft());
  },
  /**
   * 输入过程中只落盘、不重算：诊断 + 匹配要遍历全部经历与投递，
   * 每敲一个字算一次会明显卡顿（尤其在低端机上）。重算走 220ms 防抖，停手才算。
   */
  scheduleIntelligence() {
    this.persist();
    debounce('resume-intel', 220, () => this.refreshIntelligence());
  },

  /* ---------- 智能化：诊断 + 目标匹配 ---------- */
  /**
   * 实时算两份结论：
   *  - 简历诊断（结构 + 内容打分，给「怎么补」）
   *  - 目标匹配（把简历和已有投递的 JD 做匹配度排序，没意向时引导先填）
   * 纯本地确定性计算，离线也能跑；不被任何云依赖卡住。
   */
  refreshIntelligence() {
    const draft = this.currentDraft();
    const profile = draftToProfile(draft);
    const diag = diagnoseResume(profile);
    const goal = currentGoal();
    // 智能匹配：按「目标岗位 / JD 关键词」算命中与缺失（纯本地，离线可用）
    const job = smartJobOf();
    const match = matchReport(profile, { target: job.target, keywords: job.keywords });

    const matches: MatchRow[] = [];
    if (goal.has) {
      loadApps()
        .map((a) => ({ app: a, m: matchResumeToJob(a, profile) }))
        .filter((x) => x.m.score > 0)
        .sort((a, b) => b.m.score - a.m.score)
        .slice(0, 5)
        .forEach((x) => matches.push({
          appId: x.app._id,
          company: x.app.company,
          position: x.app.position,
          score: x.m.score,
          level: x.m.level,
          hit: x.m.hitCount,
          total: x.m.totalCount
        }));
    }

    this.setData({
      diagReady: true,
      diag,
      match,
      goal: {
        target: goal.target, city: goal.city, salary: goal.salary,
        keywords: goal.keywords, source: goal.source, has: goal.has
      },
      matchList: matches
    });
  },

  /** 点匹配结果跳到对应投递详情（那里有完整的匹配度 + 下一步 + 面试提纲） */
  onMatchTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    go(`/subpackages/recruit/pages/recruit/detail?id=${id}`);
  },

  /* ---------- 基础字段 ---------- */
  onField(e: WechatMiniprogram.InputEvent) {
    const f = e.currentTarget.dataset.field as string;
    const v = e.detail.value || '';
    this.setData({ [f]: v } as any, () => this.scheduleIntelligence());
    // 输入即消错：姓名填上了就立刻收起红框，不用等下次点生成才发现
    if (f === 'name' && this.data.nameErr && v.trim()) this.setData({ nameErr: false });
  },

  /**
   * 目标岗位 / JD 原文输入：这两个字段直接决定匹配与重排的准度，
   * 所以停手 260ms 就重算（比普通字段稍慢一点，避免粘长 JD 时反复抽词）。
   */
  onJobField(e: WechatMiniprogram.InputEvent) {
    const f = e.currentTarget.dataset.field as string;
    const v = e.detail.value || '';
    this.setData({ [f]: v } as any, () => {
      this.persist();
      debounce('resume-job', 260, () => this.refreshIntelligence());
    });
  },

  /* ---------- 智能化：本地提炼（重排 + 规范标点，可二次编辑） ---------- */
  /**
   * 「按岗位突出经历」：本地完成三件事，全部可撤销（用户继续在表单里改即可）：
   *   1) 规范标点与口语词（不改动事实与数字）
   *   2) 按岗位关键词相关度重排每段经历的要点，命中的排到最前
   *   3) 相关度高的经历在模块内前置
   * 措辞层面的润色交给「AI 提炼润色」，本地绝不替用户改写语义。
   */
  onPolish() {
    if (this.data.polishing) return;
    if (!guardTap('resume-polish')) return;
    const job = smartJobOf();
    if (!job.keywords.length) {
      toast('先填目标岗位或粘贴一段 JD，才知道该突出什么');
      return;
    }
    this.setData({ polishing: true });
    try {
      const raw = draftToProfile(this.currentDraft());
      const tidied = tidyProfile(raw);
      const arranged = smartArrange(tidied.profile, { target: job.target, keywords: job.keywords });
      const sections = this.sectionsFromProfile(arranged.sections, this.data.sections);
      this.setData({ sections }, () => {
        this.persist();
        this.refreshIntelligence();
      });
      const notes = arranged.notes.slice(0, 2);
      const tidyNote = tidied.changed ? `规范了 ${tidied.changed} 条标点和口语表述` : '';
      const text = [tidyNote].concat(notes).filter(Boolean).join('；');
      this.setData({
        polishing: false,
        tip: text ? `${text}。内容已回到下方表单，可继续手动微调。` : '已按岗位重排要点，可继续手动微调'
      });
      toast('已按岗位重排要点');
    } catch (err) {
      this.setData({ polishing: false });
      console.error('[resume] polish fail:', err);
      toast('整理失败，内容未改动');
    }
  },

  /** 把 Profile 的 sections 反向写回表单（bullets 数组 → 多行文本），保留模块图片 */
  sectionsFromProfile(sections: ResumeSection[], fallback: EditSection[]): EditSection[] {
    const imgMap: Record<string, ResumeImage[]> = {};
    (fallback || []).forEach((s) => { if (s.images && s.images.length) imgMap[s.key] = s.images; });
    const out: EditSection[] = sections
      .filter((s) => s.items && s.items.length)
      .map((s) => ({
        key: s.key,
        title: s.title || sectionDef(s.key).title,
        items: (s.items || []).map((it) => ({
          primary: it.primary || '',
          secondary: it.secondary || '',
          meta: it.meta || '',
          bullets: (it.bullets || []).join('\n')
        })),
        images: imgMap[s.key] || []
      }));
    return out.length ? out : fallback.map((s) => ({ ...s, images: s.images || [] }));
  },

  /* ---------- 条目编辑 ---------- */
  addItem(e: WechatMiniprogram.TouchEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const sections = this.data.sections.map((s, i) =>
      i === si ? { ...s, items: [...s.items, emptyItem()] } : s
    );
    this.setData({ sections }, () => this.scheduleIntelligence());
  },
  removeItem(e: WechatMiniprogram.TouchEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const ii = Number(e.currentTarget.dataset.ii);
    const sections = this.data.sections.map((s, i) =>
      i === si ? { ...s, items: s.items.filter((_, k) => k !== ii) } : s
    );
    this.setData({ sections }, () => this.scheduleIntelligence());
  },
  onItem(e: WechatMiniprogram.InputEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const ii = Number(e.currentTarget.dataset.ii);
    const f = e.currentTarget.dataset.field as string;
    const sections = this.data.sections.map((s, i) => {
      if (i !== si) return s;
      return { ...s, items: s.items.map((it, k) => (k === ii ? { ...it, [f]: e.detail.value } : it)) };
    });
    this.setData({ sections }, () => this.scheduleIntelligence());
  },

  /* ---------- 简历语言 ---------- */
  /** 切换中文 / English：只影响 AI 润色的输出语言与模板文案方向，已填内容不清空 */
  onLang(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as 'zh' | 'en';
    if (!key || key === this.data.lang) return;
    this.setData({ lang: key }, () => this.persist());
    toast(key === 'en' ? '已切换为英文简历，AI 润色将输出英文' : '已切换为中文简历');
  },

  /* ---------- PDF 版式 ---------- */
  /** 切换版式：雅致分节版 / 经典一页纸等，只影响生成 PDF 的排版，不改内容 */
  onLayout(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as ResumeLayout;
    if (!key || key === this.data.layout) return;
    this.setData({ layout: key }, () => this.persist());
  },

  /* ---------- 图片上传（插入对应模块） ---------- */
  /** 选证件照（基本信息卡） */
  pickPhoto() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (r: any) => {
        const f = r.tempFiles && r.tempFiles[0];
        if (!f || !f.tempFilePath) return;
        const path = this.saveResumeImage(f.tempFilePath);
        this.setData({ photo: { id: this.genImgId(), path, caption: this.data.photo ? this.data.photo.caption : '' } }, () => this.persist());
      },
      fail: () => {}
    });
  },
  removePhoto() {
    const p = this.data.photo;
    if (p) this.removeResumeImage(p.path);
    this.setData({ photo: null }, () => this.persist());
  },
  /** 选模块图片（section：证书 / 作品 / 截图） */
  pickImages(e: WechatMiniprogram.TouchEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const sec = this.data.sections[si];
    if (!sec) return;
    const remain = Math.max(0, 9 - (sec.images ? sec.images.length : 0));
    if (remain <= 0) { toast('每个模块最多 9 张图片'); return; }
    wx.chooseMedia({
      count: remain, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (r: any) => {
        const added: ResumeImage[] = (r.tempFiles || []).map((f: any) => {
          const path = this.saveResumeImage(f.tempFilePath);
          return { id: this.genImgId(), path, caption: '' };
        });
        if (!added.length) return;
        const sections = this.data.sections.map((s, i) =>
          i === si ? { ...s, images: [...(s.images || []), ...added] } : s
        );
        this.setData({ sections }, () => this.scheduleIntelligence());
      },
      fail: () => {}
    });
  },
  removeImg(e: WechatMiniprogram.TouchEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const ii = Number(e.currentTarget.dataset.ii);
    const sec = this.data.sections[si];
    if (!sec || !sec.images) return;
    const removed = sec.images[ii];
    if (removed) this.removeResumeImage(removed.path);
    const sections = this.data.sections.map((s, i) =>
      i === si ? { ...s, images: s.images.filter((_, k) => k !== ii) } : s
    );
    this.setData({ sections }, () => this.scheduleIntelligence());
  },
  onImgCaption(e: WechatMiniprogram.InputEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const ii = Number(e.currentTarget.dataset.ii);
    const sections = this.data.sections.map((s, i) => {
      if (i !== si || !s.images) return s;
      return { ...s, images: s.images.map((im, k) => (k === ii ? { ...im, caption: e.detail.value } : im)) };
    });
    this.setData({ sections }, () => this.scheduleIntelligence());
  },
  /** 生成图片 id（本机唯一即可） */
  genImgId(): string {
    return 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  },
  /** 把临时图片落地到 USER_DATA_PATH（避免冷启动临时路径失效），返回稳定路径 */
  saveResumeImage(tempPath: string): string {
    try {
      const fs = wx.getFileSystemManager() as any;
      const m = (tempPath || '').match(/\.([A-Za-z0-9]{2,5})(?:\?|$)/);
      const ext = m ? m[1].toLowerCase() : 'jpg';
      const name = `resume-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const dest = `${wx.env.USER_DATA_PATH}/${name}`;
      fs.copyFileSync(tempPath, dest);
      return dest;
    } catch (err) {
      console.warn('[resume] 图片落地失败，使用临时路径：', err);
      return tempPath;
    }
  },
  /** 删除已落地图片（best-effort，失败不影响流程） */
  removeResumeImage(path: string): void {
    try {
      const fs = wx.getFileSystemManager() as any;
      if (path && path.indexOf(wx.env.USER_DATA_PATH) === 0) fs.unlinkSync(path);
    } catch (err) {
      // 文件可能已不存在，忽略
    }
  },

  /* ---------- PDF 配色 ---------- */
  /** 切换配色：只改样式层，不动任何内容；选择会被记住，重进页面不回到默认蓝 */
  onTheme(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (idx === this.data.themeIdx) return;
    this.setData({ themeIdx: idx }, () => this.persist());
  },

  /* ---------- 模板 ---------- */
  openTemplates() { this.setData({ showTemplates: true }); },
  closeTemplates() { this.setData({ showTemplates: false }); },
  /**
   * 选模板：已填过真实内容时先问一句，避免「一键切换把写了半小时的经历冲掉」。
   * 内容与样式解耦 —— 这里只替换内容骨架，版式与配色保持用户当前选择。
   */
  useTemplate(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.idx);
    const t = RESUME_TEMPLATES[idx];
    if (!t) return;
    if (!guardTap('resume-tpl-' + idx)) return;
    if (this.hasRealContent()) {
      wx.showModal({
        title: `套用「${t.title}」`,
        content: '你已经填过简历内容了。要保留你的经历、只套用模板结构，还是清空并换成模板示例？',
        confirmText: '保留我的内容',
        cancelText: '换成模板示例',
        success: (r) => {
          if (r.confirm) this.applyTemplateStructure(t);
          else this.applyTemplate(t);
        }
      });
      return;
    }
    this.applyTemplate(t);
  },

  /** 是否已填过真实内容（有非占位的主标题就算） */
  hasRealContent(): boolean {
    const sections = this.data.sections || [];
    for (const s of sections) {
      for (const it of s.items || []) {
        const v = (it.primary || '').trim();
        if (v && !looksEmpty(v)) return true;
        if ((it.bullets || '').trim()) return true;
      }
    }
    return !!(this.data.skills || '').trim() || !!(this.data.summary || '').trim();
  },

  /**
   * 只套结构、保留内容：用模板的小节骨架重排 / 补全，用户的每段经历原样搬过去。
   * 用户模块里已有对应 key 的，沿用自己的标题与条目；模板有而用户没有的，补一个空条目。
   */
  applyTemplateStructure(t: ResumeTemplate): void {
    const p = t.profile;
    const mine = this.data.sections || [];
    const byKey: Record<string, EditSection> = {};
    mine.forEach((s) => { if (!byKey[s.key]) byKey[s.key] = s; });

    const merged: EditSection[] = (p.sections || [])
      .filter((s) => s.key !== 'skill' && s.key !== 'summary')
      .map((s) => {
        const key = normalizeSectionKey(s.key, s.title);
        const own = byKey[key];
        if (own) return { ...own, key, images: own.images || [] };
        return {
          key,
          title: s.title || sectionDef(key).title,
          items: [emptyItem()],
          images: []
        };
      });
    // 用户自建、模板里没有的模块照样保留（绝不丢内容）
    const known: Record<string, boolean> = {};
    merged.forEach((s) => { known[s.key] = true; });
    mine.forEach((s) => { if (!known[s.key]) merged.push({ ...s, images: s.images || [] }); });

    this.setData({ sections: merged, showTemplates: false }, () => {
      this.persist();
      this.refreshIntelligence();
      toast(`已按「${t.title}」重组结构，你的内容都还在`);
    });
  },

  /** 套用模板：把模板骨架反向填回表单（silent 用于首次进入，不弹 toast） */
  applyTemplate(t: ResumeTemplate, silent?: boolean): void {
    const p = t.profile;
    // 把模板骨架反向填回表单。
    // 不再硬编码只取 edu/intern/proj：模板有什么模块就填什么模块，并**保留模板原标题**
    // （算法模板的「研究与项目」不会被改写成「项目经历」），key 走注册表归一。
    // 技能 / 自我评价是表单顶层字段，单独回填，不重复进 sections。
    const sections: EditSection[] = (p.sections || [])
      .filter((s) => s && ((s.items && s.items.length) || s.text))
      .map((s): EditSection | null => {
        const key = normalizeSectionKey(s.key, s.title);
        if (key === 'skill' || key === 'summary') return null;
        return {
          key,
          title: s.title || sectionDef(key).title,
          items: (s.items || []).map((it) => ({
            primary: it.primary || '', secondary: it.secondary || '', meta: it.meta || '',
            bullets: (it.bullets || []).join('\n')
          })),
          images: []
        };
      })
      .filter((x): x is EditSection => !!x);
    const skillSec = p.sections.find((s) => normalizeSectionKey(s.key, s.title) === 'skill');
    const sumSec = p.sections.find((s) => normalizeSectionKey(s.key, s.title) === 'summary');

    this.setData({
      name: p.name, headline: p.headline, contacts: (p.contacts || []).join('\n'),
      skills: skillSec ? skillSec.text || '' : '',
      summary: sumSec ? sumSec.text || '' : '',
      sections: sections.length ? sections.map((s) => ({ ...s, images: [] })) : defaultSections(),
      photo: null,
      showTemplates: false
    }, () => {
      this.persist();
      this.refreshIntelligence();
      if (!silent) toast(`已套用「${t.title}」，请替换成你的真实信息`);
    });
  },

  /* ---------- AI 补充润色 ---------- */
  /**
   * 把草稿 + 求职意向发给云函数 resume（action=enhance，智谱 GLM），
   * 由 AI 把简略的要点扩充成「量化结果 + 专业措辞」的完整简历内容，再回填表单。
   * 无 Key / 出错时保持原内容，仅提示，不影响后续手动生成。
   */
  async enhance() {
    if (this.data.enhancing) return;
    const d = this.data;
    if (!d.name.trim() && !d.headline.trim()) {
      toast('请先填写姓名或求职意向，AI 才知道往哪个方向补充');
      return;
    }
    this.setData({ enhancing: true });
    wx.showLoading({ title: 'AI 补充中…', mask: true });
    try {
      const profile = draftToProfile(this.currentDraft());
      // 把目标岗位与 JD 关键词一并交给模型：让它按岗位调整措辞侧重点（不改变任何事实）
      const g = currentGoal();
      const job = smartJobOf();
      const r = await callFn<{
        success?: boolean; error?: string;
        profile?: {
          name?: string; headline?: string; salary?: string; city?: string;
          contacts?: string; skills?: string; summary?: string;
          sections?: Array<{ key?: string; title?: string; items?: Array<{ primary?: string; secondary?: string; meta?: string; bullets?: string[] }> }>;
        };
      }>('resume', {
        action: 'enhance',
        lang: this.data.lang,
        profile: {
          name: profile.name,
          headline: profile.headline,
          salary: d.salary,
          city: d.city,
          contacts: profile.contacts,
          sections: profile.sections
        },
        job: {
          target: job.target || g.target || '',
          keywords: (job.keywords || []).slice(0, 12),
          // 命中的关键词告诉模型「往哪个方向靠」，缺失的告诉它「别硬凑，也不要凭空造」
          hits: (this.data.match ? this.data.match.hits : []).slice(0, 8).map((h) => h.word),
          gaps: (this.data.match ? this.data.match.gaps : []).slice(0, 8)
        }
      });
      if (!r || r.success === false) {
        throw new Error((r && r.error) || 'AI 补充失败');
      }
      const e = r.profile || {};
      // AI 返回的 sections 顺序不可信（曾出现把英文/技能段排到最前面），
      // 回填前强制走确定性排序：教育背景 → 实习 → 项目 → 其它
      // 同时**保留用户已上传的模块图片**（AI 不产出图片，按 key 回灌）
      const prevImages: Record<string, ResumeImage[]> = {};
      (d.sections || []).forEach((s) => { if (s.images && s.images.length) prevImages[s.key] = s.images; });
      const backSections: EditSection[] = sortSectionsCanonical(
        (e.sections && e.sections.length)
          ? e.sections.map((s) => ({
              key: s.key || 'custom',
              title: s.title || '经历',
              items: (s.items || []).map((it) => ({
                primary: it.primary || '',
                secondary: it.secondary || '',
                meta: it.meta || '',
                bullets: (it.bullets || []).join('\n')
              })),
              images: (s.key && prevImages[s.key]) ? prevImages[s.key] : []
            }))
          : d.sections.map((s) => ({ ...s, images: s.images || [] }))
      );

      this.setData({
        name: e.name || d.name,
        headline: e.headline || d.headline,
        salary: e.salary || d.salary,
        city: e.city || d.city,
        contacts: e.contacts || d.contacts,
        skills: e.skills || d.skills,
        summary: e.summary || d.summary,
        sections: backSections,
        photo: d.photo || null
      }, () => { this.persist(); this.refreshIntelligence(); });

      wx.hideLoading();
      this.setData({
        enhancing: false,
        tip: 'AI 已按目标岗位提炼润色，内容都在下方表单里 —— 逐条核对后再生成 PDF'
      });
      toast('已提炼润色，核对后再生成 PDF');
    } catch (err) {
      wx.hideLoading();
      this.setData({ enhancing: false });
      console.error('[resume] enhance fail:', err);
      const msg = (err && (err as Error).message) || 'AI 补充失败';
      wx.showModal({
        title: '补充说明',
        content: `${msg}\n（已保留你填写的内容，可稍后重试，或直接点「生成 PDF」）`,
        showCancel: false
      });
    }
  },

  /* ---------- 生成 PDF ---------- */
  async generate() {
    if (this.data.generating) return;
    const d = this.data;
    // 姓名是 PDF 页眉的唯一必填项：错误直接挂在字段上，比只弹 toast 更好定位
    if (!d.name.trim()) {
      this.setData({ nameErr: true });
      toast('请先填写姓名');
      return;
    }
    if (this.data.nameErr) this.setData({ nameErr: false });

    // 生成链路：草稿 → 容错清洗 → 岗位自适应编排 → canvas 排版 → PDF
    const raw = draftToProfile(this.currentDraft());
    // ① 容错清洗：剔除占位符（XX 大学 / ____ / 此处填写…）与空壳模块，模板痕迹绝不进 PDF
    const clean = sanitizeProfile(raw);
    if (!clean.sections.length && raw.sections.length) {
      toast('检测到内容还是模板占位，请替换成真实经历'); return;
    }
    // ② 智能重排：按岗位关键词把最相关的经历与要点顶到前面（只排序，不改写）
    const job = smartJobOf();
    const arranged = smartArrange(clean, { target: job.target, keywords: job.keywords });
    // ③ 自适应编排：按目标岗位与资历重排模块顺序、按 JD 相关度取舍要点、压住篇幅
    const goal = currentGoal();
    const ctx: JobContext = { target: job.target || goal.target || '', keywords: job.keywords || [], has: !!job.target };
    const adapted = adaptProfile(arranged.sections.length ? { ...clean, sections: arranged.sections } : clean, ctx, budgetOfLayout(d.layout));
    const profile = adapted.profile;
    if (profile.sections.length === 0) {
      toast('至少填写一段经历，或填写技能 / 自我评价'); return;
    }
    const allNotes = arranged.notes.concat(adapted.notes);
    if (allNotes.length) console.log('[resume] 智能编排：', allNotes.join('；'));

    this.setData({ generating: true });
    wx.showLoading({ title: '排版中…', mask: true });

    // 分步计时日志：出问题时能一眼看出卡在第几步，不用猜
    const t0 = Date.now();
    const step = (s: string) => console.log(`[resume] ${s} (+${Date.now() - t0}ms)`);

    // 首页图：PDF 链路失败时兜底存相册，保证用户至少能拿到简历
    let firstTemp = '';

    try {
      // 1) 取 canvas 节点（真机安全重试：基础库旧版本/部分 Android 机型刚 select 到的节点 .node 为空）
      step('取 canvas 节点');
      let canvasNode: any = null;
      for (let attempt = 0; attempt < 3 && !canvasNode; attempt++) {
        canvasNode = await new Promise<any>((resolve) => {
          wx.createSelectorQuery().select('#resumeCv').fields({ node: true, size: true }).exec((res: any) => {
            resolve(res && res[0] && res[0].node ? res[0].node : null);
          });
        });
        if (!canvasNode) {
          await new Promise<void>((ok) => setTimeout(ok as unknown as () => void, 60));
        }
      }
      if (!canvasNode) throw new Error('canvas 节点获取失败（请回到首页重试）');
      const ctx = canvasNode.getContext('2d');
      if (!ctx) throw new Error('canvas 2d 上下文获取失败');

      const dpr = (wx.getSystemInfoSync().pixelRatio as number) || 2;
      canvasNode.width = Math.round(PAGE_W * dpr);
      canvasNode.height = Math.round(PAGE_H * dpr);
      // 赋值尺寸后等待 GPU 完成一次渲染帧，真机上避免 canvas 拿到但像素缓存全空
      await new Promise<void>((ok) => setTimeout(ok as unknown as () => void, 20));
      ctx.scale(dpr, dpr);
      step(`canvas 就绪 dpr=${dpr} → ${canvasNode.width}x${canvasNode.height}`);

      // 1.5) 预加载所有图片（证件照 + 各模块图片）为可绘制对象
      const loaded: Record<string, LoadedImage> = {};
      const defs: { id: string; path: string }[] = [];
      if (this.data.photo && this.data.photo.path) defs.push({ id: this.data.photo.id, path: this.data.photo.path });
      (this.data.sections || []).forEach((sec) => (sec.images || []).forEach((im) => defs.push({ id: im.id, path: im.path })));
      if (defs.length) {
        await Promise.all(defs.map(({ id, path }) => new Promise<void>((resolve) => {
          loadCanvasImage(canvasNode, path).then((li) => { loaded[id] = li; resolve(); })
            .catch((e) => { console.warn('[resume] 图片加载失败（将画占位块）', id, e); resolve(); });
        })));
      }
      step(`图片预加载完成 ${Object.keys(loaded).length}/${defs.length}`);

      // 2) 排版（测量 → 自动分页）；版式由「PDF 版式」选择决定
      const hasPhoto = !!(this.data.photo && this.data.photo.path);
      const { measured, pages } = layout(ctx as any, profile, this.data.layout, hasPhoto);
      step(`排版完成，共 ${pages.length} 页`);
      wx.showLoading({ title: `渲染 ${pages.length} 页…`, mask: true });

      // 选中的配色主题（默认经典蓝）
      const th: ResumeTheme = RESUME_THEMES[this.data.themeIdx] || RESUME_THEMES[0];

      // 3) 逐页绘制并导出到本地临时文件
      const photoImg = this.data.photo ? loaded[this.data.photo.id] : undefined;
      const photoCap = this.data.photo ? this.data.photo.caption : undefined;
      // 续页页眉 / 页脚署名：多页时第 2 页起也能看出这是谁的简历
      const runHead = [this.data.name, this.data.headline].filter(Boolean).join(' · ');
      const tempFiles: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        drawPage(ctx as any, measured, pages[i], i + 1, pages.length, th, this.data.layout, photoImg, photoCap, loaded, runHead);
        const fp = await canvasToTemp(canvasNode);
        if (!fp) throw new Error(`第 ${i + 1} 页导出失败（canvas 未渲染出内容）`);
        if (i === 0) firstTemp = fp;
        tempFiles.push(fp);
        step(`第 ${i + 1}/${pages.length} 页导出成功`);
      }

      // 3.1) 上传页图（只有云端链路需要）。
      // 上传失败（云存储不可用 / 未初始化）不致命 —— 放弃云端，走下面的本地拼装，
      // 否则「云存储一挂就整份简历生成不出来」。
      const fileIDs: string[] = [];
      for (let i = 0; i < tempFiles.length; i++) {
        try {
          fileIDs.push(await uploadAttachImage(tempFiles[i]));
          step(`第 ${i + 1}/${pages.length} 页上传成功`);
        } catch (e) {
          console.warn('[resume] 页图上传失败，放弃云端链路：', (e && (e as Error).message) || e);
          fileIDs.length = 0;
          break;
        }
      }

      // 4) 先本地拼装 PDF（纯本地字节组装，毫秒级、零网络依赖）——
      // 本地路径是唯一可靠的打开锚点；云端 fileID 只作为转发/分享的附加能力。
      // ⚠️ 真机上用 openDocument({fileID}) 打开云文件要先下载，下载一失败就会报
      // 「parameter.filePath should be String instead of Undefined」这种误导性错误
      // （手机端实际发生过），所以打开永远走本地文件，云端只用于分享。
      wx.showLoading({ title: '生成 PDF…', mask: true });
      step('本地拼装 PDF');
      const localPath = buildPdfLocal(tempFiles);

      // 4.1) 云端副本：成功则拿到 cloud:// 便于转发，失败不影响本次生成
      let cloudFileId = '';
      let cloudPages = pages.length;
      if (fileIDs.length === tempFiles.length) {
        try {
          step(`调用云函数 resume/pdf（${fileIDs.length} 张页图）`);
          const r = await callFn<{ success?: boolean; fileID?: string; pages?: number; error?: string }>('resume', {
            action: 'pdf', fileIDs
          });
          if (r && r.success !== false && r.fileID) {
            cloudFileId = r.fileID;
            cloudPages = r.pages || pages.length;
            step(`云端 PDF 成功 ${r.fileID}`);
          } else {
            console.warn('[resume] 云端 PDF 返回失败：', r && r.error);
          }
        } catch (e) {
          console.warn('[resume] 云端 PDF 不可用，仅用本地版本：', (e && (e as Error).message) || e);
        }
      }

      // 把智能编排做了什么一并告诉用户（透明）：篇幅被压缩 / 要点被裁剪都要说清楚
      const noteText = allNotes.length ? ` · ${allNotes[0]}` : '';
      this.setData({
        pdfPath: localPath,
        pdfFileId: cloudFileId,
        tip: `已生成 ${cloudPages} 页 PDF${cloudFileId ? '（含云端副本，可转发）' : '（本地生成）'}${noteText}`
      });
      wx.hideLoading();
      this.setData({ generating: false });
      this.openPdfLocal(localPath);
    } catch (err) {
      wx.hideLoading();
      this.setData({ generating: false });
      const msg = (err && (err as Error).message) || '请稍后重试';
      console.error('[resume] generate fail:', err);

      // 页已经画出来了，只是 PDF 链路不通 → 兜底把首页存到相册，不让用户白等
      if (firstTemp) {
        wx.showModal({
          title: '生成失败',
          content: `${msg}\n\n已排好版的简历图片可以先存到相册吗？`,
          confirmText: '存到相册',
          cancelText: '关闭',
          success: (res) => { if (res.confirm) this.saveImage(firstTemp); }
        });
        return;
      }
      wx.showModal({ title: '生成失败', content: msg, showCancel: false });
    }
  },

  /** 兜底：把已排好版的简历页存到相册 */
  saveImage(filePath: string) {
    // 旧版类型声明缺 saveImageToPhotosAlbum，用 as any 兼容真实存在的 API
    (wx as any).saveImageToPhotosAlbum({
      filePath,
      success: () => toast('已保存到相册'),
      fail: (e: any) => {
        wx.showModal({
          title: '保存失败',
          content: (e && e.errMsg) || '无法保存到相册，请检查相册权限',
          showCancel: false
        });
      }
    });
  },

  openPdf(fileId?: string) {
    const fid = fileId || this.data.pdfFileId;
    if (!fid) { toast('请先生成 PDF'); return; }
    // 旧版类型声明缺 openDocument，用 as any 兼容真实存在的 API
    (wx as any).openDocument({
      fileID: fid,
      fileType: 'pdf',
      showMenu: true,
      success: () => {},
      fail: (e) => {
        // 云文件打不开（下载失败/文件损坏）→ 本地有兜底版本就直接打开，不让用户卡死
        if (this.data.pdfPath) {
          console.warn('[resume] 云端 PDF 打开失败，降级本地版本：', e && e.errMsg);
          this.openPdfLocal();
          return;
        }
        // 云端文件在真机上下载失败时报的是误导性的 filePath 错误，翻译成人话并给出出路
        const raw = (e && e.errMsg) || '';
        wx.showModal({
          title: '打开失败',
          content: `云端简历副本下载失败${raw ? `（${raw}）` : ''}。\n请重新点「生成 PDF」，本地会立刻生成可直接打开的版本。`,
          showCancel: false
        });
      }
    });
  },

  /** 打开本地拼装的 PDF（filePath 形式，非云文件） */
  openPdfLocal(filePath?: string) {
    const p = filePath || this.data.pdfPath;
    if (!p) { toast('请先生成 PDF'); return; }
    // 打开前校验文件真实存在且非空：临时文件可能被系统回收，
    // 直接 openDocument 会报「filePath should be String instead of Undefined」这种看不出原因的错
    try {
      const fs = wx.getFileSystemManager() as any;
      const stat = fs.statSync(p) as { size: number };
      if (!stat || !stat.size) throw new Error('empty');
    } catch (e) {
      this.setData({ pdfPath: '' });
      wx.showModal({
        title: '文件已失效',
        content: '本地 PDF 已被系统清理，请重新点「生成 PDF」',
        showCancel: false
      });
      return;
    }
    // 旧版类型声明缺 openDocument 的 filePath 用法，用 as any 兼容
    (wx as any).openDocument({
      filePath: p,
      fileType: 'pdf',
      showMenu: true,
      success: () => {},
      fail: (e: any) => {
        wx.showModal({
          title: '打开失败',
          content: (e && e.errMsg) || '无法预览 PDF',
          showCancel: false
        });
      }
    });
  },

  onOpenPdf() {
    // 本地文件打开零下载、最可靠；云端副本只用于转发分享
    if (this.data.pdfPath) { this.openPdfLocal(); return; }
    if (this.data.pdfFileId) { this.openPdf(); return; }
    toast('请先生成 PDF');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '我的简历 · 秋招助手', path: '/subpackages/recruit/pages/recruit/resume' };
  }
});
