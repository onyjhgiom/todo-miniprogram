// utils/love-place.ts
// 异地恋 · 两地距离 + 双方天气（含三级降级）
//
// 【外部数据获取与降级策略 —— 这是本模块最重要的设计】
//
// 天气属于外部实时数据，拿不到是常态（云函数没部署 / 没配和风 Key / 断网 / 城市查不到）。
// 三级策略：
//   L1 实时：云函数 love 的 weather action（服务端持有和风天气 Key，前端不存任何密钥）
//           → 返回真实天气、温度、风力、紫外线与预警
//   L2 缓存：上次的真实结果存本地（带时间戳），24 小时内可用，标注「更新时间」
//   L3 估算：按城市纬度 + 当前月份推算季节气候，给出「按季节的照顾建议」
//           → 明确标注「离线估算，非实时天气」，绝不把估算伪装成实时
//  任何一级都不会返回空白——用户看到的永远是一条能执行的建议。
//
// 商品推荐同理（见 love-outfit.ts）：不接电商 API，给「品类+材质+价位区间+选购标准」，
// 因为价格库存实时变动，写死链接必然过期；云端若部署了 goods action 可再叠加实时榜单。
import { callFn } from '../../../utils/cloud';
import { get, set } from '../../../utils/storage';
import type { CityWeather } from './love-types';

/* ============================ 城市坐标（离线表，不依赖任何网络） ============================ */

