# 2048 卡片圖示:用 tools/g2048_scene.py 算出來的方塊(assets/g2048_tiles.webp)疊在橘黃色的卡片底上,貼到 assets/game_icons.webp 的第 18 格(第 2 欄、第 5 列)
# 用法:python3 tools/g2048_icon.py <assets 資料夾>
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
A = sys.argv[1]
IW, IH = 336, 240
S = 2
w, h = IW * S, IH * S
g = np.zeros((h, w, 3), float)
top, bot = np.array([255, 226, 150]), np.array([255, 170, 90])
for y in range(h):
    g[y, :] = top + (bot - top) * (y / h)
yy, xx = np.mgrid[0:h, 0:w]
glow = np.clip(1 - np.hypot((xx - w / 2) / (w * 0.55), (yy - h * 0.42) / (h * 0.7)), 0, 1)[..., None]
g = g * (1 - glow * 0.7) + np.array([255, 250, 235]) * glow * 0.7
bg = Image.fromarray(g.clip(0, 255).astype('uint8')).convert('RGBA')
sheet = Image.open(os.path.join(A, 'g2048_tiles.webp')).convert('RGBA')
font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 64 * S // 2)
def tile(idx, num, size, angle, cx, cy):
    t = sheet.crop(((idx % 4) * 256, (idx // 4) * 256, (idx % 4) * 256 + 256, (idx // 4) * 256 + 256)).resize((size * S, size * S), Image.LANCZOS)
    d = ImageDraw.Draw(t)
    f = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(size * S * (0.4 if len(num) <= 2 else 0.3 if len(num) == 3 else 0.24)))
    col = (122, 90, 58) if idx < 2 else (255, 255, 255)
    d.text((t.width / 2, t.height / 2 + 2 * S), num, font=f, fill=col, anchor='mm', stroke_width=0 if idx < 2 else 3 * S, stroke_fill=(110, 55, 15, 110))
    t = t.rotate(angle, expand=True, resample=Image.BICUBIC)
    sh = Image.new('RGBA', bg.size, (0, 0, 0, 0))
    sh.paste((90, 45, 10, 120), (int(cx * S - t.width / 2 + 4 * S), int(cy * S - t.height / 2 + 8 * S)), t.split()[3])
    return t, sh.filter(ImageFilter.GaussianBlur(7 * S)), (int(cx * S - t.width / 2), int(cy * S - t.height / 2))
for idx, num, size, ang, cx, cy in [(1, '4', 86, 12, 82, 150), (4, '32', 92, -8, 250, 150), (10, '2048', 118, 3, 168, 108)]:
    t, sh, pos = tile(idx, num, size, ang, cx, cy)
    bg = Image.alpha_composite(bg, sh)
    bg.alpha_composite(t, pos)
icon = bg.resize((IW, IH), Image.LANCZOS).convert('RGB')
sheet_i = Image.open(os.path.join(A, 'game_icons.webp')).convert('RGB')
sheet_i.paste(icon, (1 * IW, 4 * IH))
sheet_i.save(os.path.join(A, 'game_icons.webp'), quality=92, method=6)
print('ok')
