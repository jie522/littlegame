# 全壘打大賽的 3D 場景(Blender 腳本)
# 用法:blender -b -P tools/baseball_scene.py -- assets/baseball.glb [預覽圖.png]
# 會建好球場、看台、燈塔、記分板、球員(手臂可以動)和球棒,匯出成 glb 給網頁的 three.js 用。
# 座標:本壘在原點,+Y 朝中外野(投手在 +Y 18.44 公尺),+X 是一壘那一側,Z 朝上,單位公尺。
import bpy, bmesh, math, random, sys
from mathutils import Vector

random.seed(7)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'baseball.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))  # sRGB → 線性


def make_mat(name, color, rough=0.85, metal=0.0, vcol=False, emit=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*hexrgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if vcol:  # 用頂點顏色(觀眾、草皮條紋)
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'Col'
        nt.links.new(ca.outputs['Color'], p.inputs['Base Color'])
    if emit:
        p.inputs['Emission Color'].default_value = (*hexrgb(emit), 1)
        p.inputs['Emission Strength'].default_value = 3.0
    m.diffuse_color = (*hexrgb(color), 1)
    return m


MAT = {
    'ground': make_mat('Ground', '#2f7a3a'),
    'grass': make_mat('Grass', '#4fa64a', vcol=True),
    'dirt': make_mat('Dirt', '#c98b54', rough=1.0),
    'white': make_mat('Chalk', '#f4f4f0'),
    'wall': make_mat('Wall', '#1f4d3a'),
    'yellow': make_mat('WallTop', '#ffd23f'),
    'crowd': make_mat('Crowd', '#888888', vcol=True),
    'concrete': make_mat('Concrete', '#8a93a3'),
    'steel': make_mat('Steel', '#5b6372', rough=0.5, metal=0.4),
    'lamp': make_mat('Lamp', '#fffbe0', emit='#fff6c8'),
    'board': make_mat('Board', '#141c2e'),
    'boardface': make_mat('BoardFace', '#22314f', emit='#1b3d73'),
    # 球員
    'shirt': make_mat('TeamShirt', '#e53935'),
    'cap': make_mat('TeamCap', '#b71c1c'),
    'pants': make_mat('Pants', '#f2f2f2'),
    'skin': make_mat('Skin', '#f2c9a0'),
    'black': make_mat('Black', '#1d2129'),
    'glove': make_mat('Glove', '#8a5a2b'),
    'wood': make_mat('Wood', '#d9a066', rough=0.55),
}


def new_obj(name, bm, mat, parent=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if 'Col' in me.color_attributes:  # 匯出 glTF 時只會帶「作用中」的顏色屬性
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if isinstance(mat, list):
        for m in mat:
            ob.data.materials.append(m)
    else:
        ob.data.materials.append(mat)
    if parent:
        ob.parent = parent
    return ob


def polar(r, deg):  # 以本壘為中心,角度從 +Y 往 +X 量
    a = math.radians(deg)
    return r * math.sin(a), r * math.cos(a)


def sector(name, r0, r1, a0, a1, seg, z, mat, colorf=None, rings=1):
    """環狀扇形(可以分成好幾圈,用 colorf(圈, 段) 指定每一格的顏色)"""
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col') if colorf else None
    for k in range(rings):
        ra, rb = r0 + (r1 - r0) * k / rings, r0 + (r1 - r0) * (k + 1) / rings
        for i in range(seg):
            da, db = a0 + (a1 - a0) * i / seg, a0 + (a1 - a0) * (i + 1) / seg
            pts = [polar(ra, da), polar(ra, db), polar(rb, db), polar(rb, da)]
            vs = [bm.verts.new((x, y, z)) for x, y in pts]
            f = bm.faces.new(vs if ra > 0 else vs)
            if col:
                c = colorf(k, i)
                for lp in f.loops:
                    lp[col] = (*c, 1)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return new_obj(name, bm, mat)


def box(name, size, loc, mat, parent=None, rot=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(rot, 3, 'Z'))
    ob = new_obj(name, bm, mat, parent)
    ob.location = loc
    return ob


def cyl(name, r, h, loc, mat, seg=16, parent=None, r2=None, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = new_obj(name, bm, mat, parent, smooth)
    ob.location = loc
    return ob


def sphere(name, r, loc, mat, scale=(1, 1, 1), parent=None, seg=18, half=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2 + 2, radius=r)
    if half:  # 只留上半球(帽子)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.001], context='VERTS')
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    ob = new_obj(name, bm, mat, parent, smooth=True)
    ob.location = loc
    return ob


# ---------------- 球場 ----------------
stadium = bpy.data.objects.new('Stadium', None)
scene.collection.objects.link(stadium)


def S(ob):
    ob.parent = stadium
    return ob


S(sector('Ground', 0.01, 175, -180, 180, 72, -0.03, MAT['ground']))
# 外野草皮:同心圓的割草條紋
light, dark = hexrgb('#55ad4c'), hexrgb('#469c40')
S(sector('Outfield', 0.01, 99, -52, 52, 52, 0.0, MAT['grass'], lambda k, i: light if k % 2 else dark, rings=24))
# 內野紅土:扇形 + 本壘周圍
S(sector('InfieldDirt', 0.01, 29, -50, 50, 36, 0.012, MAT['dirt']))
S(sector('HomeDirt', 0.01, 4.2, -180, 180, 28, 0.014, MAT['dirt']))
# 內野草皮(壘包圍起來的正方形)
bm = bmesh.new()
pts = [(0, 3.3), (16.9, 19.4), (0, 35.5), (-16.9, 19.4)]
bm.faces.new([bm.verts.new((x, y, 0.02)) for x, y in pts])
col = bm.loops.layers.color.new('Col')
for f in bm.faces:
    for lp in f.loops:
        lp[col] = (*light, 1)
S(new_obj('InfieldGrass', bm, MAT['grass']))
# 投手丘
S(cyl('Mound', 2.7, 0.25, (0, 18.44, 0.1), MAT['dirt'], seg=28, r2=2.2))
S(box('Rubber', (0.6, 0.15, 0.04), (0, 18.44, 0.25), MAT['white']))
# 壘包
for nm, (x, y) in {'Base1': (19.4, 19.4), 'Base2': (0, 38.8), 'Base3': (-19.4, 19.4)}.items():
    S(box(nm, (0.4, 0.4, 0.09), (x, y, 0.05), MAT['white'], rot=math.radians(45)))
bm = bmesh.new()
plate = [(-0.215, 0), (0.215, 0), (0.215, -0.215), (0, -0.43), (-0.215, -0.215)]
bm.faces.new([bm.verts.new((x, y, 0.03)) for x, y in plate])
S(new_obj('HomePlate', bm, MAT['white']))
# 界外線、打擊區
for sgn in (-1, 1):
    ln = S(box('FoulLine', (0.1, 98, 0.01), (0, 0, 0.026), MAT['white']))
    ln.data.transform(__import__('mathutils').Matrix.Translation((0, 49, 0)))
    ln.rotation_euler = (0, 0, -sgn * math.radians(45))
    for dx, dy, w, h in ((sgn * 0.62, 0, 0.05, 1.8), (sgn * 1.52, 0, 0.05, 1.8), (sgn * 1.07, 0.9, 0.95, 0.05), (sgn * 1.07, -0.9, 0.95, 0.05)):
        S(box('BatterBox', (w, h, 0.01), (dx, dy, 0.027), MAT['white']))
# 全壘打牆
bm = bmesh.new()
seg, R, H = 46, 99.5, 3.2
for i in range(seg):
    a, b = -46 + 92 * i / seg, -46 + 92 * (i + 1) / seg
    (x1, y1), (x2, y2) = polar(R, a), polar(R, b)
    vs = [bm.verts.new(v) for v in ((x1, y1, 0), (x2, y2, 0), (x2, y2, H), (x1, y1, H))]
    bm.faces.new(vs)
S(new_obj('Wall', bm, MAT['wall']))
S(sector('WallTop', R - 0.05, R + 0.6, -46, 46, 46, H + 0.01, MAT['yellow']))
# 看台:一排一排往上、往後;每一格座位上是隨機顏色的觀眾
palette = [hexrgb(c) for c in ('#ffd23f', '#ff6b6b', '#6bd0ff', '#ffffff', '#9b7bff', '#5fd38d', '#ff9f43', '#e53935', '#1e6fe0', '#ffd9b3')]
bm = bmesh.new()
colL = bm.loops.layers.color.new('Col')
rows, segs = 16, 130
for k in range(rows):
    r_a, r_b, z = 101 + k * 1.7, 101 + (k + 1) * 1.7, 3.6 + k * 1.05
    for i in range(segs):
        a, b = -118 + 236 * i / segs, -118 + 236 * (i + 1) / segs
        (x1, y1), (x2, y2), (x3, y3), (x4, y4) = polar(r_a, a), polar(r_a, b), polar(r_b, b), polar(r_b, a)
        c = random.choice(palette) if random.random() < 0.86 else hexrgb('#5a6374')
        # 階梯的立面:下半是水泥、上半是坐著的觀眾(從球場往上看主要看到這一面)
        for z0, z1, fc in ((z - 1.05, z - 0.5, hexrgb('#7d8696')), (z - 0.5, z, c)):
            riser = bm.faces.new([bm.verts.new(v) for v in ((x1, y1, z0), (x2, y2, z0), (x2, y2, z1), (x1, y1, z1))])
            for lp in riser.loops:
                lp[colL] = (*fc, 1)
        # 座位面:觀眾
        seat = bm.faces.new([bm.verts.new(v) for v in ((x1, y1, z), (x2, y2, z), (x3, y3, z), (x4, y4, z))])
        for lp in seat.loops:
            lp[colL] = (*c, 1)
bm.normal_update()
S(new_obj('Stands', bm, MAT['crowd']))
# 看台最上面的屋簷
S(sector('Roof', 101 + rows * 1.7, 101 + rows * 1.7 + 6, -118, 118, 60, 3.6 + rows * 1.05 + 2.2, MAT['concrete']))
# 燈塔
for deg in (-70, -28, 28, 70):
    x, y = polar(136, deg)
    S(cyl('LightPole', 0.5, 44, (x, y, 22), MAT['steel'], seg=10))
    head = S(box('LightHead', (7, 1, 4), (x, y, 45), MAT['steel']))
    head.rotation_euler = (0, 0, -math.radians(deg))
    face = S(box('LightFace', (6.4, 0.2, 3.4), (x - math.sin(math.radians(deg)) * 0.6, y - math.cos(math.radians(deg)) * 0.6, 45), MAT['lamp']))
    face.rotation_euler = (0, 0, -math.radians(deg))
# 中外野的大記分板
S(box('Scoreboard', (34, 1.2, 14), (0, 132, 34), MAT['board']))
S(box('ScoreFace', (31, 0.3, 11), (0, 131.3, 34), MAT['boardface']))
for x in (-12, 12):
    S(cyl('BoardLeg', 0.6, 26, (x, 132.5, 13), MAT['steel'], seg=8))

# ---------------- 球員(Q 版,手臂可以轉) ----------------
player = bpy.data.objects.new('Player', None)
scene.collection.objects.link(player)
for sx in (-0.13, 0.13):
    cyl('Leg', 0.11, 0.72, (sx, 0, 0.36), MAT['pants'], parent=player)
    box('Shoe', (0.16, 0.28, 0.1), (sx, 0.04, 0.05), MAT['black'], parent=player)
sphere('Body', 0.3, (0, 0, 0.98), MAT['shirt'], scale=(1, 0.75, 1.15), parent=player)
cyl('Belt', 0.24, 0.07, (0, 0, 0.74), MAT['black'], parent=player)
sphere('Head', 0.29, (0, 0, 1.55), MAT['skin'], parent=player)
sphere('Cap', 0.305, (0, 0, 1.6), MAT['cap'], parent=player, half=True)
brim = cyl('Brim', 0.2, 0.03, (0, 0.2, 1.62), MAT['cap'], parent=player, seg=16)
brim.scale = (1, 1.2, 1)
for ex in (-0.1, 0.1):
    sphere('Eye', 0.035, (ex, 0.265, 1.55), MAT['black'], parent=player, seg=8)
for nm, sx in (('ArmL', -0.36), ('ArmR', 0.36)):
    # 手臂的原點在肩膀,網頁裡轉這個物件就是在揮手臂
    arm = bpy.data.objects.new(nm, None)
    scene.collection.objects.link(arm)
    arm.parent = player
    arm.location = (sx, 0, 1.18)
    cyl(nm + 'Mesh', 0.075, 0.5, (0, 0, -0.26), MAT['shirt'], parent=arm)
    sphere(nm + 'Hand', 0.08, (0, 0, -0.54), MAT['glove'] if nm == 'ArmL' else MAT['skin'], parent=arm, seg=10)

# ---------------- 球棒(原點在握把) ----------------
bat = bpy.data.objects.new('Bat', None)
scene.collection.objects.link(bat)
cyl('BatWood', 0.018, 0.84, (0, 0, 0.42), MAT['wood'], parent=bat, r2=0.035, seg=12)
cyl('BatTape', 0.02, 0.12, (0, 0, 0.06), MAT['black'], parent=bat, seg=12)

# 球員和球棒放在場外,網頁會複製出來用
player.location = (0, -60, 0)
bat.location = (2, -60, 0)

# ---------------- 匯出 ----------------
kw = dict(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
for extra in ({'export_vertex_color': 'ACTIVE'}, {'export_colors': True}, {}):
    try:
        bpy.ops.export_scene.gltf(**kw, **extra)
        print('exported', OUT, extra)
        break
    except TypeError:
        continue

# ---------------- 預覽圖(檢查用) ----------------
if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = (0, -5.5, 2.6)
    cam.rotation_euler = (math.radians(84), 0, 0)
    cam.data.lens = 26
    scene.camera = cam
    for nm, rot, en in (('Sun', (math.radians(50), math.radians(10), math.radians(30)), 3.5),):
        sun = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'SUN'))
        sun.data.energy = en
        sun.rotation_euler = rot
        scene.collection.objects.link(sun)
    # 預覽時把球員放到投手丘和打擊區
    player.location = (0, 18.44, 0.25)
    player.rotation_euler = (0, 0, math.radians(180))
    world = bpy.data.worlds.new('World')
    world.color = hexrgb('#9fd3ff')
    scene.world = world
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 540, 720
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
