// utils/money.ts
// 金额统一以「分」为整数存储与计算，仅在展示层格式化，避免浮点误差

/** 分 → 展示字符串（默认带 ¥） */
export function formatMoney(fen: number, withSymbol = true): string {
  const n = Math.abs(Math.round(fen || 0));
  const sign = (fen || 0) < 0 ? '-' : '';
  const yuan = Math.floor(n / 100);
  const cent = n % 100;
  const body = `${String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(cent).padStart(2, '0')}`;
  return `${sign}${withSymbol ? '¥' : ''}${body}`;
}

/** 分 → 紧凑展示（无小数时省略 .00，用于卡片） */
export function formatMoneyShort(fen: number): string {
  const n = Math.round(fen || 0);
  if (n % 100 === 0) return `¥${n / 100}`;
  return formatMoney(n);
}

/** 用户输入 → 分（兼容 "35"、"35.5"、"¥35.50"、"1,200"、"35元"） */
export function parseMoney(input: string | number): number {
  if (typeof input === 'number') return Math.round(input);
  const s = String(input || '').replace(/[^\d.-]/g, '');
  const v = Number(s);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100);
}

/** 从自然语言中提取金额（语音记账用）：支持 三十五/35/35.5/1千2/两万） */
export function extractAmount(text: string): number {
  if (!text) return 0;
  const CN: Record<string, number> = {
    零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10
  };
  const s = text.replace(/[，,。\s]/g, '');
  // 阿拉伯数字（优先）
  const arabic = s.match(/(\d+(?:\.\d+)?)/);
  if (arabic) {
    const idx = s.indexOf(arabic[1]);
    const unit = s.slice(idx + arabic[1].length, idx + arabic[1].length + 1);
    if (unit === '万') return Math.round(Number(arabic[1]) * 1000000);
    if (unit === '千') return Math.round(Number(arabic[1]) * 100000);
    if (unit === '百') return Math.round(Number(arabic[1]) * 10000);
    if (unit === '块' || unit === '元') return Math.round(Number(arabic[1]) * 100);
    return Math.round(Number(arabic[1]) * 100);
  }
  // 中文数字：支持 三十五 / 一百二十 / 两千
  const cnMatch = s.match(/[零一两二三四五六七八九十百千万块元]+/);
  if (!cnMatch) return 0;
  const raw = cnMatch[0];
  let total = 0;
  let section = 0;
  let number = 0;
  // 上一次是否处理到单位（十/百/千）——用于区分「三十五」的 35 与单独一个「五」的 5
  let lastWasUnit = false;
  for (const ch of raw) {
    if (ch in CN) {
      const v = CN[ch];
      if (v === 10) {
        // 十 / 十几 / 几十
        number = (number === 0 ? 1 : number) * 10;
        lastWasUnit = true;
      } else {
        // 单位之后又出现数字（如「三十五」的五），需先把已累计的十位并入 section
        if (lastWasUnit) {
          section += number;
          number = 0;
        }
        number = v;
        lastWasUnit = false;
      }
    } else if (ch === '百' || ch === '千') {
      section += (number === 0 ? 1 : number) * (ch === '百' ? 100 : 1000);
      number = 0;
    } else if (ch === '万') {
      section += number;
      total += section * 10000;
      section = 0;
      number = 0;
    } else if (ch === '块' || ch === '元') {
      break;
    }
  }
  const yuan = total + section + number;
  return yuan * 100;
}
