// 云函数 love：爱遇小栈的「共享同步」+「双人空间」+「双方天气」
//
// 设计原则（与全站其它云函数一致）：
//  1) 云端只是第二份副本：前端本地优先，云端失败一律静默降级，绝不让用户卡住；
//  2) 数据隔离 + 权限校验：所有双人数据按 pairId 隔离，写入时服务端强制记录 openid/角色，
//     不信任前端传的身份；任何读写前先 ensureMember()，非成员一律拒绝；
//  3) 天气的密钥只存在于服务端环境变量 QWEATHER_KEY，前端永远拿不到；
//     没配就返回 ok:false，前端降级到「按季节估算」并明确标注来源。
//
// 集合：
//  · love_rooms（旧）房间快照同步：{ room, slots:{ me:{openid,at,snapshot}, him:{...} } }
//  · love_pairs（新）情侣绑定：{ openids[], members[], code, codeAt, status }
//  · love_duo （新）双人协作内容：{ pairId, kind, id, data, updatedAt, by, deleted }

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COL_ROOM = 'love_rooms';
const COL_PAIR = 'love_pairs';
const COL_DUO = 'love_duo';

/** 单份快照上限（字节）——超过直接拒绝，避免撑爆云函数入参限制 */
const MAX_SNAPSHOT = 600 * 1024;
/** 邀请码有效期 */
const CODE_TTL = 24 * 60 * 60 * 1000;
/** 单次 duo 同步最多条数，防止一次请求过大 */
const DUO_LIMIT = 200;
/** 允许的 duo 内容类型白名单——任何不在名单里的 kind 一律拒绝，避免被当免费数据库用 */
const DUO_KINDS = ['msg', 'mood', 'anniv', 'signal', 'wish', 'task', 'post', 'comment'];

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

function normRole(r) {
  return r === 'him' ? 'him' : 'me';
}

function ok(data) {
  return Object.assign({ success: true, ok: true }, data || {});
}

function fail(msg) {
  return { success: true, ok: false, error: msg || '失败' };
}

/* ============================ 旧：房间快照同步 ============================ */

async function findRoom(room) {
  const res = await db.collection(COL_ROOM).where({ room }).limit(1).get();
  return (res && res.data && res.data[0]) || null;
}

/** 探测：前端用它判断云端是否真的可用（未部署 / 集合没建都会走到 fail 分支） */
async function probe() {
  // 集合不存在时这里会抛 -502005，外层 catch 统一转成 ok:false
  await db.collection(COL_ROOM).limit(1).get();
  return ok({});
}

async function pair(data) {
  const room = str(data.room, 12).toUpperCase();
  const role = normRole(data.role);
  if (!/^[A-Z0-9]{4,12}$/.test(room)) return fail('房间号不合法');
  const openid = getOpenid();
  const now = Date.now();

  const exist = await findRoom(room);
  if (!exist) {
    const doc = {
      room,
      createdAt: now,
      updatedAt: now,
      slots: { me: null, him: null }
    };
    doc.slots[role] = { openid, at: now, snapshot: null };
    await db.collection(COL_ROOM).add({ data: doc });
    return ok({ room, role });
  }

  const patch = { updatedAt: now };
  patch[`slots.${role}`] = { openid, at: now, snapshot: (exist.slots && exist.slots[role] && exist.slots[role].snapshot) || null };
  await db.collection(COL_ROOM).doc(exist._id).update({ data: patch });
  return ok({ room, role });
}

