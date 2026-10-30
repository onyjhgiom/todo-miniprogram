// components/empty-state/empty-state.ts
Component({
  properties: {
    icon: { type: String, value: '📭' },
    title: { type: String, value: '空空如也' },
    subtitle: { type: String, value: '' },
    actionText: { type: String, value: '' }
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});