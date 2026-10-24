# 九子棋的素材:用 Blender Cycles 算出「木頭棋盤」和「8 種顏色的寶石棋子」
# 用法:blender -b -P tools/morris_scene.py -- <絕對路徑>/assets
#   morris_board.png   1024x1024 俯視棋盤:外框、凹下去的棋盤面、刻出來的三個方框和四條中線、24 個圓孔
#   morris_stones.png  2048x256,8 顆棋子(紅藍綠黃紫橘黑白,順序同 game.js 的 NMM_COLORS)排成一列
# 座標要和 game.js 對得上:點的位置是 P(v) = 6 + v * 88/6(%),v = 0..6;棋盤畫面佔滿整張圖
import bpy, bmesh, math, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()
COLORS = ['#e8444f', '#3f7de8', '#2fb36b', '#f2b800', '#8c5be8', '#ff8a3d', '#34344a', '#f4f1ea']
XY = [(0, 0), (3, 0), (6, 0), (1, 1), (3, 1), (5, 1), (2, 2), (3, 2), (4, 2), (0, 3), (1, 3), (2, 3), (4, 3), (5, 3), (6, 3), (2, 4), (3, 4), (4, 4), (1, 5), (3, 5), (5, 5), (0, 6), (3, 6), (6, 6)]
S = 10.0  # 棋盤邊長(單位),整張圖就是這個範圍


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def P(v):  # 棋盤上的座標(以棋盤中心為 0,圖片上方是 +y)
    return (0.06 + v * 0.88 / 6 - 0.5) * S


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 128
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    return sc


def world(strength, color='#fff4e6'):
    w = bpy.data.worlds.new('W')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*hexrgb(color), 1)
    bg.inputs['Strength'].default_value = strength


def area(loc, rot, size, energy, color='#ffffff'):
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    l = bpy.context.object
    l.data.size, l.data.energy = size, energy
    l.data.color = hexrgb(color)
    return l


def ortho(scale, z=20):
    bpy.ops.object.camera_add(location=(0, 0, z), rotation=(0, 0, 0))
    c = bpy.context.object
    c.data.type = 'ORTHO'
    c.data.ortho_scale = scale
    bpy.context.scene.camera = c


