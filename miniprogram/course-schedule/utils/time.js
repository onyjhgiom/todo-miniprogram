'use strict';

/**
 * 时间与日期工具
 * 小程序内 HH:MM 一律用字符串比较（零补足），无需转 Date。
 */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isHHMM(v) {
  return typeof v === 'string' && HHMM_RE.test(v);
}

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
}

function toMinutes(v) {
  const parts = String(v).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** 半开区间重叠判断：[aStart, aEnd) 与 [bStart, bEnd) */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

function isStartBeforeEnd(start, end) {
  return toMinutes(start) < toMinutes(end);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

module.exports = {
  isHHMM,
  isDate,
  toMinutes,
  overlaps,
  isStartBeforeEnd,
  addDays,
  diffDays,
};
