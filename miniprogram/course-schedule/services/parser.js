'use strict';

/**
 * 指令解析服务
 *
 * 优先级：外部注入的 AI 解析（app.globalData.parseInstruction）> 本地规则兜底。
 * 本地兜底只覆盖高频指令，保证断网/AI 不可用时功能不瘫；
 * 兜不住的一律返回 unknown + question，绝不瞎猜。
 */

const { SLOTS } = require('../utils/slots');
const time = require('../utils/time');

const WEEKDAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

function dedupeById(list) {
  const seen = {};
  return list.filter((e) => (seen[e._id] ? false : (seen[e._id] = true)));
}

/** 课名匹配：先整名命中，再退化为前 3 字 */
function findCourses(text, entries) {
  const hits = [];
  (entries || []).forEach((e) => {
    if (!e.title) return;
    if (text.indexOf(e.title) !== -1) { hits.push(e); return; }
    const key = e.title.length > 3 ? e.title.slice(0, 3) : e.title;
    if (key.length >= 2 && text.indexOf(key) !== -1) hits.push(e);
  });
  return dedupeById(hits);
}

function parseWeekday(text) {
  const m = text.match(/周([一二三四五六日天])/) || text.match(/星期([一二三四五六日天])/);
  return m ? WEEKDAY_MAP[m[1]] : null;
}

/** "1-2节" / "3-6节" → { startTime, endTime }；命中不了返回 null */
function parseSlot(text) {
  const m = text.match(/(\d+)\s*[-\u007e~]\s*(\d+)\s*节/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const si = Math.floor((Math.min(a, b) - 1) / 2);
    const ei = Math.floor((Math.max(a, b) - 1) / 2);
    if (SLOTS[si] && SLOTS[ei]) {
      return { startTime: SLOTS[si].start, endTime: SLOTS[ei].end };
    }
    return null;
  }
  const times = text.match(/(\d{1,2}:\d{2})/g);
  if (times && times.length >= 2 && time.isHHMM(times[0]) && time.isHHMM(times[1])) {
    return { startTime: times[0], endTime: times[1] };
  }
  return null;
}

function parseWeek(text, ctx) {
  const m = text.match(/第\s*(\d+)\s*周/);
  if (m) {
    const w = Number(m[1]);
    return w >= 1 && w <= ctx.totalWeeks ? w : null;
  }
  if (/本周|这周/.test(text)) return ctx.currentWeek;
  if (/下周/.test(text)) {
    const w = ctx.currentWeek + 1;
    return w <= ctx.totalWeeks ? w : null;
  }
  const d = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (d && typeof ctx.weekOfDate === 'function') {
    const mm = String(Number(d[1])).padStart(2, '0');
    const dd = String(Number(d[2])).padStart(2, '0');
    return ctx.weekOfDate((ctx.year || new Date().getFullYear()) + '-' + mm + '-' + dd);
  }
  return null;
}

/**
 * 地点识别：必须带楼栋号（教302 / 博文北302 / 公共教学楼南109），
 * 否则"教室"这类普通词会被误当成地点名。
 */
function parseLocation(text) {
  const m = text.match(/(公共教学楼|实训楼|博文|博奕|博学|机房|教)\s*([东南西北中])?\s*(\d{2,4})/);
  if (m) return m[1] + (m[2] || '') + m[3];
  if (/操场/.test(text)) return '操场';
  if (/线上/.test(text)) return '线上';
  return null;
}

/** 从指令里剥离动作词、时间、地点、教师，剩下的即课程名 */
function extractTitle(text) {
  let rest = text.replace(/新增|添加|加一门|加一节|开一门/, '');
  rest = rest.replace(/周[一二三四五六日天]|星期[一二三四五六日天]/g, '');
  rest = rest.replace(/\d+\s*[-\u007e~]\s*\d+\s*节/g, '');
  rest = rest.replace(/\d{1,2}:\d{2}/g, '');
  rest = rest.replace(/第\s*\d+\s*周/g, '');
  rest = rest.replace(/[\u4e00-\u9fa5]{1,3}老师/g, '');
  const loc = parseLocation(text);
  if (loc) rest = rest.split(loc).join('');
  rest = rest.replace(/[，,。.;；\s]/g, '');
  rest = rest.replace(/(课程|课)$/, '');
  return rest;
}

