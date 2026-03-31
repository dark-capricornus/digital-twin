from typing import Dict, Any
from backend.simulation.machines.base_machine import BaseMachine, MachineState

class SimulationAdapter:
    """
    Wraps a Simulation Engine 'Machine' to look like a 'DeviceBase' for the VirtualPLC.
    This bridges the gap between the SCADA-facing PLC and the internal Physics Engine.
    """
    def __init__(self, machine: BaseMachine, device_id: str):
        self.machine = machine
        self.device_id = device_id
        self.plc_running = False
        
        # ENSURE MACHINE IS READY
        # Machines default to IDLE in new architecture. ENABLED flag managed by PLC.
        # self.machine.power_on() -> DEPRECATED

    def bind_to_plc_state(self, is_running: bool):
        """
        Sync adapter state with PLC.
        Dual-mode control:
        - CENTRALIZED: Global PLC Start/Stop cascades to all machines.
        - INDEPENDENT: Individual Start/Stop tags can override per-machine via OPC UA.
        """
        if is_running and not self.plc_running:
            # Restore auto-start behavior when PLC starts
            self.machine.enabled = True
            self.machine.set_command("start", True)
        elif not is_running and self.plc_running:
            # Ensure STOP still works
            self.machine.set_command("stop", True)

        self.plc_running = is_running

    def update(self, dt: float):
        """
        No-op for Adapter.
        Physics is handled centrally by SimulationEngine.step().
        """
        pass

    # Explicit Mapping: Sim Key -> SCADA/OPC UA CamelCase Name
    TAG_MAP = {
        # Common tags
        "temperature": "Temperature",
        "target_temp": "TargetTemp",
        "progress": "Progress",
        "fault_code": "FaultCode",
        "state": "State",
        "is_running": "IsRunning",
        "enabled": "Enabled",
        "power_kw": "Instant_kW",
        "energy_kwh": "Total_kWh",
        "runtime_total_hrs": "RuntimeTotalHrs",
        "processed_count": "ProcessedCount",
        
        # Specialized Thermal
        "bath_temp": "Melt_Bath_Temperature",
        "roof_temp": "Roof_Temperature",
        "wall_temp": "Wall_Temperature",
        "mode": "Mode",
        "step_timer": "Step_Timer",
        
        # Specialized Simple/LPDC/CNC
        "cycle_status": "Cycle_Status",
        "pressure_psi": "Pressure_PSI",
        "riser_pressure": "Riser_Pressure",
        "pressure_setpoint": "Pressure_Setpoint",
        "holding_pressure": "Holding_Pressure",
        "holding_furnace_temp": "Holding_Furnace_Temperature",
        "die_top_temp": "Die_Top_Temperature",
        "die_bottom_temp": "Die_Bottom_Temperature",
        "fill_time": "Fill_Time",
        "solidification_time": "Solidification_Time",
        "cycle_time": "Cycle_Time",
        "shot_count": "Shot_Count",
        "good_count": "Good_Part_Count",
        "reject_count": "Reject_Count",
        "program_id": "Program_ID",
        "model_id": "Model_ID",
        "spindle_rpm": "Spindle_RPM",
        
        # Environment
        "humidity": "Booth_Humidity",
        "air_flow": "Air_Flow_Status",
        "conveyor_speed": "Conveyor_Speed",
        "dryer_temp": "Dryer_Temperature",
        
        # Inspection
        "scan_status": "Scan_Status",
        "inspected_count": "Inspected_Count",
        "ok_count": "OK_Count",
        "ng_count": "NG_Count",
        "inspection_cycle_time": "Inspection_Cycle_Time",
        "alarm_status": "Alarm_Status",
        "accumulating": "Accumulating",
        "vacuum_level": "VacuumLevel",
        
        # New Simulated Industrial Tags
        "vibration": "Vibration_mm_s",
        "motor_load": "Motor_Load_Pct",
        "oil_level": "Oil_Level_Pct",
        "air_pressure": "Air_Supply_PSI",
        "internal_temp": "Internal_Temp",
        
        # Plant-Level KPIs (Orchestrator Mapping)
        "KPI_total_ingots_consumed": "Plant_KPI_Ingots_Consumed",
        "KPI_total_wheels_produced": "Plant_KPI_Total_Produced",
        "KPI_total_scrap": "Plant_KPI_Total_Scrap",
        "KPI_batches_completed": "Plant_KPI_Batches",
        "KPI_throughput_wheels_hr": "Plant_KPI_Throughput",
        "KPI_yield_percent": "Plant_KPI_Yield",
        
        # WIP (Ground Truth Flow)
        "WIP_ingots_kg": "Plant_WIP_Ingots_Available",
        "WIP_molten_metal_kg": "Plant_WIP_Molten_Metal",
        "WIP_degassed_metal_kg": "Plant_WIP_Degassed_Metal",
        "WIP_cast_parts": "Plant_WIP_Cast_Parts",
        "WIP_cooled_parts_1": "Plant_WIP_Cooled_Parts_1",
        "WIP_heat_treated_parts": "Plant_WIP_Heat_Treated_Parts",
        "WIP_cooled_parts_2": "Plant_WIP_Cooled_Parts_2",
        "WIP_machined_parts": "Plant_WIP_Machined_Parts",
        "WIP_pretreated_parts": "Plant_WIP_Pretreated_Parts",
        "WIP_painted_parts": "Plant_WIP_Painted_Parts",
        "WIP_xray_passed": "Plant_WIP_Passed_Parts"
    }

    def get_tags(self) -> Dict[str, Any]:
        """
        Retrieve tags from the simulation machine and format for SCADA.
        Handles dynamic prefixing for energy tags (e.g., Furnace_Instant_kW).
        """
        sim_tags = self.machine.get_tags()
        mapped_tags = {}
        
        # Identify Device Prefix (e.g., "FURNACE_01" or "LPDC_01")
        prefix = self.device_id
        # Align with frontend schema prefixes (main.js)
        if "PAINT_01" in prefix: base_type = "PB1"
        elif "PAINT_02" in prefix: base_type = "PB2"
        elif "INSPECTION" in prefix: base_type = "XRay"
        elif "HEAT" in prefix: base_type = "HT"
        elif "PRETREAT" in prefix: base_type = "PT"
        elif "FURNACE" in prefix: base_type = "Furnace"
        elif "LPDC" in prefix: base_type = "LPDC"
        elif "CNC" in prefix: base_type = "CNC"
        elif "COOLING" in prefix: base_type = "Cooling"
        elif "DEGASSER" in prefix: base_type = "Degasser"
        elif "OUTBOUND" in prefix: base_type = "Outbound"
        else: base_type = prefix.split('_')[0] if '_' in prefix else prefix
        
        for k, v in sim_tags.items():
            key_clean = k.split('.')[-1]
            
            if key_clean in self.TAG_MAP:
                final_key = self.TAG_MAP[key_clean]
                
                # Apply Prefix to Energy & Specific Status tags if requested
                # e.g., PB1_Instant_kW, Furnace_Instant_kW
                if final_key in ["Instant_kW", "Total_kWh"]:
                    final_key = f"{base_type}_{final_key}"
                # For specific overrides like Furnace_Mode
                elif final_key == "Mode":
                    if "FURNACE" in base_type:
                        final_key = "Furnace_Mode"
                    elif "HT" in base_type:
                        final_key = "Process_Step"
                elif final_key == "Cycle_Status":
                    if "PT" in base_type:
                        final_key = "Stage_Status"
                    elif "PAINT" in base_type or "PB" in base_type:
                        final_key = "Booth_Cycle_Status"
                elif final_key == "Temperature":
                    if "HT" in base_type:
                        final_key = "Furnace_Temperature"
                    elif "PAINT" in base_type or "PB" in base_type:
                        final_key = "Booth_Temperature"
                elif final_key == "ProcessedCount":
                    final_key = f"{base_type}_Production_Count"
                elif final_key in ["Good_Part_Count", "Reject_Count"]:
                    final_key = f"{base_type}_{final_key}"
                elif final_key == "TargetTemp":
                    if "HT" in base_type:
                        final_key = "Temperature_Setpoint"
                        
                # [ARCHITECTURE] SCADA Mapping Core
                # Store the custom prefixed/specialized tag name
                mapped_tags[final_key] = v
                
                # [VISIBILITY FIX] Also store the generic "base" tag name for plant/zone aggregation
                # This ensures consistent data for the plant/zone counters while keeping asset-specific tags.
                # Only do this if final_key was modified (prefixed/renamed)
                if key_clean in self.TAG_MAP:
                    generic_key = self.TAG_MAP[key_clean]
                    if generic_key not in mapped_tags:
                        mapped_tags[generic_key] = v
            else:
                # Fallback
                mapped_tags[key_clean] = v
                
        # Inject Run_Status (Alias of State)
        state_val = str(sim_tags.get(f"{self.machine.id}.state", "IDLE")).upper()
        if "RUNNING" in state_val: final_state = "RUNNING"
        elif "STOPPED" in state_val or "IDLE" in state_val: final_state = "STOPPED"
        elif "FAULT" in state_val: final_state = "FAULT"
        else: final_state = state_val

        status_key = f"{base_type}_Run_Status"
        
        mapped_tags[status_key] = final_state
        
        # Inject device-specific Independent Controls (if not already there)
        if "Start" not in mapped_tags: mapped_tags["Start"] = False
        if "Stop" not in mapped_tags: mapped_tags["Stop"] = False
            
        # Restore legacy tags (PourRequest, Trigger, PartCount)
        mapped_tags = self._synthesize_legacy_tags(mapped_tags)
            
        return mapped_tags

    def _synthesize_legacy_tags(self, tags: Dict[str, Any]) -> Dict[str, Any]:
        """Inject tags that existed in Phase 1 but are missing in Simulation logic."""
        if "LPDC" in self.device_id:
            # Ensure LPDC has all expected tags
            if "PourRequest" not in tags:
                tags["PourRequest"] = False
        
        elif "CNC" in self.device_id:
            # Ensure CNC has all expected tags
            if "Trigger" not in tags:
                tags["Trigger"] = False
        
        elif "Buffer" in self.device_id or "Storage" in self.device_id:
            # Buffer: PartCount IS QueueOut length
            # If "QueueOut" exists (from TAG_MAP), we can alias it or just rely on it.
            # But HMI expects "PartCount". Let's provide PartCount.
            if "QueueOut" in tags:
                tags["PartCount"] = tags["QueueOut"]
                # We can optionally remove QueueOut to be cleaner, or keep both.
                # User asked to remove redundant.
                del tags["QueueOut"]
            elif "part_count" not in tags:
                 # Fallback if TAG_MAP didn't catch it
                 tags["PartCount"] = len(self.machine.queue_out)
            
        return tags

    def set_tag(self, tag_name: str, value: Any):
        print(f"[ADAPTER][WRITE] {self.device_id}.{tag_name} = {value}")

        if tag_name == "Start":
            if value:
                # INDUSTRIAL FIX: If machine is STOPPED/FAULTED, we must RESET before starting
                from backend.simulation.machines.base_machine import MachineState
                if self.machine.state in [MachineState.STOPPED, MachineState.FAULTED]:
                    print(f"[ADAPTER][AUTO-RESET] {self.device_id} (Prior state: {self.machine.state.name})")
                    self.machine.handle_reset_command()

                print(f"[ADAPTER][START] {self.device_id}")
                self.machine.set_command("start", True)

        elif tag_name == "Stop":
            if value:
                print(f"[ADAPTER][STOP] {self.device_id}")
                self.machine.set_command("stop", True)

        elif tag_name == "Trigger" and "CNC" in self.device_id:
            if value:
                print(f"[ADAPTER][TRIGGER] {self.device_id}")
                self.machine.set_command("trigger", True)
                self.machine.set_command("start_job", True)

        elif tag_name == "PourRequest" and "LPDC" in self.device_id:
            if value:
                print(f"[ADAPTER][POUR] {self.device_id}")
                self.machine.set_command("pour_request", True)
                self.machine.set_command("start", True)

        else:
            print(f"[ADAPTER][IGNORED] {tag_name}")
