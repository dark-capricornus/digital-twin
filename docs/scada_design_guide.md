# Ignition SCADA Control System Design: AlloyWheel Digital Twin

This guide outlines the architectural and UI/UX design for a high-fidelity control system in **Ignition Perspective** to manage the AlloyWheel Digital Twin.

## 1. View Hierarchy & Navigation
A professional SCADA system uses a tiered navigation approach to avoid clutter.

| View Level | Name | Purpose |
| :--- | :--- | :--- |
| **Level 1** | **Main Dashboard** | High-level KPIs (Throughput, Yield), Global PLC Status, and Site Map. |
| **Level 2** | **Production Floor** | Interactive 2D/3D layout showing all machines and their live states. |
| **Level 3** | **Machine Faceplates** | Popups for individual machine control (FURNACE_01, CNC_01, etc.). |
| **Level 4** | **Analytics & Alarms** | Historical trends and active alarm tables. |

---

## 2. Master Control Panel (Level 1)
Located on the Main Dashboard or a persistent Sidebar.

### **UI Components:**
- **Status Indicator**: Multi-state indicator bound to `PLC/State`.
    - `OFF`: Grey / Red
    - `STARTING`: Pulsing Yellow
    - `RUNNING`: Solid Green
- **Control Buttons**: 
    - **START**: Large Green button. Script: `system.tag.writeBlocking(["[default]PLC/Start"], [True])`.
    - **STOP**: Large Red button. Script: `system.tag.writeBlocking(["[default]PLC/Stop"], [True])`.
- **System Metrics**: Gauge components for `Throughput` and `Yield`.

---

## 3. Machine Faceplate Design (Level 3)
Instead of creating a screen for every machine, create **one parameterized View** (Template) and pass the machine name (e.g., `"FURNACE_01"`) as a parameter.

### **Design Layout:**
- **Header**: Machine Name + Status Icon (Green/Red Circle).
- **Process Data**:
    - **Progress Bar**: Bound to `Production_Floor/{MachineName}/Progress` (0-100%).
    - **State Text**: Bound to `Production_Floor/{MachineName}/State`.
    - **Dynamic Values**: If `MachineName` contains "CNC", show `SpindleRPM`. If "HEAT", show `Temperature_C`.
- **Individual Controls**:
    - Small **Start/Stop** buttons for local overrides.
    - *Tip*: Use a "Confirm" popup for Stop buttons to prevent accidental shutdowns.

---

## 4. Aesthetic & UX Guidelines
To match a "Digital Twin" look, aim for a **Dark Mode / Glassmorphism** aesthetic.

- **Background**: Dark Navy (`#0A192F`) or Deep Grey (`#121212`).
- **Colors**:
    - **Running**: Neon Cyan or Emerald Green.
    - **Idle**: Muted Slate.
    - **Alarm**: Vibrant Amber or Crimson.
- **Components**:
    - Use **Flex Containers** for responsiveness.
    - Use **SVG Icons** for machines (Furnace, CNC, Paint Booth).
    - Use **Pipes & Tanks** perspective components for the foundry section.

---

## 5. Implementation Scripting (Python)
Use standard Action Scripts for interactive elements.

### **Start Button (Toggle/Momentary Logic):**
```python
# Event: onActionPerformed
tagPath = "[default]Production_Floor/FURNACE_01/Start"
system.tag.writeBlocking([tagPath], [True])
# Note: The simulation logic resets this to False automatically
```

### **Dynamic Styling (Binding):**
On a machine icon's `style.backgroundColor`, use an **Expression Binding**:
```sql
case({[default]Production_Floor/FURNACE_01/State},
  "RUNNING", "#00E676",
  "STARTING", "#FFD600",
  "OFF", "#607D8B",
  "#FFFFFF"
)
```

---

## 6. Recommended Project Structure
Organize your Perspective project as follows:
- `Views/`
    - `Nav/` (Header, Footer, Menu)
    - `Dashboard/` (Main Overview)
    - `FloorMap/` (The "Twin" visualization)
    - `Templates/` (MachineFaceplate, KPICard)
- `Styles/`
    - `StatusColors` (Theme classes for Running/Stopped)
