from typing import Dict, Any, List
from .base_machine import BaseMachine, MachineState

class SimpleMachine(BaseMachine):
    """
    Standard machine: Takes item -> Waits cycle_time -> Output.
    Used for: Storage, Pretreatment, Paint Booth, Packing, LPDC, CNC, Buffers.
    
    Migrated to BaseMachine for SCADA compliance.
    """
    def __init__(self, machine_id: str, name: str, cycle_time: float, 
                 role: str = "generic", has_pour: bool = False, 
                 has_trigger: bool = False, capacity: int = 100):
        super().__init__(machine_id, name)
        
        self.cycle_time = cycle_time
        self.role = role
        self.has_pour = has_pour
        self.has_trigger = has_trigger
        self.capacity = capacity
        
        # Command Flags (Device Specific)
        self.cmd_trigger = False
        self.cmd_pour_request = False
        
        # Logic State
        self.progress = 0.0
        self.current_item = None
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []
        
        # Role State
        self.pressure_psi = 0.0
        self.spindle_rpm = 0.0
        self.part_count = 0

    # --- BaseMachine Implementation ---

    def _pre_start_checks(self) -> bool:
        """Safe to start if no critical faults (implied by BaseMachine check too)"""
        return True

    def _detect_fault(self) -> bool:
        """Simulate faults? For now, no random faults in SimpleMachine."""
        return False

    def _get_fault_code(self) -> int:
        return 0

    def force_safe_state(self):
        """Reset operational state on Safe Stop"""
        self.progress = 0.0
        self.spindle_rpm = 0.0
        self.pressure_psi = 0.0
        # Don't dump queue, just stop processing
        
    def _execute_running_logic(self, dt: float):
        """
        Executed ONLY when State=RUNNING.
        """
        # Role-specific physics emulation
        if self.role == "casting":
            self.pressure_psi = 45.0 if self.current_item else 0.0
        elif self.role == "machining":
            self.spindle_rpm = 3500.0 if self.current_item else 0.0

        # 1. Try to Load
        if self.current_item is None:
            # Check Input Queue
            if self.queue_in:
                # Gating: CNC Trigger
                if self.role == "machining" and self.has_trigger and not self.cmd_trigger:
                    self.spindle_rpm = 1000.0 # Idle spin
                    return 
                    
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
                
                # Consume Triggers
                self.cmd_trigger = False
                self.cmd_pour_request = False
                
            # Special Case: Casting (Infinite Supply but needs Pour Request)
            elif self.role == "casting":
                if self.has_pour and not self.cmd_pour_request:
                    self.pressure_psi = 5.0 # Low pressure
                    return
                
                # Start Cycle
                self.current_item = "MoltenMetal_Shot"
                self.progress = 0.0
                self.cmd_pour_request = False
                
            else:
                 return # Starved

        # 2. Process
        self.progress += (dt / self.cycle_time) * 100.0
        
        # 3. Finish
        if self.progress >= 100.0:
            self.queue_out.append(self.current_item)
            self.current_item = None
            self.processed_count += 1
            self.progress = 0.0
            
            # Update Buffers
            if self.role == "buffer":
                self.part_count = len(self.queue_out)
                
            # Events
            if self.role == "casting":
                self._emit_event("LPDC_CYCLE_COMPLETE", {})
            elif self.role == "machining":
                self._emit_event("CNC_CYCLE_COMPLETE", {})

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        tags = {
            f"{self.id}.progress": round(self.progress, 2),
            f"{self.id}.queue_in": len(self.queue_in),
            f"{self.id}.queue_out": len(self.queue_out),
        }
        
        # Role Tags
        if self.role == "casting":
            tags[f"{self.id}.pressure_psi"] = round(self.pressure_psi, 1)
            tags[f"{self.id}.pour_request"] = self.cmd_pour_request
        elif self.role == "machining":
            tags[f"{self.id}.spindle_rpm"] = round(self.spindle_rpm, 1)
            tags[f"{self.id}.trigger"] = self.cmd_trigger
        elif self.role == "buffer":
            tags[f"{self.id}.part_count"] = self.part_count
            tags[f"{self.id}.capacity"] = self.capacity
            # tags[f"{self.id}.full"] = self.part_count >= self.capacity # Redundant
            # tags[f"{self.id}.empty"] = self.part_count == 0 # Redundant
            
        return tags

    # --- Legacy / Helper Methods ---

    def receive_item(self, item: Any) -> bool:
        if len(self.queue_in) < self.capacity:
            self.queue_in.append(item)
            return True
        return False

    def set_command(self, cmd_name: str, value: bool):
        # Extend BaseMachine command set
        super().set_command(cmd_name, value)
        
        if cmd_name == "trigger":
            self.cmd_trigger = value
        elif cmd_name == "pour_request":
            self.cmd_pour_request = value
