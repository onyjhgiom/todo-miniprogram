// pages/year-review/year-review.ts
// 年度治愈系回忆录：统计本年完成数据并生成可分享的总结卡片
import { yearStats, YearStat } from '../../utils/todo-store';
import { getThemeState, syncNavBar } from '../../utils/theme';
import type { ThemeKey } from '../../types/index';

Page<{
  theme: ThemeKey;
  themeStyle: string;
  bgStyle: string;
  stat: YearStat;
  monthMax: number;
  hasData: boolean;
  summary: string;
}>({
  data: {
    theme: 'light',
    themeStyle: '',
    bgStyle: '',
    stat: {
      year: new Date().getFullYear(),
      totalCompleted: 0,
      totalCreated: 0,
      byMonth: new Array(12).fill(0),
      byPriority: { high: 0, medium: 0, low: 0, none: 0 },
      topTags: [],
      activeDays: 0,
      longestStreak: 0,
      totalEstimatedMin: 0
    },
    monthMax: 1,
    hasData: false,
    summary: ''
  },

  onLoad() {
    this.applyTheme();
    this.buildReport();
  },

  onShow() {
    // 数据可能在其他页变化时更新，每次显示重算
    this.buildReport();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, bgStyle: s.bgStyle });
    syncNavBar(s);
  },

  buildReport() {
    const stat = yearStats();
    const max = Math.max(1, ...stat.byMonth);
    const hasData = stat.totalCompleted > 0;
    this.setData({ stat, monthMax: max, hasData, summary: this.buildSummary(stat) });
  },

  buildSummary(stat: YearStat): string {
    if (stat.totalCompleted === 0) {
      return '今年还没有完成记录～ 先从一件小事开始，完成的那一刻，回忆录就有了第一笔。';
    }
    const top = stat.topTags[0] ? `「${stat.topTags[0].tag}」` : '生活里的小事';
    const lines = [
      `今年你按下了 ${stat.totalCompleted} 次「完成」，最常出现在 ${top} 上。`,
      `你坚持了 ${stat.activeDays} 天，最长连续 ${stat.longestStreak} 天没有停下——`,
      `慢慢来，你已经在认真生活了，这本身就很棒。`
    ];
    if (stat.longestStreak >= 21) {
      lines[1] = `最长连续 ${stat.longestStreak} 天，已经养成了自己的节奏，`;
    }
    return lines.join('');
  },

  /** 生成分享图并保存到相册 */
  onShareImage() {
    // 旧版 canvas 接口（canvas-id）在部分类型定义中缺失，这里做兼容转换
    const ctx: any = (wx as any).createCanvasContext('shareCanvas', this);
    const W = 300;
    const H = 420;
    // 背景渐变
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#a8c0ff');
    g.addColorStop(1, '#e0f0ff');
    ctx.setFillStyle(g);
    ctx.fillRect(0, 0, W, H);

    // 标题
    ctx.setFillStyle('#3a3a5a');
    ctx.setFontSize(18);
    ctx.fillText(`${this.data.stat.year} 年度待办回忆录`, 24, 46);

    // 大数字
    ctx.setFontSize(60);
    ctx.setFillStyle('#5d4fe8');
    ctx.fillText(String(this.data.stat.totalCompleted), 24, 128);
    ctx.setFontSize(15);
    ctx.setFillStyle('#5a5a7a');
    ctx.fillText('件已完成', 24, 156);

    // 关键指标
    let y = 196;
    ctx.setFontSize(14);
    ctx.setFillStyle('#4a4a6a');
    ctx.fillText(`坚持 ${this.data.stat.activeDays} 天 · 最长连续 ${this.data.stat.longestStreak} 天`, 24, y);
    y += 26;
    ctx.fillText(`新建 ${this.data.stat.totalCreated} 件`, 24, y);
    y += 26;
    const tags = this.data.stat.topTags.map((t) => t.tag).join('、') || '—';
    ctx.fillText(`常做：${tags}`, 24, y);
    y += 32;

    // 治愈文案（自动换行）
    ctx.setFontSize(13);
    ctx.setFillStyle('#6a6a8a');
    this.wrapText(ctx, this.data.summary, 24, y, W - 48, 20);

    ctx.draw(() => {
      wx.canvasToTempFilePath(
        {
          canvasId: 'shareCanvas',
          success: (r) => {
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
              fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' })
            });
          },
          fail: () => wx.showToast({ title: '生成失败', icon: 'none' })
        }
      );
    });
  },

  /** 简易按字符宽度折行（旧版 canvas 无自动换行） */
  wrapText(
    ctx: WechatMiniprogram.CanvasContext,
    text: string,
    x: number,
    y: number,
    maxW: number,
    lh: number
  ) {
    const chars = (text || '').split('');
    let line = '';
    let yy = y;
    for (const ch of chars) {
      const test = line + ch;
      // measureText 在旧版 canvas 上下文上可用
      const w = (ctx.measureText && ctx.measureText(test).width) || test.length * 7;
      if (w > maxW && line) {
        ctx.fillText(line, x, yy);
        line = ch;
        yy += lh;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }
});