function parseTeacher(text) {
  const m = text.match(/([\u4e00-\u9fa5]{1,3})老师/);
  return m ? m[1] + '老师' : null;
}

function pickByWeekday(hits, weekday) {
  if (weekday === null) return hits;
  const exact = hits.filter((e) => e.weekday === weekday);
  return exact.length ? exact : hits;
}

/**
 * @param {string} text 用户指令
 * @param {Object} ctx { totalWeeks, currentWeek, entries, weekOfDate, year }
 * @returns {Promise<Object>} edit payload
 */
function parseInstruction(text, ctx) {
  const injected = (typeof getApp === 'function' && getApp().globalData)
    ? getApp().globalData.parseInstruction
    : null;

  if (typeof injected === 'function') {
    return Promise.resolve()
      .then(() => injected(text, ctx))
      .catch((err) => {
        console.warn('[schedule] AI 解析失败，回退本地规则', err);
        return localParse(text, ctx);
      });
  }
  return Promise.resolve(localParse(text, ctx));
}

function localParse(text, ctx) {
  const operations = [];
  const week = parseWeek(text, ctx);
  const hits = findCourses(text, ctx.entries);
  const isBatch = /所有|全部|都|统一/.test(text);

  /* 停课 / 取消 */
  if (/停课|停上|取消|不上|放假/.test(text)) {
    if (!hits.length) {
      const name = (text.match(/([\u4e00-\u9fa5]{2,8})(?:课|课程)?(?:停课|取消|不上)/) || [])[1];
      return unknown('没有找到' + (name || '这门课') + '，是要新增这门课吗？');
    }
    const targets = pickByWeekday(hits, parseWeekday(text));
    if (week !== null) {
      // 有周次限定 → 单周覆盖
      targets.forEach((e) => operations.push({
        operation: 'weekly_override', target_id: e._id, target_ids: [], week: week, cancelled: true,
      }));
    } else if (isBatch) {
      targets.forEach((e) => operations.push({
        operation: 'weekly_override', target_id: e._id, target_ids: [], week: ctx.currentWeek, cancelled: true,
      }));
      return withNote(operations, '未指定周次，默认停本周（第' + ctx.currentWeek + '周）');
    } else {
      // 无限定 → 给候选，不擅自决定
      return {
        request_type: 'edit',
        operations: [],
        conflicts: [],
        output_candidates: [
          {
            interpretation: '只停这一次（第' + ctx.currentWeek + '周）',
            operations: targets.map((e) => ({ operation: 'weekly_override', target_id: e._id, target_ids: [], week: ctx.currentWeek, cancelled: true })),
          },
          {
            interpretation: '整学期停课',
            operations: targets.map((e) => ({ operation: 'delete_entry', target_id: e._id, target_ids: [] })),
          },
        ],
        confirm_note: null,
        question: '「' + targets[0].title + '」要停多久？',
      };
    }
    return withNote(operations, targets.length > 1 ? '匹配到多条，已全部停课' : null);
  }

  /* 调课 / 改到 */
  if (/调到|调至|改到|换到|移到|挪到/.test(text)) {
    if (!hits.length) return unknown('没有找到要调整的课程，请确认课程名');

    // "周三操作系统调到周五" —— 第一个周几是来源，调到之后的才是目标
    const tailMatch = text.match(/(?:调到|调至|改到|换到|移到|挪到)([\s\S]*)$/);
    const tail = tailMatch ? tailMatch[1] : text;
    const sourceWeekday = parseWeekday(text);
    const targetWeekday = parseWeekday(tail) !== null ? parseWeekday(tail) : sourceWeekday;
    const slot = parseSlot(tail) || parseSlot(text);

    const targets = pickByWeekday(hits, sourceWeekday);
    const changes = {};
    if (targetWeekday !== null) changes.weekday = targetWeekday;
    if (slot) { changes.startTime = slot.startTime; changes.endTime = slot.endTime; }

    if (targetWeekday === null && !slot) return unknown('请说明调到星期几、第几节');
    if (!slot) {
      return { request_type: 'edit', operations: [], conflicts: [], output_candidates: [], confirm_note: null,
        question: '请确认具体节次（如下午是 5-6 节 14:00，还是 7-8 节 16:00）' };
    }
    if (isBatch || targets.length > 1) {
      operations.push({ operation: 'batch_update', target_id: null, target_ids: targets.map((e) => e._id), changes: changes });
      return withNote(operations, '匹配到多条，已批量调整');
    }
    operations.push({ operation: 'update_entry', target_id: targets[0]._id, target_ids: [], changes: changes });
    return withNote(operations, null);
  }

  /* 新增 */
  if (/新增|添加|加一门|加一节|开一门/.test(text)) {
    const title = extractTitle(text);
    const slot = parseSlot(text);
    const weekday = parseWeekday(text);
    if (!title) return unknown('请说明要新增的课程名');
    if (weekday === null || !slot) return unknown('请说明新增课程的时间（如：周二 7-8 节）');
    const changes = {
      title: title,
      weekday: weekday,
      startTime: slot.startTime,
      endTime: slot.endTime,
    };
    const loc = parseLocation(text);
    const teacher = parseTeacher(text);
    if (loc) changes.location = loc;
    if (teacher) changes.teacher = teacher;
    changes.weekRule = week !== null
      ? { mode: 'weeks', ranges: [], weeks: [week] }
      : { mode: 'every', ranges: [], weeks: [] };
    operations.push({ operation: 'add_entry', target_id: null, target_ids: [], changes: changes });
    return withNote(operations, null);
  }

  /* 删除 */
  if (/删除|去掉|移除|删掉/.test(text)) {
    if (!hits.length) return unknown('没有找到要删除的课程，请确认课程名');
    const targets = pickByWeekday(hits, parseWeekday(text));
    targets.forEach((e) => operations.push({ operation: 'delete_entry', target_id: e._id, target_ids: [] }));
    return withNote(operations, null);
  }

  /* 改字段（地点 / 教师 / 周次） */
  const changes = {};
  const loc = parseLocation(text);
  const teacher = parseTeacher(text);
  if (/教室|地点|改成|改为|更换|换到|统一/.test(text) && loc) changes.location = loc;
  if (teacher) changes.teacher = teacher;
  if (/每周|全周|全部周次/.test(text)) changes.weekRule = { mode: 'every', ranges: [], weeks: [] };
  if (/单周/.test(text)) changes.weekRule = { mode: 'odd', ranges: [], weeks: [] };
  if (/双周/.test(text)) changes.weekRule = { mode: 'even', ranges: [], weeks: [] };
  const rangeM = text.match(/第?\s*(\d+)\s*-\s*(\d+)\s*周/);
  if (rangeM && /延长|改成|改为|调整为/.test(text)) {
    changes.weekRule = { mode: 'range', ranges: [{ start: Number(rangeM[1]), end: Number(rangeM[2]) }], weeks: [] };
  }

  if (Object.keys(changes).length && hits.length) {
    if (isBatch || hits.length > 1) {
      operations.push({ operation: 'batch_update', target_id: null, target_ids: hits.map((e) => e._id), changes: changes });
      return withNote(operations, '匹配到 ' + hits.length + ' 条，已批量修改');
    }
    operations.push({ operation: 'update_entry', target_id: hits[0]._id, target_ids: [], changes: changes });
    return withNote(operations, null);
  }

  return unknown('没太理解这条指令，换个说法试试？比如「第6周周五嵌入式停课」');
}

function unknown(question) {
  return {
    request_type: 'edit',
    operations: [{ operation: 'unknown', target_id: null, target_ids: [], question: question }],
    conflicts: [],
    output_candidates: [],
    confirm_note: null,
    question: question,
  };
}

function withNote(operations, note) {
  return {
    request_type: 'edit',
    operations: operations,
    conflicts: [],
    output_candidates: [],
    confirm_note: note,
    question: null,
  };
}

module.exports = { parseInstruction: parseInstruction, localParse: localParse, findCourses: findCourses };
