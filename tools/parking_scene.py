# 停車大師的 3D 模型(Blender 腳本)
# 用法:blender -b -P tools/parking_scene.py -- assets/parking.glb [預覽圖.png]
# 會建好四種車(轎車 Sedan、小車 Hatch、廂型車 Van、玩家的跑車 Sport),
# 還有 KUSO 道具:鴨子、香蕉皮、購物車、三角錐、柱子、樹、樹叢,匯出成 glb 給網頁的 three.js 用。
# 座標:車子的中心在原點、車頭朝 +X、車寬方向是 Y、Z 朝上;單位是公尺(車長 4.4、車寬 1.9)。
# 網頁會把 CarPaint 換成每台車自己的顏色,TailLight 在煞車/倒車時變亮。
import bpy, bmesh, math, sys
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'parking.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))  # sRGB → 線性


def make_mat(name, color, rough=0.6, metal=0.0, emit=None, strength=2.0):
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
        p.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = (*hexrgb(color), 1)
    return m


MAT = {
    'paint': make_mat('CarPaint', '#1e6fe0', rough=0.25, metal=0.15),
    'stripe': make_mat('Stripe', '#ffffff', rough=0.3),
    'glass': make_mat('Glass', '#1c2a3d', rough=0.08, metal=0.4),
    'dark': make_mat('Trim', '#23262d', rough=0.7),
    'chrome': make_mat('Chrome', '#d9dee6', rough=0.15, metal=0.9),
    'tire': make_mat('Tire', '#17191d', rough=0.95),
    'head': make_mat('HeadLight', '#fffbe6', emit='#fff4c2', strength=1.5),
    'tail': make_mat('TailLight', '#c81e1e', emit='#ff2a2a', strength=0.6),
    'plate': make_mat('Plate', '#f4f6f9', rough=0.5),
    'duck': make_mat('Duck', '#ffd23f', rough=0.6),
    'beak': make_mat('Beak', '#ff8a1a', rough=0.5),
    'eye': make_mat('Eye', '#15171c', rough=0.3),
    'banana': make_mat('Banana', '#ffe14d', rough=0.5),
    'bananatip': make_mat('BananaTip', '#5a4320', rough=0.7),
    'steel': make_mat('Steel', '#aeb6c2', rough=0.3, metal=0.8),
    'red': make_mat('CartRed', '#e53935', rough=0.5),
    'cone': make_mat('Cone', '#ff7a1a', rough=0.5),
    'white': make_mat('White', '#f5f6f8', rough=0.5),
    'concrete': make_mat('Concrete', '#b9bfc9', rough=0.9),
    'yellow': make_mat('Hazard', '#ffc61a', rough=0.6),
    'black': make_mat('HazardBlack', '#202228', rough=0.6),
    'bark': make_mat('Bark', '#8a5a3b', rough=0.9),
    'leaf': make_mat('Leaf', '#5cbf5a', rough=0.8),
    'leaf2': make_mat('Leaf2', '#3fa34d', rough=0.8),
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


def rbox(name, sx, sy, z0, z1, mat, parent, bevel=0.0, x=0.0, y=0.0, seg=3, taper=None):
    """圓角的盒子:sx × sy 的底面、從 z0 到 z1;taper=(上面 x 縮放, 上面 y 縮放, 上面 x 位移) 做出斜斜的車頂"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx, sy, z1 - z0), verts=bm.verts)
    if taper:
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x = v.co.x * taper[0] + taper[2]
                v.co.y *= taper[1]
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    return new_obj(name, bm, mat, parent, smooth=bool(bevel))


def cyl(name, r, h, loc, mat, parent=None, seg=16, axis='Z', r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    if axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
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


# ---------------- 車子 ----------------
W = 1.9


def wheels(root, L, r=0.34, inset=0.78):
    for x in (L / 2 - inset, -L / 2 + inset):
        for s in (-1, 1):
            cyl('Tire', r, 0.26, (x, s * (W / 2 - 0.14), r), MAT['tire'], root, seg=20, axis='Y')
            cyl('Rim', r * 0.58, 0.27, (x, s * (W / 2 - 0.135), r), MAT['chrome'], root, seg=14, axis='Y')


def lights(root, L, zh=0.66, zt=0.7):
    hl = L / 2
    for s in (-1, 1):
        rbox('HeadLight', 0.08, 0.36, zh - 0.07, zh + 0.07, MAT['head'], root, bevel=0.03, seg=2, x=hl - 0.03, y=s * 0.62)
        rbox('TailLight', 0.08, 0.38, zt - 0.06, zt + 0.07, MAT['tail'], root, bevel=0.03, seg=2, x=-hl + 0.03, y=s * 0.6)
    rbox('Plate', 0.03, 0.5, 0.42, 0.56, MAT['plate'], root, x=hl + 0.005)
    rbox('Plate', 0.03, 0.5, 0.48, 0.62, MAT['plate'], root, x=-hl - 0.005)
    rbox('Bumper', 0.16, W - 0.12, 0.22, 0.42, MAT['dark'], root, bevel=0.06, x=hl - 0.05)
    rbox('Bumper', 0.16, W - 0.12, 0.22, 0.42, MAT['dark'], root, bevel=0.06, x=-hl + 0.05)


def mirrors(root, x):
    for s in (-1, 1):
        rbox('Mirror', 0.14, 0.16, 0.98, 1.1, MAT['paint'], root, bevel=0.04, seg=2, x=x, y=s * (W / 2 + 0.04))


def sedan(name, loc):
    L = 4.4
    root = empty(name, loc)
    rbox('Body', L, W, 0.28, 0.92, MAT['paint'], root, bevel=0.2)
    rbox('Cabin', 2.3, W - 0.2, 0.86, 1.42, MAT['glass'], root, bevel=0.14, x=-0.25, taper=(0.72, 0.86, -0.08))
    rbox('Roof', 1.5, W - 0.5, 1.36, 1.46, MAT['paint'], root, bevel=0.05, seg=2, x=-0.33)
    rbox('Grille', 0.05, 0.9, 0.48, 0.66, MAT['dark'], root, bevel=0.02, seg=1, x=L / 2 + 0.005)
    mirrors(root, 0.62)
    lights(root, L)
    wheels(root, L)
    return root


def hatch(name, loc):
    L = 3.8
    root = empty(name, loc)
    rbox('Body', L, W, 0.28, 0.95, MAT['paint'], root, bevel=0.24)
    rbox('Cabin', 2.3, W - 0.2, 0.88, 1.55, MAT['glass'], root, bevel=0.18, x=-0.4, taper=(0.82, 0.86, -0.02))
    rbox('Roof', 1.7, W - 0.46, 1.48, 1.6, MAT['paint'], root, bevel=0.06, seg=2, x=-0.45)
    mirrors(root, 0.42)
    lights(root, L, 0.68, 0.78)
    wheels(root, L, r=0.32, inset=0.7)
    return root


def van(name, loc):
    L = 4.6
    root = empty(name, loc)
    rbox('Body', L, W, 0.3, 1.05, MAT['paint'], root, bevel=0.2)
    rbox('Cabin', 3.7, W - 0.12, 1.0, 1.95, MAT['paint'], root, bevel=0.2, x=-0.3, taper=(0.98, 0.95, -0.03))
    rbox('Windows', 3.5, W - 0.08, 1.25, 1.75, MAT['glass'], root, bevel=0.1, seg=2, x=-0.25)
    rbox('Wind', 0.5, W - 0.3, 1.05, 1.8, MAT['glass'], root, bevel=0.08, seg=2, x=1.55, taper=(0.4, 0.95, -0.15))
    rbox('Rack', 2.6, W - 0.5, 1.95, 2.02, MAT['chrome'], root, x=-0.4)
    mirrors(root, 1.35)
    lights(root, L, 0.75, 0.9)
    wheels(root, L, r=0.36, inset=0.85)
    return root


def sport(name, loc):
    L = 4.4
    root = empty(name, loc)
    rbox('Body', L, W, 0.24, 0.82, MAT['paint'], root, bevel=0.22)
    rbox('Cabin', 2.0, W - 0.3, 0.76, 1.24, MAT['glass'], root, bevel=0.16, x=-0.35, taper=(0.62, 0.82, -0.12))
    rbox('Roof', 1.1, W - 0.62, 1.18, 1.27, MAT['paint'], root, bevel=0.04, seg=2, x=-0.45)
    for s in (-1, 1):  # 引擎蓋到車尾的兩條賽車白線
        rbox('Stripe', L - 0.3, 0.16, 0.8, 0.84, MAT['stripe'], root, x=0.05, y=s * 0.17)
        rbox('Stripe', 1.1, 0.14, 1.27, 1.29, MAT['stripe'], root, x=-0.45, y=s * 0.17)
    rbox('Spoiler', 0.36, W - 0.1, 1.02, 1.08, MAT['dark'], root, bevel=0.02, seg=1, x=-L / 2 + 0.25)
    for s in (-1, 1):
        rbox('SpoilerLeg', 0.1, 0.08, 0.8, 1.04, MAT['dark'], root, x=-L / 2 + 0.25, y=s * 0.6)
    rbox('Grille', 0.05, 1.0, 0.36, 0.52, MAT['dark'], root, bevel=0.02, seg=1, x=L / 2 + 0.005)
    mirrors(root, 0.45)
    lights(root, L, 0.58, 0.64)
    wheels(root, L, r=0.35, inset=0.8)
    return root


sedan('Sedan', (0, 0, 0))
hatch('Hatch', (0, 3, 0))
van('Van', (0, 6, 0))
sport('Sport', (0, 9, 0))

# ---------------- KUSO 道具 ----------------
duck = empty('Duck', (8, 0, 0))  # 鴨子(頭朝 +X)
ball('DuckBody', 0.22, (0, 0, 0.2), MAT['duck'], duck, scale=(1.25, 0.95, 0.85), sub=3)
ball('DuckTail', 0.08, (-0.26, 0, 0.3), MAT['duck'], duck, scale=(1.2, 0.8, 0.8))
ball('DuckHead', 0.13, (0.2, 0, 0.42), MAT['duck'], duck, sub=3)
ball('Beak', 0.07, (0.33, 0, 0.4), MAT['beak'], duck, scale=(1.4, 1, 0.45))
for s in (-1, 1):
    ball('DuckEye', 0.022, (0.29, s * 0.07, 0.46), MAT['eye'], duck, sub=1)
    ball('Wing', 0.12, (-0.02, s * 0.19, 0.24), MAT['duck'], duck, scale=(1.3, 0.35, 0.7))
    cyl('Foot', 0.05, 0.03, (0.05, s * 0.08, 0.015), MAT['beak'], duck, seg=8)

banana = empty('Banana', (8, 2, 0))  # 香蕉皮:彎彎的果皮攤在地上
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.07, radius2=0.07, depth=0.5)
bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
for v in bm.verts:  # 彎成弧形
    v.co.y += (v.co.x ** 2) * 1.1
    v.co.z *= 0.6
new_obj('Peel', bm, MAT['banana'], banana, smooth=True).location = (0, 0, 0.05)
for a in (0.5, 2.2, 3.9):  # 攤開的三片皮
    p = ball('PeelFlap', 0.16, (math.cos(a) * 0.22 + 0.25, math.sin(a) * 0.22 + 0.07, 0.03), MAT['banana'], banana, scale=(1.4, 0.45, 0.18))
    p.rotation_euler = (0, 0, a)
ball('Stem', 0.035, (-0.27, 0.08, 0.06), MAT['bananatip'], banana)

cart = empty('Cart', (8, 4, 0))  # 購物車(推手朝 -X)
rbox('Basket', 0.95, 0.6, 0.45, 0.95, MAT['steel'], cart, bevel=0.03, seg=1, taper=(1.12, 1.08, 0.04))
rbox('BasketIn', 0.88, 0.52, 0.52, 0.97, MAT['dark'], cart, taper=(1.12, 1.08, 0.04))
rbox('Handle', 0.06, 0.62, 0.98, 1.04, MAT['red'], cart, x=-0.55)
for x, y in ((0.35, 0.25), (0.35, -0.25), (-0.35, 0.25), (-0.35, -0.25)):
    rbox('CartLeg', 0.04, 0.04, 0.1, 0.46, MAT['steel'], cart, x=x, y=y)
    cyl('CartWheel', 0.07, 0.05, (x, y, 0.07), MAT['dark'], cart, seg=10, axis='Y')

cone = empty('Cone', (8, 6, 0))
rbox('ConeBase', 0.5, 0.5, 0, 0.06, MAT['cone'], cone, bevel=0.02, seg=1)
cyl('ConeBody', 0.19, 0.72, (0, 0, 0.42), MAT['cone'], cone, seg=16, r2=0.035)
cyl('ConeBand', 0.135, 0.12, (0, 0, 0.46), MAT['white'], cone, seg=16, r2=0.11)

pillar = empty('Pillar', (8, 8, 0))  # 地下停車場的柱子(底下黃黑斜紋)
rbox('PillarBody', 0.8, 0.8, 0, 3.2, MAT['concrete'], pillar, bevel=0.04, seg=1)
for i in range(4):
    rbox('HazardBand', 0.84, 0.84, 0.1 + i * 0.2, 0.2 + i * 0.2, MAT['yellow' if i % 2 == 0 else 'black'], pillar)

tree = empty('Tree', (10, 0, 0))
cyl('Trunk', 0.16, 1.2, (0, 0, 0.6), MAT['bark'], tree, seg=8, r2=0.12)
ball('Crown', 0.9, (0, 0, 1.75), MAT['leaf'], tree, scale=(1, 1, 0.9))
ball('Crown', 0.6, (0.4, 0.2, 2.45), MAT['leaf'], tree)
ball('Crown', 0.55, (-0.45, -0.15, 2.2), MAT['leaf2'], tree)

bush = empty('Bush', (10, 3, 0))
for (x, y, r, m) in ((0, 0, 0.5, 'leaf2'), (0.45, 0.12, 0.38, 'leaf'), (-0.4, -0.1, 0.35, 'leaf'), (0.05, 0.35, 0.33, 'leaf2')):
    ball('Leaves', r, (x, y, r * 0.75), MAT[m], bush, scale=(1, 1, 0.85), sub=1)

# ---------------- 匯出 ----------------
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
print('exported', OUT)

# ---------------- 預覽圖(檢查用) ----------------
if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = (14, -9, 9)
    cam.rotation_euler = (math.radians(58), 0, math.radians(48))
    cam.data.lens = 30
    scene.camera = cam
    world = bpy.data.worlds.new('World')
    world.color = hexrgb('#e8ecf3')
    scene.world = world
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 640
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
