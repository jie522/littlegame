# 把 tools/bomb_scene.py 算出來的 12 張小圖拼成 assets/bomb_sprites.webp(4 x 3 格,每格 128 x 192),草地轉成 assets/bomb_floor.webp
# 用法:python3 tools/bomb_stitch.py <暫存資料夾> <assets 資料夾>
import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
CW, CH = 128, 192
sheet = Image.new('RGBA', (CW * 4, CH * 3), (0, 0, 0, 0))
for i in range(12):
    t = Image.open(os.path.join(src, 'bomb_tmp', 'b_%02d.png' % i)).convert('RGBA')
    sheet.paste(t, ((i % 4) * CW, (i // 4) * CH))
sheet.save(os.path.join(out, 'bomb_sprites.webp'), quality=92, method=6)
Image.open(os.path.join(src, 'bomb_floor.png')).convert('RGB').save(os.path.join(out, 'bomb_floor.webp'), quality=88, method=6)
