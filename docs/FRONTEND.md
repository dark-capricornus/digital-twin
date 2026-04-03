# Frontend & 3D Visualization

The frontend is a high-performance **Three.js** application designed for industrial monitoring. It prioritizes **Legibility**, **Responsiveness**, and **Visual Excellence**.

---

## 1. 3D Rendering Engine (`renderer.js`)

The renderer manages the 3D scene, which consists of a single loaded `plant.glb` model.

### Key Features
- **Orthographic Perspective**: Preferred for industrial "Map" views to maintain scale and dimensional accuracy.
- **Color Injection**: Meshes are dynamically re-colored based on their `Status.State` tag:
    - **Green**: Running
    - **Orange**: Warning/Idle
    - **Red**: Fault/Stopped
    - **Dark Gray**: Offline
- **Contextual Isolation (Ghosting)**: When a specific machine is selected, the renderer keeps the focus machine fully opaque and applies a semi-transparent "Ghost" material to all other machinery.

### Asset Aliasing (`manualMap`)
The renderer uses a `manualMap` to bridge naming mismatches between the GLB mesh names (Blender) and the SCADA tag IDs (PLC). If the mesh in Blender is named `tank_01` but the tag ID is `STORAGE_01`, the `manualMap` ensures the link is maintained.

---

## 2. UI Design System (`style.css`)

The UI follows modern **Industrial Design** principles:
- **Typography**: Strictly uses **Public Sans** (variable weight 400-900) for a clean, non-monospace aesthetic.
- **Glassmorphism**: Transparent, blurred sidebars (`backdrop-filter: blur(12px)`) provide depth while keeping the 3D scene visible in the background.
- **Color Palette**:
    - **Background**: `#0d1117` (Deep Midnight)
    - **Primary**: `#ec5b13` (Industrial Orange)
    - **Success**: `#22c55e` (Green)
    - **Warning**: `#f59e0b` (Amber)

---

### 3. State & Analytics Engine

### `stateManager.js`
Acts as the **Source of Truth**. It maintains a global `deviceStates` map. When a WebSocket message arrives, the `StateManager` performs a delta check to see if the value has actually changed before notifying the UI.

### `EnergyAnalytics.js`
A heavy-duty processing engine for telemetry. It performs:
- **Aggregation**: Sums kW/kWh across Zones and Plants.
- **OEE Derivation**: Calculates Availability, Performance, and Quality components based on throughput and scrap tags.
- **Virtual Accumulation**: If a PLC is missing a real `totalEnergy` tag, the engine performs a **Time-Integration** of the current `instantKW` load to estimate cumulative energy consumption.

---

## 4. User Interaction

### Context-Aware Framing
The `Renderer` features specialized focus modes:
- **`focusOnZone(zoneId)`**: Calculates the bounding box of all machines in a department and frames them perfectly with a generous margin.
- **`focusOnDevice(id)`**: Uses the **Golden Angle** (pre-calibrated vector `[700, 529, 932]`) to provide the most legible view of an asset and its floating data chip.

### Gemba Walk Mode
Triggered via the "Tour" icon in the bottom navigation. It executes a **Cinematic Path** through the factory floor (Duration: 7s per transition) with ultra-smooth damping for a high-end presentation feel.
    - **Path Duration**: 7 seconds (Majestic sweep)
    - **Easing**: Cubic In-Out (Silky smooth start/stop)
