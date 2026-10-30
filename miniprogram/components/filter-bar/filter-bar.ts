// components/filter-bar/filter-bar.ts
// 顶部筛选条：状态分段 + 搜索 + 筛选 chip 行
import type { FilterKey, Priority, SearchFilters } from '../../types/index';

interface CompData {
  statusOptions: { value: FilterKey; label: string; count: number }[];
  hasAnyFilter: boolean;
  priorityLabel: string;
}

interface CompProps {
  filter: FilterKey;
  keyword: string;
  filters: SearchFilters;
  counts: { all: number; active: number; done: number };
}

Component({
  options: {
    styleIsolation: 'apply-shared',
    multipleSlots: false
  },

  properties: {
    filter: { type: String, value: 'all' },
    keyword: { type: String, value: '' },
    filters: { type: Object, value: {} as SearchFilters },
    counts: { type: Object, value: { all: 0, active: 0, done: 0 } }
  },

  // 注意：keyword/filters 均以 properties 为准，
  // 不要在 data 中重复声明（会触发 "overwritten by property" 警告）
  data: {
    statusOptions: [
      { value: 'all', label: '全部', count: 0 },
      { value: 'active', label: '进行中', count: 0 },
      { value: 'done', label: '已完成', count: 0 }
    ],
    hasAnyFilter: false,
    priorityLabel: '优先级'
  } as CompData,

  observers: {
    'filter, counts': function (filter: FilterKey, counts: CompProps['counts']) {
      const statusOptions: CompData['statusOptions'] = [
        { value: 'all', label: '全部', count: counts?.all ?? 0 },
        { value: 'active', label: '进行中', count: counts?.active ?? 0 },
        { value: 'done', label: '已完成', count: counts?.done ?? 0 }
      ];
      this.setData({ statusOptions });
    },
    'filters': function (filters: SearchFilters) {
      const hasAnyFilter = !!(
        filters.priority ||
        filters.location ||
        filters.person ||
        filters.tag
      );
      const priorityMap: Record<Priority, string> = {
        high: '高优先级',
        medium: '中优先级',
        low: '低优先级'
      };
      const priorityLabel = filters.priority ? priorityMap[filters.priority] : '优先级';
      this.setData({ hasAnyFilter, priorityLabel });
    }
  },

  methods: {
    onChangeStatus(e: WechatMiniprogram.TouchEvent): void {
      const value = e.currentTarget.dataset.value as FilterKey;
      if (value === this.data.filter) return;
      this.triggerEvent('changeFilter', { value });
    },
    onInputKeyword(e: WechatMiniprogram.InputEvent): void {
      this.triggerEvent('changeKeyword', { value: e.detail.value });
    },
    onClearKeyword(): void {
      this.triggerEvent('changeKeyword', { value: '' });
    },
    onTapFilter(e: WechatMiniprogram.TouchEvent): void {
      const key = e.currentTarget.dataset.key as keyof SearchFilters;
      this.triggerEvent('openFilter', { key });
    },
    onClearFilter(e: WechatMiniprogram.TouchEvent): void {
      const key = e.currentTarget.dataset.key as keyof SearchFilters;
      this.triggerEvent('clearFilter', { key });
    },
    onResetAll(): void {
      this.triggerEvent('resetFilters');
    }
  }
});
