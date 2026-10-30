// 云函数：memo —— 语音备忘录云端同步
// 部署：右键 cloudfunctions/memo → 上传并部署（云端安装依赖）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const col = db.collection('memos');

/* 字段白名单归一化（丢弃未知字段，防注入） */
function normalize(memo) {
  const m = memo || {};
  return {
    _id: String(m._id || ''),
    title: String(m.title || '').slice(0, 200),
    content: String(m.content || '').slice(0, 50000),
    checklist: Array.isArray(m.checklist)
      ? m.checklist.slice(0, 200).map((c) => ({
          id: String((c && c.id) || ''),
          text: String((c && c.text) || '').slice(0, 500),
          done: !!(c && c.done)
        }))
      : [],
    isChecklist: !!m.isChecklist,
    audioList: Array.isArray(m.audioList)
      ? m.audioList.slice(0, 50).map((a) => ({
          id: String((a && a.id) || ''),
          src: String((a && a.src) || '').slice(0, 500),
          duration: Math.max(0, Math.min(3600, Number((a && a.duration) || 0))),
          text: String((a && a.text) || '').slice(0, 5000),
          status: ['pending', 'done', 'failed'].includes(a && a.status) ? a.status : 'pending',
          anchor: Number((a && a.anchor) || 0),
          createTime: Number((a && a.createTime) || 0)
        }))
      : [],
    imageList: Array.isArray(m.imageList) ? m.imageList.slice(0, 20).map(String) : [],
    color: String(m.color || '#f59e0b').slice(0, 20),
    folderId: String(m.folderId || ''),
    tags: Array.isArray(m.tags) ? m.tags.slice(0, 20).map((t) => String(t).slice(0, 30)) : [],
    isLocked: !!m.isLocked,
    lockHash: String(m.lockHash || '').slice(0, 40),
    isPinned: !!m.isPinned,
    isArchived: !!m.isArchived,
    versions: Array.isArray(m.versions)
      ? m.versions.slice(0, 20).map((v) => ({
          id: String((v && v.id) || ''),
          title: String((v && v.title) || '').slice(0, 200),
          content: String((v && v.content) || '').slice(0, 50000),
          createTime: Number((v && v.createTime) || 0)
        }))
      : [],
    createTime: Number(m.createTime || Date.now()),
    updateTime: Number(m.updateTime || Date.now()),
    version: Math.max(1, Number(m.version || 1))
  };
}

function ok(data) {
  return Object.assign({ success: true }, data);
}
function fail(error) {
  return { success: false, error: String(error) };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'list';

  try {
    switch (action) {
      case 'list': {
        const res = await col.where({ _openid: OPENID }).limit(1000).get();
        return ok({ items: res.data });
      }
      case 'upsert': {
        const memo = normalize(event.memo);
        if (!memo._id) return fail('_id 必填');
        try {
          await col.doc(memo._id).set({ data: memo });
        } catch (e) {
          await col.add({ data: Object.assign({}, memo, { _id: undefined }) });
        }
        return ok({ id: memo._id });
      }
      case 'upsertMany': {
        const memos = Array.isArray(event.memos) ? event.memos.slice(0, 200) : [];
        let count = 0;
        for (const raw of memos) {
          const memo = normalize(raw);
          if (!memo._id) continue;
          try {
            await col.doc(memo._id).set({ data: memo });
          } catch (e) {
            await col.add({ data: Object.assign({}, memo, { _id: undefined }) });
          }
          count += 1;
        }
        return ok({ count });
      }
      case 'remove': {
        const id = String(event._id || '');
        if (!id) return fail('_id 必填');
        await col.doc(id).remove();
        return ok({ removed: 1 });
      }
      case 'clear': {
        const res = await col.where({ _openid: OPENID }).remove();
        return ok({ removed: res.stats ? res.stats.removed : 0 });
      }
      default:
        return fail(`未知 action: ${action}`);
    }
  } catch (err) {
    console.error('[memo] error', err);
    return fail(err.message || '云端执行失败');
  }
};
