# 暗棋大對決的 3D 模型(Blender 腳本)
# 用法:blender -b -P tools/chess_scene.py -- assets/chess.glb [預覽圖.png]
# 會建好木頭棋盤(4 x 8 格,深淺木紋格子、刻線、銅角飾)和一顆圓角的棋子,匯出成 glb 給網頁的 three.js 用。
# 座標:棋盤中心在原點、X 是 4 欄、Y 是 8 列(一格 1 單位)、Z 朝上;棋子底部在 z=0、厚 0.2。
# 棋子正反面的字和花紋由網頁貼上去(PieceWood 是側邊的木頭)。
import bpy, bmesh, math, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'chess.glb'
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
    'frame': make_mat('BoardFrame', '#5a3418', rough=0.45),
    'wood': make_mat('BoardWood', '#ecca8e', rough=0.6),
    'wooddk': make_mat('BoardWoodDk', '#d8ae6c', rough=0.6),
    'ink': make_mat('Ink', '#5b3a1e', rough=0.8),
    'brass': make_mat('Brass', '#d9a441', rough=0.25, metal=0.85),
    'piece': make_mat('PieceWood', '#f1dcb2', rough=0.35),
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
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx, sy, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    return new_obj(name, bm, mat, parent, smooth=bool(bevel))


def disc(name, r, z0, z1, mat, parent, bevel=0.0, x=0.0, y=0.0, seg=48):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    if bevel:  # 只把上下兩圈邊緣磨圓
        rims = [e for e in bm.edges if all(abs(v.co.z - z0) < 1e-4 for v in e.verts) or all(abs(v.co.z - z1) < 1e-4 for v in e.verts)]
        rims = [e for e in rims if all(math.hypot(v.co.x - x, v.co.y - y) > r * 0.9 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=rims, offset=bevel, segments=5, profile=0.5, affect='EDGES', clamp_overlap=True)
    return new_obj(name, bm, mat, parent, smooth=True)


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    return e


# ---------------- 棋盤 ----------------
COLS, ROWS = 4, 8
board = empty('Board')
rbox('Frame', COLS + 0.9, ROWS + 0.9, -0.32, 0.0, MAT['frame'], board, bevel=0.14)
rbox('Inlay', COLS + 0.22, ROWS + 0.22, -0.05, 0.012, MAT['ink'], board, bevel=0.02, seg=2)  # 外框的深色細邊
rbox('Surface', COLS + 0.12, ROWS + 0.12, -0.05, 0.02, MAT['wood'], board)
for r in range(ROWS):
    for c in range(COLS):
        if (r + c) % 2:
            rbox('Tile', 0.97, 0.97, 0.0, 0.024, MAT['wooddk'], board, x=c - COLS / 2 + 0.5, y=ROWS / 2 - r - 0.5)
for c in range(COLS + 1):  # 刻線
    rbox('LineV', 0.035, ROWS, 0.0, 0.028, MAT['ink'], board, x=c - COLS / 2)
for r in range(ROWS + 1):
    rbox('LineH', COLS + 0.035, 0.035 if r not in (0, ROWS, ROWS // 2) else 0.06, 0.0, 0.028, MAT['ink'], board, y=r - ROWS / 2)
for sx in (-1, 1):  # 四個角的銅角飾
    for sy in (-1, 1):
        disc('Corner', 0.16, -0.02, 0.04, MAT['brass'], board, bevel=0.03, x=sx * (COLS / 2 + 0.28), y=sy * (ROWS / 2 + 0.28), seg=24)

# ---------------- 棋子 ----------------
piece = empty('Piece', (6, 0, 0))
disc('PieceBody', 0.43, 0.0, 0.22, MAT['piece'], piece, bevel=0.07)

# ---------------- 匯出 ----------------
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
print('exported', OUT)

if PREVIEW:
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = (3, -9, 9)
    cam.rotation_euler = (math.radians(45), 0, math.radians(18))
    cam.data.lens = 30
    scene.camera = cam
    world = bpy.data.worlds.new('World')
    world.color = hexrgb('#3a2a1e')
    scene.world = world
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 800, 640
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
