from pygltflib import GLTF2
gltf = GLTF2().load(r'd:\Digital Twin\manufacturing_unit\frontend\models\machine_layout.glb')
for n in gltf.nodes:
    if n.name and 'pack' in n.name.lower():
        print("Found:", n.name)
