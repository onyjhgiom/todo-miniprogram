'use strict';

/**
 * 课表存储层：entries（原始课表） + overrides（单周/起始周覆盖）分离
 *
 * 核心思想：
 * - entries 只由「导入」和「整学期修改」改动，是干净的底表；
 * - 「第6周停课」「第8周起改到周五」这类临时/阶段性改动全部落到 overrides；
 * - 渲染时按周 merge，切周 = 换 merge 参数，底表永不被污染，撤销也只是一句话。
 */

const time = require('../utils/time');
const weekRule = require('../utils/weekRule');

const KEY = 'course_schedule_v1';
const UNDO_LIMIT = 10;

function memoryStorage() {
  const mem = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

function detectStorage() {
  if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
    return {
      getItem: (k) => {
        try { const v = wx.getStorageSync(k); return v === '' || v === undefined ? null : v; }
        catch (e) { return null; }
      },
      setItem: (k, v) => { try { wx.setStorageSync(k, v); } catch (e) { /* 配额满，静默降级为内存态 */ } },
      removeItem: (k) => { try { wx.removeStorageSync(k); } catch (e) {} },
    };
  }
  if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  return memoryStorage();
}

let seed = 0;
function genId(prefix) {
  seed += 1;
  return prefix + Date.now().toString(36) + seed.toString(36);
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function ScheduleStore(options) {
  options = options || {};
  this.storage = options.storage || detectStorage();
  this.key = options.key || KEY;
  this.totalWeeks = options.totalWeeks || 16;
  this.semesterStart = options.semesterStart || '2026-09-01';
  this.state = { entries: [], overrides: [] };
  this.undoStack = [];
  this.load();
}

ScheduleStore.prototype.load = function load() {
  try {
    const raw = this.storage.getItem(this.key);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && Array.isArray(parsed.entries)) {
        this.state = {
          entries: parsed.entries.map((e) => ({
            _id: e._id,
            title: e.title,
            weekday: e.weekday,
            startTime: e.startTime,
            endTime: e.endTime,
            location: e.location || null,
            teacher: e.teacher || null,
            weekRule: weekRule.normalizeWeekRule(e.weekRule, this.totalWeeks),
            note: e.note || '',
          })),
          overrides: Array.isArray(parsed.overrides) ? parsed.overrides : [],
        };
      }
    }
  } catch (e) {
    this.state = { entries: [], overrides: [] };
  }
  return this.state;
};

ScheduleStore.prototype.persist = function persist() {
  this.storage.setItem(this.key, JSON.stringify(this.state));
};

/** 所有写操作都走这里：先压快照，再执行，天然支持撤销 */
ScheduleStore.prototype.mutate = function mutate(label, fn) {
  this.undoStack.push({ label: label || 'edit', state: clone(this.state) });
  if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  fn(this.state);
  this.persist();
  return this.state;
};

ScheduleStore.prototype.undo = function undo() {
  const last = this.undoStack.pop();
  if (!last) return false;
  this.state = last.state;
  this.persist();
  return true;
};

ScheduleStore.prototype.canUndo = function canUndo() { return this.undoStack.length > 0; };

ScheduleStore.prototype.getEntries = function getEntries() { return this.state.entries; };
ScheduleStore.prototype.getIds = function getIds() { return this.state.entries.map((e) => e._id); };

ScheduleStore.prototype.replaceAll = function replaceAll(entries) {
  return this.mutate('import', (s) => {
    s.entries = entries.map((e) => Object.assign({ _id: e._id || genId('e') }, e));
    s.overrides = [];
  });
};

ScheduleStore.prototype.addEntries = function addEntries(entries) {
  return this.mutate('import-append', (s) => {
    entries.forEach((e) => { s.entries.push(Object.assign({ _id: e._id || genId('e') }, e)); });
  });
};

/* 静默写：不产生撤销点，供 applyEdit 在同一个批次里批量调用 */
ScheduleStore.prototype.addEntrySilently = function addEntrySilently(entry) {
  const e = Object.assign({ _id: entry._id || genId('e') }, entry);
  this.state.entries.push(e);
  return e;
};

ScheduleStore.prototype.updateEntrySilently = function updateEntrySilently(id, changes) {
  const target = this.state.entries.find((e) => e._id === id);
  if (target) Object.assign(target, changes);
  return target;
};

ScheduleStore.prototype.removeEntrySilently = function removeEntrySilently(id) {
  this.state.entries = this.state.entries.filter((e) => e._id !== id);
  this.state.overrides = this.state.overrides.filter((o) => o.entryId !== id);
};

ScheduleStore.prototype.addOverrideSilently = function addOverrideSilently(ov) {
  const o = Object.assign({ _id: ov._id || genId('o') }, ov);
  this.state.overrides.push(o);
  return o;
};

ScheduleStore.prototype.addEntry = function addEntry(entry) {
  let created;
  this.mutate('add', () => { created = this.addEntrySilently(entry); });
  return created;
};

ScheduleStore.prototype.updateEntry = function updateEntry(id, changes) {
  return this.mutate('update', () => { this.updateEntrySilently(id, changes); });
};

ScheduleStore.prototype.removeEntry = function removeEntry(id) {
  return this.mutate('delete', () => { this.removeEntrySilently(id); });
};

ScheduleStore.prototype.addOverride = function addOverride(ov) {
  let created;
  this.mutate('override', () => { created = this.addOverrideSilently(ov); });
  return created;
};

ScheduleStore.prototype.getOverrides = function getOverrides() { return this.state.overrides; };

