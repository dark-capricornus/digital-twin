# Digital Twin – Alloy Wheel Manufacturing (V1)
## Technical Documentation & Architecture

### 1. Overview
V1 establishes the transition from isolated machine simulations to an integrated, material-driven production flow. It provides a real-time 3D "Control Room" experience with live telemetry, departmental analytics, and process-flow visualization.

### 2. System Architecture
The system follows a typical Industrial IoT (IIoT) stack:
- **Physical/Simulation Layer**: Virtual PLCs simulated via backend logic, exposing data over OPC UA.
- **Data Orchestration layer**: An OPC UA to WebSocket bridge (backend) that pushes live tag updates to the frontend.
- **Visualization Layer**: 3D Digital Twin built with Three.js/WebGL (frontend).
- **Analytics Layer**: Client-side derived Industrial KPIs (OEE, Scrap, Energy Intensity).

### 3. Key Components (Frontend)
- **`main.js`**: Application entry point, zone definitions, and global state management.
- **`renderer.js`**: 3D Scene management, GLB asset loading, post-processing (matte/ghosting), and dynamic labeling.
- **`uiUpdater.js`**: Reacts to WebSocket updates to refresh sidebar metrics and status chips.
- **`EnergyAnalytics.js`**: Aggregates raw tag data into departmental KPIs (Production, KW, Scrap Rate).
- **`websocketHandler.js`**: Manages the persistent connection and tag-to-machine mapping.

### 4. Process Flow & Production Logic
V1 implements a sequential production chain:
1. **Raw Materials**: Tracked via inventory-only telemetry.
2. **Smelting**: Aggregated production (Sum of Degasser 1 & 2 outputs).
3. **Die Casting**: LPDC machines (parallel production).
4. **Machining**: CNC stations (parallel production).
5. **Finishing**: Paint shop/Treating.
6. **Shipping**: Outbound inventory.

### 5. 3D Visualization Refinements
- **Galvanized Iron Textures**: Restored via DoubleSide rendering and metalness/roughness overrides in the rendering pipeline.
- **Dynamic Centering**: Icon chips use world-space bounding box union calculations to anchor perfectly on multi-mesh assets (like storage piles).
- **Machine States**: Prioritized PLC status tags (`Is Running`) over derived cycle states for high-fidelity reporting.

### 6. Known Constraints & V2 Roadmap
- **Manual Mapping**: Some meshes require mapping via `manualMap` in `renderer.js` due to non-standard naming in the source GLB.
- **Aggregation**: Complex serial/parallel logic is handled via the `PARALLEL_ZONES` and `SERIAL_ZONES` sets in `EnergyAnalytics.js`.
- **Roadmap**: V2 will introduce Predictive Maintenance (ML-based) and historical data playback.
