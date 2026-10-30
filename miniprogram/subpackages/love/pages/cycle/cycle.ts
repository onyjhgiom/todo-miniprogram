// pages/love/cycle/cycle.ts
// 自在养护：经期 / 皮肤 / 头发 / 身体 四个板块
//
// 为什么把健康四件事放在一起：它们是同一套激素节律下的四个表现。
//  黄体期皮肤爆痘、经期头发油得快、身体水肿——分开看是四件事，合起来是一个周期。
//  页面顶部那条「今天该照顾自己什么」就是把这个关联直接讲给用户听。
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import {
  loadPeriods, startPeriod, endPeriod, removePeriod, upsertPeriod,
  getCycleSettings, setCycleSettings, todayYmd, weekdayCn, addDays,
  getSkinProfile, setSkinProfile, getHairProfile, setHairProfile,
  getBodyProfile, setBodyProfile, loadCareChecks, markCareCheck, onTopic
} from '../../utils/love-store';
import {
  analyze, phaseAdvice, painPlan, buildReminder, SYMPTOM_TAGS, MOOD_TAGS
} from '../../utils/love-cycle';
import type { PhaseAdvice, CycleAnalysis } from '../../utils/love-cycle';
import { skinPlan, hairPlan, bodyPlan, careReminders } from '../../utils/love-care';
import type { SkinPlan, HairPlan, BodyPlan, DecoCheck } from '../../utils/love-care';
import { requestSubscribe, grantSubscription, pushReminder, SUB_TMPL_ID, clip } from '../../../../utils/subscribe';
import { addDay } from '../../../../utils/important-day-store';
import type { PeriodRecord, CycleSettings, SkinProfile, HairProfile, SkinType, ScalpType } from '../../utils/love-types';

type TabKey = 'cycle' | 'skin' | 'hair' | 'body';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'cycle', label: '🌹 经期' },
  { key: 'skin', label: '🧴 皮肤' },
  { key: 'hair', label: '💇 头发' },
  { key: 'body', label: '🫧 身体' }
];

interface DecoRecord extends PeriodRecord {
  lenText: string;
  painText: string;
}

interface CycleData {
  skin: SkinView;
  tabs: { key: TabKey; label: string }[];
  tab: TabKey;

  /* 经期 */
  cyc: CycleAnalysis;
  remTitle: string;
  remDesc: string;
  remDue: boolean;
  advice: PhaseAdvice;
  records: DecoRecord[];
  settings: CycleSettings;
  pain: number;
  planTitle: string;
  planSteps: string[];
  redFlags: string[];
  showForm: boolean;
  formStart: string;
  formEnd: string;
  formFlow: string;
  formPain: number;
  formMoods: string[];
  formSymptoms: string[];
  formNote: string;
  symptomTags: string[];
  moodTags: string[];
  flowTags: string[];

  /* 皮肤 */
  skinPlan: SkinPlan;
  skinTypeTags: string[];
  skinConcernTags: string[];
  sunTags: string[];

  /* 头发 */
  hairPlan: HairPlan;
  scalpTags: string[];
  hairConcernTags: string[];
  damageTags: string[];

  /* 身体 */
  bodyPlan: BodyPlan;
  bodyConcernTags: string[];
  checks: DecoCheck[];

  /** 档案当前值（用于标签选中态回显） */
  skinTypeVal: string;
  skinConcerns: string[];
  sunVal: string;
  scalpVal: string;
  hairConcerns: string[];
  damageVal: string;
  bodyConcerns: string[];
  bodyKp: boolean;
  bodyBack: boolean;
}

