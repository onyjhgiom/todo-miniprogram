'use strict';

/**
 * weekRule 周次规则：归一化 / 展开 / 交集 / 冲突检测
 * mode: every | odd | even | range | weeks
 */

const time = require('./time');

const MODES = ['every', 'odd', 'even', 'range', 'weeks'];

/**
 * 归一化：纠正 start>end、截断到 1~totalWeeks、去重排序。
 * 无法解析时退化为 every —— 宁可多显示，也不要把课弄丢。
 */
function normalizeWeekRule(raw, totalWeeks) {
  const fallback = { mode: 'every', ranges: [], weeks: [] };
  if (!raw || typeof raw !== 'object' || MODES.indexOf(raw.mode) === -1) return fallback;

  if (raw.mode === 'range') {
    const ranges = (Array.isArray(raw.ranges) ? raw.ranges : [])
      .map((r) => {
        if (!r) return null;
        let s = Number(r.start);
        let e = Number(r.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
        if (s > e) { const t = s; s = e; e = t; }           // 原文颠倒自动纠正
        s = Math.min(Math.max(1, Math.trunc(s)), totalWeeks); // 截断到学期范围
        e = Math.min(Math.max(1, Math.trunc(e)), totalWeeks);
        return s <= e ? { start: s, end: e } : null;
      })
      .filter(Boolean);
    return ranges.length ? { mode: 'range', ranges: ranges, weeks: [] } : fallback;
  }

  if (raw.mode === 'weeks') {
    const set = {};
    (Array.isArray(raw.weeks) ? raw.weeks : []).forEach((n) => {
      const w = Math.trunc(Number(n));
      if (Number.isFinite(w) && w >= 1 && w <= totalWeeks) set[w] = true;
    });
    const weeks = Object.keys(set).map(Number).sort((a, b) => a - b);
    return weeks.length ? { mode: 'weeks', ranges: [], weeks: weeks } : fallback;
  }

  return { mode: raw.mode, ranges: [], weeks: [] };
}

/** 展开为具体的周号数组，如 every → [1..16]，odd → [1,3,5...] */
function expandWeeks(rule, totalWeeks) {
  const r = normalizeWeekRule(rule, totalWeeks);
  const all = [];
  for (let i = 1; i <= totalWeeks; i += 1) all.push(i);
  switch (r.mode) {
    case 'every': return all;
    case 'odd': return all.filter((w) => w % 2 === 1);
    case 'even': return all.filter((w) => w % 2 === 0);
    case 'range': return all.filter((w) => r.ranges.some((g) => w >= g.start && w <= g.end));
    case 'weeks': return r.weeks.slice();
    default: return all;
  }
}

/** 两条规则是否存在共同周号（冲突判定核心） */
function weekIntersects(a, b, totalWeeks) {
  const setB = {};
  expandWeeks(b, totalWeeks).forEach((w) => { setB[w] = true; });
  return expandWeeks(a, totalWeeks).some((w) => setB[w] === true);
}

/**
 * 冲突检测：同一天 + 时间重叠 + 周次有交集
 * @param {Array} entries 已 merge 完成的某周条目
 */
function findConflicts(entries, totalWeeks) {
  const out = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (!a._id || !b._id || a._id === b._id) continue;
      if (a.weekday !== b.weekday) continue;
      if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) continue;
      if (!time.overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
      if (!weekIntersects(a.weekRule, b.weekRule, totalWeeks)) continue;
      out.push({
        target_id: a._id,
        conflict_with_id: b._id,
        detail: '周' + a.weekday + ' ' + a.startTime + ' 时间重合',
      });
    }
  }
  return out;
}

module.exports = {
  MODES: MODES,
  normalizeWeekRule: normalizeWeekRule,
  expandWeeks: expandWeeks,
  weekIntersects: weekIntersects,
  findConflicts: findConflicts,
};
