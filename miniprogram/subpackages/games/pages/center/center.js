import { go } from '../../utils/nav';
const store = require('../../utils/store');

const CATS = [
  { key: 'all', name: '全部' },
  { key: 'logic', name: '逻辑思维' },
  { key: 'memory', name: '记忆训练' },
  { key: 'puzzle', name: '拼图消除' },
  { key: 'culture', name: '国风文化' },
  { key: 'relax', name: '极简解压' }
];

const GAMES = [
  { id: 'huarong', name: '数字华容道', cat: 'logic', icon: '🧩', diff: '中等', desc: '滑块拼数字，挑战最少步数', tone: 'clay' },
  { id: 'merge2048', name: '2048 合成', cat: 'logic', icon: '🔢', diff: '中等', desc: '滑动合并，冲击更高分数', tone: 'gold' },
  { id: 'sudoku', name: '数独闯关', cat: 'logic', icon: '🧠', diff: '困难', desc: '四宫到九宫，步步为营', tone: 'clay' },
  { id: 'memory', name: '翻翻乐记忆', cat: 'memory', icon: '🃏', diff: '简单', desc: '翻牌配对，锻炼记忆力', tone: 'mint' },
  { id: 'flash', name: '瞬间记忆', cat: 'memory', icon: '⚡', diff: '中等', desc: '点位闪现，复刻位置', tone: 'mint' },
  { id: 'nummem', name: '数字速记', cat: 'memory', icon: '🔣', diff: '困难', desc: '数字闪现，逐位加长', tone: 'mint' },
  { id: 'puzzle', name: '经典拼图', cat: 'puzzle', icon: '🧩', diff: '简单', desc: '方块归位，自由闯关', tone: 'gold' },
  { id: 'match3', name: '极简消消乐', cat: 'puzzle', icon: '🍬', diff: '简单', desc: '三连消除，解压闯关', tone: 'gold' },
  { id: 'feihualing', name: '国学飞花令', cat: 'culture', icon: '📜', diff: '中等', desc: '主题飞花，诗词填空', tone: 'mint' },
  { id: 'classicqa', name: '典籍常识问答', cat: 'culture', icon: '📚', diff: '简单', desc: '经史子集，益智科普', tone: 'mint' },
  { id: 'point24', name: '24 点', cat: 'logic', icon: '🎴', diff: '中等', desc: '四张牌算 24，答对加分', tone: 'clay' },
  { id: 'idiom', name: '成语接龙', cat: 'culture', icon: '🀄', diff: '中等', desc: '两千成语，比拼连击', tone: 'mint' },
  { id: 'onestroke', name: '一笔画', cat: 'logic', icon: '✒️', diff: '困难', desc: '百关连线，不重复走完', tone: 'gold' },
  { id: 'schulte', name: '舒尔特方格', cat: 'memory', icon: '🔢', diff: '简单', desc: '5×5 注意力训练', tone: 'mint' },
  { id: 'tetris', name: '俄罗斯方块', cat: 'relax', icon: '🧱', diff: '中等', desc: '手势操控，冲击高分', tone: 'clay' },
  { id: 'teaser', name: '脑筋急转弯', cat: 'relax', icon: '💡', diff: '简单', desc: '分级闯关，连对翻倍', tone: 'gold' },
  { id: 'breakout', name: '打方块', cat: 'relax', icon: '🧱', diff: '中等', desc: '弹射砖块，纯解压', tone: 'clay' },
  { id: 'maze', name: '路径迷宫', cat: 'relax', icon: '🌀', diff: '中等', desc: '随机迷宫，闯关解谜', tone: 'clay' }
];

Page({
  data: {
    cats: CATS,
    activeCat: 'all',
    // 只保留 list 一份用于渲染，避免 games/list 双份数据重复 setData 序列化
    list: GAMES,
    stats: { todayPlays: 0, bestScore: 0, totalTimeText: '00:00' }
  },

  onShow() {
    // 主题类与统计各走一次 setData，避免同一帧内重复跨线程传输
    const cls = store.themeClass();
    if (cls !== this.data.themeCls) this.setData({ themeCls: cls });
    this.refreshStats();
  },

  refreshStats() {
    const g = store.getGlobal();
    const next = {
      'stats.todayPlays': g.todayPlays,
      'stats.bestScore': g.bestScore,
      'stats.totalTimeText': store.formatTime(g.totalTime)
    };
    // 统计值未变化时不触发 setData，返回大厅时省掉一次无谓渲染
    const cur = this.data.stats;
    if (cur.todayPlays === g.todayPlays && cur.bestScore === g.bestScore && cur.totalTimeText === next['stats.totalTimeText']) return;
    this.setData(next);
  },

  onSelectCat(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeCat) return;
    const list = key === 'all' ? GAMES : GAMES.filter((g) => g.cat === key);
    this.setData({ activeCat: key, list });
  },

  onPlay(e) {
    const id = e.currentTarget.dataset.id;
    go('/subpackages/games/pages/games/' + id + '/' + id);
  },

  onClear() {
    wx.showModal({
      title: '清空游戏数据',
      content: '将清除全部游戏的最高分、步数、时长等本地记录，确定吗？',
      confirmText: '清空', confirmColor: '#BE6F44',
      success: (res) => {
        if (res.confirm) {
          store.clearAll();
          this.refreshStats();
          wx.showToast({ title: '已清空', icon: 'none' });
        }
      }
    });
  }
});
