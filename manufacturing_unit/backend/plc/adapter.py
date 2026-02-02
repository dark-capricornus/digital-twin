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
        Trigger edge-based commands to the underlying machine when state changes.
        """
        if is_running and not self.plc_running:
             self.machine.set_command("start", True)
        elif not is_running and self.plc_running:
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
        "burner_enable": "BurnerEnable", 
        "cmd_auto": "CmdAuto",
        "progress": "Progress",
        "processed_count": "ProcessedCount",
        "queue_in": "QueueIn",
        "queue_out": "QueueOut",
        "busy": "Busy",
        "error": "Error",
        "state": "State",
        "fault": "Fault",
        
        # LPDC-specific tags
        "pressure_psi": "PressurePSI",
        "pour_request": "PourRequest",
        "cycle_running": "CycleRunning",
        
        # CNC-specific tags
        "spindle_rpm": "SpindleRPM",
        "trigger": "Trigger",
        
        # Buffer-specific tags
        "part_count": "PartCount",
        "capacity": "Capacity",
        "full": "Full",
        "empty": "Empty"
    }

    def get_tags(self) -> Dict[str, Any]:
        """
        Retrieve tags from the simulation machine and format for OPC UA.
        Using explicit TAG_MAP for consistency.
        """
        # CHANGED_BY_ANTIGRAVITY: Deduped and added TAG_MAP
        sim_tags = self.machine.get_tags()
        mapped_tags = {}
        
        for k, v in sim_tags.items():
            # Example: "machine.temperature" -> "temperature"
            key_clean = k.split('.')[-1]
            
            if key_clean in self.TAG_MAP:
                final_key = self.TAG_MAP[key_clean]
            else:
                # Fallback: simple capitalization (heuristic)
                final_key = key_clean[0].upper() + key_clean[1:] if key_clean else key_clean
                
            mapped_tags[final_key] = v
            
        # Synthesize Legacy Tags
        mapped_tags = self._synthesize_legacy_tags(mapped_tags)
            
        return mapped_tags

    def _synthesize_legacy_tags(self, tags: Dict[str, Any]) -> Dict[str, Any]:
        """Inject tags that existed in Phase 1 but are missing in Simulation logic."""
        # CHANGED_BY_ANTIGRAVITY: Deduped method
        if "Furnace" in self.device_id:
            # New Architecture: Just RUNNING (STARTING is gone)
            is_active = self.machine.state == MachineState.RUNNING
            tags["BurnerEnable"] = is_active
            
            current_temp = tags.get("Temperature", 20.0)
            tags["OverTempAlarm"] = current_temp > 800.0
        
        elif "LPDC" in self.device_id:
            # Ensure LPDC has all expected tags
            if "PourRequest" not in tags:
                tags["PourRequest"] = False
            if "CycleRunning" not in tags:
                tags["CycleRunning"] = self.machine.state == MachineState.RUNNING
        
        elif "CNC" in self.device_id:
            # Ensure CNC has all expected tags
            if "Busy" not in tags:
                tags["Busy"] = self.machine.state == MachineState.RUNNING

            if "Trigger" not in tags:
                tags["Trigger"] = False
        
        elif "Buffer" in self.device_id or "Storage" in self.device_id:
            # Ensure Buffer has all expected tags
            if "PartCount" not in tags:
                tags["PartCount"] = len(self.machine.queue_out)
            
        return tags

    def set_tag(self, tag_name: str, value: Any):
        """
        Handle Write from PLC. Minimal explicit path for Option 1.
        """
        # CHANGED_BY_ANTIGRAVITY: Explicit command forwarding
        if not value:
            return

        if tag_name == "Start":
             self.machine.set_command("start", True)
        elif tag_name == "Stop":
             self.machine.set_command("stop", True)
        elif tag_name == "PourRequest" and "LPDC" in self.device_id:
             self.machine.set_command("pour_request", True)
             self.machine.set_command("start", True)  # Pour request triggers start
        elif tag_name == "Trigger" and "CNC" in self.device_id:
             self.machine.set_command("trigger", True)
             self.machine.set_command("start_job", True)  # Trigger starts job 
