# Digital Twin – Alloy Wheel Manufacturing (V1)
**Version**: V1 – Integrated Process Flow & 3D Visualization  
**Status**: Completed, Verified.

## Overview
V1 represents the first complete "Live Factory" release of the Digital Twin. While V0 validated independent machine actors, **V1** establishes the synchronous, material-driven production chain and high-fidelity 3D user experience required for industrial operations.

The purpose of V1 is to:
*   **Orchestrate Material Flow**: Connect independent machines into a logical, sequential production line.
*   **Visualize the Factory Floor**: Provide a real-time, spatial 3D view of the entire plant state.
*   **Standardize Analytics**: Transition from raw tag values to derived industrial KPIs (OEE, Scrap, Energy Intensity).
*   **Implement UI/UX Excellence**: Deliver a premium "Control Room" aesthetic using modern web technologies.

## Objectives of V1
* **Implement Production Chain Logic**: Establish dependencies where machine "A" provides the material for machine "B."
* **Establish Real-Time WIP Tracking**: Monitor "Work-In-Process" levels at 13 distinct transition stages.
* **Integrate 3D GPU Rendering**: Launch a Three.js-based visualization engine for spatial monitoring.
* **Create a High-Fidelity Design System**: Use Public Sans typography, glassmorphism, and dark-mode visuals.
* **Optimize Data Transport**: Use a "Bridge Middleware" to multiplex PLC tags into an efficient WebSocket delta stream.

## Machines Included
V1 simulates a complete 21-machine facility across 8 operational zones:
1.  **Smelting**: Furnace_01, Degasser_01, Degasser_02
2.  **Die Casting**: LPDC_01, LPDC_02, LPDC_03, Cooling_01
3.  **Heat Treating**: Heat_01, Heat_02, Cooling_02
4.  **Machining**: CNC_01, CNC_02
5.  **Finishing**: Pretreat_01, Paint_01, Paint_02
6.  **X-Ray / QC**: Inspection_01
7.  **Shipping**: Outbound_01
8.  **Logistics**: RawMaterials (Ingot Storage)

## Core Features
### 1. Material Flow Orchestration
* **Buffer Persistence**: Material "piles up" in upstream buffers if a downstream machine stops.
* **Stop/Start Propagation**: Simulation pauses material transformation correctly during E-Stops.

### 2. High-Performance 3D UI
* **Contextual Focus**: "Ghosting" shader effects to isolate specific zones or assets.
* **Floating Data Chips**: Real-time status labels anchored in 3D space above physical machinery.
* **Gemba Walk Mode**: Cinematic, automated camera paths for remote factory tours.

### 3. Integrated Analytics Engine
* **OEE Derivations**: Real-time calculation of Availability, Performance, and Quality components.
* **Energy Monitoring**: Active tracking of Instant kW and Integrated kWh across all departments.
* **Scrap Analytics**: Real-time visibility into Pass/Fail ratios from the X-Ray stage.

### 4. Advanced Interaction Model
* **Dual Sidebars**: Left sidebar for plant hierarchy; Right sidebar for deep-dive asset metadata.
* **Fault Propagation**: UI reflects errors from the PLC (Red Meshes + Warning Icons) instantly.

## Progress & Flow Logic
In V1, machine progress is no longer just a local timer. It is constrained by **Material Availability**:
1. **Smelting Ingestion**: Ingots are consumed from `RAWMATERIALS` by mass (kg).
2. **Sequential Flow**: A part cannot enter `CNC_01` unless it has cleared the `COOLING_02` stage.
3. **Throughput Scaling**: Global plant throughput (`parts/hr`) is derived from the final `SHIPPING` exit rate.

## Verification Status
V1 has been verified and signed off through:
* **UI Stress Testing**: Confirmed 60fps rendering during peak WebSocket traffic.
* **Logic Integration**: Validated 1:1 mapping between `orchestrator.py` flow and `main.js` UI indices.
* **Integrity Audit**: Standardized ID aliasing (`PB1`, `PB2`, `PT`) across the entire stack.
* **Visual Verification**: Confirmed "Public Sans" typography and consistent color coding across all department views.

## Explicit Limitations of V1
V1 does NOT include:
* **Historical Trend Charts**: Persistence of time-series data (Coming in V2).
* **Predictive Maintenance**: ML-driven failure prediction models (Coming in V2).
* **Control Loop Back-Feed**: Changing machine setpoints directly from the UI (Currently Read-Only + Start/Stop).
* **Multi-Plant Aggregation**: Dashboard only supports a single facility.

## Design Philosophy
* **Legibility Above All**: High-resolution text and unit formatting for industrial environments.
* **Spatial Truth**: The 3D model is the primary navigation interface, not an afterthought.
* **Zero Lag UI**: Throttled DOM updates and delta-based WebSockets for fluid performance.

## Version Status
V1 is now: **Stable Reference Release**  
Ongoing work focus: Documentation, maintenance, and preparation for **Phase 2 (Analytics+)**.

## Next Phase (V2)
Development proceeds to V2, which will introduce:
* **Time-Series Persistence**: Local DB for historical OEE trending.
* **Maintenance Scheduler**: Integration of runtime-hours based maintenance triggers.
* **Multi-User Sync**: Shared camera sessions for collaborative Gemba walks.