/** [城市名, 纬度, 经度] */
const CITY_TABLE: [string, number, number][] = [
  ['北京', 39.90, 116.41], ['上海', 31.23, 121.47], ['广州', 23.13, 113.26], ['深圳', 22.54, 114.06],
  ['天津', 39.13, 117.20], ['重庆', 29.56, 106.55], ['成都', 30.57, 104.07], ['杭州', 30.27, 120.16],
  ['武汉', 30.59, 114.31], ['西安', 34.34, 108.94], ['南京', 32.06, 118.80], ['苏州', 31.30, 120.58],
  ['郑州', 34.75, 113.63], ['长沙', 28.23, 112.94], ['青岛', 36.07, 120.38], ['济南', 36.65, 117.12],
  ['合肥', 31.86, 117.28], ['福州', 26.07, 119.30], ['厦门', 24.48, 118.09], ['南昌', 28.68, 115.86],
  ['昆明', 25.04, 102.72], ['贵阳', 26.65, 106.63], ['南宁', 22.82, 108.32], ['海口', 20.04, 110.32],
  ['兰州', 36.06, 103.83], ['西宁', 36.62, 101.78], ['银川', 38.49, 106.23], ['乌鲁木齐', 43.83, 87.62],
  ['拉萨', 29.65, 91.14], ['呼和浩特', 40.84, 111.75], ['太原', 37.87, 112.55], ['石家庄', 38.04, 114.51],
  ['沈阳', 41.80, 123.43], ['大连', 38.91, 121.61], ['长春', 43.82, 125.32], ['哈尔滨', 45.80, 126.53],
  ['温州', 27.99, 120.70], ['宁波', 29.87, 121.55], ['无锡', 31.49, 120.31], ['常州', 31.81, 119.97],
  ['徐州', 34.27, 117.18], ['烟台', 37.46, 121.45], ['潍坊', 36.71, 119.16], ['洛阳', 34.62, 112.45],
  ['唐山', 39.63, 118.18], ['保定', 38.87, 115.46], ['廊坊', 39.54, 116.68], ['邯郸', 36.63, 114.54],
  ['临沂', 35.10, 118.36], ['济宁', 35.42, 116.59], ['襄阳', 32.04, 112.12], ['宜昌', 30.69, 111.29],
  ['株洲', 27.83, 113.13], ['衡阳', 26.89, 112.57], ['岳阳', 29.36, 113.13], ['常德', 29.05, 111.69],
  ['佛山', 23.02, 113.12], ['东莞', 23.02, 113.75], ['珠海', 22.27, 113.58], ['中山', 22.52, 113.39],
  ['惠州', 23.11, 114.42], ['汕头', 23.35, 116.68], ['湛江', 21.27, 110.36], ['桂林', 25.27, 110.29],
  ['柳州', 24.33, 109.43], ['三亚', 18.25, 109.51], ['遵义', 27.73, 106.93], ['大理', 25.61, 100.27],
  ['丽江', 26.87, 100.23], ['绵阳', 31.47, 104.68], ['南充', 30.84, 106.08], ['宜宾', 28.77, 104.63],
  ['宝鸡', 34.36, 107.24], ['咸阳', 34.33, 108.71], ['榆林', 38.29, 109.74], ['大同', 40.08, 113.30],
  ['包头', 40.66, 109.84], ['鄂尔多斯', 39.61, 109.78], ['吉林', 43.84, 126.55], ['大庆', 46.60, 125.11],
  ['鞍山', 41.11, 122.99], ['抚顺', 41.88, 123.96], ['锦州', 41.10, 121.13], ['秦皇岛', 39.94, 119.60],
  ['扬州', 32.39, 119.42], ['南通', 31.98, 120.89], ['盐城', 33.35, 120.16], ['淮安', 33.61, 119.02],
  ['泰州', 32.46, 119.92], ['镇江', 32.19, 119.45], ['嘉兴', 30.75, 120.77], ['金华', 29.08, 119.65],
  ['绍兴', 30.03, 120.58], ['台州', 28.66, 121.43], ['泉州', 24.87, 118.68], ['漳州', 24.51, 117.65],
  ['莆田', 25.43, 119.01], ['芜湖', 31.34, 118.38], ['蚌埠', 32.94, 117.36], ['安庆', 30.54, 117.05],
  ['九江', 29.71, 116.00], ['赣州', 25.83, 114.94], ['上饶', 28.45, 117.95], ['新乡', 35.30, 113.93],
  ['南阳', 32.99, 112.53], ['信阳', 32.15, 114.09], ['安阳', 36.10, 114.35], ['荆州', 30.35, 112.19],
  ['黄石', 30.20, 115.04], ['十堰', 32.65, 110.79], ['湘潭', 27.87, 112.94], ['郴州', 25.77, 113.02],
  ['汕头', 23.35, 116.68], ['潮州', 23.66, 116.62], ['揭阳', 23.55, 116.37], ['北海', 21.48, 109.12],
  ['钦州', 21.98, 108.62], ['遵义', 27.73, 106.93], ['曲靖', 25.49, 103.80], ['玉溪', 24.35, 102.55],
  ['赤峰', 42.26, 118.96], ['通辽', 43.65, 122.25], ['齐齐哈尔', 47.35, 123.92], ['牡丹江', 44.59, 129.62],
  ['香港', 22.32, 114.17], ['澳门', 22.20, 113.54], ['台北', 25.03, 121.57], ['高雄', 22.63, 120.30]
];

const CITY_MAP: Record<string, [number, number]> = {};
CITY_TABLE.forEach((c) => { if (!CITY_MAP[c[0]]) CITY_MAP[c[0]] = [c[1], c[2]]; });

/** 城市名统一处理：去掉「市/区/县」后缀与前后空格，提高匹配率 */
function normCity(name: string): string {
  return (name || '').trim().replace(/(市|地区|自治州|特别行政区)$/, '').replace(/(区|县)$/, '');
}

export function findCity(name: string): [number, number] | null {
  const raw = (name || '').trim();
  if (!raw) return null;
  if (CITY_MAP[raw]) return CITY_MAP[raw];
  const n = normCity(raw);
  if (CITY_MAP[n]) return CITY_MAP[n];
  // 最后兜底：包含匹配（「杭州市西湖区」→ 杭州）
  const keys = Object.keys(CITY_MAP);
  for (let i = 0; i < keys.length; i++) {
    if (raw.indexOf(keys[i]) >= 0) return CITY_MAP[keys[i]];
  }
  return null;
}