async function push(data) {
  const room = str(data.room, 12).toUpperCase();
  const role = normRole(data.role);
  const snap = data.snapshot;
  if (!room) return fail('缺少房间号');
  if (!snap || typeof snap !== 'object') return fail('缺少数据');

  const size = Buffer.byteLength(JSON.stringify(snap), 'utf8');
  if (size > MAX_SNAPSHOT) return fail('数据太大了，先删掉一些旧记录再同步');

  const openid = getOpenid();
  const now = Date.now();
  const exist = await findRoom(room);
  if (!exist) {
    const doc = { room, createdAt: now, updatedAt: now, slots: { me: null, him: null } };
    doc.slots[role] = { openid, at: now, snapshot: snap };
    await db.collection(COL_ROOM).add({ data: doc });
    return ok({ pushed: size });
  }
  // 权限：只能覆盖「自己那个槽位」，且槽位记录的 openid 必须是本人
  const slot = exist.slots ? exist.slots[role] : null;
  if (slot && slot.openid && slot.openid !== openid) return fail('这个房间号已被他人占用');
  const patch = { updatedAt: now };
  patch[`slots.${role}`] = { openid, at: now, snapshot: snap };
  await db.collection(COL_ROOM).doc(exist._id).update({ data: patch });
  return ok({ pushed: size });
}

/** 拉取**对方**槽位的数据——拉自己那份没有意义 */
async function pull(data) {
  const room = str(data.room, 12).toUpperCase();
  const role = normRole(data.role);
  if (!room) return fail('缺少房间号');
  const openid = getOpenid();
  const exist = await findRoom(room);
  if (!exist) return fail('房间不存在，先配对');
  // 权限：必须是房间里登记过的成员才能拉对方的数据，光知道房间号不算
  const mine = exist.slots ? exist.slots[role] : null;
  if (!mine || mine.openid !== openid) return fail('你还没有加入这个房间，请先配对');
  const other = role === 'me' ? 'him' : 'me';
  const slot = exist.slots ? exist.slots[other] : null;
  if (!slot || !slot.snapshot) return fail('对方还没有上传过数据');
  return ok({ snapshot: slot.snapshot, at: slot.at });
}

/* ============================ 新：情侣绑定（love_pairs） ============================ */

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 I L O 0 1，避免抄错

function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

async function findMyPair(openid) {
  const r = await db
    .collection(COL_PAIR)
    .where({ openids: openid, status: _.in(['pending', 'bound']) })
    .limit(1)
    .get();
  return (r && r.data && r.data[0]) || null;
}

async function findByCode(code) {
  const r = await db.collection(COL_PAIR).where({ code }).limit(1).get();
  return (r && r.data && r.data[0]) || null;
}

function roleOf(p, openid) {
  const m = (p.members || []).find((x) => x.openid === openid);
  return m ? m.role : 'me';
}

function partnerOf(p, openid) {
  const m = (p.members || []).find((x) => x.openid !== openid);
  return m || null;
}

/**
 * 权限闸门：读写任何双人数据前都必须过这一关。
 * 非成员 / 已解除的关系一律拒绝 —— 这是「情侣内容仅对绑定的双方可见」的最后一道防线，
 * 不能只靠前端隐藏。
 */
async function ensureMember(pairId, openid) {
  if (!pairId) return { p: null, err: '缺少关系 ID' };
  let p = null;
  try {
    const r = await db.collection(COL_PAIR).doc(pairId).get();
    p = (r && r.data) || null;
  } catch (e) {
    p = null;
  }
  if (!p) return { p: null, err: '关系不存在' };
  if (!(p.openids || []).includes(openid)) return { p: null, err: '你不是这个关系的成员' };
  if (p.status === 'broken') return { p: null, err: '关系已解除，重新绑定后才能查看' };
  return { p, err: '' };
}

/** 生成邀请码：建一个待配对的关系，返回码给前端展示/分享 */
async function pairCreate(data) {
  const openid = getOpenid();
  const now = Date.now();
  const name = str(data.name, 20);

  const mine = await findMyPair(openid);
  if (mine) {
    // 已有关系就复用：pending 的直接续期换码，bound 的提示先解除
    if (mine.status === 'bound') {
      return ok({ pairId: mine._id, code: mine.code, role: roleOf(mine, openid), bound: true, reused: true });
    }
    const code = makeCode();
    await db.collection(COL_PAIR).doc(mine._id).update({ data: { code, codeAt: now, updatedAt: now } });
    return ok({ pairId: mine._id, code, role: roleOf(mine, openid), bound: false, reused: true });
  }

  const code = makeCode();
  const doc = {
    openids: [openid],
    members: [{ openid, role: 'me', name, joinedAt: now }],
    code,
    codeAt: now,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };
  const add = await db.collection(COL_PAIR).add({ data: doc });
  return ok({ pairId: add._id, code, role: 'me', bound: false });
}

