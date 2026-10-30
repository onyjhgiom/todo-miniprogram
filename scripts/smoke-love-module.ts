// scripts/smoke-love-module.ts
// 爱遇小栈 · 逻辑冒烟测试（不依赖微信环境，用内存 mock 替代 wx.storage）
//
// 覆盖：经期推算 / 能量与爱心等级 / 连续天数与彩蛋 / 距离与天气降级 /
//       妆造与美甲 / 穿搭与好物价位 / 生日与送礼 / 共享快照合并 / 皮肤完整性
//
// 运行：tsc 编译到 .tmp-love 后 node 执行（见 scripts/check-love-module.py 的调用）

const MEM: Record<string, unknown> = {};

(globalThis as unknown as Record<string, unknown>).wx = {
  getStorageSync: (k: string) => (k in MEM ? MEM[k] : ''),
  setStorageSync: (k: string, v: unknown) => { MEM[k] = v; },
  removeStorageSync: (k: string) => { delete MEM[k]; },
  showToast: () => undefined,
  showLoading: () => undefined,
  hideLoading: () => undefined,
  showModal: () => undefined,
  setClipboardData: () => undefined,
  setNavigationBarColor: () => undefined,
  requestSubscribeMessage: () => undefined,
  cloud: undefined,
  compressImage: undefined,
  getFileSystemManager: undefined
};

import {
  startPeriod, endPeriod, loadPeriods, setCycleSettings, removePeriod,
  addInteraction, loadInteractions, removeInteraction,
  addMemory, loadMemories, addGift, loadGifts,
  setRelation, getRelation, buildSnapshot, applySnapshot, setShare,
  todayYmd, addDays, diffDays, getWardrobe, setWardrobe
} from '../miniprogram/subpackages/love/utils/love-store';
import { analyze, phaseAdvice, painPlan, buildReminder } from '../miniprogram/subpackages/love/utils/love-cycle';
import {
  energyOf, heartState, streakState, achievements, togetherStat, INTERACTIONS, LEVELS,
  heartVisual, heartGallery
} from '../miniprogram/subpackages/love/utils/love-energy';
import { toOrbItems, orbFormOf, memEmoji, memTint } from '../miniprogram/subpackages/love/utils/love-orb';
import { distanceKm, distanceText, localEstimate, weatherActions } from '../miniprogram/subpackages/love/utils/love-place';
import { buildMakeup, recommendNails, makeupStyles } from '../miniprogram/subpackages/love/utils/love-beauty';
import { buildOutfit, recommendGoods, BAND } from '../miniprogram/subpackages/love/utils/love-outfit';
import { zodiacOf, birthdayStat, giftIdeas } from '../miniprogram/subpackages/love/utils/love-gift';
import { SKINS, buildSkinStyle } from '../miniprogram/subpackages/love/utils/love-skin';
import { makeRoomCode, validRoomCode, exportText, importText } from '../miniprogram/subpackages/love/utils/love-share';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

let pass = 0;
let fail = 0;
const fails: string[] = [];

function ok(cond: boolean, name: string, extra?: string): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' → ' + extra : '')); }
}

function reset(): void {
  Object.keys(MEM).forEach((k) => delete MEM[k]);
}

/* ==================== 1. 经期 ==================== */
console.log('\n[1] 经期推算与建议');
reset();
{
  const a0 = analyze();
  ok(a0.hasData === false, '无数据时 hasData=false');
  ok(typeof a0.nextStart === 'string', '无数据时字段不炸');

  setCycleSettings({ cycleLen: 28, periodLen: 5, lutealLen: 14 });
  const d1 = addDays(todayYmd(), -10);
  startPeriod(d1);
  endPeriod(addDays(d1, 4));
  const a1 = analyze();
  ok(a1.hasData === true, '记录一次后有数据');
  ok(a1.dayIndex === 11, '第 11 天（含当天）', String(a1.dayIndex));
  ok(a1.phase === 'follicular' || a1.phase === 'ovulation', '第 11 天属卵泡/排卵期', a1.phase);
  ok(a1.nextStart === addDays(d1, 28), '下次 = 上次开始 + 平均周期');
  ok(a1.ovulation === addDays(a1.nextStart, -14), '排卵日 = 下次 - 黄体期');
  ok(a1.daysToNext === 18, '距下次 18 天', String(a1.daysToNext));

  // 第二次记录 → 平均周期取实际值
  startPeriod(addDays(d1, 30));
  endPeriod(addDays(d1, 33));
  const a2 = analyze();
  ok(a2.avgCycle === 30, '两次记录后平均周期=30', String(a2.avgCycle));

  const adv = phaseAdvice('menstrual');
  ok(adv.food.length >= 3 && adv.move.length >= 3, '经期建议非空');
  ok(adv.caution.length >= 3, '经期有就医红线');

  const p3 = painPlan(3);
  ok(p3.steps.join('').indexOf('就医') >= 0, '剧烈痛经明确提示就医');
  ok(painPlan(0).redFlags.length === 0, '无痛不弹红线');

  const rem = buildReminder();
  ok(typeof rem.title === 'string' && typeof rem.desc === 'string', '提醒文案不为空');

  removePeriod(loadPeriods()[0].id);
  ok(loadPeriods().length === 1, '删除记录生效');
}

