// scripts/check-photowall-store.js
// 照片墙 · 本地存储冒烟测试（离线，mock storage 与文件系统）
//
// 存储层出问题的表现是「用户昨天做的照片墙，今天打开一片灰」——
// 写的时候完全看不出来。这里覆盖四条最容易翻车的路径：
//   1) 作品存进去要能原样读出来（含 slots 点位快照）
//   2) 图片必须从临时路径固化到 USER_DATA_PATH（临时路径重启即失效）
//   3) 删除要同时清掉索引与图片目录，不留孤儿文件
//   4) 复制出来的副本不能与原作品共用 id
//
// 用法：node scripts/check-photowall-store.js

const path = require('path');
const OUT = path.resolve(__dirname, '..', '.tmp-pw', 'subpackages', 'photowall', 'utils');

/* ── mock 微信运行时 ── */
const KV = {};
const COPIED = [];
const RMDIR = [];
global.wx = {
  getStorageSync: (k) => KV[k],
  setStorageSync: (k, v) => { KV[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: (k) => { delete KV[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(KV) }),
  env: { USER_DATA_PATH: '/usr/data' },
  getFileSystemManager: () => ({
    mkdirSync() {},
    copyFileSync(s, d) { COPIED.push([s, d]); },
    rmdirSync(p) { RMDIR.push(p); },
    readdirSync() { return ['w1', 'w2']; }
  }),
  showToast() {}, showModal() {}, vibrateShort() {}
};

const S = require(path.join(OUT, 'pw-store.js'));
const T = require(path.join(OUT, 'pw-types.js'));
const SP = require(path.join(OUT, 'pw-shapes.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}

console.log('════════ 照片墙 · 存储层冒烟 ════════\n');

/* ── 1. 存 / 读往返 ── */
console.log('── 1. 作品存读往返 ──');
const w = T.newWork();
w.title = '纪念日';
w.shapeId = 'heart';
w.shapeName = '心形';
const def = SP.SHAPES.find((s) => s.id === 'heart');
const lay = SP.layout(def, 6, { seed: 3 });
w.slots = lay.pts;
for (let i = 0; i < 6; i++) w.photos.push(T.newPhoto('/tmp/p' + i + '.jpg'));
w.style.bg = '#FFF1F4';
w.style.filter = 'warm';
w.style.decor = [{ id: 'd1', kind: 'text', value: '爱你', x: 0.5, y: 0.9, size: 0.08, color: '#333', rot: 0 }];
S.saveWork(w);

const back = S.loadWork(w.id);
ok('能按 id 读回作品', !!back && back.id === w.id);
ok('标题一致', back.title === '纪念日', back.title);
ok('照片数一致', back.photos.length === 6, String(back.photos.length));
ok('点位快照一致（重开不会漂移）',
  JSON.stringify(back.slots) === JSON.stringify(w.slots));
ok('样式一致', back.style.bg === '#FFF1F4' && back.style.filter === 'warm');
ok('装饰一致', back.style.decor.length === 1 && back.style.decor[0].value === '爱你');

/* ── 2. 索引 ── */
console.log('\n── 2. 索引与草稿 ──');
const idx = S.loadIndex();
ok('索引里有这条', idx.length === 1 && idx[0].id === w.id);
ok('索引带照片数与形状名', idx[0].count === 6 && idx[0].shapeName === '心形', JSON.stringify(idx[0]));

S.setDraft(w.id, false);
ok('可转为正式作品', S.loadWork(w.id).draft === false);
S.setDraft(w.id, true);
ok('可转回草稿', S.loadWork(w.id).draft === true);

S.setNote(w.id, '第一次一起旅行');
ok('备注可写可读', S.loadWork(w.id).note === '第一次一起旅行');

const favOn = S.toggleFavorite(w.id);
ok('收藏开关生效', favOn === true && S.loadWork(w.id).favorite === true);
ok('再点一次取消收藏', S.toggleFavorite(w.id) === false);

/* ── 3. 图片落盘 ── */
console.log('\n── 3. 图片永久化 ──');
COPIED.length = 0;
const fixed = S.persistPhotos(w.id, ['/tmp/a.jpg', '/tmp/b.jpg']);
ok('每张图都被复制', COPIED.length === 2, '实际 ' + COPIED.length);
ok('返回的是永久路径', fixed.every((p) => p.indexOf('/usr/data/photowall/' + w.id) === 0), JSON.stringify(fixed));
ok('永久路径带扩展名', fixed.every((p) => p.indexOf('.jpg') > 0));

const again = S.persistPhotos(w.id, [fixed[0], '/tmp/c.jpg']);
ok('已是永久路径的不重复复制', COPIED.length === 3, '累计复制 ' + COPIED.length);

/* ── 4. 复制与删除 ── */
console.log('\n── 4. 复制 / 删除 ──');
const cp = S.duplicateWork(w.id);
ok('副本生成新 id', !!cp && cp.id !== w.id);
ok('副本标题带「副本」', cp.title.indexOf('副本') > 0, cp.title);
ok('副本是草稿、未收藏', cp.draft === true && cp.favorite === false);
ok('副本照片数一致', cp.photos.length === 6);
ok('索引变成两条', S.loadIndex().length === 2);

RMDIR.length = 0;
S.removeWork(cp.id);
ok('删除后读不到', S.loadWork(cp.id) === null);
ok('删除后索引只剩一条', S.loadIndex().length === 1);
ok('删除时清理了图片目录', RMDIR.length === 1 && RMDIR[0].indexOf(cp.id) > 0, JSON.stringify(RMDIR));

/* ── 5. 形状收藏 / 最近使用 ── */
console.log('\n── 5. 形状收藏 ──');
const shape = { id: 'heart', name: '心形', kind: 'analytic', text: '', maskPath: '', icon: '❤️' };
ok('收藏返回 true', S.toggleFavShape(shape) === true);
ok('已收藏可查到', S.isFavShape('heart'));
ok('再点取消', S.toggleFavShape(shape) === false && !S.isFavShape('heart'));

S.pushRecentShape('star5');
S.pushRecentShape('heart');
S.pushRecentShape('star5');
const recent = S.loadRecentShapes();
ok('最近使用去重且最新在前', recent[0] === 'star5' && recent.indexOf('heart') === 1, JSON.stringify(recent));

/* ── 6. 自定义蒙版 ── */
console.log('\n── 6. 自定义蒙版 ──');
const mp = S.persistMask('/tmp/mask.png');
ok('蒙版落到永久目录', mp.indexOf('/usr/data/photowall/_masks') === 0, mp);
S.saveMask({ id: 'm1', name: '我的蒙版', path: mp, createdAt: Date.now() });
ok('蒙版入库', S.loadMasks().length === 1);
S.removeMask('m1');
ok('蒙版可删除', S.loadMasks().length === 0);

/* ── 7. 形状跨页传递 ── */
console.log('\n── 7. 形状选择传递 ──');
S.setPendingShape({ id: 'text', name: 'LOVE', kind: 'text', text: 'LOVE', maskPath: '', icon: '🔤' });
const pend = S.takePendingShape();
ok('能取到暂存的形状', !!pend && pend.text === 'LOVE');
ok('取走后即清空（不会误用旧值）', S.takePendingShape() === null);

/* ── 8. 待办联动解锁 ── */
console.log('\n── 8. 待办联动解锁 ──');
const u = S.computeUnlock();
ok('解锁信息结构完整', typeof u.done === 'number' && Array.isArray(u.unlocked), JSON.stringify(u));
ok('默认解锁「经典」与「极简」', u.unlocked.indexOf('classic') >= 0 && u.unlocked.indexOf('minimal') >= 0,
  JSON.stringify(u.unlocked));
ok('未解锁的主题不在列表里', u.unlocked.indexOf('couple') < 0);
S.markUnlockSeen(['romance']);
ok('标记已读不报错', true);

/* ── 9. 旧作品自愈（算法升级后重算点位） ── */
console.log('\n── 9. 旧作品自愈 ──');
// 构造一份「旧算法」作品：有 5 张照片，但点位是错的（边长 0.82 = 单张占满 82% 内容区），
// 且没有 algo 字段（升级前保存的数据就是这个样子）
const legacy = T.newWork();
legacy.id = 'wlegacy1';
legacy.photos = [];
for (let i = 0; i < 5; i++) legacy.photos.push(T.newPhoto('/tmp/old' + i + '.jpg'));
legacy.shapeId = 'heart';
legacy.shapeKind = 'analytic';
legacy.slots = [
  { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.5 }
];
legacy.cell = 0.824;
legacy.algo = 1;
KV['__pw_work_wlegacy1'] = JSON.parse(JSON.stringify(legacy));

const healed = S.loadWork('wlegacy1');
ok('旧作品能被读出', !!healed);
ok('版本号已升到当前算法', healed.algo === T.PW_ALGO, 'algo=' + healed.algo);
ok('旧作品的边长被重算（不再 0.82）', healed.cell < 0.45 && healed.cell > 0.1, 'cell=' + healed.cell.toFixed(3));
ok('旧作品的点位被重算（不再是 5 个方角）', healed.slots.length !== 5 || healed.slots[0].x !== 0.1, healed.slots.length + ' 点');
// 自愈后必须回到默认的「一张照片一格」：旧版本默认开着铺满（照片会被循环复用），
// 升级后如果继续沿用，用户会看到同一张照片出现多次
ok('自愈后默认关闭铺满（不会重复使用照片）', healed.autofill === false, 'autofill=' + healed.autofill);
ok('自愈后点位数量 = 照片数（一一对应）', healed.slots.length === healed.photos.length,
  healed.slots.length + ' 点 / ' + healed.photos.length + ' 张');
ok('自愈结果已回写存储（下次不必重算）', KV['__pw_work_wlegacy1'].algo === T.PW_ALGO);

// 显式开着铺满的旧作品：自愈后也要回到不重复，且点位数量收敛到照片数
const legacy2 = T.newWork();
legacy2.id = 'wlegacy2';
legacy2.photos = [];
for (let i = 0; i < 6; i++) legacy2.photos.push(T.newPhoto('/tmp/old2-' + i + '.jpg'));
legacy2.shapeId = 'heart';
legacy2.shapeKind = 'analytic';
legacy2.autofill = true;              // 旧默认：铺满（40 个点位复用 6 张照片）
legacy2.slots = new Array(40).fill({ x: 0.5, y: 0.5 });
legacy2.cell = 0.12;
legacy2.algo = 2;
KV['__pw_work_wlegacy2'] = JSON.parse(JSON.stringify(legacy2));
const healed2 = S.loadWork('wlegacy2');
ok('旧版「铺满」作品自愈后不再复用照片', healed2.slots.length === 6, healed2.slots.length + ' 点');
ok('自愈后所有点位互不重合', new Set(healed2.slots.map((p) => p.x.toFixed(4) + ',' + p.y.toFixed(4))).size === 6);

// 已是当前版本的作品不应被改动
const cur = T.newWork();
cur.photos = [T.newPhoto('/tmp/n.jpg')];
cur.slots = [{ x: 0.5, y: 0.5 }];
cur.cell = 0.6;
S.saveWork(cur);
const curBack = S.loadWork(cur.id);
ok('当前版本作品不被重复重算', curBack.cell === 0.6, 'cell=' + curBack.cell);

console.log('\n══════════════════════════════════════════');
console.log(` 结果：${pass} 通过 / ${fail} 失败`);
console.log('══════════════════════════════════════════');
process.exit(fail ? 1 : 0);
