# 遊戲卡片的圖示:把設計稿(AI 生成的卡片圖)裡「插圖那一塊」裁下來,拼成 assets/game_icons.webp
# 用法:python3 tools/game_icons.py <四乘四總表.webp> <三乘三高解析表.webp> <tower_icon.png> <xqmj_tiles.png> <輸出資料夾 assets>
#   總表:16 格(4 x 4),每格是一張直的卡片;高解析表:9 格(3 x 3)正方形卡片,蓋掉總表裡同一款的圖
#   每個圖示 336 x 240(比例 1.4),排成 4 x 5,順序要和 game.js 的 GAME_ICON 一樣
#   象棋麻將也沒有設計稿:用 tools/xqmj_scene.py 算出來的牌(帥、將、兵)疊成一把扇形,放在金黃色的卡片底上
#   高樓疊疊樂沒有設計稿,用 tools/tower_icon_scene.py 算出來的圖(透明背景)疊在同風格的天空藍卡片底上
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ORDER = ['reaction', 'math', 'color', 'memory', 'chess', 'shaft', 'morris', 'heart', 'bomb', 'checkers', 'flood', 'parking', 'big2', 'seven', 'schulte', 'tower', 'xqmj']
SHEET16 = ['reaction', 'math', 'color', 'memory', 'chess', 'shaft', 'morris', 'heart', 'bomb', 'checkers', 'flood', 'parking', 'big2', 'seven', 'schulte']  # 第 16 格是多的(貓咪牌),不用
SHEET9 = ['morris', 'heart', 'bomb', 'checkers', 'flood', 'parking', 'big2', 'seven', 'schulte']
IW, IH = 336, 240


