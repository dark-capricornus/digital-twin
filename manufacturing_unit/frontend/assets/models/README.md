# 3D Models Directory

Place your GLB model file here:
- **Filename:** `plant.glb`
- **Format:** GLB (binary glTF)

## Critical Requirements

### Mesh Naming
Mesh names in the GLB file MUST exactly match Device IDs from the backend.

Example device IDs:
- `Furnace_01`
- `LPDC_01`
- `CNC_01`
- `Degasser_01`
- `Buffer_01`
- `Inspection_01`

### Export Settings
When exporting from Blender/3DS Max/Maya:
1. Use GLB format (not glTF + bin)
2. Ensure mesh names are preserved
3. Include materials (will be overridden by state colors)
4. Recommended: Use meters as units
5. Center the model at origin (0, 0, 0)

### Testing
After placing your model:
1. Open browser console
2. Look for: `[Scene] Registered mesh: <name>`
3. Verify all expected device meshes are listed

If a mesh is missing, the device will show a warning:
```
[Scene] Mesh not found for device: DeviceID
```