export function cityNames(): string[] {
  return CITY_TABLE.map((c) => c[0]);
}

/** 取城市坐标 [纬度, 经度]；查不到返回 null */
export function cityCoord(name: string): [number, number] | null {
  return findCity(name);
}

/* 中国城市坐标的整体包围盒，用于把任意两城按比例放到示意坐标图里 */
let BOX: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null = null;
function coordBox(): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  if (BOX) return BOX;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  CITY_TABLE.forEach((c) => {
    minLat = Math.min(minLat, c[1]);
    maxLat = Math.max(maxLat, c[1]);
    minLng = Math.min(minLng, c[2]);
    maxLng = Math.max(maxLng, c[2]);
  });
  BOX = { minLat, maxLat, minLng, maxLng };
  return BOX;
}

export interface CoordPoint {
  lat: number;
  lng: number;
  /** 在示意图内的百分比位置（已留 10% 边距），直接喂给 style 的 left/top */
  left: number;
  top: number;
}
export interface CoordPlot {
  /** 双方都能定位才为 true */
  ready: boolean;
  me: CoordPoint | null;
  him: CoordPoint | null;
}

/** 把两个城市映射到示意坐标图：纬度越北越靠上，经度越东越靠右 */
export function coordPlot(meCity: string, himCity: string): CoordPlot {
  const pa = findCity(meCity);
  const pb = findCity(himCity);
  const box = coordBox();
  const pad = 0.1;
  const toPt = (c: [number, number] | null): CoordPoint | null => {
    if (!c) return null;
    const x = pad + (1 - 2 * pad) * (c[1] - box.minLng) / Math.max(0.0001, box.maxLng - box.minLng);
    const y = pad + (1 - 2 * pad) * (1 - (c[0] - box.minLat) / Math.max(0.0001, box.maxLat - box.minLat));
    return { lat: c[0], lng: c[1], left: Math.round(x * 1000) / 10, top: Math.round(y * 1000) / 10 };
  };
  return { ready: !!(pa && pb), me: toPt(pa), him: toPt(pb) };
}

