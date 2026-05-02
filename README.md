# Digital Twin – Alloy Wheel Manufacturing (V1)
**Version**: V1 – Integrated Process Flow & 3D Visualization  
**Status**: Architecture Consolidated

## Overview
The Digital Twin V1 provides a high-fidelity, real-time 3D orchestration of an Alloy Wheel Manufacturing plant. It bridges industrial PLC data (OPC-UA/MQTT) with a modern web interface to visualize production flow, material tracking, and operational KPIs.

## Project Structure
The project is organized into a modular architecture:

### Core (manufacturing_unit/)
*   **frontend/**: 3D Dashboard assets. Served as static files by the middleware.
*   **middleware/**: The **Unified Bridge** (`bridge.py`). Central conduit for OPC-UA, MQTT, and WebSocket data.
*   **backend/**: PLC simulation and simulation logic.

### Documentation & Config (docs/)
*   **tags.json**: The **Single Source of Truth** for all factory tag metadata.
*   **API_CONTRACTS.md**: Technical specifications for data exchange.

## Execution Instructions

### 1. Prerequisites
*   Python 3.11+
*   Virtual environment: `.\env\Scripts\activate`
*   Dependencies: `pip install -r requirements.txt`

### 2. Start the PLC & OPC-UA Server
```powershell
python manufacturing_unit/backend/plc/engine.py
```

### 3. Start the Unified Bridge (Frontend & Data)
```powershell
python manufacturing_unit/middleware/bridge.py
```
*   **Access**: [http://localhost:8000](http://localhost:8000)

### 4. (Optional) Start the Data Gateway
```powershell
python manufacturing_unit/data_gateway/main.py
```

## Key Technical Details
*   **Unified Config**: All system components now reference `docs/tags.json` for tag indexing.
*   **Industrial Protocols**: Native support for OPC-UA, MQTT, and Sparkplug B.
*   **3D Scene**: Real-time synchronization between PLC states and Three.js mesh materials.

Note: This version (v1) has been migrated to v1.1.