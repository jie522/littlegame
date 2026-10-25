# 高樓疊疊樂的素材:用 Blender Cycles 算「8 種顏色的樓層、一樓大廳、吊車的吊具」,正面正交投影,上下疊起來剛好接得起來
# 用法:blender -b -P tools/tower_scene.py -- <絕對路徑>/<暫存資料夾>   →   tower_tmp/tw_00.png … tw_09.png(每張 384 x 168)
#       再 python3 tools/tower_stitch.py <暫存資料夾> <assets 資料夾>   →   assets/tower_floors.webp(4 x 3 格,1536 x 504)
#   格子順序:0~7 是樓層(顏色同 game.js 的 TOWER_COLORS)、8 是一樓大廳、9 是吊具
#   座標:1 單位 = 遊戲裡的 1 個單位(樓層寬 BW = 104、高 BH = 50),每單位 3 像素;每格 128 x 56 單位,
#         樓層本體在格子正中間(左右各留 12 單位給屋簷、柱子;上下各留 3 單位),吊具的底(碰到樓層頂的地方)在 z = 0
import bpy, math, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()
COLORS = ['#ef4b4b', '#33b864', '#3b82f6', '#f5b301', '#8b5cf6', '#fb8c3a', '#14b8a6', '#ec5c9b']
BW, BH, D = 104.0, 50.0, 30.0
CW, CH = 128.0, 56.0  # 格子大小(單位)


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def mix(a, b, t):
    pa, pb = hexrgb(a), hexrgb(b)
    return tuple(pa[i] + (pb[i] - pa[i]) * t for i in range(3))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    # 天空漸層:玻璃會反射出上亮下暗的藍天
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (*hexrgb('#8fb8e0'), 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (*hexrgb('#eaf6ff'), 1)
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -1; mr.inputs['From Max'].default_value = 1
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.9
    return sc


_mats = {}
def mat(key, col, rough=0.5, coat=0.0, metal=0.0, emit=None, emit_s=0.0):
    if key in _mats: return _mats[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*(hexrgb(col) if isinstance(col, str) else col), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = coat
    if emit:
        p.inputs['Emission Color'].default_value = (*hexrgb(emit), 1)
        p.inputs['Emission Strength'].default_value = emit_s
    _mats[key] = m
    return m


def box(x0, x1, y0, y1, z0, z1, m, bevel=0.4, seg=3):
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


def cyl(x, y, z, r, h, m, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z), rotation=rot)
    o = bpy.context.object
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


def window(cx, z0, w, h, frame, glass, sill, lit):
    t = 1.6  # 窗框粗細
    box(cx - w / 2, cx + w / 2, -1.6, 0.5, z0 + h - t, z0 + h, frame, 0.3)  # 上
    box(cx - w / 2, cx + w / 2, -1.6, 0.5, z0, z0 + t, frame, 0.3)  # 下
    box(cx - w / 2, cx - w / 2 + t, -1.6, 0.5, z0, z0 + h, frame, 0.3)  # 左
    box(cx + w / 2 - t, cx + w / 2, -1.6, 0.5, z0, z0 + h, frame, 0.3)  # 右
    box(cx - 0.5, cx + 0.5, -1.2, 0.5, z0, z0 + h, frame, 0.15)  # 中間的窗櫺
    box(cx - w / 2 + t, cx + w / 2 - t, -0.4, 0.5, z0 + h * 0.52, z0 + h * 0.52 + 0.9, frame, 0.1)  # 橫窗櫺
    box(cx - w / 2 + t, cx + w / 2 - t, -0.3, 0.6, z0 + t, z0 + h - t, lit if lit else glass, 0)  # 玻璃(稍微凹進去)
    box(cx - w / 2 - 1.5, cx + w / 2 + 1.5, -3.2, 0.5, z0 - 2.2, z0, sill, 0.4)  # 窗台


def floor(i):
    c = COLORS[i]
    wall = mat('wall%d' % i, c, 0.55, 0.05)
    trim = mat('trim%d' % i, mix(c, '#ffffff', 0.72), 0.45)
    dark = mat('dark%d' % i, mix(c, '#1f2a44', 0.35), 0.5)
    slab = mat('slab', '#ece6da', 0.6)
    frame = mat('frame', '#fbfaf6', 0.35)
    glass = mat('glass', '#355c86', 0.04, 0.6, 0.15)
    lit = mat('lit', '#ffe3a6', 0.2, 0.3, 0, '#ffcf73', 1.2)
    sill = mat('sill', '#dcd5c8', 0.55)
    box(-BW / 2, BW / 2, 0, D, 0, BH - 5, wall, 0.5)  # 牆
    box(-BW / 2 - 2.5, BW / 2 + 2.5, -2.5, D + 1, BH - 5.5, BH, slab, 0.8)  # 樓板 / 屋簷(白色的那一條)
    box(-BW / 2 - 1.5, BW / 2 + 1.5, -1.2, D, BH - 7.5, BH - 5.5, dark, 0.3)  # 屋簷下的陰影條
    for sx in (-1, 1):  # 兩邊的柱子
        box(sx * BW / 2 - 4, sx * BW / 2 + 4, -1.4, D, 0, BH - 5.5, trim, 0.6)
    box(-BW / 2 + 2, BW / 2 - 2, -0.8, D, 0, 3, dark, 0.3)  # 腰帶(樓層底下的深色線)
    xs = [-33, -11, 11, 33]
    lit_pat = [(i * 5 + k * 3) % 7 == 0 for k in range(4)]  # 有幾扇窗亮著暖黃色的燈
    for k, x in enumerate(xs):
        window(x, 12, 16, 26, frame, glass, sill, lit if lit_pat[k] else None)
    # 冷氣機(每層一台,位置跟著顏色換)
    ax = xs[(i * 3) % 4] + (7 if i % 2 else -7)
    box(ax - 4.5, ax + 4.5, -5.5, -0.5, 4.5, 10, mat('ac', '#e8ecf0', 0.4), 0.6)
    cyl(ax, -5.6, 7.25, 2.0, 0.4, mat('acf', '#9aa4b2', 0.5), (math.radians(90), 0, 0))


def lobby():
    stone = mat('stone', '#b9c1cd', 0.7)
    stone2 = mat('stone2', '#d3d9e2', 0.6)
    dark = mat('ldark', '#4b5568', 0.5)
    glass = mat('lglass', '#4b7aa8', 0.05, 0.6, 0.2)
    frame = mat('lframe', '#2f3644', 0.35, 0.2, 0.6)
    awn = mat('awn', '#e8444f', 0.6)
    leaf = mat('leaf', '#3f9d43', 0.7)
    pot = mat('pot', '#a0603a', 0.6)
    W = BW + 16
    box(-W / 2, W / 2, 0, D, 0, BH, stone, 0.6)  # 牆
    for k in range(5):  # 石塊的橫縫
        z = 6 + k * 9
        box(-W / 2 - 0.2, W / 2 + 0.2, -0.3, D, z, z + 0.6, stone2, 0.1)
    box(-W / 2 - 2, W / 2 + 2, -2.5, D + 1, BH - 4, BH, stone2, 0.8)  # 頂上的石條
    box(-W / 2 - 1, W / 2 + 1, -3, D, 0, 2.5, dark, 0.4)  # 台階
    # 玻璃大門
    box(-14, 14, -1.5, 0.5, 2.5, 34, frame, 0.4)
    box(-12.5, -0.6, -1.7, 0.6, 4, 32.5, glass, 0)
    box(0.6, 12.5, -1.7, 0.6, 4, 32.5, glass, 0)
    box(-2.5, -1.5, -3, -1.6, 14, 22, mat('handle', '#e0c070', 0.2, 0, 1), 0.3)
    box(1.5, 2.5, -3, -1.6, 14, 22, mat('handle', '#e0c070', 0.2, 0, 1), 0.3)
    # 雨遮(紅白條紋)
    for k in range(8):
        x0 = -18 + k * 4.5
        o = box(x0, x0 + 4.5, -9, 0, 36, 38, awn if k % 2 == 0 else mat('awnw', '#fbf6ee', 0.6), 0.2)
        o.rotation_euler = (math.radians(-14), 0, 0)
    # 兩邊的窗
    for x in (-38, 38):
        box(x - 10, x + 10, -1.4, 0.5, 14, 36, frame, 0.3)
        box(x - 8.5, x + 8.5, -1.6, 0.6, 15.5, 34.5, glass, 0)
        box(x - 0.4, x + 0.4, -1.8, 0.6, 15.5, 34.5, frame, 0)
    # 盆栽
    for x in (-22, 22):
        box(x - 4.5, x + 4.5, -10, -2, 2.5, 9, pot, 0.8)
        for (dx, dz, r) in ((0, 13, 5.2), (-2.8, 10.5, 3.6), (2.8, 10.8, 3.6)):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x + dx, -6, dz), segments=20, ring_count=12)
            o = bpy.context.object; o.data.materials.append(leaf)
            for f in o.data.polygons: f.use_smooth = True
    # 招牌
    box(-20, 20, -2.5, 0.5, 40.5, 45.5, mat('sign', '#ffd23f', 0.4, 0.3), 0.5)