/** 大圆距离（公里） */
export function distanceKm(a: string, b: string): number | null {
  const pa = findCity(a);
  const pb = findCity(b);
  if (!pa || !pb) return null;
  const R = 6371;
  const dLat = ((pb[0] - pa[0]) * Math.PI) / 180;
  const dLng = ((pb[1] - pa[1]) * Math.PI) / 180;
  const la1 = (pa[0] * Math.PI) / 180;
  const la2 = (pb[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.asin(Math.sqrt(h)));
}

/** 距离文案：把公里数翻译成有体感的表达 */
export function distanceText(km: number | null): string {
  if (km === null) return '先把双方城市填完整，就能算出距离';
  if (km === 0) return '同一个城市，零距离';
  if (km < 50) return `${km} 公里，高铁半小时的事`;
  if (km < 300) return `${km} 公里，高铁 1–2 小时能见`;
  if (km < 800) return `${km} 公里，高铁半天或一趟飞机`;
  if (km < 1500) return `${km} 公里，飞机 2 小时左右`;
  if (km < 3000) return `${km} 公里，横跨大半个中国`;
  return `${km} 公里，真的是很远很远`;
}

/** 飞行时间估算（仅作体感参考） */
export function flyText(km: number | null): string {
  if (km === null) return '';
  if (km < 100) return '自驾/高铁都方便';
  const h = km / 800 + 0.5;
  return `飞机约 ${h.toFixed(1)} 小时`;
}

/* ============================ 天气 ============================ */

const CACHE_KEY = 'love_weather_cache_v1';
const CACHE_TTL = 6 * 3600 * 1000; // 6 小时内视为「较新的缓存」

interface CacheItem { at: number; data: CityWeather }

function readCache(city: string): CityWeather | null {
  const map = get<Record<string, CacheItem>>(CACHE_KEY, {});
  const item = map ? map[city] : null;
  if (!item || !item.data) return null;
  if (Date.now() - item.at > CACHE_TTL) return null;
  return { ...item.data, source: `缓存（${timeAgo(item.at)}更新）` };
}

function writeCache(city: string, data: CityWeather): void {
  const map = get<Record<string, CacheItem>>(CACHE_KEY, {}) || {};
  map[city] = { at: Date.now(), data };
  set(CACHE_KEY, map);
}

function timeAgo(at: number): string {
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 60) return `${Math.max(1, m)} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * 拉取一个城市的天气；任何异常都退化为本地估算，绝不抛错、绝不返回空白。
 */
export async function fetchWeather(city: string): Promise<CityWeather> {
  if (!city) return localEstimate('', '');
  // L1 实时
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'weather', city });
    const r = (res || {}) as { ok?: boolean; text?: string; temp?: string; tip?: string; warning?: string; level?: string };
    if (r.ok && (r.text || r.temp)) {
      const w = normalizeLive(city, r);
      writeCache(city, w);
      return w;
    }
  } catch (e) {
    /* 云端不可用 → 继续降级 */
  }
  // L2 缓存
  const cached = readCache(city);
  if (cached) return cached;
  // L3 估算
  return localEstimate(city, '');
}

function normalizeLive(city: string, r: { text?: string; temp?: string; tip?: string; warning?: string; level?: string }): CityWeather {
  const text = r.text || '';
  const temp = r.temp || '';
  const lv: CityWeather['level'] = r.level === 'severe' ? 'severe' : (r.level === 'notice' ? 'notice' : 'none');
  const actions = buildActions(text, temp, lv);
  return {
    live: true,
    city,
    text,
    temp,
    icon: weatherIcon(text),
    tip: r.tip || '',
    warning: r.warning || '',
    level: lv,
    actions,
    source: '实时天气（和风天气）'
  };
}

/** L3：按纬度 + 月份推算季节气候，明确标注为估算 */
export function localEstimate(city: string, _unused?: string): CityWeather {
  const pos = findCity(city);
  const lat = pos ? pos[0] : 35;
  const m = new Date().getMonth() + 1; // 1-12
  const winter = m === 12 || m <= 2;
  const spring = m >= 3 && m <= 5;
  const summer = m >= 6 && m <= 8;
  const autumn = m >= 9 && m <= 11;

  let text = '';
  let temp = '';
  let tip = '';
  let level: CityWeather['level'] = 'none';
  let warning = '';

  // 纬度修正：北方更冷、南方更热
  const north = lat >= 35;

  if (winter) {
    text = north ? '寒冷干燥' : '湿冷';
    temp = north ? '-10° ~ 2°' : '3° ~ 12°';
    tip = north ? '羽绒服 + 保暖内衣 + 帽子围巾，室内外温差大记得分层' : '湿冷刺骨，穿防风外套 + 保暖内搭，南方没暖气要更注意脚部保暖';
    level = north ? 'severe' : 'notice';
    warning = north ? '寒潮期：注意防冻与路面结冰' : '持续湿冷：注意关节与呼吸道';
  } else if (spring) {
    text = '多变，早晚温差大';
    temp = '10° ~ 22°';
    tip = '洋葱式穿搭：薄内搭 + 可脱外套，早晚加一件';
    level = 'none';
  } else if (summer) {
    text = north ? '炎热' : '高温闷热';
    temp = '26° ~ 36°';
    tip = '防晒 + 透气面料 + 多补水；南方注意雷雨与台风';
    level = lat < 30 ? 'notice' : 'none';
    if (lat < 30) warning = '夏季台风与强对流高发，关注预警';
  } else {
    text = '干爽，昼夜温差明显';
    temp = '12° ~ 24°';
    tip = '长袖 + 薄外套，北方空气干燥注意保湿';
    level = 'none';
  }

  const actions = buildActions(text, temp, level);
  return {
    live: false,
    city,
    text,
    temp,
    icon: weatherIcon(text),
    tip,
    warning,
    level,
    actions,
    source: '离线估算（按季节与纬度推算，非实时天气）'
  };
}

function weatherIcon(text: string): string {
  const t = text || '';
  if (t.indexOf('雪') >= 0) return '❄️';
  if (t.indexOf('雷') >= 0 || t.indexOf('台风') >= 0) return '⛈️';
  if (t.indexOf('雨') >= 0) return '🌧️';
  if (t.indexOf('阴') >= 0 || t.indexOf('云') >= 0) return '☁️';
  if (t.indexOf('风') >= 0) return '🌬️';
  if (t.indexOf('沙尘') >= 0) return '🌪️';
  if (t.indexOf('晴') >= 0 || t.indexOf('热') >= 0) return '☀️';
  return '🌤️';
}

/**
 * 恶劣天气 → 具体行动建议。
 * 这里是「异地恋场景」的关键：不只是报天气，而是告诉她**该对他说什么**。
 */
function buildActions(text: string, temp: string, level: CityWeather['level']): string[] {
  const t = text || '';
  const out: string[] = [];
  const num = (temp || '').match(/-?\d+/g);
  const low = num && num.length ? Number(num[0]) : null;

  if (/寒潮|降温|冷|雪/.test(t) || (low !== null && low <= 5)) {
    out.push('把秋裤/厚外套的具体位置告诉他，别只说"多穿点"——具体到"把那件灰羽绒服穿上"');
    out.push('提醒他出门戴帽子围巾，头部散热占全身 30%');
    out.push('问一句"手冷不冷"，比"多喝热水"有用十倍');
    if (low !== null && low <= 0) out.push('零度以下：提醒路面结冰，骑车/开车慢一点');
  }
  if (/雨|雷/.test(t)) {
    out.push('提醒他带伞——发一句"你那边下雨了，伞在包里吗"');
    out.push('雷雨天别在树下/高处，也别边充电边打语音');
  }
  if (/台风/.test(t)) {
    out.push('台风天：确认他门窗关好、储备了水和食物，别外出');
    out.push('提前约好断联时的联络方式，别让对方担心');
  }
  if (/热|高温|晴/.test(t)) {
    out.push('提醒他防晒 + 补水，户外工作者尤其注意避开正午');
    out.push('可以给他点一杯冰饮外卖，比一句"注意防暑"更实在');
  }
  if (/沙尘|雾霾/.test(t)) {
    out.push('提醒他戴口罩，回家洗脸漱口');
    out.push('过敏体质的话提醒关窗 + 开净化器');
  }
  if (/风/.test(t)) {
    out.push('大风天：提醒别在广告牌和高楼下停留');
  }
  if (!out.length) {
    out.push('天气平稳，正好可以约一个视频通话或一起看部电影');
    out.push('把今天发生的三件小事说给他听，比聊天气更能拉近距离');
  }
  if (level === 'severe') out.push('⚠️ 恶劣天气：提前确认他今天的行程，约好报平安的时间');
  return out;
}

/**
 * 对外暴露「天气 → 行动建议」，便于自检脚本直接验证极端场景（寒潮/台风/高温）。
 * 页面拿到的 CityWeather.actions 就是它的输出。
 */
export function weatherActions(text: string, temp: string, level: CityWeather['level']): string[] {
  return buildActions(text, temp, level);
}

/** 生成一条可以直接发给对方的关心话术 */
export function careMessage(city: string, w: CityWeather, nickname: string): string {
  const who = nickname || '你';
  const first = w.actions[0] || '';
  if (w.level === 'none') {
    return `${who}那边今天是${w.text}（${w.temp}）。${w.tip}。想你了，今晚视频吗？`;
  }
  return `${who}那边今天是${w.text}（${w.temp}），${w.warning || '天气不太友好'}。${first}。记得跟我说一声你到家了。`;
}