/* --------------------- 就地编辑（卡片改字段） --------------------- */

/**
 * 定位「用户在第 week 周看到的那份数据」实际存在哪。
 *
 * 为什么需要它：页面上显示的是 merge 后的视图，同一门课在不同周可能来自三个地方
 * —— 本周 override、某个「从第 N 周起」的 override、或底表。
 * 一律写底表会出现「改了没反应」：第6周恰好有 override 覆盖了教室，
 * 改底表后 override 优先级更高，用户看到的仍是旧值。
 *
 * @returns {{type:'week'|'from'|'entry', ref:Object}|null}
 */
ScheduleStore.prototype.resolveEditTarget = function resolveEditTarget(id, week) {
  // 1) 本周覆盖：优先级最高，视图就是它渲染的
  const wov = this.state.overrides.find(
    (o) => o.entryId === id && o.kind === 'week' && o.week === week
  );
  if (wov) return { type: 'week', ref: wov };

  // 2) 「从第 N 周起」的覆盖：可能有多条，取最后生效的那条（fromWeek 最大）
  const froms = this.state.overrides
    .filter((o) => o.entryId === id && o.kind === 'from' && week >= o.fromWeek)
    .sort((a, b) => a.fromWeek - b.fromWeek);
  if (froms.length) return { type: 'from', ref: froms[froms.length - 1] };

  // 3) 都没有 → 底表
  const entry = this.state.entries.find((e) => e._id === id);
  if (entry) return { type: 'entry', ref: entry };
  return null;
};

/**
 * 就地编辑的写入口：改的是「当前周看到的那个值」，并压一个撤销点。
 * @returns {{type:string, ref:Object}|null} null 表示条目不存在
 */
ScheduleStore.prototype.applyEntryEditForWeek = function applyEntryEditForWeek(id, week, changes) {
  const target = this.resolveEditTarget(id, week);
  if (!target) return null;

  if (target.type === 'entry') {
    this.mutate('inline-edit', () => { this.updateEntrySilently(id, changes); });
  } else {
    // 覆盖层只存差量，合并而不是替换（原覆盖可能还改了别的字段）
    this.mutate('inline-edit-override', () => {
      target.ref.changes = Object.assign({}, target.ref.changes || {}, clone(changes));
    });
  }
  return target;
};

/* --------------------------- 周次 ↔ 日期 --------------------------- */

/** week n 起始日 = semesterStart + (n-1)*7 */
ScheduleStore.prototype.weekStart = function weekStart(week) {
  return time.addDays(this.semesterStart, (week - 1) * 7);
};

/** 日期 → 周次；超出学期范围返回 null */
ScheduleStore.prototype.weekOfDate = function weekOfDate(dateStr) {
  if (!time.isDate(dateStr)) return null;
  const diff = time.diffDays(this.semesterStart, dateStr);
  if (diff < 0) return null;
  const week = Math.floor(diff / 7) + 1;
  return week >= 1 && week <= this.totalWeeks ? week : null;
};

/* ------------------------------ 渲染 ------------------------------ */

/**
 * 取某一周 merge 后的课表
 * 优先级：周覆盖(week) > 起始周覆盖(from) > 底表
 */
ScheduleStore.prototype.getWeek = function getWeek(week) {
  const totalWeeks = this.totalWeeks;
  const out = [];

  this.state.entries.forEach((entry) => {
    let view = clone(entry);

    // 1) 起始周覆盖：week >= fromWeek 时生效，按 fromWeek 升序叠加
    const froms = this.state.overrides
      .filter((o) => o.entryId === entry._id && o.kind === 'from' && week >= o.fromWeek)
      .sort((a, b) => a.fromWeek - b.fromWeek);
    froms.forEach((f) => { if (f.changes) view = Object.assign(view, clone(f.changes)); });

    // 2) 可见性：以 merge 后的 weekRule 判断（覆盖可能改了周次规则）
    if (weekRule.expandWeeks(view.weekRule, totalWeeks).indexOf(week) === -1) return;

    // 3) 周覆盖：优先级最高，cancelled 直接隐藏
    const wov = this.state.overrides.find(
      (o) => o.entryId === entry._id && o.kind === 'week' && o.week === week
    );
    if (wov) {
      if (wov.cancelled === true) return;
      if (wov.changes) view = Object.assign(view, clone(wov.changes));
    }

    view._overridden = froms.length > 0 || !!wov;
    out.push(view);
  });

  return out.sort((a, b) => (a.weekday - b.weekday) || String(a.startTime).localeCompare(String(b.startTime)));
};

/** 单周冲突 */
ScheduleStore.prototype.conflictsOfWeek = function conflictsOfWeek(week) {
  return weekRule.findConflicts(this.getWeek(week), this.totalWeeks);
};

/** 整学期冲突（跨周去重，并记录具体冲突周次） */
ScheduleStore.prototype.conflicts = function conflicts() {
  const map = {};
  for (let w = 1; w <= this.totalWeeks; w += 1) {
    this.conflictsOfWeek(w).forEach((c) => {
      const k = c.target_id + '|' + c.conflict_with_id;
      if (!map[k]) {
        map[k] = { target_id: c.target_id, conflict_with_id: c.conflict_with_id, detail: c.detail, weeks: [] };
      }
      map[k].weeks.push(w);
    });
  }
  return Object.keys(map).map((k) => map[k]);
};

ScheduleStore.prototype.clear = function clear() {
  this.mutate('clear', (s) => { s.entries = []; s.overrides = []; });
};

module.exports = ScheduleStore;
module.exports.genId = genId;