/* ==================== 2. 能量与爱心 ==================== */
console.log('\n[2] 爱情能量与爱心等级');
reset();
{
  ok(energyOf('chat', 0) === 2, '聊天基础 2');
  ok(energyOf('video', 45) === 14, '视频 45 分钟 = 8+6=14', String(energyOf('video', 45)));
  ok(energyOf('meet', 600) === 35, '见面封顶 35');
  ok(energyOf('chat', 1000) === 8, '聊天不超过上限 8');

  let h = heartState(0);
  ok(h.lv === 1 && h.next !== null, '0 能量 Lv1');
  h = heartState(LEVELS[9].need);
  ok(h.lv === 10 && h.percent === 100, '满级 Lv10 进度 100');
  ok(h.modes.filter((m: Any) => m.unlocked).length === 10, '满级解锁 10 个模式');
  h = heartState(LEVELS[3].need);
  ok(h.lv === 4 && h.cur.orbit >= 6 && h.cur.beat < 2000, 'Lv4 外观随等级变化（环绕+心跳更快）');

  // —— 爱心外观分层（图鉴视觉升级回归保护）——
  const v1 = heartVisual(1);
  const v5 = heartVisual(5);
  const v10 = heartVisual(10);
  ok(v1.tier === 1 && v5.tier === 2 && v10.tier === 3, '三档视觉层级：Lv1 简洁 / Lv5 精致 / Lv10 华丽');
  ok(v1.tierCls === 'ay-heart--t1' && v10.tierCls === 'ay-heart--t3', '层级类名可用于 class 绑定');
  // 多层配色变量必须齐全，缺一个就会露出兜底色
  for (const v of [v1, v5, v10]) {
    for (const vv of ['--ht-c0', '--ht-c1', '--ht-c2', '--ht-c3', '--ht-c4', '--ht-glow', '--ht-glow-2', '--ht-ring', '--ht-beat', '--ht-tilt']) {
      ok(v.style.indexOf(vv + ':') >= 0, '外观变量含 ' + vv);
    }
  }
  ok(v1.sparks.length === 0, '简洁档无粒子');
  ok(v5.sparks.length > 0 && v10.sparks.length > v5.sparks.length, '粒子数随等级递增');
  ok(heartVisual(10).sparks.length <= 10, '粒子数收在上限 10 以内（性能保护）');
  // 相邻等级必须一眼可辨：至少有一处可见差异（颜色/光晕/环绕/粒子）
  let diffCnt = 0;
  for (let lv = 2; lv <= 10; lv++) {
    const a = heartVisual(lv - 1);
    const b = heartVisual(lv);
    if (a.style !== b.style || a.orbits.length !== b.orbits.length || a.sparks.length !== b.sparks.length) diffCnt++;
  }
  ok(diffCnt === 9, '相邻 9 对等级全部存在差异', String(diffCnt));

  const gz = heartGallery(LEVELS[3].need);
  ok(gz.length === 10, '图鉴 10 级全列出');
  ok(gz.filter((x: Any) => x.cur).length === 1, '恰好一个「当前等级」标记');
  ok(gz[3].cur === true && gz[3].unlocked === true, '当前等级即所处等级');
  ok(gz[9].unlocked === false && gz[9].remain > 0, '高级未解锁且显示差额');

  // 连续天数
  const t = todayYmd();
  addInteraction({ type: 'chat', date: t, at: Date.now(), minutes: 10, title: '', note: '', energy: 3, from: 'me' });
  ok(streakState().days === 1, '今天一条 → 连续 1 天');
  addInteraction({ type: 'chat', date: addDays(t, -1), at: Date.now(), minutes: 10, title: '', note: '', energy: 3, from: 'me' });
  addInteraction({ type: 'chat', date: addDays(t, -2), at: Date.now(), minutes: 10, title: '', note: '', energy: 3, from: 'me' });
  const st = streakState();
  ok(st.days === 3, '连续 3 天', String(st.days));
  ok(st.todayDone === true, '今天已互动');
  ok(achievements(3).filter((a: Any) => a.unlocked).length === 1, '3 天解锁 1 个成就');
  ok(achievements(3)[0].egg.length > 0, '已解锁彩蛋文案可见');
  ok(achievements(3)[5].egg === '', '未解锁彩蛋不出正文');
  ok(achievements(3)[5].masked.indexOf('?') >= 0, '未解锁彩蛋打码');

  // 断一天
  reset();
  addInteraction({ type: 'chat', date: addDays(t, -2), at: Date.now(), minutes: 10, title: '', note: '', energy: 3, from: 'me' });
  ok(streakState().days === 0, '断档后连续归零');

  reset();
  setRelation({ togetherDate: addDays(t, -99) });
  const tg = togetherStat();
  ok(tg.days === 100, '在一起 100 天', String(tg.days));
  ok(!!tg.nextMilestone, '有下一个里程碑');
  ok(tg.anniversaryText.length > 0, '有周年倒计时文案');
}