const PAIN_TEXT = ['无痛', '轻微', '明显', '剧烈'];
const FLOW_TAGS = ['light', 'normal', 'heavy'];
const FLOW_LABEL: Record<string, string> = { light: '偏少', normal: '正常', heavy: '偏多' };
const SKIN_TYPES = ['dry', 'oil', 'comb', 'sensitive', 'normal'];
const SKIN_TYPE_LABEL: Record<string, string> = { dry: '干皮', oil: '油皮', comb: '混合皮', sensitive: '敏感肌', normal: '中性皮' };
const SKIN_CONCERNS = ['美白提亮', '抗痘祛痘', '淡印去印', '抗老紧致', '保湿补水', '收缩毛孔', '舒缓修护', '控油'];
const SUN_TAGS = ['indoor', 'normal', 'outdoor'];
const SUN_LABEL: Record<string, string> = { indoor: '室内为主', normal: '正常通勤', outdoor: '户外多' };
const SCALP_TAGS = ['oil', 'dry', 'sensitive', 'dandruff', 'normal'];
const SCALP_LABEL: Record<string, string> = { oil: '油性', dry: '干性', sensitive: '敏感', dandruff: '有头屑', normal: '中性' };
const HAIR_CONCERNS = ['油塌', '毛躁', '脱发', '头屑', '分叉', '头顶稀疏', '染烫修复'];
const DAMAGE_TAGS = ['none', 'color', 'perm', 'both'];
const DAMAGE_LABEL: Record<string, string> = { none: '无烫染', color: '染过', perm: '烫过', both: '烫+染' };
const BODY_CONCERNS = ['手足护理', '私处护理', '口气牙齿'];

