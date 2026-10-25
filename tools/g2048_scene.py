# 2048 的素材:用 Blender Cycles 算「糖果質感的方塊」和「木頭托盤棋盤」
# 用法:blender -b -P tools/g2048_scene.py -- <絕對路徑>/assets [tiles|board]
#   g2048_tiles.png  1024 x 1024,4 x 4 格(每格 256 x 256,方塊畫在中間 224 x 224,四周留空給畫布畫陰影),透明背景
#                    前 13 格依序是 2 4 8 16 32 64 128 256 512 1024 2048 4096 8192(以上),只有方塊,數字由畫布畫上去
#   g2048_board.png  1024 x 1024 俯視棋盤:圓角托盤、16 個凹下去的格子
# 座標要和 game.js 對得上:棋盤邊長 1,外框 PAD = 0.045、格子間距 GAP = 0.03、格子邊長 (1 - 2 PAD - 3 GAP) / 4
import bpy, math, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()
ONLY = argv[1] if len(argv) > 1 else ''
COLORS = ['#f3ead9', '#f7d9a8', '#ffa24d', '#ff7f45', '#ff5f5f', '#ee3f6e', '#ffd84a', '#b6e04a', '#4fcf7a', '#3bc3d9', '#5b8cff', '#9b5cff', '#ff4fd0']
S = 10.0
PAD, GAP = 0.045 * S, 0.03 * S
CELL = (S - 2 * PAD - 3 * GAP) / 4


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def reset(samples=96):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*hexrgb('#fff6ea'), 1)
    bg.inputs['Strength'].default_value = 0.55
    return sc


def mat(hexc, rough=0.3, coat=0.4, sss=0.0, coatr=0.1):
    m = bpy.data.materials.new('m' + hexc)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*hexrgb(hexc), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coatr
    if sss:
        p.inputs['Subsurface Weight'].default_value = sss
        p.inputs['Subsurface Radius'].default_value = (0.5, 0.35, 0.25)
    return m


def rbox(loc, size, m, bevel, seg=10):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new('bv', 'BEVEL'); bv.width = bevel; bv.segments = seg; bv.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


def area(loc, rot, size, e, col='#ffffff'):
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    l = bpy.context.object; l.data.size, l.data.energy = size, e; l.data.color = hexrgb(col)


def lights(k=1.0):
    area((-5, -6, 14), (math.radians(25), 0, math.radians(-20)), 12, 2200 * k, '#fff2dc')
    area((9, 2, 8), (math.radians(60), 0, math.radians(70)), 9, 380 * k, '#dfe9ff')
    area((0, 9, 7), (math.radians(-50), 0, 0), 14, 420 * k, '#ffffff')


def top_camera(sc, span, cx, cy, w, h):
    bpy.ops.object.camera_add(location=(cx, cy, 30), rotation=(0, 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = span
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = w, h


def tiles():
    # 每個方塊各自在原點算一張(光線位置一樣,13 個方塊的明暗才會一致),再用 tools/g2048_stitch.py 拼成 4 x 4
    TS = 10 * 224 / 256
    tmp = os.path.join(OUT, 'g2048_tmp')
    os.makedirs(tmp, exist_ok=True)
    for i, c in enumerate(COLORS):
        sc = reset(128)
        rbox((0, 0, 0.9), (TS, TS, 1.8), mat(c, 0.3, 0.45, 0.2, 0.12), 0.9, 12)
        rbox((0, 0, 1.78), (TS * 0.8, TS * 0.8, 0.12), mat(c, 0.25, 0.5, 0.2, 0.1), 0.05, 6)  # 頂面淡淡的內框
        sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
        lights(0.8)
        top_camera(sc, 10, 0, 0, 256, 256)
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
        sc.render.filepath = os.path.join(tmp, 'g2048_t%02d.png' % i)
        bpy.ops.render.render(write_still=True)


def board():
    sc = reset(128)
    wood = mat('#8a5a36', 0.5, 0.15, 0.0, 0.3)
    inner = mat('#5d3b22', 0.55, 0.1, 0.0, 0.3)
    hole = mat('#3c2616', 0.7, 0.0, 0.0, 0.5)
    rbox((0, 0, 0.5), (S, S, 1.0), wood, 0.7, 10)  # 外框
    rbox((0, 0, 1.0), (S - 0.5, S - 0.5, 0.2), inner, 0.25, 6)  # 稍微凹下去的托盤面
    for r in range(4):
        for c in range(4):
            x = -S / 2 + PAD + CELL / 2 + c * (CELL + GAP)
            y = S / 2 - PAD - CELL / 2 - r * (CELL + GAP)
            rbox((x, y, 1.12), (CELL, CELL, 0.2), hole, 0.35, 8)
    lights()
    top_camera(sc, S, 0, 0, 1024, 1024)
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = os.path.join(OUT, 'g2048_board.png')
    bpy.ops.render.render(write_still=True)


if ONLY in ('', 'tiles'): tiles()
if ONLY in ('', 'board'): board()
print('done')
