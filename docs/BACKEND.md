# Backend & Simulation

The backend is composed of three core services running inside a single orchestrator process. It simulates the physical material flow, sensor data patterns, and PLC logic of a 21-machine alloy wheel production line.

---

## 1. Simulation Engine (`simulation.orchestrator`)

The orchestrator manages the **Production Chain Logic**. It treats the entire plant as a linear process flow with 13 distinct WIP (Work-In-Process) stages.

### The 21-Machine Chain
| Stage | Machine IDs | Material Transformation |
| :--- | :--- | :--- |
| **Ingot Feed** | `RAWMATERIALS` | Raw Ingots (kg) |
| **Melting** | `FURNACE_01` | Ingot → Molten Metal |
| **Degassing** | `DEGASSER_01, 02` | Molten → Degassed Metal |
| **Casting** | `LPDC_01, 02, 03` | Molten → Cast Wheel |
| **First Cooling** | `COOLING_01` | Hot Cast → Cooled Part |
| **Heat Treatment** | `HEAT_01, 02` | Cooled → Tempered Part |
| **Second Cooling** | `COOLING_02` | Hot THT → Cooled Part |
| **Machining** | `CNC_01, 02` | Cast → Machined Face |
| **Pre-Treatment** | `PRETREAT_01` | Machined → Cleaned Part |
| **Paint Shop** | `PAINT_01, 02` | Cleaned → Finished Wheel |
| **X-Ray** | `INSPECTION_01` | Final Check → Pass/Fail |
| **Shipping** | `OUTBOUND_01` | Pass → Dispatched |

### WIP Material Persistence
The simulation uses a `WIP_MAP` to track items at every stage. If a machine stops (e.g., E-Stop), material "piles up" in the upstream buffers, exactly as it would in a physical plant.

---

## 2. PLC Engine (`plc.engine`)

The Virtual PLC acts as the **Ground Truth Data Store**. It map simulation variables (e.g., `machined_parts_count`) to SCADA-compatible OPC UA tags (`VirtualPLC.Devices.CNC_01.Status.Part_Count`).

### Tag Structure
All machines follow a strict schema for high-fidelity mirroring:
- **`Inputs.Start / Stop / Trigger`**: Control bits written by the UI.
- **`Status.State`**: Current operational phase (Running, Idle, Fault).
- **`Status.{PREFIX}_Instant_kW`**: Real-time energy telemetry.
- **`Status.{PREFIX}_Run_Status`**: Human-readable status string.
- **`Status.ProcessedCount`**: Accumulated production tally.

---

## 3. Logic Bridge & Middleware (`middleware.bridge`)

The bridge is the **WebSocket Gateway** for the frontend. It performs two key optimizations before broadcasting:
1. **Delta Compaction**: It monitors all PLC tags and only sends values that have changed since the last broadcast.
2. **Frequency Alignment**: It throttles raw PLC updates (which may happen at 100ms) to a consistent 1Hz (1-second) UI update frequency.

---

## 4. Testing & Fault Injection

To test the Digital Twin's response to errors, use the included fault injection script.

### Injecting a Single Machine Fault
```bash
# Force LPDC_01 into a safety stop
python manufacturing_unit/backend/simulation/test_fault_injection.py --device LPDC_01 --state "FAULT"
```

### Observing UI Propagation
1. The `orchestrator` detects the fault and stops material flow for LPDC_01.
2. The `PLC Engine` updates the `LPDC_Run_Status` tag to `FAULT`.
3. The `Logic Bridge` detects the tag change and sends a WebSocket update.
4. The **Frontend UI**:
   - Turns the 3D LPDC mesh **Red**.
   - Triggers the **Error Pulse** animation (3D Triangle).
   - Updates the **Status Label** to "FAULT" (Red) in both sidebars.
   - Adjusts **Plant Availability** and **OEE** metrics in the analytics panel.
