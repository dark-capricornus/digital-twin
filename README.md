<<<<<<< HEAD
# Digital Twin – Alloy Wheel Manufacturing (V2)
**Version**: V2 – Integrated Process Flow & 3D Visualization  
**Status**: Completed, Verified.

## Overview
V2 represents the first complete "Live Factory" release of the Digital Twin. While V0 validated independent machine actors, **V2** establishes the synchronous, material-driven production chain and high-fidelity 3D user experience required for industrial operations.

The purpose of V2 is to:
*   **Orchestrate Material Flow**: Connect independent machines into a logical, sequential production line.
*   **Visualize the Factory Floor**: Provide a real-time, spatial 3D view of the entire plant state.
*   **Standardize Analytics**: Transition from raw tag values to derived industrial KPIs (OEE, Scrap, Energy Intensity).
*   **Implement UI/UX Excellence**: Deliver a premium "Control Room" aesthetic using modern web technologies.

## Objectives of V2
* **Implement Production Chain Logic**: Establish dependencies where machine "A" provides the material for machine "B".
* **3D Scene Integration**: Finalize the layout of the manufacturing unit with correct asset scaling and positioning.
* **KPI Normalization**: Ensure metrics like production counts, cycle times, and scrap rates are standardized across all departments.
* **Unified Interface**: Deliver a sidebar-driven navigation system that allows drilling down into specific zones or machines.

## Key Features in V2
* **Aggregated Smelting Production**: Summation of output from multiple degasser machines.
* **Inventory Tracking**: Live telemetry mapping for Raw Materials and Shipping/Outbound zones.
- **Premium Visuals**: High-fidelity industrial textures (galvanized iron effect) and dynamic labeling.
- **Improved State Management**: Machine states are synchronized with PLC status tags for ground-truth accuracy.
=======
# Digital Twin – Alloy Wheel Manufacturing (V1)
**Version**: V1 – Integrated Process Flow & 3D Visualization  
**Status**: Production Consolidated

## 🏭 Overview
The Digital Twin V1 provides a high-fidelity, real-time 3D orchestration of an Alloy Wheel Manufacturing plant. It bridges industrial PLC data (OPC-UA/MQTT) with a modern web interface to visualize production flow, material tracking, and operational KPIs.

## 📂 Project Structure
The project is organized into a modular architecture for better maintainability and scalability:

### 🏛️ Core (manufacturing_unit/)
*   **frontend/**: 3D Dashboard (HTML/JS/Vanilla CSS). Served as static assets.
    *   `assets.json`: Machine maintenance metadata.
*   **middleware/**: The **Unified Bridge** (`bridge.py`). Handles WebSocket communication, OPC-UA polling, and MQTT broadcasting.
*   **backend/**: PLC logic and factory simulation services.
*   **data_gateway/**: Protocol adapters (Sparkplug B / JSON).

### 📖 Documentation & Config (docs/)
*   **tags.json**: The **Single Source of Truth** for the entire factory tag hierarchy.
*   **API_CONTRACTS.md**: Technical specifications for PLC data exchange.

### 🛠️ Utilities (Root)
*   `generate_tag_report_pdf.py`: Generates a comprehensive technical data sheet of the factory tags.
*   `inspect_glb.py`: Tool for auditing mesh names and collections in the 3D plant model.
*   `browse_opc.py`: Debug utility for exploring live OPC-UA node trees.

## 🚀 Execution Instructions

### 1. Prerequisites
*   Python 3.11+
*   Virtual environment initialized: `.\env\Scripts\activate`
*   Dependencies installed: `pip install -r requirements.txt`

### 2. Start the Unified Bridge
The Bridge serves both the real-time data stream and the frontend interface:
```powershell
python manufacturing_unit/middleware/bridge.py
```
*   **Unified URL**: [http://localhost:8000](http://localhost:8000)

### 3. Generate Technical Documentation
To update the factory tag report based on the latest `docs/tags.json`:
```powershell
python generate_tag_report_pdf.py
```
The report will be generated as `tag_report.pdf`.

## 🛠️ Key Technical Details
*   **Master Config**: The system uses `docs/tags.json` as the unified source for both the 3D renderer and the middleware cache.
*   **Industrial Protocols**: Supports OPC-UA (polling), MQTT (pub/sub), and Sparkplug B decoding.
*   **3D Engine**: Built on Three.js with custom GLB mesh highlighting and dynamic labeling.
>>>>>>> f109be2 (Updated README.md)
