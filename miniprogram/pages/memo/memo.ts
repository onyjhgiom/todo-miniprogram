// pages/memo/memo.ts
// 语音备忘录：无限层级文件夹 / 语音速记（本地录音 + 云端转写）/ 清单模式 /
// 标签搜索 / 加密解锁 / 版本回溯 / 归档 / 云端同步
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast, callFn } from '../../utils/cloud';
import {
  loadMemos, loadFolders, createMemo, upsertMemo, removeMemo, archiveMemo,
  createFolder, renameFolder, removeFolder, folderChain, folderSubtreeIds,
  filterMemos, memoSummary, memoStat, allTags, mergeFromCloud,
  makeAudioClip, setClipStatus, pendingClips, restoreVersion,
  hashLock, MEMO_COLORS
} from '../../utils/memo-store';
import {
  isVoiceAvailable, startVoiceSession, createPlayer, ensureRecordAuth,
  uploadVoiceFile, recognizeVoice
} from '../../utils/voice';
import type { IMemo, IMemoFolder, IMemoVersion } from '../../types/index';
import type { ThemeKey } from '../../types/index';

interface MemoItemView {
  id: string;
  title: string;
  summary: string;
  color: string;
  tagText: string;
  audioCount: number;
  imgCount: number;
  locked: boolean;
  pinned: boolean;
  archived: boolean;
  timeText: string;
  /* 新版卡片视觉 */
  icon: string;
  thumbBg: string;
  catName: string;
  catColor: string;
  catBg: string;
  typeText: string;
  durationText: string;
}

interface StatDeltaCell {
  cls: string;
  text: string;
}

interface CategoryChip {
  id: string;
  key: string;
  name: string;
  emoji: string;
  count: number;
}

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

interface MemoData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;

  /* 文件夹区 */
  breadcrumb: { id: string; name: string }[];
  subFolders: { id: string; name: string; color: string; count: number }[];
  currentFolderId: string;

  /* 列表区 */
  memoItems: MemoItemView[];
  keyword: string;
  activeTag: string;
  showArchived: boolean;
  tags: { name: string; count: number }[];
  stat: { total: number; locked: number; audio: number; archived: number };

  /* 新版：筛选面板 / 分类 / 统计增量 / 今日效率 */
  filterOpen: boolean;
  categories: CategoryChip[];
  currentCatName: string;
  statDelta: { total: StatDeltaCell; audio: StatDeltaCell; locked: StatDeltaCell; archived: StatDeltaCell };
  efficiency: { todayCount: number; todayVoice: number; doneCount: number; percent: number };

  /* 编辑器 */
  editorOpen: boolean;
  draft: (IMemo & { lockHash?: string }) | null;
  draftChecklist: ChecklistItem[];
  isEdit: boolean;
  unlockNeeded: boolean;
  unlockPwd: string;
  tagInput: string;
  colorList: string[];
  folderNames: string[];
  folderIndex: number;

  /* 录音区 */
  recording: boolean;
  recordMode: 'voice' | 'audio';
  voiceReady: boolean;
  partialText: string;
  volume: number;
  recordSeconds: number;
  recognizing: boolean;
  playingClipId: string;

  /* 文件夹编辑 */
  folderSheetOpen: boolean;
  folderDraftName: string;
  folderParentId: string;
  parentNames: string[];
  parentIndex: number;

  /* 版本 */
  versionsOpen: boolean;
  versions: (IMemoVersion & { timeText: string })[];
}

/* 页面级缓存（非渲染数据，模块级变量避免 Page 泛型限制） */
let foldersCache: IMemoFolder[] = [];
let memosCache: IMemo[] = [];
let recordSecondsTick: ReturnType<typeof setInterval> | null = null;
let player: any = null;
/** 当前语音会话句柄（本地录音 + 云端转写） */
let voiceSession: { stop: () => void } | null = null;
/** 搜索防抖定时器（800ms） */
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

/* 分类视觉映射：根文件夹 → 图标 / 配色 */
const CAT_STYLE: Record<string, { emoji: string; color: string }> = {
  fd_life: { emoji: '🌱', color: '#34A853' },
  fd_work: { emoji: '💼', color: '#4A7DF0' },
  fd_idea: { emoji: '💡', color: '#F0A020' },
  生活: { emoji: '🌱', color: '#34A853' },
  工作: { emoji: '💼', color: '#4A7DF0' },
  灵感: { emoji: '💡', color: '#F0A020' },
  学习: { emoji: '📚', color: '#8B5CF6' },
  会议: { emoji: '📅', color: '#64748B' },
  待办: { emoji: '✅', color: '#F07020' }
};
const CAT_FALLBACK = [
  { emoji: '📁', color: '#6C7CFF' },
  { emoji: '🗂️', color: '#8B5CF6' },
  { emoji: '📌', color: '#EC4899' }
];

