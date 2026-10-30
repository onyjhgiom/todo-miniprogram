// utils/love-store.ts
// 爱遇小栈 · 数据层（本地优先 + 可选云端）
//
// 与全站其它 store 保持同一套约定：
//  · wx.storage 是唯一真相源，落盘即生效，云端只是第二份副本；
//  · 所有写入走这里，页面不直接碰 storage key；
//  · 极简事件总线做跨页刷新（从「回忆」页加了一条互动，能量站与首页立刻跟着变）。
import { get, set, uid } from '../../../utils/storage';
import type {
  PeriodRecord, CycleSettings, BeautyPrefs, WardrobePrefs, BudgetKey,
  Relation, PersonProfile, Interaction, Memory, GiftRecord,
  ShareState, ShareScope, LoveSnapshot, SkinKey,
  SkinProfile, HairProfile, BodyProfile, CareCheck,
  WardrobeItem, WardrobeCategory, PrepareItem
} from './love-types';
import { getCoreTheme, DEFAULT_CORE_THEME } from './love-core-themes';

/* ============================ 存储键 ============================ */
const K_CYCLE = 'love_cycle_records_v1';
const K_CYCLE_SET = 'love_cycle_settings_v1';
const K_SKIN_PROFILE = 'love_skin_profile_v1';
const K_HAIR_PROFILE = 'love_hair_profile_v1';
const K_BODY_PROFILE = 'love_body_profile_v1';
const K_CARE_CHECK = 'love_care_checks_v1';
const K_CLOSET = 'love_closet_v1';
const K_BEAUTY = 'love_beauty_prefs_v1';
const K_WARDROBE = 'love_wardrobe_prefs_v1';
const K_RELATION = 'love_relation_v1';
const K_INTER = 'love_interactions_v1';
const K_MEMORY = 'love_memories_v1';
const K_GIFT = 'love_gifts_v1';
const K_PREPARE = 'love_prepares_v1';
const K_SHARE = 'love_share_v1';
const K_SKIN = 'love_skin_v1';
/** 3D 水晶球视觉风格（与 K_SKIN 分开存，互不覆盖） */
const K_CORE_THEME = 'love_core_theme_v1';

/* ============================ 事件总线 ============================ */
type Topic = 'cycle' | 'beauty' | 'wardrobe' | 'relation' | 'interaction' | 'memory' | 'gift' | 'share' | 'skin' | 'prepare';
const listeners: Record<string, Array<() => void>> = {};

export function onTopic(topic: Topic, fn: () => void): () => void {
  if (!listeners[topic]) listeners[topic] = [];
  listeners[topic].push(fn);
  return () => {
    listeners[topic] = (listeners[topic] || []).filter((f) => f !== fn);
  };
}

function emit(...topics: Topic[]): void {
  topics.forEach((t) => {
    (listeners[t] || []).forEach((fn) => {
      try { fn(); } catch (e) { /* 单个订阅者出错不影响其它 */ }
    });
  });
}

/* ============================ 默认值 ============================ */

export function defaultCycleSettings(): CycleSettings {
  return { cycleLen: 28, periodLen: 5, lutealLen: 14, remindBefore: 3, remindHour: 9, notify: false, subscribed: false };
}

export function defaultBeauty(): BeautyPrefs {
  return { skin: 'comb', tone: 'medium', styles: ['奶杏日常'], occasions: ['通勤'], nailShape: '方圆', nailStyles: ['极简'], avoid: '' };
}

export function defaultWardrobe(): WardrobePrefs {
  return { styles: ['温柔韩系'], body: 'pear', height: 'average', budget: 'entry', monthly: 0, colors: ['奶油白', '雾霾蓝'], avoid: '' };
}

export function defaultPerson(): PersonProfile {
  return { nickname: '', birthday: '', city: '', zodiac: '', mbti: '', hobbies: [], words: '' };
}

export function defaultRelation(): Relation {
  return { togetherDate: '', story: '', me: defaultPerson(), him: defaultPerson() };
}

export function defaultShare(): ShareState {
  return {
    room: '', role: 'me', bound: false, lastSync: 0, cloudOn: false,
    scope: { relation: true, interaction: true, memory: true, gift: true, cycle: false },
    lastMsg: ''
  };
}

