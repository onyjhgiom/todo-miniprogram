'use strict';

/**
 * 把 AI 产出的 edit operations 落到 ScheduleStore
 * 只吃 validator 校验通过的 payload，保证不会把脏数据写进底表。
 */

const weekRule = require('../utils/weekRule');

const RESULT_OK = 'applied';
const RESULT_SKIP = 'skipped';

function stripInternal(changes) {
  if (!changes) return undefined;
  const out = {};
  Object.keys(changes).forEach((k) => { if (k !== 'start_date' && k !== 'end_date') out[k] = changes[k]; });
  return Object.keys(out).length ? out : undefined;
}

function applyUpdate(store, id, changes, label) {
  if (!id) return { status: RESULT_SKIP, reason: '缺少 target_id' };
  if (!changes || !Object.keys(changes).length) return { status: RESULT_SKIP, reason: '缺少 changes' };

  // 带 start_date → 阶段性生效，写成 from 覆盖，不动底表
  if (changes.start_date) {
    const fromWeek = store.weekOfDate(changes.start_date);
    if (fromWeek === null) {
      return { status: RESULT_SKIP, reason: 'start_date 超出学期范围：' + changes.start_date };
    }
    const body = stripInternal(changes);
    store.addOverrideSilently({ entryId: id, kind: 'from', fromWeek: fromWeek, changes: body });
    return { status: RESULT_OK, detail: '第' + fromWeek + '周起生效（未改动底表）' };
  }

  // 整学期生效 → 直接改底表
  store.updateEntrySilently(id, changes);
  return { status: RESULT_OK, detail: label || '已更新' };
}

/**
 * @param {ScheduleStore} store
 * @param {Object} payload 校验通过的 edit payload
 * @returns {{applied:Array, skipped:Array, conflicts:Array}}
 */
function applyEdit(store, payload) {
  const applied = [];
  const skipped = [];

  if (!payload || payload.request_type !== 'edit') {
    return { applied: applied, skipped: [{ operation: 'payload', reason: '不是 edit payload' }], conflicts: [] };
  }

  // 整批操作压成一个撤销点
  store.mutate('ai-edit', () => {
    payload.operations.forEach((op) => {
      const base = { operation: op.operation, target_id: op.target_id, target_ids: op.target_ids };

      switch (op.operation) {
        case 'update_entry': {
          const r = applyUpdate(store, op.target_id, op.changes);
          (r.status === RESULT_OK ? applied : skipped).push(Object.assign({}, base, r));
          break;
        }

        case 'batch_update': {
          const ids = op.target_ids || [];
          if (!ids.length) { skipped.push(Object.assign({}, base, { reason: 'target_ids 为空' })); break; }
          if (op.changes && op.changes.start_date) {
            const fromWeek = store.weekOfDate(op.changes.start_date);
            const body = stripInternal(op.changes);
            ids.forEach((id) => store.addOverrideSilently({ entryId: id, kind: 'from', fromWeek: fromWeek, changes: body }));
            applied.push(Object.assign({}, base, { detail: ids.length + ' 条自第' + fromWeek + '周起生效' }));
          } else {
            ids.forEach((id) => store.updateEntrySilently(id, op.changes));
            applied.push(Object.assign({}, base, { detail: '已批量更新 ' + ids.length + ' 条' }));
          }
          break;
        }

        case 'weekly_override': {
          if (!op.target_id) { skipped.push(Object.assign({}, base, { reason: '缺少 target_id' })); break; }
          if (!op.week) { skipped.push(Object.assign({}, base, { reason: '缺少 week' })); break; }
          store.addOverrideSilently({
            entryId: op.target_id,
            kind: 'week',
            week: op.week,
            cancelled: op.cancelled === true,
            changes: op.changes || undefined,
          });
          applied.push(Object.assign({}, base, { detail: '第' + op.week + '周' + (op.cancelled ? '停课' : '调整') }));
          break;
        }

        case 'add_entry': {
          if (!op.changes || !op.changes.title) { skipped.push(Object.assign({}, base, { reason: '缺少课程名' })); break; }
          const created = store.addEntrySilently(op.changes);
          applied.push(Object.assign({}, base, { detail: '已新增 ' + op.changes.title, new_id: created._id }));
          break;
        }

        case 'delete_entry': {
          if (!op.target_id) { skipped.push(Object.assign({}, base, { reason: '缺少 target_id' })); break; }
          store.removeEntrySilently(op.target_id);
          applied.push(Object.assign({}, base, { detail: '已删除' }));
          break;
        }

        case 'add_exception_range': {
          // 连续停课 / 放假：展开成多条 week 覆盖
          const start = op.changes && op.changes.start_date ? store.weekOfDate(op.changes.start_date) : null;
          const end = op.changes && op.changes.end_date ? store.weekOfDate(op.changes.end_date) : null;
          if (start === null || end === null) { skipped.push(Object.assign({}, base, { reason: '日期区间无法换算为周次' })); break; }
          for (let w = start; w <= end; w += 1) {
            store.addOverrideSilently({ entryId: op.target_id, kind: 'week', week: w, cancelled: true });
          }
          applied.push(Object.assign({}, base, { detail: '第' + start + '-' + end + '周停课' }));
          break;
        }

        case 'unknown': {
          skipped.push(Object.assign({}, base, { reason: op.question || '指令不明确，需用户确认' }));
          break;
        }

        default:
          skipped.push(Object.assign({}, base, { reason: '暂不支持的 operation：' + op.operation }));
      }
    });
  });

  return { applied: applied, skipped: skipped, conflicts: store.conflicts() };
}

module.exports = { applyEdit: applyEdit };