/* ==================== 3. 距离与天气降级 ==================== */
console.log('\n[3] 两地距离与天气降级');
reset();
{
  const km = distanceKm('北京', '上海');
  ok(km !== null && km > 900 && km < 1300, '北京-上海 ≈ 1067km', String(km));
  ok(distanceKm('北京', '北京') === 0, '同城 0 公里');
  ok(distanceKm('火星', '北京') === null, '未知城市返回 null');
  ok(distanceText(null).indexOf('填完整') >= 0, '距离缺失有引导文案');
  ok(distanceText(1200).indexOf('公里') >= 0, '距离文案含公里数');

  const w = localEstimate('哈尔滨');
  ok(w.live === false, '离线估算标注 live=false');
  ok(w.source.indexOf('离线估算') >= 0, '明确标注非实时');
  ok(w.text.length > 0 && w.temp.length > 0 && w.tip.length > 0, '估算也不返回空白');
  const e = localEstimate('北京', '');
  ok(e.actions.length > 0, '估算也有可执行建议');

  // 极端场景（与季节无关，直接验证行动建议生成器）
  const cold = weatherActions('寒潮', '-10° ~ 2°', 'severe');
  ok(cold.join('').indexOf('厚') >= 0 || cold.join('').indexOf('穿') >= 0, '寒潮给出具体穿什么');
  ok(cold.join('').indexOf('严寒') >= 0 || cold.join('').indexOf('⚠️') >= 0, '恶劣天气有额外警示');
  ok(weatherActions('暴雨', '20° ~ 26°', 'notice').join('').indexOf('伞') >= 0, '暴雨提醒带伞');
  ok(weatherActions('台风', '25° ~ 30°', 'severe').join('').indexOf('台风') >= 0, '台风有对应措施');
  ok(weatherActions('晴', '18° ~ 26°', 'none').length > 0, '好天气也给建议（不空白）');
}

/* ==================== 4. 妆造与美甲 ==================== */
console.log('\n[4] 妆造顾问');
reset();
{
  ok(makeupStyles().length === 8, '8 种妆感');
  const m = buildMakeup('复古港风', '面试');
  ok(m.steps.length === 6, '六步流程（底妆→定妆）');
  ok(m.steps.every((s: Any) => s.steps.length > 0), '每一步都有具体动作');
  ok(m.minutes > 0, '给出预计耗时');
  ok(m.palette.length === 4, '给色板');
  const dry = buildMakeup('清透裸妆', '日常');
  ok(dry.avoid.length > 0, '有避雷项');

  const nails = recommendNails('方圆', ['通勤'], '通勤', 'medium');
  ok(nails.length > 0, '美甲有推荐');
  ok(nails[0].how.length >= 3, '美甲给出做法要点');
  ok(nails[0].price.indexOf('元') >= 0, '美甲标注价位');
}