def render(path, w, h):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def wood_mat(name, light, dark, scale=5.0, stretch=0.1, rough=0.42):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, stretch, 1.0)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = scale; wave.inputs['Distortion'].default_value = 7; wave.inputs['Detail'].default_value = 5
    nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
    noi = nt.nodes.new('ShaderNodeTexNoise'); noi.inputs['Scale'].default_value = 40; noi.inputs['Detail'].default_value = 6
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'FLOAT'; mx.inputs['Factor'].default_value = 0.3
    nt.links.new(wave.outputs['Fac'], mx.inputs['A']); nt.links.new(noi.outputs['Fac'], mx.inputs['B'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*hexrgb(dark), 1); ramp.color_ramp.elements[1].color = (*hexrgb(light), 1)
    nt.links.new(mx.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = 0.25
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.12
    nt.links.new(wave.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


def rounded_box(name, w, h, d, r, z0, mat):
    """圓角長方塊(俯視),底在 z0,厚 d"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z0 + d / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (w, h, d)
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new('bv', 'BEVEL'); bv.width = r; bv.segments = 8; bv.limit_method = 'ANGLE'
    o.data.materials.append(mat)
    return o


def cut(target, cutter):
    m = target.modifiers.new('cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'; m.object = cutter; m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(cutter, do_unlink=True)


# ================= 1) 棋盤 =================
sc = reset()
world(0.25)
frame_m = wood_mat('Frame', '#8a5326', '#5a3315', 6, 0.08, 0.38)
field_m = wood_mat('Field', '#e9b970', '#c98f45', 5, 0.1, 0.45)
# 外框(深色木頭,圓角)
frame = rounded_box('Frame', S, S, 0.5, 0.45, 0, frame_m)
# 棋盤面:比外框低一階,放在框裡面
inset = 0.34
field = rounded_box('Field', S - inset * 2, S - inset * 2, 0.2, 0.18, 0.42, field_m)
bpy.context.view_layer.objects.active = field
# 刻出來的線(寬 0.075、深 0.07):三個方框 + 四條中線
G, GD = 0.075, 0.09
top = 0.62
def groove(x1, y1, x2, y2):
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    w, h = abs(x2 - x1) + G, abs(y2 - y1) + G
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, top))
    o = bpy.context.object
    o.scale = (w, h, GD * 2)
    bpy.ops.object.transform_apply(scale=True)
    return o
segs = []
for k in range(3):
    a, b = P(k), P(6 - k)
    segs += [(a, a, b, a), (a, b, b, b), (a, a, a, b), (b, a, b, b)]
segs += [(P(3), P(0), P(3), P(2)), (P(3), P(4), P(3), P(6)), (P(0), P(3), P(2), P(3)), (P(4), P(3), P(6), P(3))]
# 座標的 y 軸:圖片上方是 +y,所以三個方框用的 a/b 對稱,不用翻轉
for s_ in segs:
    cut(field, groove(s_[0], -s_[1], s_[2], -s_[3]))
# 24 個圓孔(放棋子的位置,圓圓的小凹洞)
for (xi, yi) in XY:
    x, y = P(xi), -P(yi)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=0.3, location=(x, y, top - 0.0), vertices=48)
    cut(field, bpy.context.object)
# 凹槽和孔洞內的顏色壓暗一點:多加一層很薄的深色膜在槽底(用第二個材質做 AO 感)
field.data.materials.append(wood_mat('Groove', '#4a2a10', '#2a1507', 5, 0.1, 0.8))
bpy.context.view_layer.update()
# 把法線朝下很多的面(槽壁/孔底)指定為深色材質
for poly in field.data.polygons:
    poly.material_index = 0
bm = bmesh.new(); bm.from_mesh(field.data)
for f in bm.faces:
    f.material_index = 0 if f.normal.z > 0.85 and f.calc_center_median().z > top - 0.001 else 1
bm.to_mesh(field.data); bm.free()
area((-4, 5, 9), (math.radians(25), math.radians(-20), 0), 7, 1000, '#fff0d8')
area((6, -5, 6), (math.radians(-35), math.radians(40), 0), 6, 300, '#ffe0b0')
ortho(S * 1.0)
sc.cycles.samples = 160
render(os.path.join(OUT, 'morris_board.png'), 1024, 1024)

# ================= 2) 棋子(8 顆寶石棋子排成一列) =================
sc = reset()
world(0.6, '#ffffff')


def lathe(name, prof, segs=96):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)] for (r, z) in prof]
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for f in me.polygons:
        f.use_smooth = True
    return ob


# 棋子的剖面:圓角的寶石圓餅(半徑 0.61,厚 0.3,頂面微微鼓起)
R, T = 0.61, 0.32
prof = [(0.0, 0.0), (R * 0.82, 0.0), (R * 0.95, 0.03), (R, 0.1), (R, T * 0.55), (R * 0.93, T * 0.8), (R * 0.75, T * 0.95), (R * 0.45, T * 1.1), (0.0, T * 1.16)]
PITCH = 1.34
for i, hexc in enumerate(COLORS):
    o = lathe('Stone%d' % i, prof)
    o.location = ((i - 3.5) * PITCH, 0, 0)
    m = bpy.data.materials.new('M%d' % i)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*hexrgb(hexc), 1)
    p.inputs['Roughness'].default_value = 0.16
    p.inputs['Coat Weight'].default_value = 1.0
    p.inputs['Coat Roughness'].default_value = 0.05
    p.inputs['Subsurface Weight'].default_value = 0.15
    p.inputs['Subsurface Radius'].default_value = (0.25, 0.25, 0.25)
    p.inputs['Specular IOR Level'].default_value = 0.8
    o.data.materials.append(m)
area((-3, 4, 8), (math.radians(20), math.radians(-15), 0), 6, 900, '#ffffff')
area((5, -3, 4), (math.radians(-30), math.radians(35), 0), 4, 240, '#ffe8c8')
# 8 顆排成一列:相機照整排,每顆佔 256 像素
bpy.ops.object.camera_add(location=(0, 0, 20), rotation=(0, 0, 0))
cam = bpy.context.object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = PITCH * 8
sc.camera = cam
sc.cycles.samples = 128
render(os.path.join(OUT, 'morris_stones.png'), 2048, 256)
print('done')
