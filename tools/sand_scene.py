# 沙漏倒倒樂的素材:用 Blender Cycles 算出背景和玻璃零件(透明 PNG),遊戲裡的沙子用 canvas 畫在它們中間
# 用法:blender -b -P tools/sand_scene.py -- <絕對路徑>/assets
#   sand_bg.jpg     直式背景:暖色木頭桌面,上面撒了一點沙,中間亮四周暗
#   sand_funnel.png 玻璃漏斗(上寬下窄),上緣和瓶頸有黃銅環
#   sand_jar.png    玻璃罐(正面),沙子會畫在它後面,所以玻璃要是半透明的
#   sand_lid.png    木頭軟木塞蓋子(杯子裝滿時蓋上)
import bpy, math, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    return sc


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*hexrgb(color), 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def glass(name, tint='#eaf6ff'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*hexrgb(tint), 1)
    p.inputs['Roughness'].default_value = 0.03
    p.inputs['IOR'].default_value = 1.45
    p.inputs['Transmission Weight'].default_value = 1.0
    return m


def world(strength=1.0, color='#fff4e6'):
    w = bpy.data.worlds.new('W')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*hexrgb(color), 1)
    bg.inputs['Strength'].default_value = strength


def area_light(loc, rot, size, energy, color='#ffffff'):
    bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
    l = bpy.context.object
    l.data.size = size
    l.data.energy = energy
    l.data.color = hexrgb(color)
    return l


def ortho_cam(loc, rot, scale):
    bpy.ops.object.camera_add(location=loc, rotation=rot)
    c = bpy.context.object
    c.data.type = 'ORTHO'
    c.data.ortho_scale = scale
    bpy.context.scene.camera = c
    return c


