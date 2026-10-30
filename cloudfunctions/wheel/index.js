// 云函数 wheel：万能转盘的云端镜像
//
// 集合：wheels（转盘配置）、wheel_records（抽奖记录，保留 90 天）
// 定位：本地 storage 是真相源，这里只做多设备镜像备份 ——
//   前端写操作是「后台静默 push」，失败完全不影响使用；
//   只有本地没有任何转盘时，前端才调 listWheels 尝试恢复。
//
// 数据隔离：一律按 OPENID 过滤，_openid 由服务端强制写入，不信任前端传入。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COL_WHEEL = 'wheels';
const COL_RECORD = 'wheel_records';
/** 记录保留天数（云端） */
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function getOpenid() {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) throw new Error('未拿到 OPENID');
  return wxContext.OPENID;
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback || 0);
}

function bool(v) {
  return v === true || v === 'true' || v === 1;
}

/** 选项裁剪：只保留必要字段，避免把脏数据写进库 */
function cleanOption(o) {
  const src = o || {};
  const weight = Math.round(num(src.weight, 1));
  return {
    id: str(src.id, 64),
    text: str(src.text, 10) || '选项',
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(src.color || '')) ? src.color : '#C7B8A8',
    weight: weight < 1 ? 1 : weight > 9 ? 9 : weight,
    icon: str(src.icon, 8),
    done: bool(src.done),
    todoId: str(src.todoId, 64)
  };
}

function cleanWheel(w, openid) {
  const src = w || {};
  const options = Array.isArray(src.options) ? src.options.slice(0, 12).map(cleanOption) : [];
  const settings = src.settings || {};
  return {
    _openid: openid,
    name: str(src.name, 16) || '我的转盘',
    icon: str(src.icon, 8) || '🎡',
    theme: ['candy', 'morandi', 'festive', 'ocean', 'custom'].indexOf(src.theme) >= 0 ? src.theme : 'candy',
    options,
    settings: {
      duration: ['short', 'standard', 'long'].indexOf(settings.duration) >= 0 ? settings.duration : 'standard',
      shakeEnabled: bool(settings.shakeEnabled),
      soundEnabled: settings.soundEnabled === false ? false : true,
      vibrateEnabled: settings.vibrateEnabled === false ? false : true
    },
    isTemplate: bool(src.isTemplate),
    templateId: str(src.templateId, 40),
    useCount: num(src.useCount, 0),
    createdAt: num(src.createdAt, Date.now()),
    updatedAt: Date.now()
  };
}

/* ==================== actions ==================== */

/** 新增或整体覆盖一个转盘（以客户端 _id 为主键） */
async function upsertWheel(event, openid) {
  const w = event.wheel || {};
  const id = str(w._id, 64);
  if (!id) return { success: false, error: '缺少 _id' };
  const data = cleanWheel(w, openid);
  try {
    await db.collection(COL_WHEEL).doc(id).set({ data });
    return { success: true, id };
  } catch (err) {
    // 集合不存在时（-502005）自动建集合后重试一次
    if (String(err && err.message || '').indexOf('collection') >= 0) {
      try {
        await db.createCollection(COL_WHEEL);
        await db.collection(COL_WHEEL).doc(id).set({ data });
        return { success: true, id };
      } catch (e2) {
        return { success: false, error: String(e2 && e2.message || e2) };
      }
    }
    return { success: false, error: String(err && err.message || err) };
  }
}

async function removeWheel(event, openid) {
  const id = str(event.id, 64);
  if (!id) return { success: false, error: '缺少 id' };
  try {
    await db.collection(COL_WHEEL).where({ _id: id, _openid: openid }).remove();
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

async function listWheels(event, openid) {
  try {
    const res = await db
      .collection(COL_WHEEL)
      .where({ _openid: openid })
      .orderBy('updatedAt', 'desc')
      .limit(20)
      .get();
    return { success: true, wheels: res.data || [] };
  } catch (err) {
    // 集合还没建（用户从未同步过）：不是错误，返回空列表
    return { success: false, wheels: [], error: String(err && err.message || err) };
  }
}

async function addRecord(event, openid) {
  const r = event.record || {};
  const data = {
    _openid: openid,
    wheelId: str(r.wheelId, 64),
    wheelName: str(r.wheelName, 16),
    result: str(r.result, 20),
    resultIcon: str(r.resultIcon, 8),
    optionSnapshot: Array.isArray(r.optionSnapshot)
      ? r.optionSnapshot.slice(0, 12).map((s) => ({
          text: str(s && s.text, 20),
          color: /^#[0-9a-fA-F]{3,8}$/.test(String((s && s.color) || '')) ? s.color : '#C7B8A8',
          icon: str(s && s.icon, 8)
        }))
      : [],
    createdAt: num(r.createdAt, Date.now())
  };
  try {
    const res = await db.collection(COL_RECORD).add({ data });
    return { success: true, id: res._id };
  } catch (err) {
    if (String(err && err.message || '').indexOf('collection') >= 0) {
      try {
        await db.createCollection(COL_RECORD);
        const res2 = await db.collection(COL_RECORD).add({ data });
        return { success: true, id: res2._id };
      } catch (e2) {
        return { success: false, error: String(e2 && e2.message || e2) };
      }
    }
    return { success: false, error: String(err && err.message || err) };
  }
}

async function listRecords(event, openid) {
  try {
    const res = await db
      .collection(COL_RECORD)
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return { success: true, records: res.data || [] };
  } catch (err) {
    return { success: false, records: [], error: String(err && err.message || err) };
  }
}

async function removeRecord(event, openid) {
  const id = str(event.id, 64);
  if (!id) return { success: false, error: '缺少 id' };
  try {
    await db.collection(COL_RECORD).where({ _id: id, _openid: openid }).remove();
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

async function clearRecords(event, openid) {
  try {
    if (event.wheelId) {
      await db.collection(COL_RECORD).where({ _openid: openid, wheelId: str(event.wheelId, 64) }).remove();
    } else {
      await db.collection(COL_RECORD).where({ _openid: openid }).remove();
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

/** 清理 90 天前的记录（可在云开发控制台配定时触发器，也可不配） */
async function prune() {
  const deadline = Date.now() - RETENTION_DAYS * DAY_MS;
  try {
    const res = await db
      .collection(COL_RECORD)
      .where({ createdAt: _.lt(deadline) })
      .remove();
    return { success: true, removed: res.stats && res.stats.removed };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

const ACTIONS = {
  upsertWheel,
  removeWheel,
  listWheels,
  addRecord,
  listRecords,
  removeRecord,
  clearRecords,
  prune
};

exports.main = async (event = {}) => {
  const action = String(event.action || '');
  const fn = ACTIONS[action];
  if (!fn) {
    return { success: false, error: `未知 action: ${action}` };
  }
  try {
    const openid = getOpenid();
    return await fn(event, openid);
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
};
