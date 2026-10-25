# 把 tools/tower_scene.py 算出來的 10 張圖(tower_tmp/tw_00.png …)拼成 assets/tower_floors.webp(4 x 3 格,每格 384 x 168)
# 用法:python3 tools/tower_stitch.py <暫存資料夾> <assets 資料夾>
import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
CW, CH = 384, 168
sheet = Image.new('RGBA', (CW * 4, CH * 3), (0, 0, 0, 0))
for i in range(10):
    t = Image.open(os.path.join(src, 'tower_tmp', 'tw_%02d.png' % i)).convert('RGBA')
    sheet.paste(t, ((i % 4) * CW, (i // 4) * CH))
sheet.save(os.path.join(out, 'tower_floors.webp'), quality=92, method=6)
