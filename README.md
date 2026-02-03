# Digital Twin – Alloy Wheel Manufacturing (V0)

## Version: V0 – Baseline Simulation Prototype  
**Status:** Completed, Verified.

---

## Overview

V0 represents the **baseline working prototype** of the Digital Twin for an Alloy Wheel Manufacturing Plant.

The purpose of V0 is to:
- Validate **machine-level simulation logic**
- Verify **time-based progress behavior**
- Establish **stable PLC + OPC UA + SCADA integration**
- Serve as a **trusted foundation** for future versions

V0 is intentionally limited in scope and is now **frozen**.

---

## Objectives of V0

- Simulate individual manufacturing machines independently
- Expose real-time machine states and progress to SCADA
- Verify correctness of cycle-time-based progress calculation
- Confirm OPC UA data flow and SCADA bindings
- Identify and eliminate core simulation logic issues

---

## Machines Included

V0 includes **independent simulations** of the following machines:

- Furnace
- LPDC
- CNC
- Buffer

Each machine operates **independently**, without material-flow dependency.

---

## Core Features

### Machine Simulation
- Time-based cycle execution
- Progress calculation using elapsed time
- Machine states:
  - IDLE
  - RUNNING

### PLC Engine
- Central PLC runtime state
- RUNNING / IDLE control
- Trigger-based machine activation

### SCADA Integration
- OPC UA exposure of machine tags
- Live visualization in Ignition SCADA
- Progress bars, numeric values, and status indicators

---

## Progress Logic

Machine progress is calculated using:


Each machine uses its **own configured cycle time**, ensuring independent progress behavior.

This logic has been **formally verified** via runtime instrumentation.

---

## Verification Status

V0 has been **verified and signed off** through:

- Code inspection of simulation and PLC engine
- Runtime debug logging of machine progress values
- Validation of different cycle times (LPDC vs CNC)
- Root cause analysis of SCADA display issues

### Verification Outcome
 - [x] Backend simulation logic confirmed correct
 - [x] shared-state or timing bugs found
 - [x] Observed identical SCADA values traced to binding/configuration, not logic

---

## Explicit Limitations of V0

V0 **does NOT include**:

- Material-driven production flow
- Batch or campaign logic
- Dependency between machines
- Quality stages (Paint, X-Ray, QC)
- KPIs or analytics
- Persistent storage or database
- Mesh-based visualization or animation logic

These limitations are **intentional**.

---

# Design Philosophy

- Keep logic **simple and verifiable**
- Validate correctness before adding complexity
- Treat V0 as a **reference implementation**, not a final product
- Enable safe evolution into V1

---
## Version Status

V0 is now:**Frozen**

No further development will occur on V0.

All future work continues in **V1 and beyond**.

---

## Next Phase

Development proceeds to **V1**, which introduces:

- Material-driven production flow
- Batch orchestration
- Scaled real-time plant logic
- Quality gates and KPIs
- Clean separation between simulation and visualization

V0 will remain the **baseline reference** for correctness.  