/* ==================== 5. 穿搭与好物 ==================== */
console.log('\n[5] 穿搭与好物');
reset();
{
  setWardrobe({ budget: 'student', body: 'pear' });
  const cheap = buildOutfit('极简高级', '通勤', '冬', '5');
  ok(cheap.pieces.length === 6, '成套 6 个位置');
  ok(cheap.pieces.every((p: Any) => p.price.indexOf('元') >= 0), '每单品标注价位');
  ok(cheap.bodyLines.join('').indexOf('梨形') >= 0 || cheap.tips.length > 0, '结合身形给建议');
  setWardrobe({ budget: 'lux' });
  const lux = buildOutfit('极简高级', '通勤', '冬', '5');
  const n1 = Number((cheap.pieces[0].price.match(/\d+/) as Any)[0]);
  const n2 = Number((lux.pieces[0].price.match(/\d+/) as Any)[0]);
  ok(n2 > n1, '预算档越高价位越高', `${n1} → ${n2}`);

  const goods = recommendGoods('包袋', 'entry', '温柔韩系');
  ok(goods.length > 0, '好物有推荐');
  ok(goods.every((g: Any) => g.how.length > 10 && g.trap.length > 0), '好物给出选购标准与避雷');
  ok(Object.keys(BAND).length === 5, '5 个预算档');
}

/* ==================== 6. 生日与送礼 ==================== */
console.log('\n[6] 生日与送礼');
reset();
{
  ok(zodiacOf('03-15') === '双鱼座', '3/15 双鱼座', zodiacOf('03-15'));
  ok(zodiacOf('1998-07-30') === '狮子座', '7/30 狮子座');
  ok(zodiacOf('') === '', '空生日不炸');

  const today = todayYmd();
  const b1 = birthdayStat(today);
  ok(b1 !== null && b1.isToday === true && b1.days === 0, '生日当天识别');
  const b2 = birthdayStat(addDays(today, 10));
  ok(b2 !== null && b2.days === 10 && b2.isToday === false, '10 天后生日');
  ok(b2 !== null && b2.prepText.length > 0, '有提前准备提示');

  const gifts = giftIdeas({ mbti: 'INTJ', hobbies: ['数码', '游戏'], budget: 'mid', zodiac: '摩羯座' });
  ok(gifts.length > 0 && gifts.length <= 6, '送礼建议 1–6 条');
  ok(gifts[0].reason.length > 0, '每条给理由');
  ok(gifts.every((g: Any) => g.price.indexOf('元') >= 0), '每条标价位');
  ok(gifts[0].score >= gifts[gifts.length - 1].score, '按匹配度排序');
}

/* ==================== 7. 共享与快照 ==================== */
console.log('\n[7] 共享与同步');
reset();
{
  const code = makeRoomCode();
  ok(validRoomCode(code), '生成的房间号合法', code);
  ok(!validRoomCode('abc'), '小写不合法');
  ok(!validRoomCode('ABC12'), '位数不足不合法');

  setRelation({ togetherDate: '2024-01-01', him: { nickname: '阿泽', birthday: '05-20', city: '上海', zodiac: '', mbti: 'INFP', hobbies: ['音乐'], words: '' } as Any });
  addInteraction({ type: 'video', date: todayYmd(), at: Date.now(), minutes: 40, title: '聊到两点', note: '', energy: 14, from: 'me' });
  addMemory({ date: '2024-05-01', title: '第一次见面', place: '上海', note: '下雨', tags: ['第一次'] });
  addGift({ from: 'me', title: '手链', date: '2024-06-01', price: '500', occasion: '纪念日', note: '' });

  const { text } = exportText();
  ok(text.length > 50, '导出快照非空');
  const parsed = JSON.parse(text);
  ok(parsed.v === 1 && Array.isArray(parsed.interactions), '快照结构正确');

  // 清空后导入，应完全恢复
  reset();
  const r = importText(text);
  ok(r.ok === true, '导入成功', r.msg);
  ok(loadInteractions().length === 1, '互动恢复');
  ok(loadMemories().length === 1, '回忆恢复');
  ok(loadGifts().length === 1, '礼物恢复');
  ok(getRelation().him.nickname === '阿泽', '档案恢复');

  // 重复导入不产生重复
  const r2 = importText(text);
  ok(r2.ok === true && loadInteractions().length === 1, '重复导入不产生重复记录');

  // 经期默认不共享
  reset();
  setShare({ scope: { relation: true, interaction: true, memory: true, gift: true, cycle: false } });
  startPeriod(todayYmd());
  const snapNoCycle = buildSnapshot('ABC123', 'me');
  ok(!snapNoCycle.cycle, '经期默认不进快照');
  setShare({ scope: { relation: true, interaction: true, memory: true, gift: true, cycle: true } });
  const snapCycle = buildSnapshot('ABC123', 'me');
  ok(!!snapCycle.cycle, '打开后经期进快照');

  ok(importText('not json').ok === false, '非法内容被拒绝');
  ok(importText('{"v":9}').ok === false, '版本不符被拒绝');
}

