'use strict';

/**
 * 课表皮肤切换器
 * 入口按钮 + 底部弹层，列出 6 套皮肤供选择。
 * 选中后写入本地存储并 triggerEvent('change')，由页面 setData 切换 data-cs-theme。
 */

var csTheme = require('../../utils/csTheme');

Component({
  properties: {
    /** 当前皮肤 key（页面传入，保证组件与页面状态一致） */
    current: { type: String, value: '' },
    /** 入口按钮是否显示文字 */
    label: { type: String, value: '' },
  },

  data: {
    visible: false,
    themes: csTheme.CS_THEMES,
    currentKey: csTheme.DEFAULT_CS_THEME,
    currentName: '',
  },

  observers: {
    current: function (val) {
      var key = (val && csTheme.THEME_KEYS.indexOf(val) >= 0) ? val : csTheme.getCsTheme();
      this.setData({
        currentKey: key,
        currentName: csTheme.themeByKey(key).name,
      });
    },
  },

  lifetimes: {
    attached: function () {
      var key = (this.data.current && csTheme.THEME_KEYS.indexOf(this.data.current) >= 0)
        ? this.data.current
        : csTheme.getCsTheme();
      this.setData({
        currentKey: key,
        currentName: csTheme.themeByKey(key).name,
      });
    },
  },

  methods: {
    open: function open() {
      this.setData({ visible: true });
    },

    close: function close() {
      this.setData({ visible: false });
    },

    /** 阻止点击弹层内容冒泡到遮罩（避免误关闭） */
    noop: function noop() {},

    pick: function pick(e) {
      var key = e.currentTarget.dataset.key;
      if (!key || csTheme.THEME_KEYS.indexOf(key) < 0) return;

      csTheme.setCsTheme(key);
      var meta = csTheme.themeByKey(key);
      var self = this;

      this.setData({ currentKey: key, currentName: meta.name });
      this.triggerEvent('change', { key: key, name: meta.name, dark: meta.dark });

      // 轻微延迟关闭，让勾选反馈先被看见
      setTimeout(function () { self.setData({ visible: false }); }, 200);
    },
  },
});
