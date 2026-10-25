# 把 tools/g2048_scene.py 算出來的 13 張方塊(g2048_tmp/g2048_t00.png ...)拼成 g2048_tiles.png(4 x 4 格,每格 256 x 256)
# 用法:python3 tools/g2048_stitch.py <assets 資料夾>
import sys, os
from PIL import Image
out = sys.argv[1]
sheet = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
for i in range(13):
    t = Image.open(os.path.join(out, 'g2048_tmp', 'g2048_t%02d.png' % i)).convert('RGBA')
    sheet.paste(t, ((i % 4) * 256, (i // 4) * 256))
sheet.save(os.path.join(out, 'g2048_tiles.png'), optimize=True)
