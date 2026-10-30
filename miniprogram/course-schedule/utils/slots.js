'use strict';

/**
 * 节次与星期常量
 * 注意：作息按学校实际填写，不要硬套"1-2节=08:00-09:40"的通用标准。
 * 该校实测：1-2节 08:20 起，3-4节 10:20 起。
 */

const SLOTS = [
  { index: 0, label: '1-2节', start: '08:20', end: '10:00' },
  { index: 1, label: '3-4节', start: '10:20', end: '12:00' },
  { index: 2, label: '5-6节', start: '14:00', end: '15:40' },
  { index: 3, label: '7-8节', start: '16:00', end: '17:40' },
  { index: 4, label: '9-10节', start: '19:00', end: '20:40' },
];

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function slotIndexOf(startTime) {
  for (let i = 0; i < SLOTS.length; i += 1) {
    if (SLOTS[i].start === startTime) return i;
  }
  return -1;
}

function slotLabel(startTime) {
  const i = slotIndexOf(startTime);
  return i === -1 ? startTime : SLOTS[i].label;
}

/**
 * 依据课程时间构建网格行
 * 优先命中预设节次，命不中的（如 3-6 节连排）追加为独立行，保证不丢课
 */
function buildRows(courses) {
  const rows = SLOTS.map((s) => ({ label: s.label, start: s.start, end: s.end }));
  const covered = {};
  rows.forEach((r) => { covered[r.start] = true; });

  // 命不中预设节次的（如 3-6 节连排）追加为独立行，保证不丢课。
  // 同一开始时间可能有多条课程（不同周/不同教室），结束时间取最晚的一条，
  // 否则时间轴显示的“下课时间”可能早于实际。
  const extra = {};
  courses.forEach((c) => {
    if (!c.startTime || covered[c.startTime]) return;
    if (!extra[c.startTime]) {
      extra[c.startTime] = { label: c.startTime, start: c.startTime, end: c.endTime || '' };
    }
    const cur = extra[c.startTime].end;
    if (c.endTime && (!cur || String(c.endTime).localeCompare(String(cur)) > 0)) {
      extra[c.startTime].end = c.endTime;
    }
  });
  Object.keys(extra).forEach((k) => rows.push(extra[k]));

  rows.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return rows;
}

module.exports = { SLOTS, WEEKDAY_NAMES, slotIndexOf, slotLabel, buildRows };
