from typing import Dict, Any, Optional
import logging

logger = logging.getLogger("SimulationAdapter")

class SimulationAdapter:
    """
    Acts as a 'Data Cleaner' and 'Mapper' between the raw Simulation Machines
    and the standardized OPC UA / SCADA Tag Tree.
    
    This ensures that internal Simulation logic (which might be cryptic or 
    generic) is translated into industry-standard names and types before 
    reaching the PLC/OPC layer.
    """
    
    # Static Mapping: simulation_key -> standardized_scada_tag
    TAG_MAP = {
        # Process Variables
        "pressure": "PressurePSI",
        "processed_count": "ProcessedCount",
        "progress": "Progress",
        "spindle_rpm": "SpindleRPM",
        "vacuum_level": "VacuumLevel",
        "reject_count": "RejectCount",
        "part_count": "PartCount",
        "capacity": "Capacity",
        
        # Thermal / Machine-Specific
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
        "temperature": "Temperature",
        "target_temp": "TargetTemp",
        "power_kw": "PowerKW",
        "energy_kwh": "EnergyKWH",
        
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

    def __init__(self, machine_obj: Any, device_id: str):
        self.machine = machine_obj
        self.device_id = device_id

    def get_tags(self) -> Dict[str, Any]:
        """
        [CLEANER] Translates cryptic PLC codes to semantic SCADA tags.
        Standardizes output for Ignition UDTs and WebGL.
        """
        sim_tags = self.machine.get_tags()
        mapped_tags = {}
        
        # 1. Base State Logic (Cryptic -> Clean)
        # Assuming sim_tags uses {machine_id}.state
        state_code = sim_tags.get(f"{self.machine.id}.state", 0)
        state_map = {0: "STOPPED", 1: "IDLE", 2: "RUNNING", 3: "FAULTED"}
        clean_state = state_map.get(state_code, "UNKNOWN")
        
        # 2. Map to Manifest-compliant Names (Matching UDTs)
        # Category: Status
        mapped_tags["State"] = clean_state
        mapped_tags["StateCode"] = state_code
        mapped_tags["IsRunning"] = (state_code == 2)
        mapped_tags["Progress"] = round(sim_tags.get(f"{self.machine.id}.progress", 0.0), 2)
        mapped_tags["ProcessedCount"] = int(sim_tags.get(f"{self.machine.id}.processed_count", 0))
        mapped_tags["FaultCode"] = int(sim_tags.get(f"{self.machine.id}.fault_code", 0))
        
        # 3. Handle specific metrics from self.TAG_MAP
        for k, v in sim_tags.items():
            # Tag key in simulation is usually "MACHINE_ID.tag_name"
            key_clean = k.split('.')[-1]
            
            # Skip base tags handled above
            if key_clean in ["state", "is_running", "progress", "processed_count", "fault_code", "state_code"]:
                continue
                
            if key_clean in self.TAG_MAP:
                mapped_tags[self.TAG_MAP[key_clean]] = v
            else:
                # Pass through others if they aren't mapped but might be needed
                mapped_tags[key_clean] = v

        # Inject legacy synthesized tags (Trigger, PourRequest)
        # This keeps the flow logic working while using clean tags for state
        if "CNC" in self.device_id:
            mapped_tags["Trigger"] = sim_tags.get(f"{self.machine.id}.trigger", False)
        if "LPDC" in self.device_id:
            mapped_tags["PourRequest"] = sim_tags.get(f"{self.machine.id}.pour_request", False)

        return mapped_tags

    def bind_to_plc_state(self, is_active: bool):
        """Link machine operational capability to PLC power state."""
        if hasattr(self.machine, 'bind_to_plc_state'):
            self.machine.bind_to_plc_state(is_active)
        else:
            # Fallback: directly set enabled flag
            if hasattr(self.machine, 'enabled'):
                self.machine.enabled = is_active

    def set_tag(self, tag: str, value: Any):
        """
        Route SCADA command tags to the machine's command interface.
        
        Maps OPC UA tag names (PascalCase) to BaseMachine.set_command (lowercase).
        """
        if not value:
            return  # Only process rising edge (True)
        
        # Map SCADA tag names to machine command names
        cmd_map = {
            "Start": "start",
            "Stop": "stop",
            "Reset": "reset",
            "Trigger": "start",       # CNC Trigger = Start cycle
            "Pour_Request": "start",   # LPDC Pour = Start cycle
        }
        
        cmd = cmd_map.get(tag)
        if cmd and hasattr(self.machine, 'set_command'):
            logger.info(f"[{self.device_id}] Routing tag '{tag}' -> set_command('{cmd}', {value})")
            self.machine.set_command(cmd, value)
        else:
            logger.warning(f"[{self.device_id}] Unknown command tag: {tag}")

