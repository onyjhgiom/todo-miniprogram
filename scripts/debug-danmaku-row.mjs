// 临时诊断：找出同轨道最小间距为 0 的那一对条目到底是谁
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(__dirname, 'lib/ts-resolve-hook.mjs')).href, import.meta.url);
const ts = (rel) => pathToFileURL(path.join(__dirname, rel)).href;

const { DanmakuEngine } = await import(ts('../miniprogram/subpackages/danmaku/utils/danmaku-engine.ts'));
const { DEFAULT_STYLE, DEFAULT_ANIM, DEFAULT_LAYOUT, DEFAULT_BG } = await import(
  ts('../miniprogram/subpackages/danmaku/utils/danmaku-types.ts')
);

function ctx() {
  return {
    globalAlpha: 1, font: '', fillStyle: '', fill() {}, save() {}, restore() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    fillRect() {}, translate() {}, rotate() {}, transform() {}, setTransform() {},
    measureText(t) {
      let w = 0;
      for (const ch of String(t)) w += ch.charCodeAt(0) > 0x2e80 ? 18 : 9.9;
      return { width: w };
    },
    fillText() {}, strokeText() {}, stroke() {}, clearRect() {},
    bezierCurveTo() {}, quadraticCurveTo() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} }; }
  };
}

const items = [];
for (let i = 0; i < 30; i++) items.push({ id: 'i' + i, kind: 'text', text: '第' + i + '条弹幕内容测试' });

const e = new DanmakuEngine({ width: 375, height: 600 });
e.setConfig({
  id: 'x', name: 'x', createdAt: 0, updatedAt: 0, favorite: false, skin: 'none',
  style: { ...DEFAULT_STYLE }, anim: { ...DEFAULT_ANIM },
  layout: { ...DEFAULT_LAYOUT }, bg: { ...DEFAULT_BG }, items
});
e.play();

const c = ctx();
let worst = { gap: 1e9 };
for (let f = 0; f < 400; f++) {
  e.update(1000 / 60);
  e.draw(c);
  const active = e.getActiveSnapshot();
  const byRow = new Map();
  for (const a of active) {
    if (a.mode !== 'scroll') continue;
    if (!byRow.has(a.row)) byRow.set(a.row, []);
    byRow.get(a.row).push(a);
  }
  for (const [row, list] of byRow) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.x - q.x);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].x - (list[i - 1].x + list[i - 1].w);
      if (gap < worst.gap) {
        worst = {
          gap, frame: f, row,
          prevText: list[i - 1].item.text, prevX: list[i - 1].x.toFixed(1), prevW: list[i - 1].w,
          prevAge: list[i - 1].age.toFixed(0), prevLife: list[i - 1].life.toFixed(0),
          curText: list[i].item.text, curX: list[i].x.toFixed(1), curW: list[i].w,
          curAge: list[i].age.toFixed(0), curLife: list[i].life.toFixed(0)
        };
      }
    }
  }
}
console.log(JSON.stringify(worst, null, 2));
