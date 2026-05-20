# 🎨 Digital Twin — Design & Architecture Specifications

## 1. Overview
The **Digital Twin Manufacturing Platform** is a high-fidelity, real-time industrial visualization and data orchestration system. It bridges the gap between hardware (PLC/OPC-UA) and human-centric dashboards through a modular, scalable architecture.

---

## 2. Design System

### **Visual Aesthetic**
The platform has transitioned to a **"Minimalist Data-Only"** aesthetic (The Analytic Monolith). This style prioritizes raw telemetry density and optical clarity over decorative depth. All glassmorphism, blur effects, and soft shadows have been removed to ensure a clean, high-precision industrial instrument feel.

#### **Minimalist Color Palette**
| Category | Token | Hex/RGBA | Usage |
| :--- | :--- | :--- | :--- |
| **Data Primary**| `Telemetry Cyan`    | `#00D1FF` | Critical data highlights and active sensor paths. |
| **Background**  | `Deep Charcoal`     | `#0A0A0A` | Base matte background (The Void). |
| **Surface**     | `Solid Slate`       | `#1C1C1C` | High-density data panels and active sidebars. |
| **Status**      | `Nominal Green`     | `#00E676` | Running state and healthy signals. |
| **Status**      | `Advisory Amber`    | `#FFC400` | Transitions and warning states. |
| **Divider**     | `Hairline Edge`     | `#333333` | 1px tonal shifts for section boundaries. |

#### **High-Density Typography**
- **Full Interface**: [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — A monospaced typeface used across 100% of the UI (Headings, Body, and Readouts) to provide a consistent "data-stream" aesthetic and fixed character widths for telemetry stability.

---

## 3. Technology Stack

### **Backend (Data & Middleware)**
- **Language**: Python 3.11+ (Asynchronous)
- **Web/API**: [FastAPI](https://fastapi.tiangolo.com/)
- **Industrial Protocols**: [AsyncUA](https://github.com/FreeOpcUa/opcua-asyncio) (OPC-UA), [Paho MQTT](https://eclipse.org/paho/) (MQTT 3.1.1/Sparkplug B)
- **Data Logic**: Modular source/sink adapters with SOLID interface compliance.

### **Frontend (Visualization)**
- **Engine**: [Three.js](https://threejs.org/) (GLTFLoader, CSS2DRenderer)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) (Strict gridded layout)
- **Communication**: native WebSockets (JSON and Sparkplug B Binary formats)
- **State Management**: Domain-driven `StateManager` for high-frequency telemetry updates.

---

## 4. Architecture & Data Flow

### **The Layered Model**
1.  **Industrial Layer (Hardware)**: PLC / VirtualPLC acting as OPC-UA servers.
2.  **Data Gateway (Transport)**: Polling OPC-UA → Map Tag to Channel → Publish to MQTT.
3.  **Bridge Middleware (Orchestrator)**: Subscribe to MQTT → Decode Sparkplug → Broadcast over WebSocket.
4.  **Frontend (Presentation)**: WebSocket → State Buffer → Renderer Update → HUD Refresh.

### **SOLID Compliance Goals (V1.1)**
- **SRP**: Each module (Source, Sink, App) has exactly one reason to change.
- **DIP**: High-level logic depends on abstract `ISource`/`ISink` interfaces, not concrete drivers.
- **Encapsulation**: State is managed within class-based controllers (`BridgeApp`, `DigitalTwinApp`).

---

## 5. UI Components
- **Telemetry Monolith**: Side-mounted data sheets with vertical sensor feeds.
- **Technical HUD**: A header-free, minimal navigation strip based on breadcrumb paths.
- **Vector POI**: 2D vector circles replacing the 3D-styled POI chips for a flatter, mapping-oriented look.
- **System Diagnostics Overlay**: Full-screen monochrome JSON-style tree for real-time node auditing.

---
*Document Version: 1.2.0 (Analytic Monolith update)*
