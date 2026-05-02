import struct
import json
import sys
import os

def inspect_glb(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File '{file_path}' not found.")
        return

    try:
        with open(file_path, 'rb') as f:
            # GLB Header
            magic = f.read(4)
            if magic != b'glTF':
                print(f"Error: '{file_path}' is not a valid GLB file (invalid magic).")
                return
            
            version = struct.unpack('<I', f.read(4))[0]
            length = struct.unpack('<I', f.read(4))[0]
            
            # Chunk 0: JSON
            chunk_length = struct.unpack('<I', f.read(4))[0]
            chunk_type = f.read(4)
            if chunk_type != b'JSON':
                print(f"Error: Chunk 0 is not JSON.")
                return
            
            json_data = f.read(chunk_length).decode('utf-8')
            doc = json.loads(json_data)

            print(f"\nGLB Inspection: {os.path.basename(file_path)}")
            print("=" * 40)
            print(f"Version: {version}")
            print(f"Total File Length: {length} bytes")
            print(f"Total Nodes: {len(doc.get('nodes', []))}")
            print(f"Total Meshes: {len(doc.get('meshes', []))}")
            
            print("\n--- MESH NAMES ---")
            meshes = doc.get('meshes', [])
            if not meshes:
                print("No meshes found.")
            for mesh in meshes:
                print(f"- {mesh.get('name', '<unnamed>')}")

            print("\n--- NODE NAMES ---")
            nodes = doc.get('nodes', [])
            if not nodes:
                print("No nodes found.")
            for node in nodes:
                print(f"- {node.get('name', '<unnamed>')}")

    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_glb.py <path_to_glb>")
        # Default to the main plant model if no arg provided and it exists
        default_path = 'manufacturing_unit/frontend/assets/models/plant.glb'
        if os.path.exists(default_path):
            print(f"Checking default: {default_path}")
            inspect_glb(default_path)
    else:
        inspect_glb(sys.argv[1])
