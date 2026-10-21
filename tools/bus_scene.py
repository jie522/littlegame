# 公車大塞車的 3D 模型(Blender 腳本)
# 用法:blender -b -P tools/bus_scene.py -- assets/bus.glb [預覽圖.png]
# 會建好兩種公車(4 人座短車 Bus4、6 人座長車 Bus6)、路燈、樹、矮樹叢、三角錐,匯出成 glb 給網頁的 three.js 用。
# 座標:公車的中心在原點、車頭朝 +X、車寬方向是 Y、Z 朝上;單位跟遊戲一樣(車寬 0.72)。
# 網頁會把 BusPaint / BusRoof 換成每台公車自己的顏色。
import bpy, bmesh, math, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'bus.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))  # sRGB → 線性


def make_mat(name, color, rough=0.6, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*hexrgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*hexrgb(emit), 1)
        p.inputs['Emission Strength'].default_value = 2.0
    m.diffuse_color = (*hexrgb(color), 1)
    return m


MAT = {
    'paint': make_mat('BusPaint', '#e53935', rough=0.35),
    'roof': make_mat('BusRoof', '#ef5350', rough=0.4),
    'dark': make_mat('BusDark', '#2b2f38', rough=0.7),
    'glass': make_mat('Glass', '#22344d', rough=0.12, metal=0.3),
    'white': make_mat('White', '#f5f6f8', rough=0.5),
    'light': make_mat('HeadLight', '#fff8d8', emit='#fff3b0'),
    'tail': make_mat('TailLight', '#ff4d4d', emit='#d01010'),
    'tire': make_mat('Tire', '#1b1d22', rough=0.9),
    'hub': make_mat('Hub', '#c9ced8', rough=0.3, metal=0.6),
    'steel': make_mat('Steel', '#8d96a6', rough=0.4, metal=0.5),
    'bark': make_mat('Bark', '#8a5a3b', rough=0.9),
    'leaf': make_mat('Leaf', '#5cbf5a', rough=0.8),
    'leaf2': make_mat('Leaf2', '#3fa34d', rough=0.8),
    'cone': make_mat('Cone', '#ff7a1a', rough=0.5),
}


