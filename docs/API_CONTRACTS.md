# API & Tag Contracts

The Digital Twin communication follows the **Sparkplug B** naming convention for its topic structure, even when operating in a pure WebSocket mode. This ensures direct compatibility with industrial SCADA systems like **Ignition** or **Kepware**.

---

## 1. WebSocket Message Schema

### 📤 Outbound (Writing Tags)
To control a machine or inject a fault from the UI, send the following JSON:

| Key | Description | Example |
| :--- | :--- | :--- |
| `type` | Command action type. | `"write"` |
| `node_id` | Full PLC tag path. | `"VirtualPLC.Devices.CNC_01.Inputs.Start"` |
| `value` | Boolean or Numeric value to set. | `true` |

```json
{
  "type": "write",
  "node_id": "VirtualPLC.Devices.CNC_01.Inputs.Start",
  "value": true
}
```

### 📥 Inbound (Broadcast)
The bridge sends state updates as a single flat dictionary of all changed tag values:

```json
{
  "FURNACE_01.Status.Melt_Bath_Temperature": 725.4,
  "FURNACE_01.Status.State": "RUNNING",
  "Plant.KPI.Total_Produced": 142
}
```

The frontend `StateManager` and `EnergyAnalytics` handle the mapping of these flat keys to the correct machine and zone structures.

---

## 2. Integrated PLC Tags (Ignition)

All simulated devices follow the **Machine Template** contract:

| Tag Suffix | Type | Description |
| :--- | :--- | :--- |
| `.Status.State` | String | Operation phase: `RUNNING`, `IDLE`, `FAULT`, `OFFLINE`. |
| `.Status.IsRunning` | Boolean | Primary operational flag. |
| `.Status.ProcessedCount`| Int32 | Part/Batch counter. |
| `.Status.{PREFIX}_Instant_kW` | Double | Real-time energy consumption. |
| `.Status.Vibration_mm_s` | Double | Health indicator. |
| `.Status.Internal_Temp` | Double | Machine temperature. |

---

## 3. Plant-Level KPI WIP Tags

Global plant metrics are available under the `VirtualPLC.Plant` namespace:

| Tag Path | Unit | Description |
| :--- | :--- | :--- |
| `VirtualPLC.Plant.KPI.total_wheels_produced` | Units | Final good parts count. |
| `VirtualPLC.Plant.KPI.total_scrap` | Units | Total scrap generated. |
| `VirtualPLC.Plant.KPI.throughput_wheels_hr` | Units/hr| Current production rate. |
| `VirtualPLC.Plant.WIP.ingots_kg` | kg | Raw material currently in Smelting. |
| `VirtualPLC.Plant.WIP.molten_metal_kg` | kg | Metal currently in Degassing. |
| `VirtualPLC.Plant.WIP.cast_parts` | Units | Castings currently in Cooling Line 1. |
| `VirtualPLC.Plant.WIP.machined_parts` | Units | Machined wheels awaiting Finishing. |

---

## 4. Normalization Aliases

The frontend automatically normalizes inconsistent naming conventions from industrial protocols:

| Standard ID (Frontend) | SCADA Match Patterns |
| :--- | :--- |
| **`PB1`** | `PAINT_01`, `PB1_Run_Status`, `Paint booth 01` |
| **`PB2`** | `PAINT_02`, `PB2_Run_Status`, `Paint booth 02` |
| **`PT`** | `PRETREAT_01`, `PT_Run_Status` |
| **`SHIPPING`** | `OUTBOUND_01`, `Dispatched_Count`, `Plant_KPI_Total_Produced` |
| **`RAWMATERIALS`** | `INBOUND_01`, `STORAGE_01`, `Ingots_kg` |
