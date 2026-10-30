'use strict';

/**
 * AI 输出校验器 —— AI 的 JSON 绝不能直接入库，必须过这一层。
 *
 * 设计原则：
 * 1. 能修的就地修（截断、夹紧、纠正 start>end），修完记进 warnings；
 * 2. 修不了的整条剔除，记进 errors + rejected，不拖垮整份 payload；
 * 3. ok=false 只保留给"整体结构不可信"的情况（类型错、数组缺失），
 *    此时调用方应降级为手动添加，而不是写入脏数据。
 */

const time = require('./time');
const weekRule = require('./weekRule');

const EDIT_OPERATIONS = [
  'update_entry', 'weekly_override', 'add_entry', 'delete_entry',
  'add_exception_range', 'batch_update', 'settings', 'unknown',
];

const CHANGE_KEYS = [
  'title', 'weekday', 'startTime', 'endTime', 'location', 'teacher',
  'weekRule', 'start_date', 'end_date', 'note',
];

function err(errors, path, message) { errors.push({ path: path, message: message }); }
function warn(warnings, path, message) { warnings.push({ path: path, message: message }); }

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/* ------------------------------ import ------------------------------ */

function validateEntry(raw, totalWeeks, errors, warnings, path) {
  if (!isObj(raw)) { err(errors, path, '不是对象'); return null; }

  // title：必填，去符号后 ≤15 字
  let title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) { err(errors, path + '.title', '标题为空，该条已剔除'); return null; }
  if (title.length > 15) {
    title = title.slice(0, 15);
    warn(warnings, path + '.title', '标题超 15 字已截断：' + title);
  }

  // weekday：1~7
  const weekday = Math.trunc(Number(raw.weekday));
  if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) {
    err(errors, path + '.weekday', 'weekday 非法：' + raw.weekday + '，该条已剔除');
    return null;
  }

  // 时间：null 或 HH:MM，start 必须早于 end（颠倒则自动交换）
  let startTime = raw.startTime == null ? null : String(raw.startTime);
  let endTime = raw.endTime == null ? null : String(raw.endTime);
  if (startTime !== null && !time.isHHMM(startTime)) {
    warn(warnings, path + '.startTime', '时间格式非法已置空：' + startTime);
    startTime = null;
  }
  if (endTime !== null && !time.isHHMM(endTime)) {
    warn(warnings, path + '.endTime', '时间格式非法已置空：' + endTime);
    endTime = null;
  }
  if (startTime && endTime && !time.isStartBeforeEnd(startTime, endTime)) {
    const t = startTime; startTime = endTime; endTime = t;
    warn(warnings, path, '起止时间颠倒已纠正为 ' + startTime + '-' + endTime);
  }

  const rule = weekRule.normalizeWeekRule(raw.weekRule, totalWeeks);
  if (raw.weekRule && rule.mode !== raw.weekRule.mode) {
    warn(warnings, path + '.weekRule', 'weekRule 无法解析已退化为 every');
  }

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.8;
  confidence = Math.min(1, Math.max(0, confidence));

  let note = typeof raw.note === 'string' ? raw.note : '';
  if (note.length > 40) note = note.slice(0, 40);

  return {
    title: title,
    weekday: weekday,
    startTime: startTime,
    endTime: endTime,
    location: typeof raw.location === 'string' && raw.location ? raw.location : null,
    teacher: typeof raw.teacher === 'string' && raw.teacher ? raw.teacher : null,
    weekRule: rule,
    confidence: confidence,
    note: note,
  };
}

function validateImport(payload, ctx) {
  const totalWeeks = ctx && ctx.totalWeeks ? ctx.totalWeeks : 16;
  const errors = [];
  const warnings = [];

  if (!isObj(payload)) {
    return { ok: false, value: null, errors: [{ path: '$', message: 'payload 不是对象' }], warnings: warnings, rejected: [] };
  }
  if (payload.request_type !== 'import') {
    err(errors, '$.request_type', '期望 import，实际 ' + payload.request_type);
  }
  if (!Array.isArray(payload.entries)) {
    return { ok: false, value: null, errors: [{ path: '$.entries', message: 'entries 不是数组' }], warnings: warnings, rejected: [] };
  }

  const entries = [];
  const rejected = [];
  payload.entries.forEach((raw, i) => {
    const item = validateEntry(raw, totalWeeks, errors, warnings, '$.entries[' + i + ']');
    if (item) entries.push(item); else rejected.push(raw);
  });

  const value = {
    request_type: 'import',
    table_meta: {
      title: isObj(payload.table_meta) && typeof payload.table_meta.title === 'string' ? payload.table_meta.title : null,
      semester_hint: isObj(payload.table_meta) && typeof payload.table_meta.semester_hint === 'string' ? payload.table_meta.semester_hint : null,
    },
    entries: entries,
    incomplete: Array.isArray(payload.incomplete) ? payload.incomplete : [],
    ignored_lines: Array.isArray(payload.ignored_lines) ? payload.ignored_lines : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.slice() : [],
  };

  // 条目内部交叉冲突
  weekRule.findConflicts(entries, totalWeeks).forEach((c) => value.warnings.push(c.detail));

  return { ok: true, value: value, errors: errors, warnings: warnings, rejected: rejected };
}

/* ------------------------------- edit ------------------------------- */