def new_obj(name, bm, mat, parent=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if parent:
        ob.parent = parent
    return ob


def rbox(name, sx, sy, z0, z1, mat, parent, bevel=0.0, x=0.0, y=0.0, seg=3):
    """圓角的盒子:sx × sy 的底面、從 z0 到 z1"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx, sy, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    return new_obj(name, bm, mat, parent, smooth=bool(bevel))


def cyl(name, r, h, loc, mat, parent=None, seg=16, axis='Z', r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    if axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.radians(90), 3, 'X'))
    ob = new_obj(name, bm, mat, parent, smooth=True)
    ob.location = loc
    return ob


def ball(name, r, loc, mat, parent=None, scale=(1, 1, 1), sub=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    ob = new_obj(name, bm, mat, parent, smooth=True)
    ob.location = loc
    return ob


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    return e


# ---------------- 公車 ----------------
W = 0.72


def make_bus(name, L, loc):
    root = empty(name)
    hl, hw = L / 2, W / 2
    rbox('Skirt', L - 0.03, W - 0.03, 0.07, 0.2, MAT['dark'], root, bevel=0.05)
    rbox('Body', L, W, 0.15, 0.43, MAT['paint'], root, bevel=0.09)
    rbox('Stripe', L + 0.006, W + 0.006, 0.29, 0.33, MAT['white'], root, bevel=0.07, seg=2)
    rbox('Windows', L - 0.07, W - 0.05, 0.41, 0.57, MAT['glass'], root, bevel=0.05, seg=2)
    # 車窗之間的柱子(跟車身同色)
    n = 3 if L < 1.8 else 4
    for i in range(n + 1):
        x = -hl + 0.12 + (L - 0.42) * i / n
        rbox('Pillar', 0.05, W - 0.035, 0.41, 0.57, MAT['paint'], root, x=x)
    rbox('Pillar', 0.04, W - 0.035, 0.41, 0.57, MAT['paint'], root, x=hl - 0.2)  # 擋風玻璃前面的柱子
    rbox('Roof', L - 0.02, W - 0.02, 0.555, 0.65, MAT['roof'], root, bevel=0.06)
    # 車頭:大燈、保險桿;車尾:尾燈
    for s in (-1, 1):
        rbox('HeadLight', 0.03, 0.12, 0.2, 0.27, MAT['light'], root, bevel=0.012, seg=2, x=hl - 0.005, y=s * (hw - 0.14))
        rbox('TailLight', 0.03, 0.08, 0.22, 0.3, MAT['tail'], root, bevel=0.012, seg=2, x=-hl + 0.005, y=s * (hw - 0.12))
    rbox('Bumper', 0.07, W - 0.08, 0.08, 0.16, MAT['dark'], root, bevel=0.025, x=hl - 0.01)
    rbox('Bumper', 0.07, W - 0.08, 0.08, 0.16, MAT['dark'], root, bevel=0.025, x=-hl + 0.01)
    rbox('Sign', 0.03, W - 0.26, 0.475, 0.535, MAT['light'], root, bevel=0.01, seg=1, x=hl - 0.025)  # 車頭的路線牌
    # 輪子
    for x in (hl - 0.3, -hl + 0.3):
        for s in (-1, 1):
            cyl('Tire', 0.115, 0.11, (x, s * (hw - 0.06), 0.115), MAT['tire'], root, seg=18, axis='Y')
            cyl('Hub', 0.055, 0.115, (x, s * (hw - 0.055), 0.115), MAT['hub'], root, seg=12, axis='Y')
    root.location = loc
    return root


make_bus('Bus4', 1.45, (0, 0, 0))
make_bus('Bus6', 2.05, (0, 1.2, 0))

# ---------------- 路燈、樹、樹叢、三角錐 ----------------
lamp = empty('Lamp', (3, 0, 0))
cyl('Pole', 0.035, 1.25, (0, 0, 0.625), MAT['steel'], lamp, seg=10)
cyl('PoleBase', 0.07, 0.08, (0, 0, 0.04), MAT['steel'], lamp, seg=12)
rbox('Arm', 0.36, 0.05, 1.2, 1.25, MAT['steel'], lamp, x=0.16)
rbox('LampHead', 0.18, 0.1, 1.15, 1.22, MAT['steel'], lamp, bevel=0.02, x=0.3)
rbox('LampGlow', 0.14, 0.07, 1.14, 1.16, MAT['light'], lamp, x=0.3)

tree = empty('Tree', (4, 0, 0))
cyl('Trunk', 0.07, 0.5, (0, 0, 0.25), MAT['bark'], tree, seg=8, r2=0.05)
ball('Crown', 0.36, (0, 0, 0.7), MAT['leaf'], tree, scale=(1, 1, 0.9))
ball('Crown', 0.24, (0.16, 0.08, 0.98), MAT['leaf'], tree)
ball('Crown', 0.22, (-0.18, -0.06, 0.88), MAT['leaf2'], tree)

bush = empty('Bush', (5, 0, 0))
for (x, y, r, m) in ((0, 0, 0.2, 'leaf2'), (0.18, 0.05, 0.15, 'leaf'), (-0.16, -0.04, 0.14, 'leaf'), (0.02, 0.14, 0.13, 'leaf2')):
    ball('Leaves', r, (x, y, r * 0.75), MAT[m], bush, scale=(1, 1, 0.85), sub=1)

cone = empty('Cone', (6, 0, 0))
rbox('ConeBase', 0.2, 0.2, 0, 0.03, MAT['cone'], cone, bevel=0.01, seg=1)
cyl('ConeBody', 0.075, 0.3, (0, 0, 0.18), MAT['cone'], cone, seg=14, r2=0.015)
cyl('ConeBand', 0.056, 0.05, (0, 0, 0.2), MAT['white'], cone, seg=14, r2=0.045)

# ---------------- 乘客(Q 版小人,臉朝 -Y;網頁依材質名稱上色:衣服和帽子 = 乘客的顏色) ----------------
for k, (nm, col) in enumerate((('PShirt', '#e53935'), ('PCap', '#e53935'), ('PSkin', '#f5d0b0'), ('PHair', '#5a3a22'), ('PPants', '#3b5b8c'), ('PEye', '#1d2129'))):
    MAT[nm] = make_mat(nm, col, rough=0.6)
person = empty('Person', (7, 0, 0))
for s in (-1, 1):
    cyl('Leg', 0.042, 0.15, (s * 0.05, 0, 0.075), MAT['PPants'], person, seg=10)
    ball('Arm', 0.05, (s * 0.125, 0, 0.25), MAT['PShirt'], person, scale=(0.75, 0.75, 1.6), sub=2)
    ball('Eye', 0.018, (s * 0.042, -0.112, 0.49), MAT['PEye'], person, sub=1)
ball('Body', 0.12, (0, 0, 0.27), MAT['PShirt'], person, scale=(1, 0.82, 1.18), sub=3)
ball('Head', 0.125, (0, 0, 0.48), MAT['PSkin'], person, sub=3)
ball('Hair', 0.128, (0, 0.025, 0.495), MAT['PHair'], person, scale=(1.02, 1, 1), sub=3)
cap = ball('Cap', 0.132, (0, 0.005, 0.52), MAT['PCap'], person, scale=(1, 1, 0.78), sub=3)
bm = bmesh.new()
bm.from_mesh(cap.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.0], context='VERTS')  # 只留上半顆
bm.to_mesh(cap.data)
bm.free()
cyl('Brim', 0.075, 0.02, (0, -0.12, 0.525), MAT['PCap'], person, seg=16)

# ---------------- 匯出 ----------------
kw = dict(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
bpy.ops.export_scene.gltf(**kw)
print('exported', OUT)

# ---------------- 預覽圖(檢查用) ----------------
if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = (6.6, -1.1, 0.9)
    cam.rotation_euler = (math.radians(65), 0, math.radians(-20))
    cam.data.lens = 35
    scene.camera = cam
    world = bpy.data.worlds.new('World')
    world.color = hexrgb('#e8ecf3')
    scene.world = world
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 720, 540
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
