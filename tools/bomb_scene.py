# 轟炸超人的素材:用 Blender Cycles 算「斜俯視」的草地棋盤、石牆、木箱、炸彈、道具底座
# 用法:blender -b -P tools/bomb_scene.py -- <暫存資料夾>   →   bomb_tmp/b_00.png … b_11.png(每張 128 x 192)、bomb_floor.png(1440 x 1056)
#       再 python3 tools/bomb_stitch.py <暫存資料夾> <assets 資料夾>   →   assets/bomb_sprites.webp(4 x 3 格)、assets/bomb_floor.webp
# 投影:正交相機往後傾 30 度(看得到方塊的頂面和正面);物件的 y 先拉長 1/cos30,所以地上的格子在畫面上還是正方形
#   每張小圖 = 1 格寬 x 1.5 格高:下面 1 x 1 是這一格的地面,上面多 0.5 格給高起來的東西(牆、木箱的頂)
#   遊戲裡畫在 (格子左, 格子中心 y - 1, 1, 1.5)
#   格子順序:0 石牆、1 外圍石牆、2 木箱、3 炸彈、4 快爆炸的紅炸彈、5~11 道具底座(顏色同 game.js 的 BOMB_ITEMS)
import bpy, math, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()
TH = math.radians(30)
YS = 1 / math.cos(TH)
ITEM_COLORS = ['#5c6bc0', '#f57c00', '#26a69a', '#42a5f5', '#8d6e63', '#6a1b9a', '#d32f2f']


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexrgb('#eef6ff'), 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    return sc


