# 撲克牌桌(大老二、排七的背景),用 Blender Cycles 算出一張直式的高質感圖片
# 用法:blender -b -P tools/cardtable_scene.py -- <絕對路徑>/assets/cardtable.jpg(相對路徑會存到別的地方)
# 綠色絨布(有細細的纖維起伏)、外圈是深色木頭桌緣、中間一圈金線,上方一盞柔和的燈打出中間亮、四周暗的感覺。
import bpy, math, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'cardtable.jpg'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
W, H = 9.0, 16.0  # 直式(手機)


def hexrgb(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def mat_nodes(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes.get('Principled BSDF')


# ---- 絨布:兩種綠色用雜訊混在一起,加上細細的凹凸 ----
felt, nt, p = mat_nodes('Felt')
noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 140; noise.inputs['Detail'].default_value = 8
big = nt.nodes.new('ShaderNodeTexNoise'); big.inputs['Scale'].default_value = 3; big.inputs['Detail'].default_value = 2
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (*hexrgb('#0d4a2c'), 1)
ramp.color_ramp.elements[1].color = (*hexrgb('#17663d'), 1)
mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'ADD'
nt.links.new(noise.outputs['Fac'], mix.inputs[0]); nt.links.new(big.outputs['Fac'], mix.inputs[1])
mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 0.5
nt.links.new(mix.outputs[0], mul.inputs[0]); nt.links.new(mul.outputs[0], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
p.inputs['Roughness'].default_value = 0.95
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
nt.links.new(noise.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])

# ---- 木頭桌緣:波紋紋理做木紋 ----
wood, nt, p = mat_nodes('Wood')
wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 2.2; wave.inputs['Distortion'].default_value = 2.2; wave.inputs['Detail'].default_value = 4; wave.inputs['Detail Scale'].default_value = 2
wr = nt.nodes.new('ShaderNodeValToRGB')
wr.color_ramp.elements[0].color = (*hexrgb('#2a140a'), 1)
wr.color_ramp.elements[1].color = (*hexrgb('#6b3a1c'), 1)
nt.links.new(wave.outputs['Fac'], wr.inputs['Fac']); nt.links.new(wr.outputs['Color'], p.inputs['Base Color'])
p.inputs['Roughness'].default_value = 0.32
p.inputs['Coat Weight'].default_value = 0.6

gold, nt, p = mat_nodes('Gold')
p.inputs['Base Color'].default_value = (*hexrgb('#e2b04a'), 1); p.inputs['Metallic'].default_value = 1; p.inputs['Roughness'].default_value = 0.25


def box(name, sx, sy, sz, loc, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        md = o.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = 6
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


RIM = 0.55
box('Felt', W - RIM * 2 + 0.2, H - RIM * 2 + 0.2, 0.1, (0, 0, -0.05), felt)
for (sx, sy, x, y) in ((W, RIM, 0, (H - RIM) / 2), (W, RIM, 0, -(H - RIM) / 2), (RIM, H, (W - RIM) / 2, 0), (RIM, H, -(W - RIM) / 2, 0)):
    box('Rim', sx, sy, 0.35, (x, y, 0.1), wood, bevel=0.12)
box('RimBase', W, H, 0.2, (0, 0, -0.12), wood)  # 桌緣底下墊一整塊木頭,四個角才不會露出黑色
# 金線(一圈細細的)
G = 0.04
for (sx, sy, x, y) in ((W - RIM * 2 - 0.5, G, 0, (H - RIM * 2 - 0.5) / 2), (W - RIM * 2 - 0.5, G, 0, -(H - RIM * 2 - 0.5) / 2), (G, H - RIM * 2 - 0.5, (W - RIM * 2 - 0.5) / 2, 0), (G, H - RIM * 2 - 0.5, -(W - RIM * 2 - 0.5) / 2, 0)):
    box('Gold', sx, sy, 0.012, (x, y, 0.006), gold)

# ---- 燈光、鏡頭 ----
bpy.ops.object.light_add(type='AREA', location=(0, 1.0, 9))
lamp = bpy.context.active_object
lamp.data.energy = 1800; lamp.data.size = 7; lamp.data.color = (1.0, 0.95, 0.86)
bpy.ops.object.light_add(type='AREA', location=(0, 0, 14))
fill = bpy.context.active_object
fill.data.energy = 500; fill.data.size = 20
world = bpy.data.worlds.new('World'); world.color = hexrgb('#2a1408'); scene.world = world
bpy.ops.object.camera_add(location=(0, 0, 30), rotation=(0, 0, 0))
cam = bpy.context.active_object
cam.data.type = 'ORTHO'; cam.data.ortho_scale = H
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
try:
    scene.cycles.use_denoising = True
except Exception:
    pass
scene.render.resolution_x, scene.render.resolution_y = 720, 1280
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 82
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('rendered', OUT)
