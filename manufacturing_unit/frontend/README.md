# Digital Twin Frontend

## Overview
Three.js-based 3D visualization for the Digital Twin manufacturing unit. Consumes real-time device state via WebSocket and renders color-coded 3D models.

## Project Structure
```
frontend/
├── index.html          # Entry point
├── css/
│    └── style.css       # Styling
├── js/
│   ├── main.js         # Application entry
│   ├── renderer.js     # Three.js rendering engine
│   ├── websocketHandler.js # WebSocket handler (Decoupled)
│   └── stateManager.js # State management
└── assets/
    └── models/         # Place GLB models here
```

## Setup

### 1. Add Your 3D Model
Place your GLB model file at:
```
assets/models/plant.glb
```

**Critical:** Mesh names in the GLB file MUST exactly match Device IDs from the backend:
- `Furnace_01`
- `LPDC_01`
- `CNC_01`
- `Inspection_01`
- etc.

### 2. Start the Unified Industrial Server
The frontend and backend now run on a single unified port to simplify DevTunnel and mobile access.

```bash
# From d:\digital_twin\
python manufacturing_unit\backend\middleware\bridge.py
```

### 3. Open in Browser
Navigate to:
```
http://localhost:8000
```

## Data Flow

```
Backend WebSocket (ws://localhost:8000/ws)
  ↓
WebSocket Handler (websocket.js)
  ↓
State Manager (stateManager.js)
  ↓
Scene Manager (scene.js)
  ↓
Three.js Renderer
```

## Visual Rules (v1)

| Device State | Color | Hex Code |
|--------------|-------|----------|
| Running      | GREEN | #00ff00  |
| Stopped/Other| RED   | #ff0000  |
| Unknown      | GRAY  | #808080  |

## WebSocket Message Format

Expected incoming message structure:
```json
{
  "topic": "spBv1.0/Group/DDATA/Node/DeviceID",
  "type": "json",
  "payload": {
    "Status/State": "Running"
  }
}
```

The frontend extracts:
- **Device ID** from topic (5th segment)
- **State** from payload (`Status/State`, `State`, or `state`)

## Controls

- **Left Mouse**: Rotate camera
- **Right Mouse**: Pan camera
- **Scroll**: Zoom in/out

## Troubleshooting

### No model visible
- Ensure `assets/models/plant.glb` exists
- Check browser console for load errors
- Verify GLB file is valid

### Devices not changing color
- Check WebSocket connection status (top-left)
- Verify mesh names match device IDs exactly
- Check browser console for warnings

### WebSocket not connecting
- Ensure unified server is running: `python manufacturing_unit\backend\middleware\bridge.py`
- Verify Port 8000 is open and not blocked by another process.
- For remote access, ensure a single DevTunnel is pointing to Port 8000.

## Development

### Adding New Features
1. Keep changes in `frontend/` directory only
2. Do NOT modify backend, MQTT, or Sparkplug logic
3. Follow existing code structure

### Testing
1. Start backend services
2. Start frontend HTTP server
3. Open browser console for logs
4. Monitor connection status and device updates

## Dependencies

- **Three.js** (v0.160.0) - Loaded via CDN
- **GLTFLoader** - Three.js addon for GLB loading
- **OrbitControls** - Camera controls

No npm installation required - all dependencies loaded via CDN.
