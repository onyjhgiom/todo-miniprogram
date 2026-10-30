Component({
  properties: {
    text: { type: String, value: '已更新' },
    visible: { type: Boolean, value: false },
    duration: { type: Number, value: 5000 },
  },

  observers: {
    visible: function visible(v) {
      this._reset(v);
    },
  },

  methods: {
    _reset: function _reset(v) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (v && this.data.duration > 0) {
        this._timer = setTimeout(() => {
          this.setData({ visible: false });
          this.triggerEvent('close');
        }, this.data.duration);
      }
    },

    onUndo: function onUndo() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this.triggerEvent('undo');
    },

    onClose: function onClose() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this.setData({ visible: false });
      this.triggerEvent('close');
    },
  },

  detached: function detached() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },
});
