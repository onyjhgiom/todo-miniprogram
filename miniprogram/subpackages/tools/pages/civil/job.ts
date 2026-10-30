// pages/civil/job.ts
// 岗位详情页：编制高亮 + 硬性条件 + 招录时间 + 🎯 备战指南（重心/节奏/阶段/能力/避坑）+ 同赛道岗位
// 页内只做展示与拼装，所有规则计算都复用 civil-strategy 的 buildCivilGuide（离线可用）
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import { toast } from '../../../../utils/cloud';
import type { ThemeKey } from '../../../../types/index';
import { jobById, jobsOfTrack, trackOf, compileOf, compileTone, difficultyLabel, hexA } from '../../utils/civil-data';
import type { CivilJob, ApplyPortal } from '../../utils/civil-data';
import { buildCivilGuide, guideToText } from '../../utils/civil-strategy';
import type { CivilGuide } from '../../utils/civil-strategy';

const FRESH_CN: Record<string, string> = { only: '仅限应届', prefer: '应届优先', no: '不限应届' };
const PARTY_CN = (b: boolean) => (b ? '要求党员' : '不限政治面貌');

interface MetaRow {
  icon: string;
  label: string;
  value: string;
  /** 高亮（应届 / 党员这类影响报考资格的行用） */
  hi: boolean;
}

interface RelationRow {
  id: string;
  title: string;
  unit: string;
  compileShort: string;
  tone: string;
  hasBian: boolean;
  stars: string;
}

interface JobData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  found: boolean;
  id: string;
  title: string;
  unit: string;
  /* 编制 */
  compileLabel: string;
  compileShort: string;
  compileDesc: string;
  compilePhrase: string;
  tone: string;
  hasBian: boolean;
  compileWarning: string;
  /* 赛道 */
  trackName: string;
  trackShort: string;
  trackIcon: string;
  trackColor: string;
  trackSoft: string;
  /* 硬条件 */
  meta: MetaRow[];
  salary: string;
  ratio: string;
  difficulty: number;
  stars: string;
  diffLabel: string;
  /* 流程（来自赛道定义，按该岗位所处环节裁剪展示） */
  process: string[];
  /* 备战指南 */
  guide: CivilGuide | null;
  guideOpen: boolean;
  /* 同赛道 */
  relations: RelationRow[];
  /* 赛道通用策略入口 */
  trackKey: string;
  /* 官方报名入口（每个岗位必有） */
  apply: ApplyPortal | null;
  /** 本岗位在入口内的检索路径（检索式 + 筛选条件） */
  applyPath: string;
}