/** 用邀请码加入：成功后双方 status=bound */
async function pairJoin(data) {
  const code = str(data.code, 12).toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) return fail('邀请码是 6 位字母数字组合');
  const openid = getOpenid();
  const now = Date.now();
  const name = str(data.name, 20);

  const target = await findByCode(code);
  if (!target) return fail('邀请码不存在，请确认后重试');
  if (target.codeAt && now - target.codeAt > CODE_TTL) return fail('邀请码已过期，让对方重新生成一个');

  // 已经是成员（比如自己扫了自己的码）→ 直接回状态
  if ((target.openids || []).includes(openid)) {
    const g = await ensureMember(target._id, openid);
    if (g.err && target.status === 'broken') {
      // 关系曾被解除，本人重新加入 → 恢复
      await db.collection(COL_PAIR).doc(target._id).update({ data: { status: 'bound', updatedAt: now } });
      return ok({ pairId: target._id, role: roleOf(target, openid), bound: true });
    }
    return ok({ pairId: target._id, role: roleOf(target, openid), bound: target.status === 'bound', status: target.status });
  }

  const owner = (target.members || [])[0];
  if (!owner) return fail('邀请码无效，请让对方重新生成');

  // 重新绑定同一个人：优先复用「双方都在」的历史关系，把旧内容带回来
  let p = target;
  const hist = await db
    .collection(COL_PAIR)
    .where({ openids: _.all([owner.openid, openid]) })
    .limit(1)
    .get();
  if (hist && hist.data && hist.data.length && hist.data[0]._id !== target._id) p = hist.data[0];

  if (p.status === 'bound' && !(p.openids || []).includes(openid)) {
    return fail('对方已经和别人绑定啦');
  }
  if ((p.openids || []).length >= 2 && !(p.openids || []).includes(openid)) {
    return fail('这个邀请码已被使用');
  }

  const openids = (p.openids || []).slice();
  const members = (p.members || []).slice();
  if (!openids.includes(openid)) openids.push(openid);
  if (!members.find((m) => m.openid === openid)) members.push({ openid, role: 'him', name, joinedAt: now });

  await db.collection(COL_PAIR).doc(p._id).update({
    data: { openids, members, status: 'bound', code: '', codeAt: 0, updatedAt: now }
  });
  return ok({ pairId: p._id, role: roleOf({ members }, openid), bound: true, restored: p._id !== target._id });
}

/** 查询当前绑定状态（前端每次进双人空间都调一次，兼顾「对方悄悄解绑了」的情况） */
async function pairStatus(data) {
  const openid = getOpenid();
  const pairId = str(data.pairId, 40);
  if (!pairId) return ok({ bound: false, status: 'none' });
  const r = await ensureMember(pairId, openid);
  if (r.err) return ok({ bound: false, status: 'broken', error: r.err });
  const p = r.p;
  const mate = partnerOf(p, openid);
  return ok({
    bound: p.status === 'bound',
    status: p.status,
    pairId: p._id,
    role: roleOf(p, openid),
    code: p.code || '',
    partner: mate ? { name: mate.name || '', role: mate.role, joinedAt: mate.joinedAt } : null,
    updatedAt: p.updatedAt
  });
}

/** 解除绑定：自己退出关系，关系标记 broken，双方立即失去双人内容访问权 */
async function pairLeave(data) {
  const openid = getOpenid();
  const pairId = str(data.pairId, 40);
  if (!pairId) return fail('缺少关系 ID');
  let p = null;
  try {
    const r = await db.collection(COL_PAIR).doc(pairId).get();
    p = (r && r.data) || null;
  } catch (e) {
    p = null;
  }
  if (!p) return fail('关系不存在');
  if (!(p.openids || []).includes(openid)) return fail('你不是这个关系的成员');
  const now = Date.now();
  await db.collection(COL_PAIR).doc(pairId).update({
    data: {
      status: 'broken',
      code: '',
      codeAt: 0,
      leftBy: openid,
      updatedAt: now
    }
  });
  return ok({ left: true });
}