Page<MemoData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    breadcrumb: [],
    subFolders: [],
    currentFolderId: '',
    memoItems: [],
    keyword: '',
    activeTag: '',
    showArchived: false,
    tags: [],
    stat: { total: 0, locked: 0, audio: 0, archived: 0 },
    filterOpen: false,
    categories: [],
    currentCatName: '全部',
    statDelta: {
      total: { cls: 'flat', text: '较昨日 持平' },
      audio: { cls: 'flat', text: '较昨日 持平' },
      locked: { cls: 'flat', text: '较昨日 持平' },
      archived: { cls: 'flat', text: '较昨日 持平' }
    },
    efficiency: { todayCount: 0, todayVoice: 0, doneCount: 0, percent: 0 },
    editorOpen: false,
    draft: null,
    draftChecklist: [],
    isEdit: false,
    unlockNeeded: false,
    unlockPwd: '',
    tagInput: '',
    colorList: MEMO_COLORS,
    folderNames: [],
    folderIndex: 0,
    recording: false,
    recordMode: 'audio',
    voiceReady: false,
    partialText: '',
    volume: 0,
    recognizing: false,
    recordSeconds: 0,
    playingClipId: '',
    folderSheetOpen: false,
    folderDraftName: '',
    folderParentId: '',
    parentNames: [],
    parentIndex: 0,
    versionsOpen: false,
    versions: []
  },

  onLoad() {
    this.applyThemeToPage();
    this.setData({ voiceReady: isVoiceAvailable() });
  },

  onShow() {
    this.applyThemeToPage();
    // 用户可能刚在设置页开了权限，回来时重新确认云端识别可用性
    const voiceReady = isVoiceAvailable();
    if (voiceReady !== this.data.voiceReady) this.setData({ voiceReady });
    this.refresh();
    this.syncFromCloud();
  },

  onHide() {
    if (this.data.recording && voiceSession) voiceSession.stop();
  },

  onUnload() {
    if (voiceSession) voiceSession.stop();
    if (searchDebounce) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
    this.destroyPlayer();
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    });
    syncNavBar(state);
  },

  /* ==================== 数据刷新 ==================== */

  refresh() {
    foldersCache = loadFolders();
    memosCache = loadMemos();
    const folders = foldersCache;
    const memos = memosCache;
    const { currentFolderId, keyword, activeTag, showArchived } = this.data;

    const chain = folderChain(folders, currentFolderId);
    const breadcrumb = [{ id: '', name: '全部' }].concat(
      chain.map((f) => ({ id: f.id, name: f.name }))
    );
    const subFolders = folders
      .filter((f) => f.parentId === currentFolderId)
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        count: memos.filter((m) => m.folderId === f.id && !m.isArchived).length
      }));

    /* 分类条：全部 + 根文件夹（计数含子文件夹内备忘） */
    const categories: CategoryChip[] = [
      {
        id: '',
        key: 'all',
        name: '全部',
        emoji: '🏠',
        count: memos.filter((m) => !m.isArchived).length
      }
    ];
    let fallbackIdx = 0;
    folders
      .filter((f) => !f.parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((f) => {
        const style = CAT_STYLE[f.id] || CAT_STYLE[f.name] || CAT_FALLBACK[fallbackIdx++ % CAT_FALLBACK.length];
        const ids = new Set(folderSubtreeIds(folders, f.id));
        categories.push({
          id: f.id,
          key: f.id,
          name: f.name,
          emoji: style.emoji,
          count: memos.filter((m) => m.folderId && ids.has(m.folderId) && !m.isArchived).length
        });
      });

    const effectiveKw = activeTag || keyword;
    let filtered = filterMemos(memos, {
      keyword: effectiveKw || '',
      folderId: currentFolderId || undefined,
      showArchived: showArchived ? true : undefined
    });

    /* 分类名（卡片右上角标签）：取该备忘所在根文件夹 */
    const rootNameOf = new Map<string, { name: string; color: string }>();
    folders
      .filter((f) => !f.parentId)
      .forEach((f) => {
        const style = CAT_STYLE[f.id] || CAT_STYLE[f.name] || { emoji: '📁', color: '#6C7CFF' };
        const ids = folderSubtreeIds(folders, f.id);
        ids.forEach((id) => rootNameOf.set(id, { name: f.name, color: style.color }));
      });

    const memoItems: MemoItemView[] = filtered.map((m) => {
      const audio = m.audioList || [];
      const totalSec = audio.reduce((s, c) => s + (c.duration || 0), 0);
      const root = rootNameOf.get(m.folderId || '');
      const catColor = root ? root.color : '#6C7CFF';
      return {
        id: m._id,
        title: m.title || '无标题',
        summary: m.isLocked ? '🔒 内容已加密，点击输入密码查看' : memoSummary(m),
        color: m.color,
        tagText: (m.tags || []).map((t) => '#' + t).join(' '),
        audioCount: audio.length,
        imgCount: (m.imageList || []).length,
        locked: m.isLocked,
        pinned: m.isPinned,
        archived: m.isArchived,
        timeText: this.fmtTime(m.updateTime),
        icon: m.isLocked ? '🔒' : audio.length ? '🎙️' : '📝',
        thumbBg: `linear-gradient(135deg, ${m.color}33, ${m.color}66)`,
        catName: root ? root.name : '',
        catColor,
        catBg: catColor + '1A',
        typeText: m.isLocked ? '已加密' : audio.length ? '语音' : '文字',
        durationText: totalSec ? this.fmtDuration(totalSec) : ''
      };
    });

    const stat = memoStat(memos);
    const statDelta = {
      total: this.mkDelta(this.countCreated(memos, 0), this.countCreated(memos, 1)),
      audio: this.mkDelta(
        this.countCreated(memos.filter((m) => (m.audioList || []).length), 0),
        this.countCreated(memos.filter((m) => (m.audioList || []).length), 1)
      ),
      locked: this.mkDelta(
        this.countCreated(memos.filter((m) => m.isLocked), 0),
        this.countCreated(memos.filter((m) => m.isLocked), 1)
      ),
      archived: this.mkDelta(
        this.countCreated(memos.filter((m) => m.isArchived), 0),
        this.countCreated(memos.filter((m) => m.isArchived), 1)
      )
    };

    /* 今日效率：今日新建条数 + 今日语音条数 + 全部已完成待办 */
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todays = memos.filter((m) => m.createTime >= todayStart.getTime());
    const doneCount = memos.reduce(
      (s, m) => s + (m.checklist || []).filter((c) => c.done).length,
      0
    );
    const efficiency = {
      todayCount: todays.length,
      todayVoice: todays.filter((m) => (m.audioList || []).length).length,
      doneCount,
      percent: Math.min(100, todays.length * 20 + doneCount * 10)
    };

    this.setData({
      breadcrumb,
      subFolders,
      categories,
      currentCatName: currentFolderId
        ? folders.find((f) => f.id === currentFolderId)?.name || '全部'
        : '全部',
      memoItems,
      tags: allTags(memos).slice(0, 12),
      stat,
      statDelta,
      efficiency
    });
  },

  /** 相对今天偏移 offsetDays 那天新建的数量 */
  countCreated(memos: IMemo[], offsetDays: number): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime() - offsetDays * 86400000;
    return memos.filter((m) => m.createTime >= from && m.createTime < from + 86400000).length;
  },

  /** 较昨日增量文案 */
  mkDelta(today: number, yesterday: number): StatDeltaCell {
    const diff = today - yesterday;
    if (diff > 0) return { cls: 'up', text: `较昨日 +${diff}` };
    if (diff < 0) return { cls: 'down', text: `较昨日 ${diff}` };
    return { cls: 'flat', text: '较昨日 持平' };
  },

  /** 秒 → m:ss */
  fmtDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  },

  fmtTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return hm;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  },

  syncFromCloud() {
    callFn<{ success: boolean; items?: IMemo[] }>('memo', { action: 'list' })
      .then((res) => {
        const remote = Array.isArray(res.items) ? res.items : [];
        mergeFromCloud(loadMemos(), remote);
        this.refresh();
        this.retryPending();
      })
      .catch(() => {
        /* 云不可用时纯本地 */
      });
  },

  /**
   * 待转写队列重试：把 status=pending 的录音片段重新上传识别。
   * - 超 7 天仍失败：标 failed，避免长期挂起误导用户
   * - 其余：静默重试一次，成功则回填文字并把状态置 done
   */
  retryPending() {
    const pend = pendingClips(loadMemos());
    if (!pend.length) return;
    const week = 7 * 86400000;
    let changed = false;
    for (const p of pend) {
      if (Date.now() - p.clip.createTime > week) {
        setClipStatus(p.memoId, p.clip.id, 'failed');
        changed = true;
      }
    }
    if (changed) this.refresh();
    // 云端可用时，静默补转写（每次仅处理最早的一条，避免并发过多）
    if (isVoiceAvailable()) {
      const target = pend.find((p) => p.clip.status === 'pending' && p.clip.src);
      if (target) void this.retryOneClip(target);
    }
  },

  /** 重试单个片段的云端转写 */
  async retryOneClip(target: { memoId: string; clip: { id: string; src: string } }) {
    try {
      const fileID = await uploadVoiceFile(target.clip.src);
      const text = await recognizeVoice(fileID);
      if (text && text.trim()) {
        setClipStatus(target.memoId, target.clip.id, 'done', text.trim());
        this.refresh();
      }
    } catch (e) {
      /* 静默失败，下次再试 */
    }
  },

  /* ==================== 文件夹操作 ==================== */

  onFolderTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    this.setData({ currentFolderId: id, keyword: '', activeTag: '' });
    this.refresh();
  },

  onBreadcrumbTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    this.setData({ currentFolderId: id });
    this.refresh();
  },

  folderLabel(f: IMemoFolder): string {
    return folderChain(foldersCache, f.id).map((x) => x.name).join('/');
  },

  onFolderNew() {
    const parentNames = ['根目录'].concat(foldersCache.map((f) => this.folderLabel(f)));
    const parentIds = [''].concat(foldersCache.map((f) => f.id));
    const cur = this.data.currentFolderId;
    this.setData({
      folderSheetOpen: true,
      folderDraftName: '',
      folderParentId: cur,
      parentNames,
      parentIndex: Math.max(0, parentIds.indexOf(cur))
    });
  },

  onFolderSheetClose() {
    this.setData({ folderSheetOpen: false });
  },

  onFolderNameInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ folderDraftName: e.detail.value });
  },

  onParentChange(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number(e.detail.value);
    const parentIds = [''].concat(foldersCache.map((f) => f.id));
    this.setData({ parentIndex: idx, folderParentId: parentIds[idx] || '' });
  },

  onFolderSave() {
    const name = this.data.folderDraftName.trim();
    if (!name) {
      toast('请输入文件夹名称');
      return;
    }
    createFolder(name, this.data.folderParentId);
    this.setData({ folderSheetOpen: false });
    this.refresh();
    toast('已创建', 'success');
  },

  onFolderLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const f = foldersCache.find((x) => x.id === id);
    if (!f) return;
    const that = this;
    wx.showActionSheet({
      itemList: ['重命名', '删除文件夹'],
      success(res) {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '重命名文件夹',
            editable: true,
            placeholderText: f.name,
            success(m) {
              if (m.confirm && m.content && m.content.trim()) {
                renameFolder(id, m.content.trim());
                that.refresh();
                toast('已重命名', 'success');
              }
            }
          });
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '删除文件夹',
            content: `删除「${f.name}」及其子文件夹？其中的备忘会移到根目录，不会丢失。`,
            confirmText: '删除',
            confirmColor: '#ef4444',
            success(m) {
              if (m.confirm) {
                removeFolder(id);
                if (that.data.currentFolderId === id) {
                  that.setData({ currentFolderId: '' });
                }
                that.refresh();
                toast('已删除', 'success');
              }
            }
          });
        }
      }
    });
  },

  /* ==================== 搜索 / 筛选 ==================== */

  onSearchInput(e: WechatMiniprogram.InputEvent) {
    // 关键词先同步（清空按钮即时可用），过滤 800ms 防抖后再执行
    this.setData({ keyword: e.detail.value, activeTag: '' });
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchDebounce = null;
      this.refresh();
    }, 800);
  },

  onSearchClear() {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
    this.setData({ keyword: '', activeTag: '' });
    this.refresh();
  },

  onFilterToggle() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },

  onCategoryTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    if (id === this.data.currentFolderId) return;
    this.setData({ currentFolderId: id, keyword: '', activeTag: '' });
    this.refresh();
  },

  onTagTap(e: WechatMiniprogram.TouchEvent) {
    const tag = (e.currentTarget.dataset.tag as string) || '';
    this.setData({ activeTag: this.data.activeTag === tag ? '' : tag, keyword: '' });
    this.refresh();
  },

  onToggleArchived() {
    this.setData({ showArchived: !this.data.showArchived });
    this.refresh();
  },

  onSheetStop() {
    /* 截断弹层内事件冒泡 */
  },

  /* ==================== 打开 / 新建备忘 ==================== */

  onNewMemo() {
    const draft = createMemo({
      folderId: this.data.currentFolderId,
      color: MEMO_COLORS[Math.floor(Math.random() * MEMO_COLORS.length)]
    });
    this.openEditor(draft, false);
  },

  /** 快捷语音记录：新建备忘后直接进入录音 */
  onQuickVoice() {
    const draft = createMemo({
      folderId: this.data.currentFolderId,
      color: MEMO_COLORS[Math.floor(Math.random() * MEMO_COLORS.length)]
    });
    this.openEditor(draft, false);
    void this.beginRecordWithAuth();
  },

  /** 快捷待办：新建清单模式备忘 */
  onNewTodo() {
    const draft = createMemo({
      folderId: this.data.currentFolderId,
      color: '#10b981',
      isChecklist: true
    });
    this.openEditor(draft, false);
  },

  /** 快捷加密备忘：新建后直接引导设置密码 */
  onNewLocked() {
    const draft = createMemo({
      folderId: this.data.currentFolderId,
      color: '#64748b'
    });
    this.openEditor(draft, false);
    this.onLockToggle();
  },

  /** 导入：图片 / 文字文件（.txt）转成备忘 */
  onImport() {
    const that = this;
    wx.showActionSheet({
      itemList: ['🖼 导入图片', '📄 导入文字文件'],
      success(res) {
        if (res.tapIndex === 0) {
          wx.chooseMedia({
            count: 9,
            mediaType: ['image'],
            success(m) {
              const paths = m.tempFiles.map((f) => f.tempFilePath);
              if (!paths.length) return;
              const draft = createMemo({
                folderId: that.data.currentFolderId,
                color: '#3b82f6',
                imageList: paths
              });
              that.openEditor(draft, false);
              toast('已导入图片，补充标题后保存', 'success');
            }
          });
        } else {
          wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: ['txt'],
            success(m) {
              const file = m.tempFiles && m.tempFiles[0];
              if (!file || file.size > 200 * 1024) {
                toast('仅支持 200KB 内的 txt 文件');
                return;
              }
              wx.getFileSystemManager().readFile({
                filePath: file.path,
                encoding: 'utf8',
                success(r) {
                  const content = typeof r.data === 'string' ? r.data.slice(0, 5000) : '';
                  if (!content.trim()) {
                    toast('文件内容为空');
                    return;
                  }
                  const draft = createMemo({
                    folderId: that.data.currentFolderId,
                    color: '#3b82f6',
                    title: file.name.replace(/\.txt$/i, '').slice(0, 60),
                    content
                  });
                  that.openEditor(draft, false);
                  toast('已导入文字内容', 'success');
                },
                fail() {
                  toast('文件读取失败');
                }
              });
            }
          });
        }
      }
    });
  },

  onMemoTap(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const memo = memosCache.find((m) => m._id === id);
    if (!memo) return;
    this.openEditor(memo, true);
  },

  onMemoLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset.id as string) || '';
    const memo = memosCache.find((m) => m._id === id);
    if (!memo) return;
    const that = this;
    const actions = memo.isArchived ? ['取消归档', '删除'] : ['置顶/取消置顶', '归档', '删除'];
    wx.showActionSheet({
      itemList: actions,
      success(res) {
        const label = actions[res.tapIndex];
        if (label === '删除') {
          wx.showModal({
            title: '删除备忘',
            content: '删除后不可恢复，确定吗？',
            confirmText: '删除',
            confirmColor: '#ef4444',
            success(m) {
              if (m.confirm) {
                removeMemo(id);
                that.refresh();
                toast('已删除', 'success');
              }
            }
          });
        } else if (label === '归档') {
          archiveMemo(id, true);
          that.refresh();
          toast('已归档', 'success');
        } else if (label === '取消归档') {
          archiveMemo(id, false);
          that.refresh();
          toast('已恢复', 'success');
        } else if (label === '置顶/取消置顶') {
          upsertMemo(Object.assign({}, memo, { isPinned: !memo.isPinned }));
          that.refresh();
        }
      }
    });
  },

  openEditor(memo: IMemo, isEdit: boolean) {
    const folderNames = ['根目录'].concat(foldersCache.map((f) => this.folderLabel(f)));
    const folderIds = [''].concat(foldersCache.map((f) => f.id));
    this.setData({
      editorOpen: true,
      draft: memo,
      draftChecklist: (memo.checklist || []).map((c) => ({ ...c })),
      isEdit,
      unlockNeeded: isEdit && !!memo.isLocked,
      unlockPwd: '',
      tagInput: '',
      partialText: '',
      folderNames,
      folderIndex: Math.max(0, folderIds.indexOf(memo.folderId || ''))
    });
  },

  onEditorClose() {
    this.stopRecordingUI();
    this.destroyPlayer();
    this.setData({ editorOpen: false, draft: null, versionsOpen: false });
  },

  /* ==================== 解锁 ==================== */

  onUnlockInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ unlockPwd: e.detail.value });
  },

  onUnlockSubmit() {
    const draft = this.data.draft;
    if (!draft) return;
    if (hashLock(this.data.unlockPwd) === (draft.lockHash || '')) {
      this.setData({ unlockNeeded: false, unlockPwd: '' });
    } else {
      toast('密码不正确');
    }
  },

  onLockToggle() {
    const draft = this.data.draft;
    if (!draft) return;
    const that = this;
    if (!draft.isLocked) {
      wx.showModal({
        title: '设置加密密码',
        editable: true,
        placeholderText: '输入 4 位以上密码',
        success(m) {
          if (m.confirm) {
            const pwd = (m.content || '').trim();
            if (pwd.length < 4) {
              toast('密码至少 4 位');
              return;
            }
            that.setData({ draft: Object.assign({}, draft, { isLocked: true, lockHash: hashLock(pwd) }) });
            toast('已加密（保存后生效）', 'success');
          }
        }
      });
    } else {
      this.setData({ draft: Object.assign({}, draft, { isLocked: false, lockHash: '' }) });
      toast('已解锁', 'success');
    }
  },

  /* ==================== 编辑器字段 ==================== */

  onTitleInput(e: WechatMiniprogram.InputEvent) {
    if (!this.data.draft) return;
    this.setData({ 'draft.title': e.detail.value });
  },

  onContentInput(e: WechatMiniprogram.InputEvent) {
    if (!this.data.draft) return;
    this.setData({ 'draft.content': e.detail.value });
  },

  onColorTap(e: WechatMiniprogram.TouchEvent) {
    const color = (e.currentTarget.dataset.color as string) || '';
    if (!this.data.draft || !color) return;
    this.setData({ 'draft.color': color });
  },

  onPinToggle() {
    if (!this.data.draft) return;
    this.setData({ 'draft.isPinned': !this.data.draft.isPinned });
  },

  onFolderChange(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number(e.detail.value);
    const folderIds = [''].concat(foldersCache.map((f) => f.id));
    if (!this.data.draft) return;
    this.setData({ folderIndex: idx, 'draft.folderId': folderIds[idx] || '' });
  },

  onChecklistToggle() {
    const draft = this.data.draft;
    if (!draft) return;
    const toList = !draft.isChecklist;
    if (toList && !this.data.draftChecklist.length && draft.content) {
      // 正文按行转清单
      const items = draft.content
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text, i) => ({ id: `ck_${Date.now().toString(36)}_${i}`, text, done: false }));
      this.setData({ 'draft.isChecklist': true, 'draft.content': '', draftChecklist: items });
    } else if (!toList && this.data.draftChecklist.length) {
      // 清单转回正文
      const content = this.data.draftChecklist.map((c) => (c.done ? '[x] ' : '[ ] ') + c.text).join('\n');
      this.setData({ 'draft.isChecklist': false, 'draft.content': content });
    } else {
      this.setData({ 'draft.isChecklist': toList });
    }
  },

  onCheckInput(e: WechatMiniprogram.InputEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const list = this.data.draftChecklist.slice();
    if (idx < 0 || idx >= list.length) return;
    list[idx] = { ...list[idx], text: e.detail.value };
    this.setData({ draftChecklist: list });
  },

  onCheckToggle(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const list = this.data.draftChecklist.slice();
    if (idx < 0 || idx >= list.length) return;
    list[idx] = { ...list[idx], done: !list[idx].done };
    this.setData({ draftChecklist: list });
  },

  onCheckRemove(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const list = this.data.draftChecklist.slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    this.setData({ draftChecklist: list });
  },

  onCheckAdd() {
    const list = this.data.draftChecklist.slice();
    list.push({ id: `ck_${Date.now().toString(36)}_${list.length}`, text: '', done: false });
    this.setData({ draftChecklist: list });
  },

  /* ==================== 标签 ==================== */

  onTagInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ tagInput: e.detail.value });
  },

  onTagAdd() {
    const name = this.data.tagInput.trim();
    const draft = this.data.draft;
    if (!draft || !name) return;
    if ((draft.tags || []).includes(name)) {
      this.setData({ tagInput: '' });
      return;
    }
    this.setData({ 'draft.tags': (draft.tags || []).concat(name), tagInput: '' });
  },

  onTagRemove(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const draft = this.data.draft;
    if (!draft) return;
    const tags = (draft.tags || []).slice();
    if (idx < 0 || idx >= tags.length) return;
    tags.splice(idx, 1);
    this.setData({ 'draft.tags': tags });
  },

  /* ==================== 图片 ==================== */

  onAddImage() {
    const that = this;
    const cur = (this.data.draft && this.data.draft.imageList) || [];
    wx.chooseMedia({
      count: Math.max(1, 9 - cur.length),
      mediaType: ['image'],
      success(res) {
        if (!that.data.draft) return;
        const paths = res.tempFiles.map((f) => f.tempFilePath);
        that.setData({ 'draft.imageList': cur.concat(paths) });
      }
    });
  },

  onImageRemove(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const draft = this.data.draft;
    if (!draft) return;
    const imgs = (draft.imageList || []).slice();
    if (idx < 0 || idx >= imgs.length) return;
    imgs.splice(idx, 1);
    this.setData({ 'draft.imageList': imgs });
  },

  onImagePreview(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const draft = this.data.draft;
    if (!draft || !(draft.imageList || []).length) return;
    wx.previewImage({ urls: draft.imageList, current: draft.imageList[idx] });
  },

  /* ==================== 录音 / 转写 ==================== */

  onRecordToggle() {
    if (this.data.recognizing) return; // 识别中，忽略点击
    if (this.data.recording) {
      this.stopRecordingUI();
      if (voiceSession) {
        voiceSession.stop(); // 结束后走 录音→上传→识别 流程
      }
      return;
    }
    // 开始录音前先确保拿到麦克风权限，避免用户拒绝后按钮「点了没反应」
    void this.beginRecordWithAuth();
  },

  /** 权限检查通过后再启动录音；被拒则给出明确指引 */
  async beginRecordWithAuth() {
    const auth = await ensureRecordAuth();
    if (auth === 'denied') {
      toast('未获得麦克风权限，无法录音');
      return;
    }
    if (auth === 'unsupported') {
      // 拿不到权限状态时依然尝试录音，由底层回调兜底报错
      console.warn('[memo] 无法读取录音权限状态，直接尝试录音');
    }
    this.startRecording();
  },

  startRecording() {
    const that = this;
    recordSecondsTick = setInterval(() => {
      that.setData({ recordSeconds: that.data.recordSeconds + 1 });
    }, 1000);

    // 本地录音 + 云端转写
    voiceSession = startVoiceSession({
      onVolume(vol) {
        that.setData({ volume: vol });
      },
      onStatus(status) {
        if (status === 'recording') {
          that.setData({ recording: true, recordMode: 'voice', recordSeconds: 0, partialText: '' });
        } else if (status === 'recognizing') {
          that.setData({ recording: false, recognizing: true });
          toast('正在识别…', 'loading');
        } else {
          that.setData({ recognizing: false });
        }
      },
      onFinal(text, filePath, durationSec) {
        voiceSession = null;
        that.clearRecordTimer();
        that.setData({ recording: false, recognizing: false, partialText: '', volume: 0 });
        const draft = that.data.draft;
        // 录音片段照常保存（有录音就有原声，便于回放/重试）
        if (draft && filePath) {
          const clip = makeAudioClip(filePath, durationSec, text || '');
          that.setData({ 'draft.audioList': (draft.audioList || []).concat(clip) });
        }
        // 识别文字写入正文 / 清单项
        if (text && text.trim()) {
          const clean = text.trim();
          if (draft && draft.isChecklist) {
            const list = that.data.draftChecklist.slice();
            list.push({ id: `ck_${Date.now().toString(36)}_${list.length}`, text: clean, done: false });
            that.setData({ draftChecklist: list });
          } else if (draft) {
            that.setData({ 'draft.content': (draft.content ? draft.content + '\n' : '') + clean });
          }
          toast('已转写', 'success');
        } else {
          toast('已保存录音（待转写）', 'success');
        }
      },
      onError(msg) {
        that.stopRecordingUI();
        that.setData({ recognizing: false });
        toast(msg || '语音识别失败，可重试');
      }
    });

    if (!voiceSession) {
      this.clearRecordTimer();
      this.setData({ recording: false });
      toast('云端识别服务未就绪，请检查云开发配置');
    }
  },

  /** 仅复位录音 UI 状态（不清数据） */
  stopRecordingUI() {
    this.clearRecordTimer();
    if (this.data.recording) {
      this.setData({ recording: false, partialText: '', volume: 0 });
    }
  },

  clearRecordTimer() {
    if (recordSecondsTick) {
      clearInterval(recordSecondsTick);
      recordSecondsTick = null;
    }
  },

  /* ==================== 音频片段 ==================== */

  onClipTap(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const draft = this.data.draft;
    if (!draft || !(draft.audioList || []).length) return;
    const clip = draft.audioList[idx];
    if (!clip || !clip.src) {
      toast('该片段没有原声文件');
      return;
    }
    if (this.data.playingClipId === clip.id) {
      this.destroyPlayer();
      this.setData({ playingClipId: '' });
      return;
    }
    this.destroyPlayer();
    const p = createPlayer();
    if (!p) {
      toast('播放不可用');
      return;
    }
    const that = this;
    p.src = clip.src;
    p.onEnded(() => {
      that.setData({ playingClipId: '' });
    });
    p.onError(() => {
      that.setData({ playingClipId: '' });
      toast('本地临时音频可能已失效');
    });
    p.play();
    player = p;
    this.setData({ playingClipId: clip.id });
  },

  onClipText(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const draft = this.data.draft;
    if (!draft || !(draft.audioList || []).length) return;
    const clip = draft.audioList[idx];
    if (clip && clip.text) {
      wx.setClipboardData({ data: clip.text });
    }
  },

  onClipRemove(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const draft = this.data.draft;
    if (!draft || !(draft.audioList || []).length) return;
    const list = (draft.audioList || []).slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    this.setData({ 'draft.audioList': list });
  },

  destroyPlayer() {
    if (player) {
      try {
        player.stop();
        player.destroy();
      } catch (e) {
        /* ignore */
      }
      player = null;
    }
  },

  /* ==================== 版本 ==================== */

  onVersionsToggle() {
    const draft = this.data.draft;
    if (!draft) return;
    const versions = (draft.versions || []).map((v) => ({
      ...v,
      timeText: this.fmtTime(v.createTime)
    }));
    this.setData({ versionsOpen: !this.data.versionsOpen, versions });
  },

  onVersionRestore(e: WechatMiniprogram.TouchEvent) {
    const vid = (e.currentTarget.dataset.id as string) || '';
    const draft = this.data.draft;
    if (!draft || !vid) return;
    restoreVersion(draft._id, vid);
    const updated = loadMemos().find((m) => m._id === draft._id);
    if (updated) {
      this.setData({
        draft: updated,
        draftChecklist: (updated.checklist || []).map((c) => ({ ...c })),
        versionsOpen: false
      });
      toast('已恢复该版本', 'success');
    }
  },

  /* ==================== 保存 / 删除 / 归档 ==================== */

  onSave() {
    const draft = this.data.draft;
    if (!draft) return;
    const checklist = this.data.draftChecklist.filter((c) => (c.text || '').trim());
    if (
      !draft.title.trim() &&
      !draft.content.trim() &&
      !checklist.length &&
      !(draft.audioList || []).length &&
      !(draft.imageList || []).length
    ) {
      toast('内容为空');
      return;
    }
    const final: IMemo = Object.assign({}, draft, {
      title: draft.title.trim() || memoTitleFromContent(draft, checklist),
      checklist
    });
    upsertMemo(final);
    this.setData({ editorOpen: false, draft: null, versionsOpen: false });
    this.destroyPlayer();
    this.refresh();
    toast('已保存', 'success');
  },

  onDelete() {
    const draft = this.data.draft;
    if (!draft) return;
    const that = this;
    wx.showModal({
      title: '删除备忘',
      content: '删除后不可恢复，确定吗？',
      confirmText: '删除',
      confirmColor: '#ef4444',
      success(m) {
        if (m.confirm) {
          removeMemo(draft._id);
          that.setData({ editorOpen: false, draft: null });
          that.refresh();
          toast('已删除', 'success');
        }
      }
    });
  },

  onArchiveToggle() {
    const draft = this.data.draft;
    if (!draft) return;
    const next = Object.assign({}, draft, { isArchived: !draft.isArchived });
    upsertMemo(next);
    this.setData({ editorOpen: false, draft: null });
    this.refresh();
    toast(next.isArchived ? '已归档' : '已恢复', 'success');
  },

  /* ==================== 导出 ==================== */

  onExport() {
    const memos = loadMemos().filter((m) => !m.isLocked);
    if (!memos.length) {
      toast('没有可导出的备忘');
      return;
    }
    const lines = ['标题,内容,标签,创建时间'];
    for (const m of memos) {
      lines.push(
        [
          '"' + (m.title || '').replace(/"/g, '""') + '"',
          '"' + (m.isChecklist
            ? (m.checklist || []).map((c) => (c.done ? '[x] ' : '[ ] ') + c.text).join('\n')
            : m.content || ''
          ).replace(/"/g, '""').replace(/\n/g, '\\n') + '"',
          '"' + (m.tags || []).join(' ') + '"',
          new Date(m.createTime).toISOString()
        ].join(',')
      );
    }
    wx.setClipboardData({
      data: '\uFEFF' + lines.join('\n'),
      success() {
        toast('已复制 CSV（可粘贴到表格）', 'success');
      }
    });
  }
});

function memoTitleFromContent(draft: IMemo, checklist: ChecklistItem[]): string {
  if (draft.isChecklist && checklist.length) return checklist[0].text.slice(0, 20);
  const line = (draft.content || '').split('\n').find((s) => s.trim());
  return line ? line.trim().slice(0, 20) : '无标题';
}
