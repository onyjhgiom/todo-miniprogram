'use strict';

/**
 * course-schedule/utils/csTheme.js
 * 课程表专属皮肤：元数据 + 持久化 + 课程配色轮转
 *
 * 与 app.wxss 的全局主题（--color-*）无关，互不影响：
 * 全局主题管整个小程序的观感，这里只管课程表工具内部的皮肤。
 */

/** 存储键（带前缀避免与主项目 theme 冲突） */
var STORAGE_KEY = 'cs_theme';

/** 默认皮肤 */
var DEFAULT_CS_THEME = 'dawn';

/**
 * 6 套皮肤元数据。
 * preview 必须与 themes.wxss 中该皮肤的 --cs-hero 完全一致，
 * 否则切换面板里的预览色块和实际观感对不上。
 * dot 取该皮肤的 --cs-primary，用于小圆点标识。
 */
var CS_THEMES = [
  {
    key: 'dawn',
    name: '晨光笔记',
    desc: '清爽蓝白 · 上课首选',
    dark: false,
    preview: 'linear-gradient(135deg, #3B6DF6 0%, #7A9BFF 100%)',
    dot: '#3B6DF6',
    navBg: '#F2F6FC',
    navBgDark: '#E8EFF9',
    navText: 'black',
  },
  {
    key: 'midnight',
    name: '深空夜航',
    desc: '深蓝夜空 · 夜间护眼',
    dark: true,
    preview: 'linear-gradient(135deg, #1B2A4E 0%, #4A6BC4 100%)',
    dot: '#7C9CFF',
    navBg: '#111A2E',
    navBgDark: '#0A0F1E',
    navText: 'white',
  },
  {
    key: 'candy',
    name: '糖果马卡龙',
    desc: '粉紫奶油 · 甜妹专属',
    dark: false,
    preview: 'linear-gradient(135deg, #E8548F 0%, #B887FF 100%)',
    dot: '#E8548F',
    navBg: '#FFF3F8',
    navBgDark: '#FCE6F1',
    navText: 'black',
  },
  {
    key: 'cyber',
    name: '赛博霓虹',
    desc: '纯黑荧光 · 科技硬核',
    dark: true,
    preview: 'linear-gradient(135deg, #00E5C0 0%, #FF3D81 100%)',
    dot: '#00E5C0',
    navBg: '#0C101D',
    navBgDark: '#05060B',
    navText: 'white',
  },
  {
    key: 'retro',
    name: '复古胶片',
    desc: '米黄纸质 · 学院旧时光',
    dark: false,
    preview: 'linear-gradient(135deg, #8F3520 0%, #C25A3C 100%)',
    dot: '#B4472F',
    navBg: '#FBF5E7',
    navBgDark: '#F2E7D3',
    navText: 'black',
  },
  {
    key: 'moss',
    name: '森林苔原',
    desc: '墨绿苔藓 · 安静专注',
    dark: true,
    preview: 'linear-gradient(135deg, #2E6B4A 0%, #6FBF8B 100%)',
    dot: '#6FBF8B',
    navBg: '#131F18',
    navBgDark: '#0C1510',
    navText: 'white',
  },
];

/** key 集合，用于校验非法值 */
var THEME_KEYS = CS_THEMES.map(function (t) { return t.key; });

function storageGet(key) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
      return wx.getStorageSync(key);
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (e) { /* 存储不可用时静默降级 */ }
  return '';
}

function storageSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(key, value);
      return true;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return true;
    }
  } catch (e) { /* 同上 */ }
  return false;
}

/** 读取当前皮肤 key；非法值一律回落默认，避免脏数据导致界面无样式 */
function getCsTheme() {
  var saved = storageGet(STORAGE_KEY);
  if (saved && THEME_KEYS.indexOf(saved) >= 0) return saved;
  return DEFAULT_CS_THEME;
}

/** 写入皮肤 key；非法值拒绝写入并返回当前值 */
function setCsTheme(key) {
  if (THEME_KEYS.indexOf(key) < 0) return getCsTheme();
  storageSet(STORAGE_KEY, key);
  return key;
}

/** 按 key 取元数据；找不到返回默认皮肤 */
function themeByKey(key) {
  for (var i = 0; i < CS_THEMES.length; i += 1) {
    if (CS_THEMES[i].key === key) return CS_THEMES[i];
  }
  return CS_THEMES[0];
}

/**
 * 按课程名分配配色索引（0~5）。
 * 同一门课永远拿到同一个颜色；不同课名尽量错开。
 * 用简单字符串 hash，纯函数、可测试。
 */
function colorIndexOf(title) {
  var s = String(title || '');
  var h = 0;
  for (var i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 1000003;
  }
  return h % 6;
}

/** 给一批课程补上 ci（配色索引）字段，返回新数组 */
function decorateCourseColors(list) {
  return (list || []).map(function (item) {
    if (!item) return item;
    return Object.assign({}, item, { ci: colorIndexOf(item.title) });
  });
}

/**
 * 同步原生导航栏颜色。
 * 深色皮肤若不同步导航栏，顶部会留一条浅色条（深色页面最刺眼的破绽之一）。
 * frontColor 只接受 #ffffff / #000000 两个值，故按 navText 二选一。
 */
function applyNavBar(key) {
  var meta = themeByKey(key);
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.setNavigationBarColor === 'function') {
      wx.setNavigationBarColor({
        frontColor: meta.navText === 'white' ? '#ffffff' : '#000000',
        backgroundColor: meta.navBg,
      });
    }
  } catch (e) { /* 设置失败不影响页面本体 */ }
  return meta;
}

module.exports = {
  CS_THEMES: CS_THEMES,
  THEME_KEYS: THEME_KEYS,
  DEFAULT_CS_THEME: DEFAULT_CS_THEME,
  STORAGE_KEY: STORAGE_KEY,
  getCsTheme: getCsTheme,
  setCsTheme: setCsTheme,
  themeByKey: themeByKey,
  applyNavBar: applyNavBar,
  colorIndexOf: colorIndexOf,
  decorateCourseColors: decorateCourseColors,
};
