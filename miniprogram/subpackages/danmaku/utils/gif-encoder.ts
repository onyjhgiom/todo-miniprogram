// subpackages/danmaku/utils/gif-encoder.ts
// 自包含的 GIF89a + LZW 编码器（零依赖、零平台 API）。
//
// 为什么自己写：小程序端没有「本地合成 mp4」的能力，而录制 15 秒弹幕视频的需求，
// 用 GIF 是体验与实现成本最平衡的替代——能在相册直接播放、能分享给微信好友。
// 现成库要么依赖 canvas（端上才能跑，没法在 Node 里单测），要么带一堆 polyfill。
// 这里把「字节怎么排」这件事彻底抽成纯函数：端上喂 RGBA 帧、Node 单测也能喂合成帧，
// 然后用 Pillow 验证「真的能解码、帧数/尺寸对得上」。
//
// 调色板策略：逐帧局部色表，按位宽 4→3→2 逐级均匀量化，保证单帧颜色数 ≤ 256，
// 既能在 2 色渐变背景上保持平滑，又不会超 GIF 的 256 色上限。

export interface GifFrame {
  /** RGBA 像素数据，长度 = width*height*4 */
  rgba: Uint8Array | Uint8ClampedArray;
  /** 单帧延迟（1/100 秒）；缺省用全局 fps 推算 */
  delay?: number;
}

/** 把变长整型写入字节流（LSB-first 是 GIF LZW 的规定位序） */
class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private curBits = 0;

  writeCode(code: number, size: number): void {
    this.cur |= code << this.curBits;
    this.curBits += size;
    while (this.curBits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.curBits -= 8;
    }
  }

  flush(): number[] {
    if (this.curBits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.curBits = 0;
    }
    return this.bytes;
  }
}

/** 逐帧量化：返回 256 色的局部调色板与每像素索引 */
function buildPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  count: number
): { palette: number[][]; indices: Uint8Array } {
  let palette: number[][] = [];
  let indices = new Uint8Array(count);
  for (let bits = 4; bits >= 2; bits--) {
    const mask = (0xff << (8 - bits)) & 0xff;
    const map = new Map<number, number>();
    const pal: number[][] = [];
    const idx = new Uint8Array(count);
    for (let p = 0; p < count; p++) {
      const o = p * 4;
      const r = rgba[o] & mask;
      const g = rgba[o + 1] & mask;
      const b = rgba[o + 2] & mask;
      const key = (r << 16) | (g << 8) | b;
      let ci = map.get(key);
      if (ci === undefined) {
        ci = pal.length;
        map.set(key, ci);
        pal.push([r, g, b]);
      }
      idx[p] = ci;
    }
    if (pal.length <= 256) {
      palette = pal;
      indices = idx;
      break;
    }
  }
  while (palette.length < 256) palette.push([0, 0, 0]);
  return { palette, indices };
}

/** GIF 标准 LZW：变长码 + 清字典 */
function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map<string, number>();
  let next = eoiCode + 1;
  const resetDict = (): void => {
    dict = new Map<string, number>();
    for (let i = 0; i < clearCode + 2; i++) dict.set(String(i), i);
  };
  resetDict();

  const bw = new BitWriter();
  bw.writeCode(clearCode, codeSize);

  if (indices.length === 0) {
    bw.writeCode(eoiCode, codeSize);
    return bw.flush();
  }

  let buffer = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const combined = buffer + ',' + k;
    if (dict.has(combined)) {
      buffer = combined;
    } else {
      bw.writeCode(dict.get(buffer) as number, codeSize);
      dict.set(combined, next);
      next++;
      // GIF 的「提前 1 位」升位规则：当下一个待分配码等于 2^codeSize+1 时再升位。
      // 比 TIFF 的「等于 2^codeSize」晚一档——Pillow 等解码端都按这套约定，
      // 写早了会让解码器把高位误读，报 broken data stream。
      if (codeSize < 12 && next === (1 << codeSize) + 1) codeSize++;
      if (next > 4095) {
        bw.writeCode(clearCode, codeSize);
        resetDict();
        next = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
      buffer = String(k);
    }
  }
  bw.writeCode(dict.get(buffer) as number, codeSize);
  bw.writeCode(eoiCode, codeSize);
  return bw.flush();
}

function pushString(out: number[], s: string): void {
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
}

export function encodeGIF(frames: GifFrame[], width: number, height: number, fps: number): Uint8Array {
  const delayCs = Math.max(2, Math.round(100 / Math.max(1, fps)));
  const out: number[] = [];

  pushString(out, 'GIF89a');
  // 逻辑屏幕描述符（无全局色表）
  out.push(width & 0xff, (width >> 8) & 0xff);
  out.push(height & 0xff, (height >> 8) & 0xff);
  out.push(0x70); // GCT=0, 色深=7, 排序=0, GCT size=0
  out.push(0); // 背景色索引
  out.push(0); // 像素宽高比

  // 循环扩展（NETSCAPE2.0，loop=0 无限循环）
  out.push(0x21, 0xff, 0x0b);
  pushString(out, 'NETSCAPE2.0');
  out.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const f of frames) {
    const delay = f.delay || delayCs;
    // 图形控制扩展：处置方式 1（保留），无透明
    out.push(0x21, 0xf9, 0x04, 0x04);
    out.push(delay & 0xff, (delay >> 8) & 0xff);
    out.push(0); // 透明色索引
    out.push(0x00); // 块结束

    // 图像描述符（带局部色表，256 色）
    out.push(0x2c);
    out.push(0, 0, 0, 0); // 左上角
    out.push(width & 0xff, (width >> 8) & 0xff);
    out.push(height & 0xff, (height >> 8) & 0xff);
    out.push(0x80 | 0x07); // LCT=1, 尺寸=7（256）

    const { palette, indices } = buildPalette(f.rgba, width * height);
    for (let i = 0; i < 256; i++) {
      const c = palette[i];
      out.push(c[0], c[1], c[2]);
    }

    const minCodeSize = 8;
    out.push(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    for (let i = 0; i < lzw.length; i += 255) {
      const len = Math.min(255, lzw.length - i);
      out.push(len);
      for (let j = 0; j < len; j++) out.push(lzw[i + j]);
    }
    out.push(0); // 块结束
  }

  out.push(0x3b); // 文件结束
  return Uint8Array.from(out);
}
