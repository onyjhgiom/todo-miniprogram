'use strict';

/** weekRule → 人话，用于课表卡片与导入预览 */

function weekRuleText(rule) {
  if (!rule) return '每周';
  switch (rule.mode) {
    case 'every': return '每周';
    case 'odd': return '单周';
    case 'even': return '双周';
    case 'range': {
      if (!rule.ranges || !rule.ranges.length) return '每周';
      return rule.ranges
        .map((r) => (r.start === r.end ? '第' + r.start + '周' : '第' + r.start + '-' + r.end + '周'))
        .join('、');
    }
    case 'weeks': {
      if (!rule.weeks || !rule.weeks.length) return '每周';
      return '第' + rule.weeks.join('/') + '周';
    }
    default: return '每周';
  }
}

/** 反解 weekRule → UI 选项下标，供导入预览页回显 */
function ruleModeToIndex(rule) {
  if (!rule) return 0;
  if (rule.mode === 'odd') return 1;
  if (rule.mode === 'even') return 2;
  if (rule.mode === 'range' || rule.mode === 'weeks') return 3;
  return 0;
}

function indexToRuleMode(idx) {
  return ['every', 'odd', 'even', 'range'][idx] || 'every';
}

module.exports = { weekRuleText, ruleModeToIndex, indexToRuleMode };