/** 重新生成邀请码（待配对状态下换一个码） */
async function pairCode(data) {
  const openid = getOpenid();
  const pairId = str(data.pairId, 40);
  if (!pairId) return fail('缺少关系 ID');
  let p = null;
  try {
    const r = await db.collection(COL_PAIR).doc(pairId).get();
    p = (r && r.data) || null;
  } catch (e) {
    p = null;
  }
  if (!p) return fail('关系不存在');
  if (!(p.openids || []).includes(openid)) return fail('你不是这个关系的成员');
  if (p.status === 'bound') return fail('已经绑定了，先解除才能重新邀请');
  const code = makeCode();
  await db.collection(COL_PAIR).doc(pairId).update({ data: { code, codeAt: Date.now(), updatedAt: Date.now() } });
  return ok({ code });
}

async function pairRename(data) {
  const openid = getOpenid();
  const pairId = str(data.pairId, 40);
  const name = str(data.name, 20);
  if (!pairId) return fail('缺少关系 ID');
  const g = await ensureMember(pairId, openid);
  if (g.err) return fail(g.err);
  const members = (g.p.members || []).map((m) => (m.openid === openid ? Object.assign({}, m, { name }) : m));
  await db.collection(COL_PAIR).doc(pairId).update({ data: { members, updatedAt: Date.now() } });
  return ok({ name });
}

/* ============================ 新：双人协作内容（love_duo） ============================ */
/**
 * 为什么不是继续用「整包快照」：
 *  快照是 A/B 各占一个槽位、整体覆盖，两人同时写就互相踩。
 *  留言、评论、共同心愿这些是**协作写**，必须按「条目」粒度合并，
 *  所以这里每条内容一个文档，带 updatedAt，按条目做最后写入胜出（LWW）。
 */
async function duoPush(data) {
  const openid = getOpenid();
  const pairId = str(data.pairId, 40);
  const kind = str(data.kind, 20);
  if (DUO_KINDS.indexOf(kind) < 0) return fail('不支持的内容类型');
  const g = await ensureMember(pairId, openid);
  if (g.err) return fail(g.err);
  const role = roleOf(g.p, openid);
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return ok({ pushed: 0 });

  const now = Date.now();
  let n = 0;
  // 逐条 upsert：小批量场景足够，且能把「谁改的」在服务端钉死
  for (const raw of items.slice(0, 60)) {
    if (!raw || !raw.id) continue;
    const id = str(raw.id, 64);
    const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : now;
    const doc = {
      pairId,
      kind,
      id,
      data: raw.data === undefined ? null : raw.data,
      updatedAt,
      by: role, // 强制用服务端判定的角色，不信前端传的
      deleted: !!raw.deleted
    };
    const q = await db.collection(COL_DUO).where({ pairId, kind, id }).limit(1).get();
    if (q && q.data && q.data.length) {
      const old = q.data[0];
      // 只在新旧更新的情况下覆盖
      if (updatedAt >= (old.updatedAt || 0)) {
        await db.collection(COL_DUO).doc(old._id).update({ data: doc });
        n++;
      }
    } else {
      await db.collection(COL_DUO).add({ data: doc });
      n++;
    }
  }
  return ok({ pushed: n });
}

async function duoPull(data) {
  const openid = getOpenid();
  const pairId = str(data.pairId, 40);
  const kind = str(data.kind, 20);
  if (DUO_KINDS.indexOf(kind) < 0) return fail('不支持的内容类型');
  const g = await ensureMember(pairId, openid);
  if (g.err) return fail(g.err);
  const since = typeof data.since === 'number' ? data.since : 0;

  const q = await db
    .collection(COL_DUO)
    .where({ pairId, kind, updatedAt: _.gte(since) })
    .orderBy('updatedAt', 'asc')
    .limit(DUO_LIMIT)
    .get();
  const items = ((q && q.data) || []).map((d) => ({
    id: d.id,
    data: d.data,
    updatedAt: d.updatedAt,
    by: d.by,
    deleted: !!d.deleted
  }));
  return ok({ items, serverTime: Date.now() });
}