/* ============================ 皮肤 ============================ */

export function getSkinKey(): SkinKey {
  const v = get<string>(K_SKIN, 'peach');
  return (v || 'peach') as SkinKey;
}

export function setSkinKey(key: SkinKey): void {
  set(K_SKIN, key);
  emit('skin');
}

/* ==================== 3D 水晶球视觉风格（与皮肤相互独立） ====================
 * 皮肤（love-skin）改的是整页配色；水晶球风格（love-core-themes）改的是
 * 首页那颗 3D 球本身的配色 / 粒子 / 轨道 / 光效 / 动效节奏。
 * 两者互不覆盖：用户可以「粉色页面 + 暗夜金砂球」，也可以「星河紫梦页面 + 熔金球」。
 */

/** 读取当前水晶球风格；未设置或已失效时回落到默认（星河紫梦） */
export function getCoreThemeKey(): string {
  const v = get<string>(K_CORE_THEME, DEFAULT_CORE_THEME);
  // 兜底校验：主题库更新后旧的本地值可能已不存在
  if (!v || !getCoreTheme(v)) return DEFAULT_CORE_THEME;
  return v;
}

/** 切换水晶球风格；emit('skin') 让所有页面（含首页画布）同步刷新 */
export function setCoreThemeKey(key: string): void {
  if (!getCoreTheme(key)) return;          // 非法 key 直接忽略，避免写入脏数据
  if (key === getCoreThemeKey()) return;   // 没变就不写盘、不广播
  set(K_CORE_THEME, key);
  emit('skin');
}

/* ============================ 经期 ============================ */

export function loadPeriods(): PeriodRecord[] {
  const list = get<PeriodRecord[]>(K_CYCLE, []);
  return Array.isArray(list) ? list : [];
}

/** 写入（新增或更新）一次经期记录 */
export function upsertPeriod(rec: PeriodRecord): PeriodRecord[] {
  const list = loadPeriods();
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.unshift(rec);
  list.sort((a, b) => (a.start < b.start ? 1 : -1));
  set(K_CYCLE, list);
  emit('cycle');
  return list;
}

export function removePeriod(id: string): PeriodRecord[] {
  const list = loadPeriods().filter((x) => x.id !== id);
  set(K_CYCLE, list);
  emit('cycle');
  return list;
}

export function getCycleSettings(): CycleSettings {
  const s = get<CycleSettings>(K_CYCLE_SET, defaultCycleSettings());
  return { ...defaultCycleSettings(), ...(s || {}) };
}

export function setCycleSettings(patch: Partial<CycleSettings>): CycleSettings {
  const next = { ...getCycleSettings(), ...patch };
  set(K_CYCLE_SET, next);
  emit('cycle');
  return next;
}

/** 新增一次经期（只给开始日，自动按平均长度补结束日） */
export function startPeriod(start: string): PeriodRecord {
  const s = getCycleSettings();
  const rec: PeriodRecord = {
    id: uid('pd'), start, end: '', flow: '', pain: 0, moods: [], symptoms: [], note: '', createTime: Date.now()
  };
  // 上一期未结束的，按平均经期长度自动收尾，避免两条「进行中」打架
  const list = loadPeriods();
  const running = list.find((x) => !x.end && x.start <= start);
  if (running) {
    running.end = addDays(running.start, Math.max(1, s.periodLen - 1));
    upsertPeriod(running);
  }
  upsertPeriod(rec);
  return rec;
}

/** 结束当前经期 */
export function endPeriod(end: string): PeriodRecord | null {
  const list = loadPeriods();
  const running = list.find((x) => !x.end);
  if (!running) return null;
  running.end = end;
  upsertPeriod(running);
  return running;
}

/* ============================ 自在养护档案 ============================ */

export function defaultSkinProfile(): SkinProfile {
  return { type: 'comb', concerns: ['保湿'], sun: 'normal', allergy: '', active: false };
}
export function defaultHairProfile(): HairProfile {
  return { scalp: 'normal', texture: 'normal', curly: false, damage: 'none', concerns: ['毛躁'], washFreq: 2 };
}
export function defaultBodyProfile(): BodyProfile {
  return { dryness: 'mild', kp: false, backAcne: false, concerns: [], exercise: 'light', sleep: 7, water: 4 };
}

