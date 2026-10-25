# 象棋麻將的牌:用 Blender Cycles 算「象牙白牌面 + 翠綠牌背」的麻將牌,字和外圈是刻進去再填漆的
# 用法:先 python3 tools/xqmj_masks.py <輸出資料夾>/masks,再 blender -b -P tools/xqmj_scene.py -- <輸出資料夾>   →   xqmj_tiles.png(1280 x 1632)
#   4 x 4 個格子,每格 320 x 408:前 7 格是紅方 帥仕相俥傌炮兵,接著 7 格是黑方 將士象車馬砲卒,第 15 格是牌背,最後一格是空白牌面
#   順序要和 game.js 的 XQ_NAMES 對得上;字和外圈是遮罩圖,用 Cycles 的真實位移(Cycles 的 adaptive subdivision)刻進牌面,再填漆;XQ_TEST=1 只算三張小圖試看
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
sc.cycles.samples = int(os.environ.get('XQ_SAMPLES', 96))
sc.cycles.dicing_rate = 0.6  # 位移的細緻度:數字越小切得越細
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


def noise_mix(nt, a_hex, b_hex, scale, detail=6, distortion=0.0, fac=0.5, soft=1.0):
    """兩種顏色用雜訊混在一起(象牙的細微顆粒、翠綠的雲紋)"""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    no = nt.nodes.new('ShaderNodeTexNoise'); no.inputs['Scale'].default_value = scale; no.inputs['Detail'].default_value = detail
    no.inputs['Distortion'].default_value = distortion
    nt.links.new(tc.outputs['Object'], no.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeMapRange'); ramp.inputs['From Min'].default_value = 0.3; ramp.inputs['From Max'].default_value = 0.7; ramp.inputs['To Max'].default_value = soft  # soft 越小,兩種顏色混得越不明顯
    nt.links.new(no.outputs['Fac'], ramp.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    mx.inputs['A'].default_value = (*hexrgb(a_hex), 1); mx.inputs['B'].default_value = (*hexrgb(b_hex), 1)
    nt.links.new(ramp.outputs['Result'], mx.inputs['Factor'])
    return mx, no


def jade_mat():
    m = bpy.data.materials.new('jade'); m.use_nodes = True
    nt = m.node_tree; p = nt.nodes['Principled BSDF']
    mx, no = noise_mix(nt, '#093f26', '#16603c', 3.2, 5, 1.2, soft=0.9)
    nt.links.new(mx.outputs['Result'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.42
    p.inputs['Coat Weight'].default_value = 0.1; p.inputs['Coat Roughness'].default_value = 0.2
    p.inputs['Specular IOR Level'].default_value = 0.25
    p.inputs['Subsurface Weight'].default_value = 0.2; p.inputs['Subsurface Radius'].default_value = (0.2, 0.5, 0.3)
    return m


JADE = jade_mat()
IVORY = mat('#f4ead0', 0.3, 0.4, 0.2)


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


def face_mat(base_hex, ink_hex, mask_path, rough=0.3, glossy_ink=True):
    """牌面材質:遮罩圖白色的地方 = 刻進去(真實位移)並填上漆;牌面本身有象牙的細微顆粒和色差"""
    m = bpy.data.materials.new('face')
    m.use_nodes = True
    m.displacement_method = 'DISPLACEMENT'
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    out = nt.nodes['Material Output']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(mask_path)
    img.image.colorspace_settings.name = 'Non-Color'
    img.extension = 'CLIP'
    img.interpolation = 'Cubic'
    nt.links.new(tc.outputs['Generated'], img.inputs['Vector'])  # 每個物件自己的 0~1 座標,剛好對應整張牌面
    base, grain = noise_mix(nt, base_hex, '#ecdcb4' if base_hex != '#15603d' else '#1c6e45', 55, 6, 0.0, soft=0.5 if base_hex != '#15603d' else 0.35)
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(base.outputs['Result'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*hexrgb(ink_hex), 1)
    nt.links.new(img.outputs['Color'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    rg = nt.nodes.new('ShaderNodeMapRange'); rg.inputs['To Min'].default_value = rough; rg.inputs['To Max'].default_value = 0.16 if glossy_ink else rough
    nt.links.new(img.outputs['Color'], rg.inputs['Value'])
    nt.links.new(rg.outputs['Result'], p.inputs['Roughness'])
    dp = nt.nodes.new('ShaderNodeDisplacement'); dp.inputs['Midlevel'].default_value = 0.0; dp.inputs['Scale'].default_value = -0.034  # 往下刻 0.034(牌面厚 0.3)
    nt.links.new(img.outputs['Color'], dp.inputs['Height'])
    nt.links.new(dp.outputs['Displacement'], out.inputs['Displacement'])
    gb = nt.nodes.new('ShaderNodeBump'); gb.inputs['Strength'].default_value = 0.035; gb.inputs['Distance'].default_value = 0.01  # 顆粒的細微起伏
    nt.links.new(grain.outputs['Fac'], gb.inputs['Height'])
    nt.links.new(gb.outputs['Normal'], p.inputs['Normal'])
    p.inputs['Coat Weight'].default_value = 0.45
    p.inputs['Coat Roughness'].default_value = 0.1
    p.inputs['Subsurface Weight'].default_value = 0.2
    p.inputs['Subsurface Radius'].default_value = (0.5, 0.35, 0.2)
    return m


MASKS = os.path.join(OUT, 'masks')  # 先跑 tools/xqmj_masks.py <OUT>/masks


def subdiv(o):  # 牌面要切得很細,真實位移才刻得出字(Cycles adaptive subdivision:依畫面上的大小自動切)
    sd = o.modifiers.new('sub', 'SUBSURF'); sd.subdivision_type = 'SIMPLE'; sd.levels = 1; sd.render_levels = 1
    sd.use_adaptive_subdivision = True  # Blender 4.2 以後這個開關在修改器上
    sd.adaptive_pixel_size = 0.7


def make_tile(cx, cy, idx):
    base = rbox((cx, cy, T0 / 2), (W, H, T0), JADE, 0.05)
    z = T0 + T1 / 2 - 0.004
    if idx == 14:  # 牌背:翠綠加金色花邊
        top = rbox((cx, cy, z), (W, H, T1), face_mat('#15603d', '#d9b25c', os.path.join(MASKS, 'mask_back.png'), 0.22, False), 0.05)
    elif idx == 15:  # 空白牌面
        top = rbox((cx, cy, z), (W, H, T1), IVORY, 0.05)
        return
    else:
        color = idx // 7
        top = rbox((cx, cy, z), (W, H, T1), face_mat('#f4ead0', '#c4202c' if color == 0 else '#14161c', os.path.join(MASKS, f'mask_{idx}.png')), 0.05)
    subdiv(top)


TEST = os.environ.get('XQ_TEST') == '1'
for i in range(16):
    if TEST and i not in (0, 7, 14): continue
    make_tile((i % 4 - 1.5) * PX, (1.5 - i // 4) * PY, i)

# 光:左上前方主光、右邊補光、後面一道輪廓光
def area(loc, rot, size, e, col='#ffffff'):
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    l = bpy.context.object; l.data.size, l.data.energy = size, e; l.data.color = hexrgb(col)
area((-4, -9, 12), (math.radians(40), 0, math.radians(-15)), 12, 1800, '#fff4e0')
area((9, -3, 6), (math.radians(60), 0, math.radians(60)), 8, 350, '#dfe9ff')
area((0, 9, 5), (math.radians(-60), 0, 0), 14, 450, '#ffffff')

cw, ch_ = (160, 204) if TEST else (320, 408)
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
