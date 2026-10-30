// utils/todo-shard.ts
// 待办本地分片存储层
//
// 为什么需要它：
//  1) wx.setStorageSync 单个 key 上限 1MB、整个小程序上限 10MB。旧实现把全部待办塞进
//     单个 key（__todo_mock_todos__），上千条就会写入失败（静默异常 → 新增丢失）。
//  2) 旧实现每次写入都要把全量数组 JSON 序列化一次，O(n)；上万条时 add 一次要几百毫秒。
// 分片后：每 200 条一个 key，写单条只改动 1 个分片（≤200 条），新增为追加，复杂度从 O(n) 降到 O(1)。
//
// 磁盘结构：
//   __todo_shard_meta_v1__   { v, buckets, total }
//   __todo_shard_b_<i>       ITodo[]（最多 BUCKET_SIZE 条）

import type { ITodo } from '../types/index';

const META_KEY = '__todo_shard_meta_v1__';
const BUCKET_PREFIX = '__todo_shard_b_';
/** 旧版单 key 存储（用于自动迁移） */
const LEGACY_KEYS = ['__todo_mock_todos__'];

export const BUCKET_SIZE = 200;

interface ShardMeta {
  v: number;
  buckets: number;
  total: number;
}

/** 内存索引：id -> 所在分片序号，使更新/删除无需遍历全部分片 */
const idBucket = new Map<string, number>();
let bucketCount = 0;
let loaded = false;

/** 写入失败（通常是超出存储配额）时的标记，供 UI 层提示 */
let quotaWarned = false;

export function hasQuotaIssue(): boolean {
  return quotaWarned;
}

/* ---------------- 底层读写 ---------------- */

function readKey<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(key);
    if (v === undefined || v === null || v === '') return fallback;
    return v as T;
  } catch (_e) {
    return fallback;
  }
}

function writeKey(key: string, value: unknown): boolean {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (err) {
    if (!quotaWarned) {
      quotaWarned = true;
      console.error('[todo-shard] 本地存储写入失败（可能超出配额）:', key, err);
    }
    return false;
  }
}

function removeKey(key: string): void {
  try {
    wx.removeStorageSync(key);
  } catch (_e) {
    /* 忽略 */
  }
}

function bucketKey(i: number): string {
  return BUCKET_PREFIX + i;
}

function readBucket(i: number): ITodo[] {
  const v = readKey<ITodo[]>(bucketKey(i), []);
  return Array.isArray(v) ? v : [];
}

function writeMeta(): void {
  writeKey(META_KEY, {
    v: 1,
    buckets: bucketCount,
    total: idBucket.size
  } as ShardMeta);
}

/* ---------------- 对外 API ---------------- */

/**
 * 读取全部待办并重建 id→分片 索引。
 * 首次调用若发现旧版单 key 数据，会自动迁移到分片并释放旧 key（避免占用双份配额）。
 */
export function loadAll(): ITodo[] {
  const meta = readKey<ShardMeta | null>(META_KEY, null);
  bucketCount = meta && typeof meta.buckets === 'number' && meta.buckets >= 0 ? meta.buckets : 0;
  idBucket.clear();

  const out: ITodo[] = [];

  if (bucketCount <= 0) {
    // 兼容迁移：旧版把全量数组存在单 key 里
    for (const legacyKey of LEGACY_KEYS) {
      const legacy = readKey<ITodo[]>(legacyKey, []);
      if (Array.isArray(legacy) && legacy.length) {
        console.log(`[todo-shard] 检测到旧版单 key 数据 ${legacy.length} 条，迁移为分片存储`);
        // 迁移成功后再删除旧 key；replaceAll 内部会重建索引
        replaceAll(legacy);
        if (bucketCount > 0) removeKey(legacyKey);
        loaded = true;
        return legacy.slice();
      }
    }
    loaded = true;
    return out;
  }

  for (let i = 0; i < bucketCount; i++) {
    const b = readBucket(i);
    for (let j = 0; j < b.length; j++) {
      const it = b[j];
      if (it && it._id) {
        idBucket.set(it._id, i);
        out.push(it);
      }
    }
  }
  loaded = true;
  return out;
}

/** 全量重写（用于初始化 / 批量清除 / 同步收尾），会重建全部分片 */
export function replaceAll(list: ITodo[]): void {
  clearBuckets();
  const safe = Array.isArray(list) ? list : [];
  const n = Math.max(1, Math.ceil(safe.length / BUCKET_SIZE));
  for (let i = 0; i < n; i++) {
    const slice = safe.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE);
    for (const it of slice) {
      if (it && it._id) idBucket.set(it._id, i);
    }
    writeBucketAt(i, slice);
  }
  bucketCount = n;
  if (safe.length === 0) idBucket.clear();
  writeMeta();
  loaded = true;
}

function writeBucketAt(i: number, list: ITodo[]): boolean {
  return writeKey(bucketKey(i), list);
}

/** 新增或更新单条：只落盘 1 个分片，O(1) */
export function upsert(it: ITodo): void {
  if (!it || !it._id) return;
  if (!loaded) loadAll();

  const known = idBucket.get(it._id);
  if (known !== undefined && known < bucketCount) {
    const b = readBucket(known);
    const p = b.findIndex((x) => x && x._id === it._id);
    if (p >= 0) b[p] = it;
    else b.push(it);
    writeBucketAt(known, b);
    writeMeta();
    return;
  }

  // 未登记过：追加到最后一个分片（满则新建）
  let target = bucketCount > 0 ? bucketCount - 1 : 0;
  let b = bucketCount > 0 ? readBucket(target) : [];
  if (bucketCount === 0 || b.length >= BUCKET_SIZE) {
    target = bucketCount;
    b = [];
    bucketCount += 1;
  }
  b.push(it);
  idBucket.set(it._id, target);
  writeBucketAt(target, b);
  writeMeta();
}

/** 删除单条：只落盘 1 个分片 */
export function removeById(id: string): void {
  if (!id) return;
  if (!loaded) loadAll();
  const idx = idBucket.get(id);
  if (idx === undefined) return;
  const b = readBucket(idx);
  const next = b.filter((x) => x && x._id !== id);
  if (next.length === b.length) {
    idBucket.delete(id);
    return;
  }
  writeBucketAt(idx, next);
  idBucket.delete(id);
  writeMeta();
}

/** 批量删除（用于清除已完成），按涉及分片去重后各写一次 */
export function removeMany(ids: string[]): void {
  if (!ids || !ids.length) return;
  if (!loaded) loadAll();
  const touched = new Set<number>();
  for (const id of ids) {
    const idx = idBucket.get(id);
    if (idx === undefined) continue;
    touched.add(idx);
    idBucket.delete(id);
  }
  touched.forEach((idx) => {
    const b = readBucket(idx);
    writeBucketAt(idx, b.filter((x) => x && x._id && idBucket.has(x._id)));
  });
  writeMeta();
}

/** 清空所有分片 */
export function clearBuckets(): void {
  for (let i = 0; i < bucketCount; i++) removeKey(bucketKey(i));
  // 兜底：清理可能残留的高位分片
  for (let i = bucketCount; i < bucketCount + 5; i++) removeKey(bucketKey(i));
  bucketCount = 0;
  idBucket.clear();
  removeKey(META_KEY);
  loaded = true;
  quotaWarned = false;
}

/** 当前已落盘的条目数 */
export function count(): number {
  return idBucket.size;
}

/** 重置内存态（测试 / 清空数据用） */
export function reset(): void {
  clearBuckets();
}