export function getSkinProfile(): SkinProfile {
  return { ...defaultSkinProfile(), ...(get<SkinProfile>(K_SKIN_PROFILE, defaultSkinProfile()) || {}) };
}
export function setSkinProfile(patch: Partial<SkinProfile>): SkinProfile {
  const next = { ...getSkinProfile(), ...patch };
  set(K_SKIN_PROFILE, next);
  emit('cycle');
  return next;
}

export function getHairProfile(): HairProfile {
  return { ...defaultHairProfile(), ...(get<HairProfile>(K_HAIR_PROFILE, defaultHairProfile()) || {}) };
}
export function setHairProfile(patch: Partial<HairProfile>): HairProfile {
  const next = { ...getHairProfile(), ...patch };
  set(K_HAIR_PROFILE, next);
  emit('cycle');
  return next;
}

export function getBodyProfile(): BodyProfile {
  return { ...defaultBodyProfile(), ...(get<BodyProfile>(K_BODY_PROFILE, defaultBodyProfile()) || {}) };
}
export function setBodyProfile(patch: Partial<BodyProfile>): BodyProfile {
  const next = { ...getBodyProfile(), ...patch };
  set(K_BODY_PROFILE, next);
  emit('cycle');
  return next;
}

/** 默认体检 / 疫苗清单（首次进入自动铺好，用户可勾选完成更新下次时间） */
export function defaultCareChecks(): CareCheck[] {
  return [
    { key: 'gyn', name: '妇科常规体检', emoji: '🩺', intervalMonths: 12, lastAt: 0, note: '有性生活后建议每年一次；经期结束 3–7 天去最合适' },
    { key: 'tct', name: 'TCT 宫颈细胞学', emoji: '🔬', intervalMonths: 12, lastAt: 0, note: '25 岁以上或有性生活满 3 年，常与 HPV 联合筛查' },
    { key: 'hpv', name: 'HPV 检测', emoji: '🦠', intervalMonths: 36, lastAt: 0, note: '联合 TCT 阴性可 3–5 年一次，遵医嘱' },
    { key: 'breast', name: '乳腺超声', emoji: '💗', intervalMonths: 12, lastAt: 0, note: '月经结束后 7–10 天做，胀痛影响最小；每月自检也在此时' },
    { key: 'hpvvac', name: 'HPV 疫苗', emoji: '💉', intervalMonths: 0, lastAt: 0, note: '九价越早越好；已接种则记录剂次，0/2/6 月' },
    { key: 'teeth', name: '洗牙 / 口腔检查', emoji: '🦷', intervalMonths: 6, lastAt: 0, note: '半年到一年一次，牙龈出血别拖' },
    { key: 'eye', name: '视力 / 眼底', emoji: '👁️', intervalMonths: 12, lastAt: 0, note: '长期戴隐形或高度近视，建议每年查一次眼底' },
    { key: 'physical', name: '全身体检', emoji: '📋', intervalMonths: 12, lastAt: 0, note: '关注甲功、铁蛋白、维生素 D，女生缺铁很常见' }
  ];
}

export function loadCareChecks(): CareCheck[] {
  const list = get<CareCheck[]>(K_CARE_CHECK, []);
  if (!Array.isArray(list) || !list.length) {
    const def = defaultCareChecks();
    set(K_CARE_CHECK, def);
    return def;
  }
  // 兜底合并：老版本缺项时补齐，不清空用户已有记录
  const def = defaultCareChecks();
  const map: Record<string, CareCheck> = {};
  list.forEach((x) => { if (x && x.key) map[x.key] = x; });
  def.forEach((d) => { if (!map[d.key]) map[d.key] = d; });
  return def.map((d) => map[d.key]);
}

export function markCareCheck(key: string): CareCheck[] {
  const list = loadCareChecks().map((x) => (x.key === key ? { ...x, lastAt: Date.now() } : x));
  set(K_CARE_CHECK, list);
  emit('cycle');
  return list;
}

export function saveCareChecks(list: CareCheck[]): void {
  set(K_CARE_CHECK, list);
  emit('cycle');
}

/* ============================ 我的衣橱 ============================ */

export function loadCloset(): WardrobeItem[] {
  const list = get<WardrobeItem[]>(K_CLOSET, []);
  return Array.isArray(list) ? list : [];
}

