# 象棋麻將的牌:用 Blender Cycles 算「象牙白牌面 + 翠綠牌背」的麻將牌,字和外圈是刻進去再填漆的
# 用法:先 python3 tools/xqmj_masks.py <輸出資料夾>/masks,再 blender -b -P tools/xqmj_scene.py -- <輸出資料夾>   →   xqmj_tiles.png(1024 x 1304)
#   4 x 4 個格子,每格 256 x 326:前 7 格是紅方 帥仕相俥傌炮兵,接著 7 格是黑方 將士象車馬砲卒,第 15 格是牌背,最後一格是空白牌面
#   順序要和 game.js 的 XQ_NAMES 對得上;字和外圈是遮罩圖 + 凹凸貼圖(不用布林運算,比較穩)
import bpy, bmesh, math, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()
W, H, T0, T1 = 1.0, 1.32, 0.36, 0.30  # 牌寬、牌長、綠色底座厚、象牙白面厚
TILT = math.radians(28)
PX, PY = 1.25, 1.8  # 格子的間距(世界座標);PY 要除以 cos(TILT) 才是畫面上的間距


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'Standard'
wd = bpy.data.worlds.new('W'); sc.world = wd; wd.use_nodes = True
wd.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexrgb('#ffffff'), 1)
wd.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5


def mat(hexc, rough=0.3, coat=0.3, sss=0.0, coatr=0.15):
    m = bpy.data.materials.new('m' + hexc)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*hexrgb(hexc), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coatr
    if sss:
        p.inputs['Subsurface Weight'].default_value = sss
        p.inputs['Subsurface Radius'].default_value = (0.4, 0.3, 0.2)
    return m


IVORY = mat('#f4ead0', 0.32, 0.35, 0.18)
JADE = mat('#15603d', 0.34, 0.18, 0.0)
RED, INK, GOLD = mat('#c4202c', 0.25, 0.5), mat('#14161c', 0.25, 0.5), mat('#d9b25c', 0.28, 0.4)


def rbox(loc, size, m, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new('bv', 'BEVEL'); bv.width = bevel; bv.segments = 6; bv.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


def face_mat(base_hex, ink_hex, mask_path, rough=0.32):
    """牌面材質:遮罩圖是白色的地方變成漆色,同時用遮罩當凹凸(往下凹)"""
    m = bpy.data.materials.new('face')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(mask_path)
    img.image.colorspace_settings.name = 'Non-Color'
    img.extension = 'CLIP'
    nt.links.new(tc.outputs['Generated'], img.inputs['Vector'])  # 每個物件自己的 0~1 座標,剛好對應整張牌面
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*hexrgb(base_hex), 1)
    mix.inputs['B'].default_value = (*hexrgb(ink_hex), 1)
    nt.links.new(img.outputs['Color'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    rg = nt.nodes.new('ShaderNodeMapRange'); rg.inputs['To Min'].default_value = rough; rg.inputs['To Max'].default_value = 0.22
    nt.links.new(img.outputs['Color'], rg.inputs['Value'])
    nt.links.new(rg.outputs['Result'], p.inputs['Roughness'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.invert = True
    bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 0.04
    nt.links.new(img.outputs['Color'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    p.inputs['Coat Weight'].default_value = 0.4
    p.inputs['Coat Roughness'].default_value = 0.12
    p.inputs['Subsurface Weight'].default_value = 0.12
    p.inputs['Subsurface Radius'].default_value = (0.4, 0.3, 0.2)
    return m


MASKS = os.path.join(OUT, 'masks')  # 先跑 tools/xqmj_masks.py <OUT>/masks


def make_tile(cx, cy, idx):
    base = rbox((cx, cy, T0 / 2), (W, H, T0), JADE, 0.05)
    z = T0 + T1 / 2 - 0.004
    if idx == 14:  # 牌背:翠綠加金色花邊
        top = rbox((cx, cy, z), (W, H, T1), face_mat('#15603d', '#d9b25c', os.path.join(MASKS, 'mask_back.png'), 0.22), 0.05)
    elif idx == 15:  # 空白牌面
        top = rbox((cx, cy, z), (W, H, T1), IVORY, 0.05)
    else:
        color = idx // 7
        top = rbox((cx, cy, z), (W, H, T1), face_mat('#f4ead0', '#c4202c' if color == 0 else '#14161c', os.path.join(MASKS, f'mask_{idx}.png')), 0.05)


for i in range(16):
    make_tile((i % 4 - 1.5) * PX, (1.5 - i // 4) * PY, i)

# 光:左上前方主光、右邊補光、後面一道輪廓光
def area(loc, rot, size, e, col='#ffffff'):
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    l = bpy.context.object; l.data.size, l.data.energy = size, e; l.data.color = hexrgb(col)
area((-4, -9, 12), (math.radians(40), 0, math.radians(-15)), 12, 1800, '#fff4e0')
area((9, -3, 6), (math.radians(60), 0, math.radians(60)), 8, 350, '#dfe9ff')
area((0, 9, 5), (math.radians(-60), 0, 0), 14, 450, '#ffffff')

cw, ch_ = 256, 326
bpy.ops.object.camera_add(location=(0, -20 * math.sin(TILT), 0.3 + 20 * math.cos(TILT)), rotation=(TILT, 0, 0))
cam = bpy.context.object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 4 * PY * math.cos(TILT)  # 較長的邊(高)涵蓋 4 列
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = cw * 4, ch_ * 4
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = os.path.join(OUT, 'xqmj_tiles.png')
bpy.ops.render.render(write_still=True)
print('done')