def mat(name, col, rough=0.5, coat=0.0, metal=0.0, noise=None, bump=0.0, emit=None, emit_s=0.0):
    """noise = (第二個顏色, 尺度):用雜訊混兩個顏色,石頭、木頭的斑紋"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = coat
    if noise:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = noise[1]; nz.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        mx.inputs['A'].default_value = (*hexrgb(col), 1); mx.inputs['B'].default_value = (*hexrgb(noise[0]), 1)
        nt.links.new(nz.outputs['Fac'], mx.inputs['Factor'])
        nt.links.new(mx.outputs['Result'], p.inputs['Base Color'])
        if bump:
            b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = bump; b.inputs['Distance'].default_value = 0.02
            nt.links.new(nz.outputs['Fac'], b.inputs['Height'])
            nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    else:
        p.inputs['Base Color'].default_value = (*hexrgb(col), 1)
    if emit:
        p.inputs['Emission Color'].default_value = (*hexrgb(emit), 1)
        p.inputs['Emission Strength'].default_value = emit_s
    return m


def box(x0, x1, y0, y1, z0, z1, m, bevel=0.03, seg=4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.object
    o.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        bv = o.modifiers.new('bv', 'BEVEL'); bv.width = bevel; bv.segments = seg; bv.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


def smooth(o, m):
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


def stretch_y():  # 把整個場景的 y 拉長 1/cos30:地上的格子在畫面上才會是正方形
    for o in bpy.context.scene.objects:
        if o.type in ('MESH', 'CURVE'):
            o.location.y *= YS
            o.scale.y *= YS


def lights():
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(35), 0, math.radians(-35)))
    s = bpy.context.object; s.data.energy = 2.4; s.data.angle = math.radians(8); s.data.color = hexrgb('#fff4e2')
    bpy.ops.object.light_add(type='AREA', location=(3, -4, 4), rotation=(math.radians(50), 0, math.radians(35)))
    a = bpy.context.object; a.data.size = 6; a.data.energy = 220; a.data.color = hexrgb('#dce8ff')


def camera(sc, w_units, h_units, v_center, px):
    u = (0, math.cos(TH), math.sin(TH))
    d = (0, math.sin(TH), -math.cos(TH))
    p = (0, v_center * u[1], v_center * u[2])
    loc = (p[0] - d[0] * 50, p[1] - d[1] * 50, p[2] - d[2] * 50)
    bpy.ops.object.camera_add(location=loc, rotation=(TH, 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(w_units, h_units)
    cam.data.clip_end = 200
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = int(w_units * px), int(h_units * px)
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'


def render(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def wall(edge):
    top = mat('top', '#a9b5cc' if not edge else '#7f8ba6', 0.75, 0, 0, ('#8c98b2' if not edge else '#66718c', 7), 0.4)
    side = mat('side', '#7a86a3' if not edge else '#58627c', 0.8, 0, 0, ('#66718c' if not edge else '#47506a', 6), 0.5)
    cap = mat('cap', '#c4cde0' if not edge else '#95a1bb', 0.7, 0, 0, ('#aab5ca' if not edge else '#7f8ba6', 9), 0.3)
    box(-0.48, 0.48, -0.48, 0.48, 0, 0.62, side, 0.06)
    box(-0.46, 0.46, -0.46, 0.46, 0.6, 0.76, top, 0.05)
    box(-0.34, 0.34, -0.34, 0.34, 0.74, 0.8, cap, 0.04)  # 頂上刻出來的方塊
    for x in (-0.2, 0.2):  # 正面的石縫
        box(x - 0.012, x + 0.012, -0.495, -0.47, 0.04, 0.58, mat('gap', '#4a5470', 0.9), 0.004)
    box(-0.46, 0.46, -0.495, -0.47, 0.3, 0.32, mat('gap2', '#4a5470', 0.9), 0.004)


def crate():
    wood = mat('wood', '#e3a25e', 0.6, 0.05, 0, ('#c98445', 3.5), 0.6)
    dark = mat('frame', '#9a5a2a', 0.6, 0.05, 0, ('#7d4520', 5), 0.4)
    nail = mat('nail', '#d8d8d8', 0.25, 0, 1)
    box(-0.43, 0.43, -0.43, 0.43, 0, 0.72, wood, 0.03)
    t = 0.07
    for (x0, x1, y0, y1) in ((-0.45, 0.45, -0.45, -0.45 + t), (-0.45, 0.45, 0.45 - t, 0.45), (-0.45, -0.45 + t, -0.45, 0.45), (0.45 - t, 0.45, -0.45, 0.45)):
        box(x0, x1, y0, y1, 0.66, 0.76, dark, 0.015)  # 頂上的框
    for x in (-0.45, 0.45 - t):  # 正面兩邊的直框
        box(x, x + t, -0.46, -0.4, 0, 0.72, dark, 0.015)
    box(-0.45, 0.45, -0.46, -0.4, 0, 0.08, dark, 0.015)
    o = box(-0.04, 0.04, -0.465, -0.43, -0.05, 0.86, dark, 0.012)  # 正面的斜撐
    o.rotation_euler = (0, math.radians(-50), 0); o.location = (0, -0.447, 0.38)
    for x in (-0.15, 0.15):  # 頂面的木板縫
        box(x - 0.008, x + 0.008, -0.38, 0.38, 0.72, 0.725, mat('seam', '#8a4f22', 0.8), 0.002)
    for (x, z) in ((-0.41, 0.7), (0.41, 0.7), (-0.41, 0.04), (0.41, 0.04)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, location=(x, -0.465, z)); smooth(bpy.context.object, nail)


def bomb(hot):
    body = mat('body', '#c0392b' if hot else '#262a3c', 0.28, 0.7, 0.1, None, 0, '#ff3b2f' if hot else None, 0.9 if hot else 0)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.34, location=(0, 0, 0.36), segments=48, ring_count=24)
    smooth(bpy.context.object, body)
    cap = mat('cap', '#8a90a6', 0.3, 0.2, 0.8)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.09, depth=0.1, location=(0, 0.02, 0.72), vertices=24); smooth(bpy.context.object, cap)
    cu = bpy.data.curves.new('fuse', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.022; cu.bevel_resolution = 4
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(2)
    for bp, co in zip(sp.bezier_points, [(0, 0.02, 0.76), (0.08, 0.0, 0.88), (0.2, -0.02, 0.86)]):
        bp.co = co; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new('fuse', cu); bpy.context.collection.objects.link(o)
    o.data.materials.append(mat('rope', '#c9a26a', 0.8))


def token(col):
    rim = mat('rim', '#ffffff', 0.35, 0.4)
    face = mat('face', col, 0.25, 0.6)
    box(-0.36, 0.36, -0.36, 0.36, 0.1, 0.26, rim, 0.08, 6)
    box(-0.3, 0.3, -0.3, 0.3, 0.25, 0.3, face, 0.06, 6)


def floor():
    """整片草地 15 x 11 格:深淺相間的格子 + 草的雜訊 + 外圍深一點"""
    m = bpy.data.materials.new('grass'); m.use_nodes = True
    nt = m.node_tree; p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = 0.85
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    # 格子:floor(x) + floor(y) 的奇偶(物件座標是拉長之前的,剛好一格 1 單位)
    fx = nt.nodes.new('ShaderNodeMath'); fx.operation = 'FLOOR'
    ax = nt.nodes.new('ShaderNodeMath'); ax.operation = 'ADD'; ax.inputs[1].default_value = 7.5
    nt.links.new(sep.outputs['X'], ax.inputs[0]); nt.links.new(ax.outputs[0], fx.inputs[0])
    ay = nt.nodes.new('ShaderNodeMath'); ay.operation = 'ADD'; ay.inputs[1].default_value = 5.5
    fy = nt.nodes.new('ShaderNodeMath'); fy.operation = 'FLOOR'
    nt.links.new(sep.outputs['Y'], ay.inputs[0]); nt.links.new(ay.outputs[0], fy.inputs[0])
    sm = nt.nodes.new('ShaderNodeMath'); sm.operation = 'ADD'
    nt.links.new(fx.outputs[0], sm.inputs[0]); nt.links.new(fy.outputs[0], sm.inputs[1])
    md = nt.nodes.new('ShaderNodeMath'); md.operation = 'MODULO'; md.inputs[1].default_value = 2
    nt.links.new(sm.outputs[0], md.inputs[0])
    c1 = nt.nodes.new('ShaderNodeMix'); c1.data_type = 'RGBA'
    c1.inputs['A'].default_value = (*hexrgb('#62b34c'), 1); c1.inputs['B'].default_value = (*hexrgb('#74c25a'), 1)
    nt.links.new(md.outputs[0], c1.inputs['Factor'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 22; nz.inputs['Detail'].default_value = 8
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    c2 = nt.nodes.new('ShaderNodeMix'); c2.data_type = 'RGBA'; c2.blend_type = 'OVERLAY'
    c2.inputs['Factor'].default_value = 0.35
    nt.links.new(c1.outputs['Result'], c2.inputs['A']); nt.links.new(nz.outputs['Fac'], c2.inputs['B'])
    nt.links.new(c2.outputs['Result'], p.inputs['Base Color'])
    b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = 0.35; b.inputs['Distance'].default_value = 0.02
    nt.links.new(nz.outputs['Fac'], b.inputs['Height']); nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    o = bpy.context.object; o.scale = (15, 11, 1); bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    # 草地上的小花和草叢(固定的亂數)
    import random
    rnd = random.Random(7)
    petal = [mat('p%d' % i, c, 0.6) for i, c in enumerate(['#ffffff', '#ffe066', '#ff9ec4'])]
    tuft = mat('tuft', '#5fae4b', 0.8)
    for _ in range(70):
        x, y = rnd.uniform(-7.4, 7.4), rnd.uniform(-5.4, 5.4)
        if rnd.random() < 0.35:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, location=(x, y, 0.03)); smooth(bpy.context.object, rnd.choice(petal))
        else:
            for k in range(3):
                bpy.ops.mesh.primitive_cone_add(radius1=0.035, depth=0.18, location=(x + (k - 1) * 0.045, y, 0.08), rotation=(0, (k - 1) * 0.35, 0), vertices=6)
                smooth(bpy.context.object, tuft)


os.makedirs(os.path.join(OUT, 'bomb_tmp'), exist_ok=True)
jobs = [lambda: wall(False), lambda: wall(True), crate, lambda: bomb(False), lambda: bomb(True)] + [(lambda c: (lambda: token(c)))(c) for c in ITEM_COLORS]
for i, fn in enumerate(jobs):
    sc = reset(); fn(); stretch_y(); lights()
    camera(sc, 1, 1.5, 0.25, 128)
    render(sc, os.path.join(OUT, 'bomb_tmp', 'b_%02d.png' % i))
sc = reset(); floor(); stretch_y(); lights()
sc.cycles.samples = 64
camera(sc, 15, 11, 0, 96)
render(sc, os.path.join(OUT, 'bomb_floor.png'))
print('done')
