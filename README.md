# Digital Twin: Alloy Wheel Manufacturing Plant (V1)

[![Industrial UI](https://img.shields.io/badge/UI-Premium_Industrial-blue.svg)](https://fonts.google.com/specimen/Public+Sans)
[![Three.js](https://img.shields.io/badge/3D-Three.js_v0.160-green.svg)](https://threejs.org/)
[![Python](https://img.shields.io/badge/Backend-Python_3.9+-yellow.svg)](https://www.python.org/)

A high-fidelity, real-time Digital Twin for an industrial manufacturing facility. This system integrates physical simulation, virtual PLC logic, and premium 3D visualization to provide absolute transparency into production metrics (WIP, KPI, OEE) and asset health.

## 🚀 Quick Start

### 1. Prerequisite Environment
- **Python 3.9+**
- **MQTT Broker** (e.g., Mosquitto) running on port 1883
- **Web Browser** (Chrome/Edge/Safari)

### 2. Installation
```bash
# 1. Setup Virtual Environment
python -m venv venv
call venv\Scripts\activate

# 2. Install Dependencies
pip install -r requirements.txt
```

### 3. Execution (4-Terminal Setup)
To run the full simulation and UI locally, open four terminals and run:

| Terminal | Responsibility | Command |
| :--- | :--- | :--- |
| **1. Simulation** | Material Flow & WIP | `cd manufacturing_unit/backend && python -m simulation.orchestrator` |
| **2. PLC Engine** | Tag Management | `cd manufacturing_unit/backend && python -m plc.engine` |
| **3. Bridge** | WebSocket Gateway | `cd manufacturing_unit/backend && python -m middleware.bridge` |
| **4. Frontend** | 3D UI | `cd manufacturing_unit/frontend && python -m http.server 8001` |

Open **[http://localhost:8001](http://localhost:8001)** in your browser.

---

## 🛠 Project Documentation

Explore the technical architecture and component guides:

- **[V1 Release Definition](docs/V1_DEFINITION.md)**: Formal scope, objectives, and verification status of V1.
- **[System Architecture](docs/ARCHITECTURE.md)**: Data flow, component roles, and sync strategy.
- **[Backend & Simulation](docs/BACKEND.md)**: Production chain rules, material transformation, and fault injection.
- **[Frontend & 3D visualization](docs/FRONTEND.md)**: Three.js rendering, interaction models, and CSS design system.
- **[API & Tag Contracts](docs/API_CONTRACTS.md)**: Ignition SCADA tag mapping and WebSocket message schema.

---

## 🏗 System Overview

The plant simulates a complete **Alloy Wheel Production Line** across 8 specialized zones:
1. **Smelting**: Raw material induction into high-temp melting furnaces.
2. **Die Casting**: Precision low-pressure casting of wheel forms.
3. **Heat Treating**: Multi-stage thermal processing for material strength.
4. **Machining**: High-precision CNC milling and turning.
5. **Finishing**: Chemical pre-treatment and electrostatic paint lines.
6. **QC (X-Ray)**: Integrated defect detection and automated scrap sorting.
7. **Shipping**: Final outbound logistics and batch dispatch.
8. **Logistics**: Raw material (Ingot) inventory and inventory buffers.

---

## 💎 Features & Capabilities

- **Industrial UI Excellence**: Leverages **Public Sans**, glassmorphism, and dark mode for a premium "Control Room" aesthetic.
- **Real-Time Telemetry**: Live updating KPIs with sub-second latency via Optimized WebSocket Bridge.
- **Energy Analytics Engine**: Intelligent derivation of energy-per-unit, OEE components, and plant-wide load balancing.
- **Gemba Walk Mode**: Automated cinematic camerawork for remote floor tours.
- **Fault Simulation**: Inject machine "Faults" and "E-Stops" via terminal to observe UI propagation and safety state management.

---

Developed as a state-of-the-art reference for **Advanced Agentic Coding** and **Digital Twin Implementation**.
