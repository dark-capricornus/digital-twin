# Digital Twin – Alloy Wheel Manufacturing (V1.1)
**Version**: V1.1 – Integrated Process Flow & 3D Visualization  
**Status**: Production Consolidated

## Overview
The Digital Twin V1.1 provides a high-fidelity, real-time 3D orchestration of an Alloy Wheel Manufacturing plant. It bridges industrial PLC data (OPC-UA/MQTT) with a modern web interface to visualize production flow, material tracking, and operational KPIs.

## Project Structure
The project is organized into a modular architecture for better maintainability and scalability:

### Core (manufacturing_unit/)
*   **frontend/**: 3D Dashboard (HTML/JS/Vanilla CSS). Served as static assets.
    *   `assets.json`: Machine maintenance metadata.
*   **middleware/**: The **Unified Bridge** (`bridge.py`). Handles WebSocket communication, OPC-UA polling, and MQTT broadcasting.
*   **backend/**: PLC logic and factory simulation services.
*   **data_gateway/**: Protocol adapters (Sparkplug B / JSON).

### Documentation & Config (docs/)
*   **tags.json**: The **Single Source of Truth** for the entire factory tag hierarchy.
*   **API_CONTRACTS.md**: Technical specifications for PLC data exchange.

## Execution Instructions

### 1. Prerequisites
*   Python 3.11+
*   Virtual environment initialized: `.\env\Scripts\activate`
*   Dependencies installed: `pip install -r requirements.txt`

### 2. Start the PLC Simulation & OPC-UA Server
This command initializes the virtual factory logic and the OPC-UA server:
```powershell
python manufacturing_unit/backend/plc/engine.py
```

### 3. Start the Unified Bridge
The Bridge connects the PLC data to the 3D Dashboard and serves the web interface:
```powershell
python manufacturing_unit/middleware/bridge.py
```
*   **Access the Twin**: [http://localhost:8000](http://localhost:8000)

### 4. Start the Data Gateway
If you need to bridge data to MQTT or external databases:
```powershell
python manufacturing_unit/data_gateway/main.py
```

## What's New in V1.1
*   **Enhanced Asset Rendering**: Resolved visual ghosting issues for animated assets (forklifts, cargo, ladles) during machine selection.
*   **Unified Middleware**: The Bridge (`bridge.py`) now acts as a centralized server for both WebSocket data and static frontend assets.
*   **Optimized Performance**: Improved GLB loading and state synchronization for smoother 3D navigation.

## Key Technical Details
*   **Industrial Protocols**: Supports OPC-UA (polling), MQTT (pub/sub), and Sparkplug B decoding.
*   **3D Engine**: Built on Three.js with custom GLB mesh highlighting and dynamic labeling.

---
**Note**: This version (v1.1) is now fully merged with the main production branch.