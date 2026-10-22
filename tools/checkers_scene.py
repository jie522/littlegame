# 跳棋(中國跳棋)的 3D 模型(Blender 腳本)
# 用法:blender -b -P tools/checkers_scene.py -- assets/checkers.glb [預覽圖.png]
# 會建好六角形的木頭棋盤(深色外框、銅角飾、121 個凹洞)和一顆玻璃彈珠,匯出成 glb 給網頁的 three.js 用。
# 座標:棋盤中心在原點,洞的位置跟遊戲裡的 CHK.cells 一樣(x = r * 1.5、y = √3 * (q + r / 2)),Z 朝上;
# 匯出時 Y 軸會轉成 three.js 的 -Z,網頁會自己換算。彈珠的底部在 z=0、直徑 1.2,網頁會依玩家換顏色。
import bpy, bmesh, math, sys
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'checkers.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))  # sRGB → 線性


def make_mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*hexrgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*hexrgb(color), 1)
    return m


MAT = {
    'frame': make_mat('BoardFrame', '#5a3418', rough=0.4),
    'wood': make_mat('BoardWood', '#c58a4c', rough=0.55),
    'hole': make_mat('BoardHole', '#3a1e0a', rough=0.9),
    'ring': make_mat('HoleRing', '#e0b070', rough=0.35),
    'brass': make_mat('Brass', '#d9a441', rough=0.25, metal=0.85),
    'marble': make_mat('Marble', '#ffffff', rough=0.08),
}


def new_obj(name, bm, mat, parent=None, smooth=True):
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


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    return e


def prism(name, pts, z0, z1, mat, parent, bevel=0.0):
    """多邊形柱:pts 是 (x, y) 頂點"""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    ret = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [v for v in ret['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=3, profile=0.5, affect='EDGES', clamp_overlap=True)
    return new_obj(name, bm, mat, parent)


def cyl(name, r, z0, z1, mat, parent, x=0.0, y=0.0, seg=28, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=z1 - z0)
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    return new_obj(name, bm, mat, parent)


# ---------------- 棋盤 ----------------
# 洞的位置:跟遊戲裡一樣(立方座標六角星)
cells = []
for q in range(-8, 9):
    for r in range(-8, 9):
        s = -q - r
        t1 = q <= 4 and r <= 4 and s <= 4
        t2 = q >= -4 and r >= -4 and s >= -4
        if (t1 or t2) and abs(s) <= 8:
            cells.append((r * 1.5, math.sqrt(3) * (q + r / 2)))
assert len(cells) == 121, len(cells)

board = empty('Board')
R_OUT, R_IN = 14.4, 13.7
outer = [(math.cos(math.pi / 3 * k) * R_OUT, math.sin(math.pi / 3 * k) * R_OUT) for k in range(6)]
inner = [(math.cos(math.pi / 3 * k) * R_IN, math.sin(math.pi / 3 * k) * R_IN) for k in range(6)]
prism('Frame', outer, -0.7, 0.0, MAT['frame'], board, bevel=0.22)
prism('Surface', inner, -0.05, 0.12, MAT['wood'], board, bevel=0.06)
for k, (x, y) in enumerate(outer):  # 六個角的銅角飾
    cyl('Corner', 0.62, -0.2, 0.3, MAT['brass'], board, x=x * 0.985, y=y * 0.985, seg=24, r2=0.52)
# 洞:跟盤面齊平的深色圓,外面一圈凸起的木圈(圓環),看起來就像凹下去的洞
holes = bmesh.new()
for x, y in cells:
    bmesh.ops.create_cone(holes, cap_ends=True, segments=24, radius1=0.5, radius2=0.5, depth=0.08, matrix=Matrix.Translation((x, y, 0.09)))
new_obj('Holes', holes, MAT['hole'], board)
rings = bmesh.new()
SEG, TUBE = 20, 6
for x, y in cells:  # 圓環體(手動建):主半徑 0.58、管半徑 0.09
    base = len(rings.verts)
    vs = []
    for i in range(SEG):
        a = 2 * math.pi * i / SEG
        for j in range(TUBE):
            b = 2 * math.pi * j / TUBE
            rr = 0.58 + 0.09 * math.cos(b)
            vs.append(rings.verts.new((x + rr * math.cos(a), y + rr * math.sin(a), 0.12 + 0.09 * math.sin(b))))
    for i in range(SEG):
        for j in range(TUBE):
            rings.faces.new([vs[i * TUBE + j], vs[((i + 1) % SEG) * TUBE + j], vs[((i + 1) % SEG) * TUBE + (j + 1) % TUBE], vs[i * TUBE + (j + 1) % TUBE]])
bmesh.ops.recalc_face_normals(rings, faces=rings.faces)
new_obj('Rings', rings, MAT['ring'], board)

# ---------------- 玻璃彈珠 ----------------
marble = empty('Marble', (20, 0, 0))
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=36, v_segments=20, radius=0.6, matrix=Matrix.Translation((0, 0, 0.6)))
new_obj('MarbleBall', bm, MAT['marble'], marble)

# ---------------- 匯出 ----------------
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
print('exported', OUT)

if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = (0, -17, 24)
    cam.rotation_euler = (math.radians(35), 0, 0)
    cam.data.lens = 30
    scene.camera = cam
    world = bpy.data.worlds.new('World')
    world.color = hexrgb('#2a1c12')
    scene.world = world
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 800, 700
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
