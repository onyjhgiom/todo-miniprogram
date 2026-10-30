import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

/* 成语题库（可继续扩充至更大规模）。每条 4 字。 */
const BANK = ('一心一意,一帆风顺,一鸣惊人,一往无前,一诺千金,一蹴而就,一丝不苟,一见如故,一败涂地,一视同仁,' +
  '画蛇添足,足智多谋,人山人海,海阔天空,空前绝后,后生可畏,畏首畏尾,尾大不掉,掉以轻心,心安理得,' +
  '得意洋洋,异口同声,声东击西,西风落叶,叶公好龙,龙腾虎跃,跃然纸上,上善若水,水到渠成,成竹在胸,' +
  '胸有成竹,竹报平安,安居乐业,业精于勤,勤能补拙,舌战群儒,流连忘返,返老还童,童言无忌,忌贤妒能,' +
  '能屈能伸,伸张正义,义不容辞,辞旧迎新,新仇旧恨,恨之入骨,骨瘦如柴,柴米油盐,守株待兔,兔死狐悲,' +
  '悲欢离合,合二为一,温故知新,知难而退,退避三舍,舍己为人,人定胜天,天长地久,久负盛名,名落孙山,' +
  '山清水秀,秀色可餐,餐风饮露,无事生非,非同小可,可歌可泣,泣不成声,声泪俱下,下落不明,明察秋毫,' +
  '毫无疑义,义无反顾,顾名思义,雪中送炭,画龙点睛,井底之蛙,狐假虎威,威风凛凛,守口如瓶,胸无点墨,' +
  '墨守成规,规行矩步,步步为营,自相矛盾,兵荒马乱,乱七八糟,三心二意,意味深长,长话短说,说一不二,' +
  '雨过天晴,晴空万里,里应外合,合情合理,理直气壮,壮志凌云,云开见日,日积月累,风调雨顺,顺理成章,' +
  '五光十色,色厉内荏,百花齐放,放虎归山,山高水长,入木三分,分庭抗礼,礼尚往来,来日方长,长年累月,' +
  '月下老人,天作之合,合浦珠还,万众一心,心心相印,金玉良言,言之凿凿,鸟语花香,风和日丽,春暖花开,' +
  '开门见山,山穷水尽,尽力而为,为所欲为,千军万马,马到成功,功成名就,一举两得,得心应手,手忙脚乱,' +
  '百发百中,中流砥柱,十全十美,美中不足,足不出户,万紫千红,风花雪月,月明星稀,雪上加霜,七上八下,' +
  '下不为例,例行公事,事在人为,为人师表,表里如一,八九不离十,十拿九稳,稳如泰山,山崩地裂,千变万化,' +
  '化险为夷,大公无私,心旷神怡').split(',');

/* 同音字宽松判定表：尾字 -> 可接受的同音首字（存在题库中的真实同音字） */
const HOMOPHONE = {
  '意': '一', '义': '一', '疑': '一', '怡': '一',
  '心': '新', '新': '心'
};

const byHead = {};
BANK.forEach((w) => {
  const h = w.charAt(0);
  (byHead[h] = byHead[h] || []).push(w);
});

function headOK(playerFirst, currentLast, loose) {
  if (playerFirst === currentLast) return true;
  if (loose && HOMOPHONE[currentLast] && HOMOPHONE[currentLast].indexOf(playerFirst) >= 0) return true;
  return false;
}

Page({
  data: {
    title: '成语接龙', current: '', tail: '', botSay: '', input: '', score: 0, best: 0,
    loose: false, message: '接住上方成语的最后一个字', msgType: 'info',
    timeText: '00:00', paused: false, showHint: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.setData({ best: store.getGame('idiom').best });
    this.newRound();
  },

  newRound() {
    const start = BANK[Math.floor(Math.random() * BANK.length)];
    this.setData({ current: start, tail: start.charAt(start.length - 1), botSay: '', input: '', message: '接住「' + start + '」的尾字', msgType: 'info' });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },
  onToggleLoose(e) { this.setData({ loose: e.detail.value }); },

  submit() {
    const raw = (this.data.input || '').trim();
    if (raw.length !== 4) { this.flash('请输入一个四字成语', 'warn'); return; }
    if (BANK.indexOf(raw) < 0) { this.flash('词库里没有「' + raw + '」', 'warn'); return; }
    const cur = this.data.current;
    const last = cur.charAt(cur.length - 1);
    const first = raw.charAt(0);
    if (!headOK(first, last, this.data.loose)) {
      this.flash('首字需为「' + last + '」' + (this.data.loose ? '（或同音字）' : ''), 'warn');
      return;
    }
    const score = this.data.score + 1;
    this.setData({ score, current: raw, tail: raw.charAt(raw.length - 1), input: '' });
    if (score > this.data.best) { this.data.best = score; this.setData({ best: score }); }

    // 电脑接龙
    const tail = raw.charAt(raw.length - 1);
    let pool = (byHead[tail] || []).slice();
    if (this.data.loose) { (HOMOPHONE[tail] || '').split('').forEach((h) => { pool = pool.concat(byHead[h] || []); }); }
    pool = pool.filter((x) => x !== raw);
    if (pool.length) {
      const bot = pool[Math.floor(Math.random() * pool.length)];
      this.setData({ botSay: bot, current: bot, tail: bot.charAt(bot.length - 1), message: '电脑接：「' + bot + '」，请继续', msgType: 'ok' });
    } else {
      this.flash('电脑接不上啦，你赢了这一轮！', 'ok');
      setTimeout(() => this.newRound(), 900);
    }
  },

  flash(msg, type) { this.setData({ message: msg, msgType: type }); },

  onReset() { this.newRound(); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() {
    store.recordPlay('idiom', { score: this.data.best });
    wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } });
  },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); store.recordPlay('idiom', { score: this.data.best }); }
});