export function addClosetItem(item: Omit<WardrobeItem, 'id' | 'createTime'>): WardrobeItem {
  const rec: WardrobeItem = { ...item, id: uid('cl'), createTime: Date.now() };
  const list = loadCloset();
  list.unshift(rec);
  set(K_CLOSET, list);
  emit('wardrobe');
  return rec;
}

export function updateClosetItem(id: string, patch: Partial<WardrobeItem>): WardrobeItem[] {
  const list = loadCloset().map((x) => (x.id === id ? { ...x, ...patch } : x));
  set(K_CLOSET, list);
  emit('wardrobe');
  return list;
}

export function removeClosetItem(id: string): WardrobeItem[] {
  const list = loadCloset().filter((x) => x.id !== id);
  set(K_CLOSET, list);
  emit('wardrobe');
  return list;
}

/** 衣橱按品类统计（页面顶部展示，也用于判断缺件） */
export function closetStats(): { cat: WardrobeCategory; count: number }[] {
  const list = loadCloset();
  const order: WardrobeCategory[] = ['coat', 'top', 'bottom', 'dress', 'shoes', 'bag', 'earring', 'necklace', 'hat', 'scarf', 'other'];
  return order.map((c) => ({ cat: c, count: list.filter((x) => x.cat === c).length }));
}

/* ============================ 妆造 / 穿搭偏好 ============================ */

export function getBeauty(): BeautyPrefs {
  return { ...defaultBeauty(), ...(get<BeautyPrefs>(K_BEAUTY, defaultBeauty()) || {}) };
}

export function setBeauty(patch: Partial<BeautyPrefs>): BeautyPrefs {
  const next = { ...getBeauty(), ...patch };
  set(K_BEAUTY, next);
  emit('beauty');
  return next;
}

export function getWardrobe(): WardrobePrefs {
  return { ...defaultWardrobe(), ...(get<WardrobePrefs>(K_WARDROBE, defaultWardrobe()) || {}) };
}

export function setWardrobe(patch: Partial<WardrobePrefs>): WardrobePrefs {
  const next = { ...getWardrobe(), ...patch };
  set(K_WARDROBE, next);
  emit('wardrobe');
  return next;
}

/** 月可支配金额 → 预算档（用户可手动覆盖） */
export function budgetFromMonthly(monthly: number): BudgetKey {
  if (!monthly || monthly < 1500) return 'student';
  if (monthly < 4000) return 'entry';
  if (monthly < 9000) return 'mid';
  if (monthly < 20000) return 'upper';
  return 'lux';
}

/* ============================ 关系 ============================ */

export function getRelation(): Relation {
  const r = get<Relation>(K_RELATION, defaultRelation());
  const d = defaultRelation();
  return {
    togetherDate: (r && r.togetherDate) || '',
    story: (r && r.story) || '',
    me: { ...d.me, ...((r && r.me) || {}) },
    him: { ...d.him, ...((r && r.him) || {}) }
  };
}

export function setRelation(patch: Partial<Relation>): Relation {
  const next = { ...getRelation(), ...patch };
  set(K_RELATION, next);
  emit('relation');
  return next;
}

export function setPerson(who: 'me' | 'him', patch: Partial<PersonProfile>): Relation {
  const r = getRelation();
  const next = { ...r, [who]: { ...r[who], ...patch } };
  set(K_RELATION, next);
  emit('relation');
  return next;
}

/* ============================ 互动 ============================ */

export function loadInteractions(): Interaction[] {
  const list = get<Interaction[]>(K_INTER, []);
  return Array.isArray(list) ? list : [];
}

export function addInteraction(item: Omit<Interaction, 'id' | 'createTime'>): Interaction {
  const rec: Interaction = { ...item, id: uid('it'), createTime: Date.now() };
  const list = loadInteractions();
  list.unshift(rec);
  set(K_INTER, list);
  emit('interaction');
  return rec;
}

export function removeInteraction(id: string): Interaction[] {
  const list = loadInteractions().filter((x) => x.id !== id);
  set(K_INTER, list);
  emit('interaction');
  return list;
}