Page<JobData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    found: false,
    id: '',
    title: '',
    unit: '',
    compileLabel: '',
    compileShort: '',
    compileDesc: '',
    compilePhrase: '',
    tone: 'bian',
    hasBian: true,
    compileWarning: '',
    trackName: '',
    trackShort: '',
    trackIcon: '',
    trackColor: '#6d28d9',
    trackSoft: '',
    meta: [],
    salary: '',
    ratio: '',
    difficulty: 3,
    stars: '',
    diffLabel: '',
    process: [],
    guide: null,
    guideOpen: true,
    relations: [],
    trackKey: '',
    apply: null,
    applyPath: ''
  },

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const id = (q && q.id) || '';
    const job = jobById(id);
    if (!job) {
      this.setData({ found: false, id });
      return;
    }
    this.render(job);
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  render(job: CivilJob) {
    const c = compileOf(job.compile);
    const t = trackOf(job.track);
    const guide = buildCivilGuide(job, Date.now());

    const meta: MetaRow[] = [
      { icon: '🏢', label: '招录单位', value: job.unit, hi: false },
      { icon: '📍', label: '工作地区', value: job.region, hi: false },
      { icon: '🏛️', label: '单位层级', value: job.level, hi: false },
      { icon: '📚', label: '专业限制', value: job.majorLimit, hi: false },
      { icon: '🎓', label: '学历要求', value: job.education, hi: false },
      { icon: '🧑‍🎓', label: '应届要求', value: FRESH_CN[job.fresh] || '不限应届', hi: job.fresh !== 'no' },
      { icon: '🪪', label: '政治面貌', value: PARTY_CN(job.party), hi: job.party }
    ];
    if (job.industry) meta.splice(3, 0, { icon: '🏷️', label: '岗位行业', value: job.industry, hi: false });
    meta.push({ icon: '🧭', label: '岗位方向', value: job.direction, hi: false });

    const relations: RelationRow[] = jobsOfTrack(job.track)
      .filter((j) => j.id !== job.id)
      .sort((a, b) => b.difficulty - a.difficulty)
      .slice(0, 4)
      .map((j) => {
        const jc = compileOf(j.compile);
        return {
          id: j.id,
          title: j.title,
          unit: j.unit,
          compileShort: jc.short,
          tone: compileTone(j.compile),
          hasBian: jc.hasBian,
          stars: '★'.repeat(j.difficulty)
        };
      });

    this.setData({
      found: true,
      id: job.id,
      title: job.title,
      unit: job.unit,
      compileLabel: c.label,
      compileShort: c.short,
      compileDesc: c.desc,
      compilePhrase: c.hasBian ? '有编制' : '无编制',
      tone: compileTone(job.compile),
      hasBian: c.hasBian,
      compileWarning: c.warning,
      trackName: t.name,
      trackShort: t.short,
      trackIcon: t.icon,
      trackColor: t.color,
      trackSoft: hexA(t.color, 0.14),
      meta,
      salary: job.salary,
      ratio: job.ratio,
      difficulty: job.difficulty,
      stars: '★'.repeat(job.difficulty),
      diffLabel: difficultyLabel(job.difficulty),
      process: t.process,
      guide,
      relations,
      trackKey: job.track,
      apply: job.apply,
      applyPath: job.applyPath
    });

    // 项目类型定义未含该 API（与 folklore / guaxiang 页保持一致的处理方式）
    (wx as any).setNavigationBarTitle({ title: job.title });
  },

  onToggleGuide() {
    this.setData({ guideOpen: !this.data.guideOpen });
  },

  /** 复制该岗位的完整备战清单（纯文本，粘到备忘录就能用） */
  onCopy() {
    const d = this.data;
    if (!d.guide) return;
    const job = jobById(d.id);
    if (!job) return;
    wx.setClipboardData({
      data: guideToText(job, d.guide),
      success: () => toast('已复制该岗位备战清单')
    });
  },

  /**
   * 复制官方报名入口链接。
   * 小程序内无法直接跳转外部政府网站（受业务域名限制），
   * 与 recruit 模块一致：复制链接 → 用户粘贴到浏览器打开，既不违规也不失效。
   */
  onCopyApply() {
    const a = this.data.apply;
    if (!a || !a.url) {
      toast('该岗位暂无报名链接', 'none');
      return;
    }
    wx.setClipboardData({ data: a.url, success: () => toast('已复制报名入口，粘贴到浏览器打开') });
  },

  /**
   * 复制本岗位的「站内检索路径」。
   * 入口是体系级的，路径才是本岗位的定位方式——复制到备忘录，
   * 打开入口后照着这条路径检索即可找到对应职位。
   */
  onCopyPath() {
    const d = this.data;
    if (!d.applyPath) {
      toast('该岗位暂无检索路径', 'none');
      return;
    }
    const text = `岗位：${d.title}（${d.unit}）\n报名入口：${d.apply ? d.apply.name : ''}\n${d.apply ? d.apply.url : ''}\n站内定位：${d.applyPath}`;
    wx.setClipboardData({ data: text, success: () => toast('已复制岗位与检索路径') });
  },

  onTrack() {
    go(`/subpackages/tools/pages/civil/track?type=${this.data.trackKey}`, { loading: true });
  },

  onRelation(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (id === this.data.id) return;
    go(`/subpackages/tools/pages/civil/job?id=${id}`, { loading: true, force: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const d = this.data;
    return {
      title: `${d.title} · ${d.compilePhrase}${d.compileShort}｜仕途衡鉴`,
      path: `/subpackages/tools/pages/civil/job?id=${d.id}`
    };
  }
});