function validateChanges(raw, totalWeeks, errors, warnings, path) {
  if (!isObj(raw)) return undefined;
  const out = {};

  if (raw.title !== undefined) {
    let t = String(raw.title).trim();
    if (!t) { err(errors, path + '.title', '标题为空，已忽略该字段'); }
    else {
      if (t.length > 15) { t = t.slice(0, 15); warn(warnings, path + '.title', '标题超 15 字已截断'); }
      out.title = t;
    }
  }
  if (raw.weekday !== undefined) {
    const w = Math.trunc(Number(raw.weekday));
    if (!Number.isFinite(w) || w < 1 || w > 7) err(errors, path + '.weekday', 'weekday 非法：' + raw.weekday + '，已忽略');
    else out.weekday = w;
  }
  ['startTime', 'endTime'].forEach((k) => {
    if (raw[k] === undefined) return;
    const v = String(raw[k]);
    if (!time.isHHMM(v)) err(errors, path + '.' + k, '时间格式非法：' + v + '，已忽略');
    else out[k] = v;
  });
  ['location', 'teacher'].forEach((k) => {
    if (raw[k] !== undefined && typeof raw[k] === 'string') out[k] = raw[k];
  });
  if (raw.note !== undefined && typeof raw.note === 'string') out.note = raw.note;
  if (raw.weekRule !== undefined) out.weekRule = weekRule.normalizeWeekRule(raw.weekRule, totalWeeks);
  ['start_date', 'end_date'].forEach((k) => {
    if (raw[k] === undefined) return;
    const v = String(raw[k]);
    if (!time.isDate(v)) err(errors, path + '.' + k, '日期格式非法：' + v + '，已忽略');
    else out[k] = v;
  });

  if (out.startTime && out.endTime && !time.isStartBeforeEnd(out.startTime, out.endTime)) {
    const t = out.startTime; out.startTime = out.endTime; out.endTime = t;
    warn(warnings, path, '起止时间颠倒已纠正');
  }

  Object.keys(raw).forEach((k) => {
    if (CHANGE_KEYS.indexOf(k) === -1) warn(warnings, path, '忽略未知字段 ' + k);
  });

  return Object.keys(out).length ? out : undefined;
}

function validateOperation(raw, ctx, errors, warnings, path) {
  const totalWeeks = ctx.totalWeeks;
  const validIds = ctx.validIds || [];

  if (!isObj(raw)) { err(errors, path, '不是对象'); return null; }
  if (EDIT_OPERATIONS.indexOf(raw.operation) === -1) {
    err(errors, path + '.operation', '未知 operation：' + raw.operation + '，已剔除');
    return null;
  }

  const op = { operation: raw.operation, target_id: null, target_ids: [] };

  // target_id 必须命中现有条目，禁止凭空编造
  if (raw.target_id !== undefined && raw.target_id !== null) {
    if (validIds.indexOf(String(raw.target_id)) === -1) {
      err(errors, path + '.target_id', 'target_id 不在课表中：' + raw.target_id + '，已置空');
    } else {
      op.target_id = String(raw.target_id);
    }
  }
  if (Array.isArray(raw.target_ids)) {
    op.target_ids = raw.target_ids.map(String).filter((id) => {
      if (validIds.indexOf(id) === -1) {
        err(errors, path + '.target_ids', 'target_id 不在课表中：' + id + '，已剔除');
        return false;
      }
      return true;
    });
  }

  if (raw.week !== undefined) {
    const w = Math.trunc(Number(raw.week));
    if (!Number.isFinite(w) || w < 1 || w > totalWeeks) {
      err(errors, path + '.week', 'week 超出 1~' + totalWeeks + '：' + raw.week + '，已忽略');
    } else {
      op.week = w;
    }
  }
  if (raw.cancelled !== undefined) op.cancelled = raw.cancelled === true;

  const changes = validateChanges(raw.changes, totalWeeks, errors, warnings, path + '.changes');
  if (changes) op.changes = changes;

  if (raw.operation === 'unknown' && typeof raw.question !== 'string') {
    warn(warnings, path, 'unknown 操作缺少 question，前端无法提示用户');
  }
  if (typeof raw.question === 'string') op.question = raw.question;

  return op;
}

function validateEdit(payload, ctx) {
  const errors = [];
  const warnings = [];
  ctx = ctx || {};
  ctx.totalWeeks = ctx.totalWeeks || 16;

  if (!isObj(payload)) {
    return { ok: false, value: null, errors: [{ path: '$', message: 'payload 不是对象' }], warnings: warnings, rejected: [] };
  }
  if (payload.request_type !== 'edit') err(errors, '$.request_type', '期望 edit，实际 ' + payload.request_type);
  if (!Array.isArray(payload.operations)) {
    return { ok: false, value: null, errors: [{ path: '$.operations', message: 'operations 不是数组' }], warnings: warnings, rejected: [] };
  }

  const operations = [];
  const rejected = [];
  payload.operations.forEach((raw, i) => {
    const op = validateOperation(raw, ctx, errors, warnings, '$.operations[' + i + ']');
    if (op) operations.push(op); else rejected.push(raw);
  });

  return {
    ok: true,
    value: {
      request_type: 'edit',
      operations: operations,
      conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
      output_candidates: Array.isArray(payload.output_candidates) ? payload.output_candidates : [],
      confirm_note: typeof payload.confirm_note === 'string' ? payload.confirm_note : '',
      question: typeof payload.question === 'string' ? payload.question : '',
    },
    errors: errors,
    warnings: warnings,
    rejected: rejected,
  };
}

function validate(payload, ctx) {
  if (isObj(payload) && payload.request_type === 'import') return validateImport(payload, ctx);
  if (isObj(payload) && payload.request_type === 'edit') return validateEdit(payload, ctx);
  return {
    ok: false,
    value: null,
    errors: [{ path: '$.request_type', message: '未知 request_type：' + (isObj(payload) ? payload.request_type : typeof payload) }],
    warnings: [],
    rejected: [],
  };
}

module.exports = { validate: validate, validateImport: validateImport, validateEdit: validateEdit, EDIT_OPERATIONS: EDIT_OPERATIONS };