/* ==================== 8. 皮肤完整性 ==================== */
console.log('\n[8] 皮肤系统');
reset();
{
  ok(SKINS.length === 9, '9 套皮肤');
  const need = ['bg', 'bg2', 'card', 'card-soft', 'primary', 'primary-2', 'accent', 'text', 'sub', 'faint', 'line', 'hero', 'shadow', 'chip', 'nav'];
  let full = true;
  SKINS.forEach((s) => {
    need.forEach((k) => { if (!s.vars[k]) { full = false; console.log('    缺变量 ' + s.key + '.' + k); } });
    const st = buildSkinStyle(s.key);
    need.forEach((k) => { if (st.indexOf('--ay-' + k + ':') < 0) { full = false; console.log('    样式串缺 ' + s.key + '.' + k); } });
  });
  ok(full, '每套皮肤变量齐全');
  ok(SKINS.filter((s) => s.dark).length >= 1, '至少有 1 套深色皮肤');
  const fams: string[] = [];
  SKINS.forEach((s) => { if (fams.indexOf(s.family) < 0) fams.push(s.family); });
  ok(fams.length === 4, '四个取向分组', fams.join('/'));
  ok(buildSkinStyle('peach').indexOf('--ay-primary:') >= 0, '样式串包含主色变量');
  ok(buildSkinStyle('不存在的皮肤').indexOf('--ay-primary:') >= 0, '未知皮肤回落到默认');
}

/* ==================== 爱情球（能量站 / 回忆页共用） ==================== */
{
  ok(toOrbItems([]).length === 0, '空回忆 → 球体无节点');
  const nodes = toOrbItems([
    { id: 'a', tags: ['旅行'], photos: ['cloud://x/1.png'] },
    { id: 'b', tags: [] },
    { id: 'c', tags: ['日常'] }
  ]);
  ok(nodes.length === 3, '三条回忆 → 三个节点');
  ok(nodes[0].emoji === '✈️' && nodes[0].photo === 'cloud://x/1.png', '节点带上标签 emoji 与首张照片');
  ok(nodes[1].emoji === '💗' && nodes[1].photo === '', '无标签回忆回落到默认爱心、无照片');
  ok(nodes.every((n) => typeof n.tint === 'string' && !!n.id), '节点字段完整（id/tint 必填）');

  ok(memEmoji(['生日']) === '🎂' && memEmoji(undefined) === '💗', 'memEmoji 映射与兜底');
  ok(memTint(['纪念日']) === '#C69BFF' && memTint(['不存在的标签']) === '', 'memTint 映射与兜底');

  ok(orbFormOf(1).name === '透明粉色玻璃', 'Lv1 → 透明粉色玻璃');
  ok(orbFormOf(10).name === '完整爱情宇宙', 'Lv10 → 完整爱情宇宙');
  let mono = true;
  for (let lv = 2; lv <= 10; lv++) {
    if (orbFormOf(lv).idx < orbFormOf(lv - 1).idx) mono = false;
  }
  ok(mono, '形态随等级单调进化（不会越升越简单）');
  ok(orbFormOf(999).idx === orbFormOf(10).idx && orbFormOf(0).idx === 1, '越界等级安全回落');
  ok(orbFormOf(7).dust > orbFormOf(1).dust, '高级形态粒子更丰富');
}

/* ==================== 汇总 ==================== */
console.log('\n==================================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('失败项：');
  fails.forEach((f) => console.log('  - ' + f));
  // 不引 @types/node：这里直接取全局 process，避免为该脚本额外装类型包
  const proc = (globalThis as unknown as { process?: { exit?: (c: number) => void } }).process;
  if (proc && proc.exit) proc.exit(1);
} else {
  console.log('全部通过 ✅');
}
