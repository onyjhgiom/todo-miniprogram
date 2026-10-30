
from PIL import Image, ImageSequence
im = Image.open("C:\\Users\\陈乐天\\WorkBuddy\\2026-09-07-09-23-30\\todo-miniprogram\\.tmp\\gif_test.gif")
assert im.format == 'GIF', im.format
assert im.size == (64, 48), im.size
frames = list(ImageSequence.Iterator(im))
assert len(frames) == 12, len(frames)
# 抽几帧确认像素可读且红色方块确实出现过（量化后纯红退化为 240/0/0，仍与渐变区分）
seen_red = 0
for f in frames:
    px = f.convert('RGB').load()
    for y in range(48):
        for x in range(64):
            r,g,b = px[x, y]
            if r>200 and g<80 and b<80:
                seen_red += 1
assert seen_red > 50, '未检测到红色方块, 命中像素=%d' % seen_red
print('PILLOW_OK', im.size, len(frames))