/* ============================ 天气（和风天气） ============================ */

function httpsGet(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('天气接口超时'));
    });
  });
}

/**
 * 预警级别判定：前端会据此给出「该提醒他做什么」的具体建议，
 * 所以这里必须把「寒潮 / 暴雪 / 台风 / 极端温度」判准——宁可偏严。
 */
function pickLevel(textDay, textNight, min, max, windScale) {
  const t = `${textDay || ''}${textNight || ''}`;
  if (/寒潮|暴雪|台风|暴雨|大暴|特大暴|雷暴|冰雹|沙尘暴/.test(t)) return 'severe';
  if (typeof min === 'number' && min <= -8) return 'severe';
  if (typeof max === 'number' && max >= 38) return 'severe';
  if (typeof windScale === 'number' && windScale >= 9) return 'severe';
  if (/雨|雪|雷|沙尘|霾|雾/.test(t)) return 'notice';
  if (typeof min === 'number' && min <= 3) return 'notice';
  if (typeof max === 'number' && max >= 33) return 'notice';
  if (typeof windScale === 'number' && windScale >= 7) return 'notice';
  return 'none';
}

async function weather(data) {
  const key = process.env.QWEATHER_KEY || '';
  const city = str(data.city, 30);
  if (!key || !city) return fail('未配置 QWEATHER_KEY 或缺少城市');

  try {
    const locUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(city)}&key=${key}`;
    const locJson = JSON.parse(await httpsGet(locUrl));
    if (!locJson.location || !locJson.location.length) return fail('没查到这个城市');
    const id = locJson.location[0].id;

    const wUrl = `https://devapi.qweather.com/v7/weather/3d?location=${id}&key=${key}`;
    const w = JSON.parse(await httpsGet(wUrl));
    const day = (w.daily || [])[0];
    if (!day) return fail('没拿到天气数据');

    const min = Number(day.tempMin);
    const max = Number(day.tempMax);
    const wind = Number(day.windScaleDay);
    const level = pickLevel(day.textDay, day.textNight, isNaN(min) ? null : min, isNaN(max) ? null : max, isNaN(wind) ? null : wind);

    let warning = '';
    if (level === 'severe') {
      warning = `${city}今日${day.textDay || '天气恶劣'}，务必提醒对方注意安全与保暖`;
    } else if (level === 'notice') {
      warning = `${city}今日${day.textDay || ''}，提醒对方提前做好准备`;
    }

    return ok({
      text: day.textDay || '',
      temp: `${day.tempMin || '--'}° ~ ${day.tempMax || '--'}°`,
      tip: `今日${day.textDay || ''}，风力 ${day.windScaleDay || '--'} 级，紫外线 ${day.uvIndex || '--'}，降水概率 ${day.pop || '--'}%`,
      warning,
      level
    });
  } catch (e) {
    return fail('天气接口异常');
  }
}

/* ============================ 入口 ============================ */

const ACTIONS = {
  probe,
  pair,
  push,
  pull,
  weather,
  'pair.create': pairCreate,
  'pair.join': pairJoin,
  'pair.status': pairStatus,
  'pair.leave': pairLeave,
  'pair.code': pairCode,
  'pair.rename': pairRename,
  'duo.push': duoPush,
  'duo.pull': duoPull
};

exports.main = async (event) => {
  const action = (event && event.action) || '';
  const fn = ACTIONS[action];
  if (!fn) return { success: false, error: `未知 action: ${action}` };
  try {
    return await fn(event || {});
  } catch (e) {
    // 集合没建（-502005）等异常一律转成 ok:false，前端据此走离线降级，不会弹技术报错
    const msg = (e && e.message) || String(e || '服务端异常');
    return { success: true, ok: false, error: msg };
  }
};