/** 合并云端的互动（按 id 去重，保留 updatedAt 较新的） */
export function mergeInteractions(incoming: Interaction[]): number {
  if (!Array.isArray(incoming) || !incoming.length) return 0;
  const map: Record<string, Interaction> = {};
  loadInteractions().forEach((x) => { map[x.id] = x; });
  let added = 0;
  incoming.forEach((x) => {
    if (!x || !x.id) return;
    const old = map[x.id];
    if (!old) { map[x.id] = x; added += 1; }
    else if ((x.createTime || 0) > (old.createTime || 0)) map[x.id] = x;
  });
  const list = Object.keys(map).map((k) => map[k]);
  list.sort((a, b) => (b.at || 0) - (a.at || 0));
  set(K_INTER, list);
  emit('interaction');
  return added;
}

/* ============================ 回忆 ============================ */

export function loadMemories(): Memory[] {
  const list = get<Memory[]>(K_MEMORY, []);
  return Array.isArray(list) ? list : [];
}

export function addMemory(item: Omit<Memory, 'id' | 'createTime'>): Memory {
  const rec: Memory = { ...item, id: uid('mm'), createTime: Date.now() };
  const list = loadMemories();
  list.unshift(rec);
  set(K_MEMORY, list);
  emit('memory');
  return rec;
}

export function removeMemory(id: string): Memory[] {
  const list = loadMemories().filter((x) => x.id !== id);
  set(K_MEMORY, list);
  emit('memory');
  return list;
}

export function mergeMemories(incoming: Memory[]): number {
  if (!Array.isArray(incoming) || !incoming.length) return 0;
  const map: Record<string, Memory> = {};
  loadMemories().forEach((x) => { map[x.id] = x; });
  let added = 0;
  incoming.forEach((x) => {
    if (!x || !x.id) return;
    if (!map[x.id]) added += 1;
    map[x.id] = x;
  });
  const list = Object.keys(map).map((k) => map[k]);
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  set(K_MEMORY, list);
  emit('memory');
  return added;
}

/* ============================ 礼物 ============================ */

export function loadGifts(): GiftRecord[] {
  const list = get<GiftRecord[]>(K_GIFT, []);
  return Array.isArray(list) ? list : [];
}

export function addGift(item: Omit<GiftRecord, 'id' | 'createTime'>): GiftRecord {
  const rec: GiftRecord = { ...item, id: uid('gf'), createTime: Date.now() };
  const list = loadGifts();
  list.unshift(rec);
  set(K_GIFT, list);
  emit('gift');
  return rec;
}

export function removeGift(id: string): GiftRecord[] {
  const list = loadGifts().filter((x) => x.id !== id);
  set(K_GIFT, list);
  emit('gift');
  return list;
}

export function mergeGifts(incoming: GiftRecord[]): number {
  if (!Array.isArray(incoming) || !incoming.length) return 0;
  const map: Record<string, GiftRecord> = {};
  loadGifts().forEach((x) => { map[x.id] = x; });
  let added = 0;
  incoming.forEach((x) => {
    if (!x || !x.id) return;
    if (!map[x.id]) added += 1;
    map[x.id] = x;
  });
  const list = Object.keys(map).map((k) => map[k]);
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  set(K_GIFT, list);
  emit('gift');
  return added;
}

/* ============================ 想要准备的事 ============================ */

export function loadPrepares(): PrepareItem[] {
  const list = get<PrepareItem[]>(K_PREPARE, []);
  return Array.isArray(list) ? list : [];
}

export function addPrepare(item: Omit<PrepareItem, 'id' | 'createTime'>): PrepareItem {
  const rec: PrepareItem = { ...item, id: uid('pp'), createTime: Date.now() };
  const list = loadPrepares();
  list.unshift(rec);
  set(K_PREPARE, list);
  emit('prepare');
  return rec;
}

export function updatePrepare(id: string, patch: Partial<PrepareItem>): PrepareItem[] {
  const list = loadPrepares().map((x) => (x.id === id ? { ...x, ...patch } : x));
  set(K_PREPARE, list);
  emit('prepare');
  return list;
}

export function removePrepare(id: string): PrepareItem[] {
  const list = loadPrepares().filter((x) => x.id !== id);
  set(K_PREPARE, list);
  emit('prepare');
  return list;
}

/* ============================ 共享 ============================ */

