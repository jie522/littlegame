# 象棋麻將牌面的遮罩圖:白色 = 要刻的字和外圈,黑色 = 平的牌面;給 tools/xqmj_scene.py 當漆色和凹刻的貼圖
# 用法:python3 tools/xqmj_masks.py <輸出資料夾> [字型檔]   →   <輸出資料夾>/mask_0..13.png(14 個字)、mask_back.png(牌背花邊)
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
FONT = sys.argv[2] if len(sys.argv) > 2 else '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
NAMES = '帥仕相俥傌炮兵將士象車馬砲卒'
W, H = 512, 676  # 牌面 1.0 x 1.32 的比例
os.makedirs(OUT, exist_ok=True)
font = ImageFont.truetype(FONT, 310, index=0)
for i, ch in enumerate(NAMES):
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    cx, cy = W / 2, H / 2
    d.ellipse([cx - 222, cy - 222, cx + 222, cy + 222], outline=255, width=26)
    d.text((cx, cy), ch, font=font, fill=255, anchor='mm', stroke_width=5, stroke_fill=255)
    im.filter(ImageFilter.GaussianBlur(1.2)).save(os.path.join(OUT, f'mask_{i}.png'))
im = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(im)
d.rounded_rectangle([46, 66, W - 46, H - 66], radius=34, outline=255, width=22)
d.ellipse([W / 2 - 74, H / 2 - 74, W / 2 + 74, H / 2 + 74], outline=255, width=18)
d.ellipse([W / 2 - 28, H / 2 - 28, W / 2 + 28, H / 2 + 28], fill=255)
im.filter(ImageFilter.GaussianBlur(1.2)).save(os.path.join(OUT, 'mask_back.png'))
print('ok')