Page<CycleData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    tabs: TABS,
    tab: 'cycle',
    cyc: {} as CycleAnalysis,
    remTitle: '', remDesc: '', remDue: false,
    advice: {} as PhaseAdvice,
    records: [],
    settings: {} as CycleSettings,
    pain: 0, planTitle: '', planSteps: [], redFlags: [],
    showForm: false,
    formStart: '', formEnd: '', formFlow: 'normal', formPain: 0,
    formMoods: [], formSymptoms: [], formNote: '',
    symptomTags: SYMPTOM_TAGS, moodTags: MOOD_TAGS, flowTags: FLOW_TAGS,
    skinPlan: {} as SkinPlan,
    skinTypeTags: SKIN_TYPES, skinConcernTags: SKIN_CONCERNS, sunTags: SUN_TAGS,
    hairPlan: {} as HairPlan,
    scalpTags: SCALP_TAGS, hairConcernTags: HAIR_CONCERNS, damageTags: DAMAGE_TAGS,
    bodyPlan: {} as BodyPlan,
    bodyConcernTags: BODY_CONCERNS,
    checks: [],
    skinTypeVal: 'comb',
    skinConcerns: [],
    sunVal: 'normal',
    scalpVal: 'normal',
    hairConcerns: [],
    damageVal: 'none',
    bodyConcerns: [],
    bodyKp: false,
    bodyBack: false
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.unsubData = onTopic('cycle', () => this.refresh());
    this.refresh();
  },

  onUnload() {
    if (this.unsub) this.unsub();
    if (this.unsubData) this.unsubData();
  },

  onShow() {
    this.setData({ skin: applySkin() });
  },

  unsub: null as (() => void) | null,
  unsubData: null as (() => void) | null,

  refresh() {
    const cyc = analyze();
    const rem = buildReminder();
    const adv = phaseAdvice(cyc.phase);
    const list = loadPeriods().map((r) => ({
      ...r,
      lenText: r.end ? `第 1–${Math.max(1, Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000) + 1)} 天` : '进行中',
      painText: PAIN_TEXT[r.pain || 0]
    }));
    const sp = getSkinProfile();
    const hp = getHairProfile();
    const bp = getBodyProfile();
    const pain = this.data.pain || 0;
    const plan = painPlan(pain);

    this.setData({
      cyc, remTitle: rem.title, remDesc: rem.desc, remDue: rem.due,
      advice: adv, records: list, settings: getCycleSettings(),
      planTitle: plan.title, planSteps: plan.steps, redFlags: plan.redFlags,
      skinPlan: skinPlan(sp), hairPlan: hairPlan(hp), bodyPlan: bodyPlan(bp),
      checks: careReminders(),
      skinTypeVal: sp.type || 'comb',
      skinConcerns: sp.concerns || [],
      sunVal: sp.sun || 'normal',
      scalpVal: hp.scalp || 'normal',
      hairConcerns: hp.concerns || [],
      damageVal: hp.damage || 'none',
      bodyConcerns: bp.concerns || [],
      bodyKp: !!bp.kp,
      bodyBack: !!bp.backAcne
    });
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TabKey;
    if (!key || key === this.data.tab) return;
    this.setData({ tab: key });
  },

  /* ============================ 经期记录 ============================ */

  onToggleForm() {
    if (!guardTap('form', 400)) return;
    const show = !this.data.showForm;
    this.setData({
      showForm: show,
      formStart: show ? todayYmd() : '',
      formEnd: '', formFlow: 'normal', formPain: 0,
      formMoods: [], formSymptoms: [], formNote: ''
    });
  },

  onPickStart(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formStart: e.detail.value as string });
  },

  onPickEnd(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formEnd: e.detail.value as string });
  },

  onFlow(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formFlow: e.currentTarget.dataset.v as string });
  },

  onFormPain(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formPain: Number(e.currentTarget.dataset.v) || 0 });
  },

  onToggleTag(e: WechatMiniprogram.TouchEvent) {
    const field = e.currentTarget.dataset.f as string;
    const v = e.currentTarget.dataset.v as string;
    if (!field) return;
    const cur = (this.data as unknown as Record<string, string[]>)[field] || [];
    const next = cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]);
    this.setData({ [field]: next } as unknown as Partial<CycleData>);
  },

  onNote(e: WechatMiniprogram.InputEvent) {
    this.setData({ formNote: e.detail.value });
  },

  onSavePeriod() {
    if (!guardTap('save', 600)) return;
    const d = this.data;
    if (!d.formStart) { toast('先选一个开始日期'); return; }
    const list = loadPeriods();
    const exist = list.find((x) => x.start === d.formStart);
    const rec: PeriodRecord = exist ? { ...exist } : {
      id: '', start: d.formStart, end: '', flow: 'normal', pain: 0, moods: [], symptoms: [], note: '', createTime: Date.now()
    };
    rec.start = d.formStart;
    rec.end = d.formEnd || '';
    rec.flow = (d.formFlow || 'normal') as PeriodRecord['flow'];
    rec.pain = d.formPain || 0;
    rec.moods = d.formMoods || [];
    rec.symptoms = d.formSymptoms || [];
    rec.note = d.formNote || '';
    if (!rec.id) {
      rec.id = 'pd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      startPeriod(d.formStart);
      const created = loadPeriods().find((x) => x.start === d.formStart);
      if (created) {
        upsertPeriod({ ...created, ...rec, id: created.id });
      }
    } else {
      upsertPeriod(rec);
    }
    this.setData({ showForm: false });
    toast('已记录');
    this.refresh();
  },

  /** 今天来了 / 今天结束 —— 最常用的两个动作做成一键 */
  onStartToday() {
    if (!guardTap('start_today', 800)) return;
    startPeriod(todayYmd());
    toast('已记录今天开始');
    this.refresh();
  },

  onEndToday() {
    if (!guardTap('end_today', 800)) return;
    if (!endPeriod(todayYmd())) { toast('当前没有进行中的经期'); return; }
    toast('已记录今天结束');
    this.refresh();
  },

  onDelRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('删除这条经期记录？周期预测会重新计算。', () => {
      removePeriod(id);
      this.refresh();
    });
  },

  /* ============================ 痛经 ============================ */

  onPain(e: WechatMiniprogram.TouchEvent) {
    const v = Number(e.currentTarget.dataset.v) || 0;
    const plan = painPlan(v);
    this.setData({ pain: v, planTitle: plan.title, planSteps: plan.steps, redFlags: plan.redFlags });
  },

  /* ============================ 提醒设置 ============================ */

  onRemindBefore(e: WechatMiniprogram.TouchEvent) {
    const v = Number(e.currentTarget.dataset.v) || 3;
    setCycleSettings({ remindBefore: v });
    this.refresh();
  },

  onToggleNotify() {
    const s = this.data.settings;
    if (s.notify) {
      setCycleSettings({ notify: false });
      this.refresh();
      return;
    }
    // 开启：先要授权，授权成功才置位——避免「开关开着但永远收不到」
    requestSubscribe(SUB_TMPL_ID).then((st) => {
      if (st === 'accept') {
        grantSubscription(SUB_TMPL_ID);
        setCycleSettings({ notify: true, subscribed: true });
        toast('已开启微信通知');
      } else {
        setCycleSettings({ notify: false, subscribed: false });
        toast('未授权，改用页面内提醒');
      }
      this.refresh();
    });
  },

  /** 命中提醒条件时立即下发一条微信通知 */
  onPushNow() {
    if (!guardTap('push', 1500)) return;
    const cyc = this.data.cyc;
    if (!cyc.hasData) { toast('先记录一次经期'); return; }
    if (!this.data.settings.subscribed) { toast('请先开启微信通知'); return; }
    pushReminder({
      tmplId: SUB_TMPL_ID,
      title: clip(this.data.remTitle || '经期提醒', 20),
      desc: clip(this.data.remDesc || '', 40),
      at: Date.now(),
      page: 'subpackages/love/pages/cycle/cycle'
    }).then((r) => {
      toast(r.ok ? '已推送' : '推送失败，请检查授权');
    });
  },

  /** 把下次经期写进「重要日」，首页就能看到倒计时 */
  onAddImportantDay() {
    if (!guardTap('imp', 1000)) return;
    const cyc = this.data.cyc;
    if (!cyc.nextStart) { toast('先记录一次经期'); return; }
    addDay({
      id: 'imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '经期预计',
      date: cyc.nextStart,
      yearly: false,
      category: '其他',
      note: `预计 ${cyc.nextStart}（${weekdayCn(cyc.nextStart)}）`,
      createTime: Date.now(),
      updateTime: Date.now()
    });
    toast('已加入重要日');
  },

  /* ============================ 皮肤 / 头发 / 身体 档案 ============================ */

  onSkinType(e: WechatMiniprogram.TouchEvent) {
    setSkinProfile({ type: e.currentTarget.dataset.v as SkinType });
    this.refresh();
  },

  onSkinConcern(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const cur = getSkinProfile().concerns || [];
    const next = cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]);
    setSkinProfile({ concerns: next.slice(0, 3) });
    this.refresh();
  },

  onSun(e: WechatMiniprogram.TouchEvent) {
    setSkinProfile({ sun: e.currentTarget.dataset.v as SkinProfile['sun'] });
    this.refresh();
  },

  onScalp(e: WechatMiniprogram.TouchEvent) {
    setHairProfile({ scalp: e.currentTarget.dataset.v as ScalpType });
    this.refresh();
  },

  onHairConcern(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const cur = getHairProfile().concerns || [];
    const next = cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]);
    setHairProfile({ concerns: next.slice(0, 3) });
    this.refresh();
  },

  onDamage(e: WechatMiniprogram.TouchEvent) {
    setHairProfile({ damage: e.currentTarget.dataset.v as HairProfile['damage'] });
    this.refresh();
  },

  onBodyConcern(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const cur = getBodyProfile().concerns || [];
    const next = cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]);
    setBodyProfile({ concerns: next });
    this.refresh();
  },

  onToggleBodyFlag(e: WechatMiniprogram.TouchEvent) {
    const f = e.currentTarget.dataset.f as string;
    const b = getBodyProfile();
    if (f === 'kp') setBodyProfile({ kp: !b.kp });
    else if (f === 'backAcne') setBodyProfile({ backAcne: !b.backAcne });
    this.refresh();
  },

  onMarkCheck(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    markCareCheck(key);
    toast('已记录，下次时间已顺延');
    this.refresh();
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '自在养护 · 经期皮肤头发身体一本账', path: '/subpackages/love/pages/cycle/cycle' };
  }
});
