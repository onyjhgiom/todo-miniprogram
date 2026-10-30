'use strict';

/**
 * 示例课表数据（演示 / 联调用）。
 * 注意：此文件是应用运行时内容（"载入示例课表"按钮依赖它），
 * 因此放在 data/ 下，不参与打包排除；请勿移回 test/ 目录。
 */

module.exports = [
  { _id: 'e101', title: '移动应用开发', weekday: 1, startTime: '08:20', endTime: '10:00', location: '新校区博奕北401', teacher: '陈桓', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e102', title: '计算机网络', weekday: 1, startTime: '14:00', endTime: '15:40', location: '新校区公共教学楼北306', teacher: '吴璨', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e103', title: '嵌入式系统与应用', weekday: 2, startTime: '08:20', endTime: '10:00', location: '新校区公共教学楼北313', teacher: '孙晖', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e104', title: '操作系统', weekday: 2, startTime: '14:00', endTime: '15:40', location: '新校区公共教学楼北303', teacher: '黄孝', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e105', title: '操作系统', weekday: 3, startTime: '08:20', endTime: '10:00', location: '新校区博文南实验室二', teacher: '黄孝', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e106', title: '习思想概论', weekday: 3, startTime: '10:20', endTime: '12:00', location: '新校区公共教学楼南109', teacher: '曹崇慧', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e107', title: '移动应用开发', weekday: 4, startTime: '08:20', endTime: '10:00', location: '新校区博奕北401', teacher: '陈桓', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e108', title: '嵌入式系统与应用', weekday: 5, startTime: '08:20', endTime: '10:00', location: '新校区博文南401', teacher: '陈桓', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e109', title: '习思想概论', weekday: 5, startTime: '10:20', endTime: '12:00', location: '新校区公共教学楼南109', teacher: '曹崇慧', weekRule: { mode: 'odd', ranges: [], weeks: [] } },
  { _id: 'e110', title: '计算机网络', weekday: 5, startTime: '14:00', endTime: '15:40', location: '新校区博文北302', teacher: '吴璨', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
];