def clamp():
    yel = mat('yel', '#ffc53d', 0.35, 0.3)
    blk = mat('blk', '#26262e', 0.45)
    steel = mat('steel', '#7c8494', 0.3, 0.2, 0.9)
    cable = mat('cable', '#3a3f4f', 0.4, 0, 0.6)
    L = BW * 0.8
    box(-L / 2, L / 2, -5, 5, 1, 9, yel, 0.6)  # 吊具橫樑
    for k in range(-4, 5):  # 黑黃相間的警示條紋(貼在橫樑正面)
        if k % 2: box(k * 8 - 4, k * 8 + 4, -5.4, -4.6, 1.6, 8.4, blk, 0)
    for sx in (-1, 1):  # 兩端的夾具
        box(sx * L / 2 - 3, sx * L / 2 + 3, -6, 6, -1, 10, steel, 0.6)
        a = math.atan2(L * 0.34, 21)
        cyl(sx * L * 0.17, 0, 9 + 10.5, 0.9, math.hypot(L * 0.34, 21), cable, (0, -sx * a, 0), 12)
    bpy.ops.mesh.primitive_torus_add(major_radius=4.2, minor_radius=1.4, location=(0, -1, 33), rotation=(math.radians(90), 0, 0))
    o = bpy.context.object; o.data.materials.append(yel)
    for f in o.data.polygons: f.use_smooth = True
    box(-3, 3, -3, 3, 28, 31, steel, 0.5)  # 吊鉤座
    cyl(0, 0, 45, 1.0, 22, cable, (0, 0, 0), 12)  # 往上的鋼索(畫布會再接著畫上去)


def lights():
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(58), 0, math.radians(-32)))
    s = bpy.context.object; s.data.energy = 3.2; s.data.angle = math.radians(6); s.data.color = hexrgb('#fff3e0')
    bpy.ops.object.light_add(type='AREA', location=(60, -120, 40), rotation=(math.radians(80), 0, math.radians(30)))
    a = bpy.context.object; a.data.size = 120; a.data.energy = 9000; a.data.color = hexrgb('#dfe9ff')


def render(name, zc):
    sc = bpy.context.scene
    bpy.ops.object.camera_add(location=(0, -300, zc), rotation=(math.radians(90), 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = CW
    cam.data.clip_end = 1000
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = int(CW * 3), int(CH * 3)
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = os.path.join(OUT, 'tower_tmp', name)
    bpy.ops.render.render(write_still=True)


os.makedirs(os.path.join(OUT, 'tower_tmp'), exist_ok=True)
for i in range(8):
    reset(); _mats.clear(); floor(i); lights(); render('tw_%02d.png' % i, BH / 2)
reset(); _mats.clear(); lobby(); lights(); render('tw_08.png', BH / 2)
reset(); _mats.clear(); clamp(); lights(); render('tw_09.png', CH / 2 - 3)
print('done')