def render(path, w, h, transparent):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = transparent
    sc.cycles.film_transparent_glass = transparent
    sc.render.image_settings.file_format = 'PNG' if transparent else 'JPEG'
    if transparent:
        sc.render.image_settings.color_mode = 'RGBA'
    else:
        sc.render.image_settings.quality = 88
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def lathe(name, prof, segs=96):
    """把 (半徑, 高度) 的剖面繞 Z 軸轉一圈做成實心的旋轉體(玻璃要有厚度,所以剖面是一圈封閉的)"""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for (r, z) in prof:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:] + rings[:1]):
        for k in range(segs):
            k2 = (k + 1) % segs
            try:
                bm.faces.new((a[k], a[k2], b[k2], b[k]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for f in me.polygons:
        f.use_smooth = True
    return ob


def ring(name, r, minor, z, m):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=minor, location=(0, 0, z), major_segments=96, minor_segments=24)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


# ================= 1) 背景 =================
sc = reset()
world(0.25)
W, H = 9.0, 16.0
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
desk = bpy.context.object
desk.scale = (W * 1.3, H * 1.3, 1)
wood = bpy.data.materials.new('Wood')
wood.use_nodes = True
nt = wood.node_tree
p = nt.nodes.get('Principled BSDF')
tc = nt.nodes.new('ShaderNodeTexCoord')
mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 0.12, 1.0)
nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 7; wave.inputs['Distortion'].default_value = 9; wave.inputs['Detail'].default_value = 6
nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
noi = nt.nodes.new('ShaderNodeTexNoise'); noi.inputs['Scale'].default_value = 60; noi.inputs['Detail'].default_value = 6
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (*hexrgb('#9a6a40'), 1)
ramp.color_ramp.elements[1].color = (*hexrgb('#c98f5a'), 1)
mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'FLOAT'; mx.inputs['Factor'].default_value = 0.25
nt.links.new(wave.outputs['Fac'], mx.inputs['A']); nt.links.new(noi.outputs['Fac'], mx.inputs['B'])
nt.links.new(mx.outputs['Result'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
p.inputs['Roughness'].default_value = 0.55
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.15
nt.links.new(wave.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
desk.data.materials.append(wood)

# 撒在桌上的沙:一些扁扁的小沙堆(顏色不一)
import random
random.seed(7)
sand_cols = ['#f2c66d', '#ff8a7a', '#8fd3ff', '#9be38f', '#c9a2ff', '#ffd75e']
for i in range(18):
    x = random.uniform(-W / 2, W / 2)
    y = random.choice([random.uniform(-H / 2, -H / 2 + 2.2), random.uniform(H / 2 - 2.0, H / 2), random.uniform(-H / 2, H / 2)])
    if abs(x) < W * 0.32 and abs(y) < H * 0.36:
        continue  # 中間留給遊戲畫面
    r = random.uniform(0.12, 0.34)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, 0), segments=24, ring_count=12)
    o = bpy.context.object
    o.scale = (1, random.uniform(0.7, 1.3), 0.14)
    sm = bpy.data.materials.new('S%d' % i)
    sm.use_nodes = True
    sp = sm.node_tree.nodes.get('Principled BSDF')
    sp.inputs['Base Color'].default_value = (*hexrgb(random.choice(sand_cols)), 1)
    sp.inputs['Roughness'].default_value = 1.0
    sn = sm.node_tree.nodes.new('ShaderNodeTexNoise'); sn.inputs['Scale'].default_value = 400
    sb = sm.node_tree.nodes.new('ShaderNodeBump'); sb.inputs['Strength'].default_value = 0.6
    sm.node_tree.links.new(sn.outputs['Fac'], sb.inputs['Height']); sm.node_tree.links.new(sb.outputs['Normal'], sp.inputs['Normal'])
    o.data.materials.append(sm)
    bpy.ops.object.shade_smooth()

area_light((0, 0, 9), (0, 0, 0), 6, 900, '#fff1dc')
area_light((-6, 6, 5), (math.radians(-45), math.radians(-35), 0), 5, 250, '#ffd9a8')
ortho_cam((0, 0, 20), (0, 0, 0), H)
sc.cycles.samples = 64
render(os.path.join(OUT, 'sand_bg.jpg'), 720, 1280, False)

# ================= 2) 玻璃漏斗 =================
sc = reset()
world(1.0, '#ffffff')
brass = mat('Brass', '#d9a441', 0.25, 1.0)
gl = glass('Glass')
# 剖面:外壁往下收窄到瓶頸,內壁往回(厚度 0.06)
outer = [(2.6, 1.0), (2.5, 0.75), (1.6, 0.0), (0.55, -0.85), (0.32, -1.15), (0.32, -1.45)]
inner = [(r - 0.06, z) for (r, z) in reversed(outer)]
fun = lathe('Funnel', outer + inner)
fun.data.materials.append(gl)
ring('RimTop', 2.58, 0.09, 1.0, brass)
ring('RimNeck', 0.38, 0.08, -1.3, brass)
fun.rotation_euler = (math.radians(-12), 0, 0)  # 稍微往前傾,看得到上面的開口
for o in bpy.data.objects:
    if o.name.startswith('Rim'):
        o.rotation_euler = fun.rotation_euler
        z = o.location.z
        o.location = (0, -z * math.sin(math.radians(12)) * -1, z * math.cos(math.radians(12)))
area_light((0, -6, 4), (math.radians(60), 0, 0), 8, 600)
area_light((5, -3, 3), (math.radians(60), 0, math.radians(55)), 3, 300, '#ffe2b8')
area_light((-5, -3, 3), (math.radians(60), 0, math.radians(-55)), 3, 200, '#cfe6ff')
ortho_cam((0, -20, -0.15), (math.radians(90), 0, 0), 6.2)
render(os.path.join(OUT, 'sand_funnel.png'), 640, 340, True)

# ================= 3) 玻璃罐 =================
sc = reset()
world(1.0, '#ffffff')
gl = glass('Glass', '#f2fbff')
# 罐子:圓圓的底、直直的身體、上面有一圈稍微外翻的瓶口
outer = [(0.0, -1.62), (0.7, -1.6), (1.0, -1.45), (1.08, -1.1), (1.08, 1.25), (1.02, 1.4), (1.12, 1.52), (1.12, 1.62)]
inner = [(1.06, 1.62), (1.06, 1.53), (0.97, 1.42), (1.02, 1.25), (1.02, -1.08), (0.95, -1.4), (0.66, -1.53), (0.0, -1.55)]
jar = lathe('Jar', outer + inner)
jar.data.materials.append(gl)
area_light((0, -6, 2), (math.radians(75), 0, 0), 6, 400)
area_light((4, -4, 2), (math.radians(70), 0, math.radians(45)), 1.2, 260, '#ffffff')
area_light((-4, -4, 1), (math.radians(70), 0, math.radians(-45)), 2.0, 120, '#ffe6c4')
ortho_cam((0, -20, 0), (math.radians(90), 0, 0), 3.5)
render(os.path.join(OUT, 'sand_jar.png'), 264, 320, True)

# ================= 4) 軟木塞蓋子 =================
sc = reset()
world(0.8, '#ffffff')
cork = mat('Cork', '#b98552', 0.85)
nt = cork.node_tree
cp = nt.nodes.get('Principled BSDF')
cn = nt.nodes.new('ShaderNodeTexNoise'); cn.inputs['Scale'].default_value = 120; cn.inputs['Detail'].default_value = 4
cr = nt.nodes.new('ShaderNodeValToRGB')
cr.color_ramp.elements[0].color = (*hexrgb('#8d5e33'), 1); cr.color_ramp.elements[1].color = (*hexrgb('#d9a874'), 1)
nt.links.new(cn.outputs['Fac'], cr.inputs['Fac']); nt.links.new(cr.outputs['Color'], cp.inputs['Base Color'])
cb = nt.nodes.new('ShaderNodeBump'); cb.inputs['Strength'].default_value = 0.5
nt.links.new(cn.outputs['Fac'], cb.inputs['Height']); nt.links.new(cb.outputs['Normal'], cp.inputs['Normal'])
lid = lathe('Lid', [(0.0, 0.42), (1.12, 0.42), (1.2, 0.34), (1.2, 0.08), (1.06, 0.0), (1.0, -0.36), (0.0, -0.36)])
lid.data.materials.append(cork)
lid.rotation_euler = (math.radians(-14), 0, 0)
area_light((0, -5, 4), (math.radians(50), 0, 0), 5, 500)
area_light((4, -2, 2), (math.radians(60), 0, math.radians(60)), 2, 150, '#ffe0b0')
ortho_cam((0, -20, 0.05), (math.radians(90), 0, 0), 2.9)
render(os.path.join(OUT, 'sand_lid.png'), 264, 120, True)
print('done')