def crop16(im, i):  # 直的卡片:x 21/270/518/767、y 91/450/808/1148,寬 238 高 330;插圖在標題膠囊上面
    x0 = [21, 270, 518, 767][i % 4]; y0 = [91, 450, 808, 1148][i // 4]
    c = im.crop((x0 + 12, y0 + 12, x0 + 226, y0 + 196))  # 214 x 184,避開外框和上緣的反光弧
    ch = c.height
    tw = int(ch * IW / IH)
    pad = (tw - c.width) // 2  # 左右補到 1.4 的比例:底色是柔和的漸層,所以拿邊緣的顏色模糊後延伸,再把原圖羽化貼在中間
    wide = Image.fromarray(np.pad(np.array(c), ((0, 0), (pad, tw - c.width - pad), (0, 0)), mode='edge')).filter(ImageFilter.GaussianBlur(14))
    mask = Image.new('L', c.size, 255)
    m = np.array(mask).astype(float)
    ramp = np.minimum(1, np.arange(c.width) / 16.0)
    m = m * np.minimum(ramp, ramp[::-1])[None, :]
    wide.paste(c, (pad, 0), Image.fromarray(m.astype('uint8')))
    return wide.resize((IW, IH), Image.LANCZOS)


def crop9(im, i):  # 正方形卡片:x 16/425/833、y 14/428/840,邊長 392;插圖在上半部
    x0 = [16, 425, 833][i % 3]; y0 = [14, 428, 840][i // 3]
    c = im.crop((x0 + 45, y0 + 6, x0 + 347, y0 + 222))  # 302 x 216
    return c.resize((IW, IH), Image.LANCZOS)


def card_bg(top, bot, sparks, dashes):  # 柔和漸層 + 中央一團光 + 四角星,和設計稿的卡片底同一個味道;回傳 (RGBA 圖, 放大倍率)
    S = 3
    w, h = IW * S, IH * S
    g = np.zeros((h, w, 3), float)
    top, bot = np.array(top), np.array(bot)
    for y in range(h):
        g[y, :] = top + (bot - top) * (y / h)
    yy, xx = np.mgrid[0:h, 0:w]
    glow = np.clip(1 - np.hypot((xx - w / 2) / (w * 0.55), (yy - h * 0.42) / (h * 0.7)), 0, 1)[..., None]
    g = g * (1 - glow * 0.75) + np.array([250, 252, 255]) * glow * 0.75
    im = Image.fromarray(g.clip(0, 255).astype('uint8')).convert('RGBA')
    d = ImageDraw.Draw(im)
    def spark(cx, cy, r, col):  # 四角星
        d.polygon([(cx, cy - r), (cx + r * .3, cy - r * .3), (cx + r, cy), (cx + r * .3, cy + r * .3), (cx, cy + r), (cx - r * .3, cy + r * .3), (cx - r, cy), (cx - r * .3, cy - r * .3)], fill=col)
    for (cx, cy, r, col) in sparks:
        spark(cx * w, cy * h, r * S, col)
    for (x1, y1, x2, y2) in dashes:  # 小撇
        d.line([(x1 * w, y1 * h), (x2 * w, y2 * h)], fill='#ffffffdd', width=7 * S, joint='curve')
    return im, S


def shadowed(im, layer, x, y, blur, off):
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    sh.paste((40, 30, 20, 130), (x, y + off), layer.split()[3])
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
    im.alpha_composite(layer, (x, y))


def tower_card(icon):
    im, S = card_bg([196, 232, 255], [120, 192, 250],
                    [(.12, .22, 20, '#ffffffee'), (.88, .3, 26, '#fff2a8ff'), (.84, .8, 14, '#ffffffcc'), (.16, .74, 17, '#ffd84aff'), (.3, .1, 11, '#ffffffbb')],
                    [(.2, .45, .26, .5), (.74, .55, .8, .5)])
    w, h = im.size
    ih = int(h * 0.9); iw = int(icon.width * ih / icon.height)
    ic = icon.resize((iw, ih), Image.LANCZOS)
    shadowed(im, ic, int(w / 2 - iw / 2), int(h * 0.06), 5 * S, 10 * S)
    return im.convert('RGB').resize((IW, IH), Image.LANCZOS)


def xqmj_card(tiles):  # tiles:xqmj_tiles.png(4 x 4 格,每格 256 x 326;牌的範圍 x 25..231、y 12..308)
    im, S = card_bg([255, 232, 150], [255, 188, 84],
                    [(.1, .2, 20, '#ffffffee'), (.9, .26, 24, '#ffffffff'), (.86, .82, 14, '#fff6c8ff'), (.14, .78, 16, '#ffffffcc'), (.5, .07, 10, '#ffffffbb')],
                    [(.2, .4, .26, .45), (.74, .5, .8, .45)])
    w, h = im.size
    def tile(i):
        c, r = i % 4, i // 4
        return tiles.crop((c * 256 + 25, r * 326 + 12, c * 256 + 231, r * 326 + 308))
    # 三張牌排成扇形:黑將(左)、兵(右)在後面,紅帥在正中間最大
    for i, ang, th, cx, cy in [(7, 14, 0.62, 0.30, 0.52), (6, -14, 0.62, 0.70, 0.52), (0, 0, 0.8, 0.5, 0.5)]:
        t = tile(i)
        t = t.resize((int(t.width * h * th / t.height), int(h * th)), Image.LANCZOS)
        t = t.rotate(ang, expand=True, resample=Image.BICUBIC)
        shadowed(im, t, int(w * cx - t.width / 2), int(h * cy - t.height / 2), 4 * S, 7 * S)
    return im.convert('RGB').resize((IW, IH), Image.LANCZOS)


def main(sheet16, sheet9, tower_png, xqmj_png, out):
    s16, s9 = Image.open(sheet16).convert('RGB'), Image.open(sheet9).convert('RGB')
    icons = {}
    for i, n in enumerate(SHEET16): icons[n] = crop16(s16, i)
    for i, n in enumerate(SHEET9): icons[n] = crop9(s9, i)
    icons['tower'] = tower_card(Image.open(tower_png).convert('RGBA'))
    icons['xqmj'] = xqmj_card(Image.open(xqmj_png).convert('RGBA'))
    sheet = Image.new('RGB', (IW * 4, IH * 5))
    for i, n in enumerate(ORDER): sheet.paste(icons[n], ((i % 4) * IW, (i // 4) * IH))
    sheet.save(out + '/game_icons.webp', quality=88, method=6)
    print('ok', ORDER)


if __name__ == '__main__':
    main(*sys.argv[1:6])
