// scripts/check-gif-encoder.mjs
// GIF 编码器单测：合成渐变+移动方块的动画帧，编码成文件，再用 Pillow 解码核对。
// 验证点：
//   - 文件头是 GIF89a、能被 Pillow 正常打开（说明字节序/LZW 正确）；
//   - 解码出的帧数、尺寸与编码入参一致；
//   - 每帧都能拿到像素（说明 LZW 没有把某一帧解崩）。
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(__dirname, 'lib/ts-resolve-hook.mjs')).href, import.meta.url);

const ts = (rel) => pathToFileURL(path.join(__dirname, rel)).href;
const { encodeGIF } = await import(ts('../miniprogram/subpackages/danmaku/utils/gif-encoder.ts'));

const W = 64, H = 48, FRAMES = 12, FPS = 10;

/** 合成一帧：水平渐变（制造大量中间色，考验量化） + 移动的白色方块 */
function makeFrame(fi) {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const t = x / W;
      rgba[o] = Math.round(255 * t);
      rgba[o + 1] = Math.round(180 * (1 - t));
      rgba[o + 2] = 120;
      rgba[o + 3] = 255;
    }
  }
  // 移动方块：用与渐变区分度高的纯红（渐变里 b 恒为 120，红块 b≈0 可明确分辨）
  const bx = Math.round((fi / FRAMES) * (W - 10));
  for (let y = 18; y < 30; y++) {
    for (let x = bx; x < bx + 10; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const o = (y * W + x) * 4;
      rgba[o] = 255; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255;
    }
  }
  return { rgba };
}

const frames = [];
for (let i = 0; i < FRAMES; i++) frames.push(makeFrame(i));

const bytes = encodeGIF(frames, W, H, FPS);
console.log(`  编码完成：${(bytes.length / 1024).toFixed(1)} KB`);

const fs = await import('node:fs');
const outPath = path.join(__dirname, '../.tmp/gif_test.gif');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(bytes));

console.log('  写入', outPath);

// 用 Pillow 校验
const { execFileSync } = await import('node:child_process');
const PY = path.join(__dirname, 'verify_gif.py');
fs.writeFileSync(PY, `
from PIL import Image, ImageSequence
im = Image.open(${JSON.stringify(outPath)})
assert im.format == 'GIF', im.format
assert im.size == (${W}, ${H}), im.size
frames = list(ImageSequence.Iterator(im))
assert len(frames) == ${FRAMES}, len(frames)
# 抽几帧确认像素可读且红色方块确实出现过（量化后纯红退化为 240/0/0，仍与渐变区分）
seen_red = 0
for f in frames:
    px = f.convert('RGB').load()
    for y in range(${H}):
        for x in range(${W}):
            r,g,b = px[x, y]
            if r>200 and g<80 and b<80:
                seen_red += 1
assert seen_red > 50, '未检测到红色方块, 命中像素=%d' % seen_red
print('PILLOW_OK', im.size, len(frames))
`);
try {
  const out = execFileSync('C:/Users/陈乐天/.workbuddy/binaries/python/envs/default/Scripts/python.exe', [PY], { encoding: 'utf8' });
  console.log('  ' + out.trim());
} catch (e) {
  console.error('  PILLOW 校验失败：', e.stdout || e.stderr || e.message);
  process.exit(1);
}
console.log('\n  GIF 编码器自检：通过');
