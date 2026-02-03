# Digital Twin – Alloy Wheel Manufacturing

This repository contains the development of a **Digital Twin for an Alloy Wheel Manufacturing Plant**, designed to simulate machine behavior, production flow, and PLC/SCADA integration in a structured, versioned manner.

The project follows a **progressive versioning approach**, where each version builds on a verified and archived baseline.

---

## Project Overview

The Digital Twin models the end-to-end alloy wheel manufacturing process, including:

- Furnace melting
- LPDC casting
- CNC machining
- Buffer and intermediate stages
- Time-based progress simulation
- PLC engine and OPC UA integration
- SCADA visualization (Ignition)
- Normalized backend APIs for frontend and analytics

The long-term goal is to evolve from a **logic-verified simulation core** into a **production-grade digital twin** with analytics and visualization.

---

## Project Versions

### V0 – Baseline Simulation Prototype (Archived)

**Status:** Completed & Verified  
**Purpose:** Establish a stable and correct simulation foundation

V0 represents the **initial working prototype** of the Digital Twin.  
It focuses on **machine-level simulation correctness** and PLC/SCADA integration stability.

#### Key Characteristics of V0
- Individual machine simulations:
  - Furnace
  - LPDC
  - CNC
  - Buffer
- Time-based progress calculation per machine
- PLC engine with RUNNING / IDLE states
- OPC UA exposure for SCADA (Ignition)
- SCADA dashboards displaying live machine values
- No material-flow dependency between machines
- No batch or plant-level orchestration logic

#### Verification Status
V0 has been **formally verified** through:
- Code inspection of simulation and PLC engine
- Runtime instrumentation and log analysis
- Validation of machine progress with different cycle times
- Root-cause analysis of observed SCADA issues (confirmed as binding-related, not logic errors)


V0 is now **frozen for manufacturing unit** in GitHub and serves as the **trusted baseline** for all future development.

---

## Current Development Focus

Development is progressing toward **V1**, which will introduce:

- Material-driven production flow
- Batch and campaign logic
- Scaled real-time plant orchestration
- Logical quality stages (Paint, X-Ray, QC)
- Session-based KPIs and analytics
- Clear separation of live state and analytical data

> Note: V1 implementation is ongoing and not yet documented in this README.

---

## Design Principles

- Versioned evolution (no breaking changes to archived versions)
- Clear separation of concerns (simulation, orchestration, visualization)
- Realistic production logic and material conservation
- Simulation-first, visualization-later approach
- Explicit scope and limitations per version
