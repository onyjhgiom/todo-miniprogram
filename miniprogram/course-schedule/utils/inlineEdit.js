'use strict';

/**
 * 课表卡片「就地编辑」的字段定义与校验
 *
 * 放在 utils 而不是页面里，是为了能被 test/smoke.js 直接单测 ——
 * 这些规则一旦被绕过，脏数据就会写进底表（AI 输出有 validator 挡着，
 * 手动编辑同样需要一道，而且这里是**报错回退**而不是静默截断：
 * 用户正在盯着输入框，静默改他的输入会让人以为没保存上）。
 *
 * 与 validator.js 的分工：
 *   validator.js   面向 AI 的批量输出，能修就修、修不了才剔除；
 *   本文件       面向人手输入，非法就明确提示并回退到修改前的值。
 */

/** 可编辑字段。顺序即编辑面板里的排列顺序，也是自动聚焦的优先顺序 */
const FIELDS = [
  { key: 'title', label: '课程名', max: 15, required: true, placeholder: '课程名称（必填）' },
  { key: 'teacher', label: '教师', max: 20, required: false, placeholder: '任课教师（可留空）' },
  { key: 'location', label: '地点', max: 20, required: false, placeholder: '上课地点（可留空）' },
];

function norm(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * 校验草稿
 * @param {Object} draft { title, teacher, location }
 * @returns {{ok:boolean, value?:Object, message?:string, field?:string}}
 *   ok=false 时 message 是可直接 toast 给用户看的人话，field 指出问题字段
 */
function validateInlineEdit(draft) {
  const d = draft || {};
  const out = {};

  for (let i = 0; i < FIELDS.length; i += 1) {
    const f = FIELDS[i];
    const v = norm(d[f.key]);

    if (f.required && !v) {
      return { ok: false, field: f.key, message: f.label + '不能为空' };
    }
    if (v.length > f.max) {
      return {
        ok: false,
        field: f.key,
        message: f.label + '最多 ' + f.max + ' 个字（当前 ' + v.length + ' 个）'
      };
    }
    // 空串一律存 null，与底表「没有该信息」的语义保持一致
    out[f.key] = v || null;
  }

  return { ok: true, value: out };
}

/**
 * 草稿相对原值是否真的变了。
 * 没变就不写库、不压撤销点——否则点一下卡片再点一下空白，撤销栈里就多一条空气记录。
 * @param {Object} draft
 * @param {Object} original { title, teacher, location }
 */
function isDirty(draft, original) {
  const d = draft || {};
  const o = original || {};
  return FIELDS.some((f) => norm(d[f.key]) !== norm(o[f.key]));
}

/** 从课表条目里取出可编辑字段的初始值 */
function draftFromEntry(entry) {
  const e = entry || {};
  const out = {};
  FIELDS.forEach((f) => { out[f.key] = e[f.key] == null ? '' : String(e[f.key]); });
  return out;
}

module.exports = {
  FIELDS: FIELDS,
  validateInlineEdit: validateInlineEdit,
  isDirty: isDirty,
  draftFromEntry: draftFromEntry,
};