export function getShare(): ShareState {
  const s = get<ShareState>(K_SHARE, defaultShare());
  const d = defaultShare();
  return { ...d, ...(s || {}), scope: { ...d.scope, ...((s && s.scope) || {}) } };
}

export function setShare(patch: Partial<ShareState>): ShareState {
  const next = { ...getShare(), ...patch };
  set(K_SHARE, next);
  emit('share');
  return next;
}

export function setShareScope(patch: Partial<ShareScope>): ShareState {
  const s = getShare();
  return setShare({ scope: { ...s.scope, ...patch } });
}

/* ============================ 快照（离线共享的兜底通道） ============================ */

export function buildSnapshot(room: string, from: 'me' | 'him'): LoveSnapshot {
  const scope = getShare().scope;
  const snap: LoveSnapshot = { v: 1, at: Date.now(), room, from };
  if (scope.relation) snap.relation = getRelation();
  if (scope.interaction) snap.interactions = loadInteractions();
  if (scope.memory) snap.memories = loadMemories();
  if (scope.gift) snap.gifts = loadGifts();
  if (scope.cycle) snap.cycle = { records: loadPeriods(), settings: getCycleSettings() };
  return snap;
}

/** 应用一份快照；返回各板块新增条数，便于给用户明确反馈 */
export function applySnapshot(snap: LoveSnapshot): { relation: boolean; interaction: number; memory: number; gift: number; cycle: number } {
  const out = { relation: false, interaction: 0, memory: 0, gift: 0, cycle: 0 };
  if (!snap) return out;
  if (snap.relation && (snap.relation.togetherDate || snap.relation.him.nickname)) {
    const cur = getRelation();
    // 合并策略：非空的云端字段覆盖本地空字段；本地已有内容则以本地为准（私密数据不被动覆盖）
    const merged: Relation = {
      togetherDate: cur.togetherDate || snap.relation.togetherDate || '',
      story: cur.story || snap.relation.story || '',
      me: mergePerson(cur.me, snap.relation.me),
      him: mergePerson(cur.him, snap.relation.him)
    };
    set(K_RELATION, merged);
    out.relation = true;
  }
  if (snap.interactions) out.interaction = mergeInteractions(snap.interactions);
  if (snap.memories) out.memory = mergeMemories(snap.memories);
  if (snap.gifts) out.gift = mergeGifts(snap.gifts);
  if (snap.cycle && snap.cycle.records) {
    const map: Record<string, PeriodRecord> = {};
    loadPeriods().forEach((x) => { map[x.id] = x; });
    snap.cycle.records.forEach((x) => { if (x && x.id && !map[x.id]) { map[x.id] = x; out.cycle += 1; } });
    const list = Object.keys(map).map((k) => map[k]);
    list.sort((a, b) => (a.start < b.start ? 1 : -1));
    set(K_CYCLE, list);
    if (snap.cycle.settings) set(K_CYCLE_SET, { ...getCycleSettings(), ...snap.cycle.settings });
    emit('cycle');
  }
  emit('relation', 'interaction', 'memory', 'gift', 'share');
  return out;
}

function mergePerson(local: PersonProfile, remote: PersonProfile): PersonProfile {
  if (!remote) return local;
  const pick = (a: string, b: string) => (a && a.length ? a : (b || ''));
  return {
    nickname: pick(local.nickname, remote.nickname),
    birthday: pick(local.birthday, remote.birthday),
    city: pick(local.city, remote.city),
    zodiac: pick(local.zodiac, remote.zodiac),
    mbti: pick(local.mbti, remote.mbti),
    hobbies: (local.hobbies && local.hobbies.length ? local.hobbies : (remote.hobbies || [])),
    words: pick(local.words, remote.words)
  };
}

export function setRelationRaw(r: Relation): void {
  set(K_RELATION, r);
  emit('relation');
}

/* ============================ 日期小工具（模块内共用） ============================ */

/** yyyy-mm-dd 加 n 天 */
export function addDays(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  d.setDate(d.getDate() + n);
  return fmtYmd(d);
}

export function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function fmtYmd(d: Date): string {
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayYmd(): string {
  return fmtYmd(new Date());
}

/** 两个 yyyy-mm-dd 相差天数（b - a） */
export function diffDays(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 星期几中文 */
export function weekdayCn(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return '';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}

export { emit as emitLove };
