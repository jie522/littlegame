# 高樓疊疊樂的卡片圖示:用 Blender Cycles 算一座塔吊 + 三層彩色大樓 + 吊在半空中的一層(透明背景)
# 用法:blender -b -P tools/tower_icon_scene.py -- <輸出資料夾>   →   tower_icon.png(760x900)
# 之後用 tools/game_icons.py 疊在天空藍的卡片底上、和其他遊戲的圖示一起拼成 assets/game_icons.webp
import bpy, math, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 96
sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (*hexrgb('#ffffff'), 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55


def mat(hexc, rough=0.28, coat=0.45):
    m = bpy.data.materials.new('m' + hexc)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*hexrgb(hexc), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = 0.12
    return m


def box(loc, size, m, bevel=0.07, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new('bv', 'BEVEL'); b.width = bevel; b.segments = 5
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


def bar(p1, p2, r, m):  # 兩點之間的圓棒
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(p1 + p2) / 2, vertices=24)
    o = bpy.context.object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    o.data.materials.append(m)
    for f in o.data.polygons: f.use_smooth = True
    return o


YEL, BLK = mat('#ffc53d', 0.3), mat('#2a2a33', 0.5, 0.1)
WIN = mat('#d6efff', 0.08, 0.6)
LIP = mat('#ffffff', 0.4, 0.2)
BW, BH, BD = 2.0, 0.78, 1.3


def building(cz, color, dx=0.0, rot=0.0):
    m = mat(color)
    o = box((dx, 0, cz), (BW, BD, BH), m, 0.1, (0, math.radians(rot), 0))
    # 屋頂邊(淺色一條)
    box((dx, 0, cz + BH / 2 - 0.05), (BW + 0.04, BD + 0.04, 0.12), mat('#fff3d6', 0.35, 0.3), 0.05, (0, math.radians(rot), 0))
    # 2 x 3 個窗戶,貼在正面(朝 -y 的那面)
    for r in range(2):
        for k in range(3):
            lx, lz = (k - 1) * 0.6, -0.04 + (r - 0.5) * 0.36 * -1
            c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
            wx, wz = dx + lx * c + lz * s, cz - lx * s + lz * c
            box((wx, -BD / 2 - 0.01, wz), (0.38, 0.06, 0.26), WIN, 0.03, (0, math.radians(rot), 0))
    return o


# 一樓(石頭灰,有門)+ 兩層彩色樓,往左右錯開一點點像真的在疊
box((0, 0, 0.37), (BW + 0.3, BD + 0.1, 0.74), mat('#b9c1cf'), 0.1)
box((0, -BD / 2 - 0.08, 0.3), (0.42, 0.08, 0.5), mat('#6a7488'), 0.03)
for x in (-0.65, 0.65): box((x, -BD / 2 - 0.08, 0.42), (0.3, 0.06, 0.26), WIN, 0.03)
building(0.74 + BH / 2, '#f5b301', 0.0)
building(0.74 + BH * 1.5 + 0.0, '#ef4b4b', 0.12)
TOPZ = 0.74 + BH * 2
# 塔吊:右邊一根桁架、上面一支向左伸出的吊臂、吊臂下面吊一層半空中的藍色樓
MX, MZ = 2.15, 4.1
for x in (MX - 0.22, MX + 0.22): bar((x, 0.3, 0.0), (x, 0.3, MZ), 0.05, YEL)
n = 8
for i in range(n):
    z1, z2 = MZ * i / n, MZ * (i + 1) / n
    a, b = (MX - 0.22, MX + 0.22) if i % 2 == 0 else (MX + 0.22, MX - 0.22)
    bar((a, 0.3, z1), (b, 0.3, z2), 0.035, YEL)
box((MX, 0.3, 0.1), (0.8, 0.8, 0.2), BLK, 0.04)
JZ = MZ + 0.12
for dz in (0, 0.42): bar((MX + 0.6, 0.3, JZ + dz), (-1.2, 0.3, JZ + dz), 0.05, YEL)
for i in range(9):
    x1, x2 = MX + 0.6 - i * 0.2, MX + 0.6 - (i + 1) * 0.2
    a, b = (0, 0.42) if i % 2 == 0 else (0.42, 0)
    bar((x1, 0.3, JZ + a), (x2, 0.3, JZ + b), 0.03, YEL)
box((MX + 0.55, 0.3, JZ + 0.1), (0.5, 0.5, 0.6), BLK, 0.05)  # 配重
bar((MX, 0.3, MZ + 0.54), (MX, 0.3, MZ + 0.9), 0.04, YEL)  # 塔頂小尖
HX = -0.45
HZ = TOPZ + 1.5
bar((HX, 0.3, JZ - 0.05), (HX, 0.3, HZ), 0.028, BLK)  # 鋼索
bpy.ops.mesh.primitive_torus_add(location=(HX, 0.3, HZ + 0.1), major_radius=0.13, minor_radius=0.04, rotation=(math.radians(90), 0, 0))
bpy.context.object.data.materials.append(mat('#9aa3b8', 0.2, 0.3))
# 吊著的藍色樓:吊架(黃黑)+ 兩條斜索
BARZ = TOPZ + 0.75 + BH / 2 + 0.12
bar((HX, 0.3, HZ), (HX - 0.55, 0, BARZ), 0.02, BLK)
bar((HX, 0.3, HZ), (HX + 0.55, 0, BARZ), 0.02, BLK)
box((HX, 0, BARZ), (1.3, 0.5, 0.12), YEL, 0.04)
for i in range(-3, 3): box((HX + i * 0.2 + 0.1, -0.26, BARZ), (0.1, 0.02, 0.1), BLK, 0.01, (0, 0, 0))
building(TOPZ + 0.75, '#3b82f6', HX, 0.0)
# 光:左上主光 + 右下補光
for loc, rot, size, e, col in [((-4, -6, 8), (math.radians(50), 0, math.radians(-30)), 6, 700, '#ffffff'), ((6, -5, 1), (math.radians(80), 0, math.radians(40)), 6, 160, '#ffe8c8')]:
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    l = bpy.context.object; l.data.size, l.data.energy = size, e; l.data.color = hexrgb(col)
# 相機:正面稍微往下看
bpy.ops.object.camera_add(location=(0, -30, 2.5 + 30 * math.tan(math.radians(6))), rotation=(math.radians(84), 0, 0))
cam = bpy.context.object; cam.data.type = 'ORTHO'; cam.data.ortho_scale = 5.4
cam.location.x = 0.7
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 760, 900
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = os.path.join(OUT, 'tower_icon.png')
bpy.ops.render.render(write_still=True)
print('done')
