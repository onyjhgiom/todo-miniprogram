'use strict';

/**
 * app.js 接入示例（片段）
 * 只需在 onLaunch 里建一次 store，并算好当前周次。
 * 注：课程表 AI 已下线，录入/修改一律走本地规则解析与手动编辑。
 */

const ScheduleStore = require('./store/scheduleStore');

App({
  globalData: {
    store: null,
    currentWeek: 1,
    pendingImport: null,   // 解析结果暂存，供导入预览页读取
    parseInstruction: null,
  },

  onLaunch: function onLaunch() {
    const semesterStart = '2026-09-01';   // TODO: 换成后端学期配置
    const totalWeeks = 16;

    this.globalData.store = new ScheduleStore({
      semesterStart: semesterStart,
      totalWeeks: totalWeeks,
    });

    this.globalData.currentWeek = this.computeWeek(semesterStart, totalWeeks);
  },

  /** week = floor((today - semesterStart) / 7) + 1，钳制到 1~totalWeeks */
  computeWeek: function computeWeek(semesterStart, totalWeeks) {
    const DAY = 86400000;
    const s = Date.parse(semesterStart + 'T00:00:00+08:00');
    const now = Date.now();
    const diff = Math.floor((now - s) / DAY);
    const week = Math.floor(diff / 7) + 1;
    if (week < 1) return 1;
    if (week > totalWeeks) return totalWeeks;
    return week;
  },
});
