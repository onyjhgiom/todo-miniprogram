// subpackages/danmaku/utils/danmaku-store.ts
// 弹幕配置的本地持久化：历史记录 / 收藏 / 草稿。
//
// 选型说明（与项目整体离线优先策略一致）：
//   不做云存储。弹幕是「即用即弃的创意草稿」，价值密度低、读写频率高，
//   上云反而要处理登录态、配额、7 天过期清理任务。全部落 wx.Storage 即可——
//   换机丢失可接受，但若用户明确要求跨设备，这里也是唯一需要改的地方。
//
// 容量防控：单 key 有 1MB 上限，history 采用「分片 + 索引」写法，
//   每片固定 20 条，写一条只重写一片，避免每次保存都全量序列化整个历史。
import type { DanmakuConfig } from './danmaku-types';
import { DEFAULT_ANIM, DEFAULT_BG, DEFAULT_LAYOUT, DEFAULT_STYLE } from './danmaku-types';

const HISTORY_INDEX = '__dm_history_index__';
const HISTORY_SHARD = '__dm_history_s_';
const FAV_TEMPLATE_KEY = '__dm_fav_templates__';
/** 单分片容纳条数（越小写入越省， index 越长） */
const SHARD_SIZE = 20;
/** 历史上限：超出后淘汰最旧的更新记录 */
const HISTORY_LIMIT = 60;

/* ==================== ID ==================== */

let seq = 0;

/** 生成足够短且稳定的 id（时间戳 36 进制 + 自增序号） */
export function newId(): string {
  seq = (seq + 1) % 1296;
  return Date.now().toString(36) + seq.toString(36).padStart(2, '0');
}

/* ==================== 默认配置 ==================== */

export function createConfig(name = '未命名弹幕'): DanmakuConfig {
  const now = Date.now();
  return {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    skin: 'none',
    style: { ...DEFAULT_STYLE },
    anim: { ...DEFAULT_ANIM },
    layout: { ...DEFAULT_LAYOUT },
    bg: { ...DEFAULT_BG },
    items: []
  };
}

/**
 * 用补丁字段补齐配置，防止旧草稿（或 URL 传进来的半截 JSON）缺字段导致引擎读到 undefined。
 * 这是唯一的反序列化入口，所有外来源数据都必须过这里。
 */
export function normalizeConfig(raw: Partial<DanmakuConfig> | null | undefined): DanmakuConfig {
  const base = createConfig();
  if (!raw || typeof raw !== 'object') return base;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : base.name,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : base.updatedAt,
    favorite: !!raw.favorite,
    skin: raw.skin || base.skin,
    style: { ...base.style, ...(raw.style || {}) },
    anim: { ...base.anim, ...(raw.anim || {}) },
    layout: { ...base.layout, ...(raw.layout || {}) },
    bg: { ...base.bg, ...(raw.bg || {}) },
    items: Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i === 'object') : []
  };
}

/* ==================== 分片读写 ==================== */

interface HistoryIndex {
  /** id 列表，按 updatedAt 降序（最新在前） */
  ids: string[];
  updatedAt: number;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(key);
    if (v === '' || v === null || v === undefined) return fallback;
    if (typeof v === 'string') return JSON.parse(v) as T;
    return v as T;
  } catch (_e) {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
    return true;
  } catch (_e) {
    return false;
  }
}

function readIndex(): HistoryIndex {
  const idx = readJson<HistoryIndex>(HISTORY_INDEX, { ids: [], updatedAt: 0 });
  if (!Array.isArray(idx.ids)) return { ids: [], updatedAt: 0 };
  return idx;
}

function shardKey(i: number): string {
  return HISTORY_SHARD + i;
}

/** 把 id 列表按 SHARD_SIZE 重写入各分片；返回写成功后保留下来的 id 列表 */
function writeShards(ids: string[], map: Map<string, DanmakuConfig>): string[] {
  const kept: string[] = [];
  const total = Math.ceil(ids.length / SHARD_SIZE);
  for (let i = 0; i < total; i++) {
    const part: DanmakuConfig[] = [];
    for (let j = i * SHARD_SIZE; j < Math.min((i + 1) * SHARD_SIZE, ids.length); j++) {
      const c = map.get(ids[j]);
      if (c) {
        part.push(c);
        kept.push(ids[j]);
      }
    }
    writeJson(shardKey(i), part);
  }
  return kept;
}

/** 全量加载历史配置（按更新时间倒序） */
export function listHistory(): DanmakuConfig[] {
  const idx = readIndex();
  const map = loadAll();
  return idx.ids.map((id) => map.get(id)).filter((c): c is DanmakuConfig => !!c);
}

/** 加载全部配置 → Map，内部复用 */
function loadAll(): Map<string, DanmakuConfig> {
  const map = new Map<string, DanmakuConfig>();
  const idx = readIndex();
  // 分片数量由索引长度推出；多读一片兜底历史上的残留
  const total = Math.max(1, Math.ceil(Math.max(idx.ids.length, 1) / SHARD_SIZE)) + 1;
  for (let i = 0; i < total; i++) {
    const part = readJson<DanmakuConfig[]>(shardKey(i), []);
    if (!Array.isArray(part)) continue;
    part.forEach((raw) => {
      if (!raw || typeof raw !== 'object' || !raw.id) return;
      const c = normalizeConfig(raw);
      map.set(c.id, c);
    });
  }
  return map;
}

export function getConfig(id: string): DanmakuConfig | null {
  if (!id) return null;
  const all = loadAll();
  return all.get(id) || null;
}

/**
 * 保存（新增或更新）一条配置。
 * 历史超过 HISTORY_LIMIT 时按更新时间淘汰最旧的。
 */
export function saveConfig(cfg: DanmakuConfig): boolean {
  const map = loadAll();
  const next = normalizeConfig(cfg);
  next.updatedAt = Date.now();
  map.set(next.id, next);

  let ids = readIndex().ids.filter((id) => id !== next.id);
  ids.unshift(next.id);

  if (ids.length > HISTORY_LIMIT) {
    const dropped = ids.slice(HISTORY_LIMIT);
    ids = ids.slice(0, HISTORY_LIMIT);
    dropped.forEach((id) => map.delete(id));
  }

  const kept = writeShards(ids, map);
  return writeJson(HISTORY_INDEX, { ids: kept, updatedAt: Date.now() });
}

export function removeConfig(id: string): boolean {
  const map = loadAll();
  map.delete(id);
  const ids = readIndex().ids.filter((x) => x !== id);
  const kept = writeShards(ids, map);
  return writeJson(HISTORY_INDEX, { ids: kept, updatedAt: Date.now() });
}

/** 切换收藏态；返回切换后的值 */
export function toggleFavorite(id: string): boolean {
  const cfg = getConfig(id);
  if (!cfg) return false;
  cfg.favorite = !cfg.favorite;
  saveConfig(cfg);
  return cfg.favorite;
}

export function listFavorites(): DanmakuConfig[] {
  return listHistory().filter((c) => c.favorite);
}

/* ==================== 模板收藏 ==================== */

export function listFavoriteTemplates(): string[] {
  const v = readJson<string[]>(FAV_TEMPLATE_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function isTemplateFavorite(text: string): boolean {
  return listFavoriteTemplates().indexOf(text) >= 0;
}

/** 收藏/取消收藏一条模板；返回收藏后的状态 */
export function toggleFavoriteTemplate(text: string): boolean {
  const list = listFavoriteTemplates();
  const i = list.indexOf(text);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(text);
  writeJson(FAV_TEMPLATE_KEY, list.slice(0, 60));
  return i < 0;
}
