/**
 * 游戏通用内核：计时器 + 通关寄语 + 结算
 * 所有游戏纯单机、无广告、无付费
 */
const BLESSINGS = [
  '千里之行，始于足下。',
  '学而不思则罔，思而不学则殆。',
  '上善若水，水善利万物而不争。',
  '温故而知新，可以为师矣。',
  '知者不惑，仁者不忧，勇者不惧。',
  '大道至简，衍化至繁。',
  '静以修身，俭以养德。',
  '不积跬步，无以至千里。'
];

function blessing() {
  return BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)];
}

/* ---------- 文本归一化 / 作答判定 ----------
 * 供「脑筋急转弯」「飞花令」等需要玩家自己敲答案的题型复用：
 * 统一处理全角标点、空白、中英文数字、语气助词，再容错比对。
 */

/** 全角转半角 + 去空白去标点 + 中文数字转阿拉伯 + 去尾部语气词，最后转小写 */
function normalize(s) {
  if (s === null || s === undefined) return '';
  let t = String(s);
  // 全角字符（！～ 区间）转半角
  t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  t = t.replace(/\u3000/g, ' ');
  // 去掉所有空白与中英文标点
  t = t.replace(/[\s,.;:!?'"`~@#$%^&*()\[\]{}<>\-_+=\\/|、。，；：！？‘’“”《》（）【】「」·…—]/g, '');
  // 中文数字统一成阿拉伯数字，便于「一轮明月」式写法互通
  const cn = { 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
  t = t.replace(/[一二两三四五六七八九十]/g, (ch) => cn[ch] || ch);
  // 去掉句尾语气助词
  t = t.replace(/(的话|的时候|啊|呀|吧|呢|了|嘛|哦)$/g, '');
  return t.toLowerCase();
}

/**
 * 容错判定：完全相等 / 玩家多写了内容 / 玩家少写了内容（至少 2 字，防止单字误判）
 * @param {string} input 玩家输入
 * @param {{a:string, acc?:string[]}} item 题目（a 为标准答案，acc 为可接受的其他写法）
 */
function answerMatch(input, item) {
  const v = normalize(input);
  if (!v) return false;
  if (!item) return false;
  const pool = [item.a].concat(item.acc || []);
  for (let i = 0; i < pool.length; i++) {
    const n = normalize(pool[i]);
    if (!n) continue;
    if (v === n) return true;
    if (v.indexOf(n) >= 0) return true;                  // 玩家多写了内容
    if (n.indexOf(v) >= 0 && v.length >= 2) return true; // 玩家少写了内容（短输入除外）
  }
  return false;
}

/** 练习用洗牌：不修改原数组，返回新数组 */
function shuffleNew(arr) {
  const a = (arr || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function makeTimer(onTick) {
  let sec = 0;
  let timer = null;
  let paused = false;
  return {
    start() {
      if (!timer) {
        timer = setInterval(() => { if (!paused) { sec++; onTick(sec); } }, 1000);
      }
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    toggle() { paused = !paused; return paused; },
    reset() { sec = 0; },
    get() { return sec; }
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

module.exports = { blessing, makeTimer, shuffle, shuffleNew, normalize, answerMatch };
