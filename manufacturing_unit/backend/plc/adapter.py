from typing import Dict, Any, Optional
import logging

logger = logging.getLogger("SimulationAdapter")

class SimulationAdapter:
    """
    Maps cryptic Simulation tag names to the SCADA UDT tag names that the OPC
    server exposes (matching docs/scada_udt_definitions.json). All Title_Case
    names here MUST match the entries in docs/manifests/telemetry_dictionary.json,
    because OPC nodes are created from that dictionary and the engine looks
    them up by `{device_id}.{tag}` keys.
    """

    # Sim tag (snake_case from machine.get_tags) -> SCADA UDT tag name.
    TAG_MAP = {
        # Base / energy
        "power_kw":              "Instant_Power",
        "energy_kwh":            "Total_Energy_Consumed",
        "alarm_status":          "Alarm_Status",
        "progress":              "Progress",
        "total_runtime":         "Total_Runtime",
        "runtime_total_hrs":     "Total_Runtime",
        # Thermal / process temperatures
        "melt_bath_temp":        "Melt_Bath_Temp",
        "bath_temp":             "Melt_Bath_Temp",
        "zone_temp":             "Zone_Temp",
        "furnace_temp":          "Furnace_Temp",
        "process_temp":          "Process_Temp",
        "temp":                  "Process_Temp",
        "target_temp":           "Target_Temp",
        "temp_setpoint":         "Temp_Setpoint",
        "die_top_temp":          "Die_Top_Temp",
        "die_bottom_temp":       "Die_Bottom_Temp",
        "booth_temp":            "Booth_Temp",
        "dryer_temp":            "Dryer_Temp",
        # Pressures
        "riser_pressure":        "Riser_Pressure",
        "pressure":              "Riser_Pressure",
        "pressure_setpoint":     "Pressure_Setpoint",
        "holding_pressure":      "Holding_Pressure",
        "vacuum_level":          "Vacuum_Level",
        # Modes / cycle / step
        "furnace_mode":          "Furnace_Mode",
        "step_timer":            "Step_Timer",
        "process_step":          "Process_Step",
        "cycle_time":            "Cycle_Time",
        "cycle_status":          "Cycle_Status",
        "stage_status":          "Stage_Status",
        "scan_status":           "Scan_Status",
        "booth_cycle_status":    "Booth_Cycle_Status",
        "air_flow_status":       "Air_Flow_Status",
        "booth_humidity":        "Booth_Humidity",
        "conveyor_speed":        "Conveyor_Speed",
        # Counters / IDs
        "shot_count":            "Shot_Count",
        "part_count":            "Part_Count",
        "good_part_count":       "Good_Part_Count",
        "reject_count":          "Reject_Count",
        "processed_count":       "Processed_Count",
        "inspected_count":       "Inspected_Count",
        "ok_count":              "OK_Count",
        "not_good_count":        "Not_Good_Count",
        "ng_count":              "Not_Good_Count",
        "spindle_speed":         "Spindle_Speed",
        "model_id":              "Model_ID",
        "program_id":            "Program_ID",
    }

    def __init__(self, machine_obj: Any, device_id: str):
        self.machine = machine_obj
        self.device_id = device_id

    def get_tags(self) -> Dict[str, Any]:
        """Translate simulation tag names to SCADA UDT tag names."""
        sim_tags = self.machine.get_tags()
        mapped_tags: Dict[str, Any] = {}

        # 1. Base state — explicit Title_Case keys matching SCADA UDT.
        state_code = sim_tags.get(f"{self.machine.id}.state", None)
        if state_code is None:
            # State enum value or run_status string from base_machine.get_tags
            state_code = sim_tags.get(f"{self.machine.id}.run_status", "IDLE")

        if isinstance(state_code, int):
            state_map = {0: "STOPPED", 1: "IDLE", 2: "RUNNING", 3: "FAULTED"}
            clean_state = state_map.get(state_code, "UNKNOWN")
        else:
            clean_state = str(state_code).upper()

        mapped_tags["State"] = clean_state
        mapped_tags["Is_Running"] = (clean_state == "RUNNING")

        # 2. Map remaining sim tags via TAG_MAP, skipping ones handled above.
        skip_keys = {"state", "is_running", "run_status"}
        for k, v in sim_tags.items():
            key_clean = k.split(".")[-1]
            if key_clean in skip_keys:
                continue

            scada_name = self.TAG_MAP.get(key_clean)
            if scada_name is None:
                # Fall through: convert snake_case → Title_Case (e.g. cmd_trigger -> Cmd_Trigger).
                # These won't match the dictionary unless added to TAG_MAP, but
                # are kept for diagnostics.
                scada_name = "_".join(part.capitalize() for part in key_clean.split("_"))
            mapped_tags[scada_name] = v

        return mapped_tags

    def bind_to_plc_state(self, is_active: bool):
        """Link machine operational capability to PLC power state."""
        if hasattr(self.machine, "bind_to_plc_state"):
            self.machine.bind_to_plc_state(is_active)
        elif hasattr(self.machine, "enabled"):
            self.machine.enabled = is_active

    def set_tag(self, tag: str, value: Any):
        """Route SCADA command tags to the machine's command interface."""
        if not value:
            return
        cmd = tag.lower()
        if hasattr(self.machine, "set_command"):
            logger.info(f"[{self.device_id}] Routing tag '{tag}' -> set_command('{cmd}', {value})")
            self.machine.set_command(cmd, value)
        else:
            logger.warning(f"[{self.device_id}] Unknown command tag: {tag}")
