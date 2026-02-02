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
        
        # Configuration Flags
        self.role = role
        self.has_pour = has_pour
        self.has_trigger = has_trigger
        self.capacity = capacity
        
        # Optional Command Flags
        self.cmd_trigger = False
        self.cmd_pour_request = False
        
        # Simulation Logic
        self.progress = 0.0
        self.current_item = None
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []
        
        # Role-specific State
        self.pressure_psi = 0.0
        self.spindle_rpm = 0.0
        self.part_count = 0

    def receive_item(self, item: Any) -> bool:
        """Legacy support for factory loading"""
        if len(self.queue_in) < self.capacity: # simplistic check
            self.queue_in.append(item)
            return True
        return False
        
    def _pre_start_checks(self) -> bool:
        """Check if safe to start"""
        return True # Simple machines always safe to start if enabled
    
    def _detect_fault(self) -> bool:
        """No internal faults simulated yet"""
        return False
        
    def _get_fault_code(self) -> int:
        return 0
        
    def set_command(self, cmd_name: str, value: bool):
        """Handle device-specific commands beyond standard ones"""
        super().set_command(cmd_name, value)
        
        if cmd_name == "trigger":
            self.cmd_trigger = value
        elif cmd_name == "pour_request":
            self.cmd_pour_request = value
        elif cmd_name == "start_job":
            self.cmd_trigger = value

    def _execute_running_logic(self, dt: float):
        """Core logic step"""
        # Role-specific updates
        if self.role == "casting":
            self.pressure_psi = 45.0 if self.current_item else 0.0
        elif self.role == "machining":
            self.spindle_rpm = 3500.0 if self.current_item else 0.0
            
        # 1. Try to load
        if self.current_item is None:
            if self.queue_in:
                # In CNC mode, wait for trigger?
                if self.role == "machining" and self.has_trigger and not self.cmd_trigger:
                    return # Wait for trigger
                    
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
                
                # Reset triggers
                self.cmd_trigger = False
                self.cmd_pour_request = False # FIX: Reset pour request too
            
            # Special Case: CASTING (Infinite Supply)
            elif self.role == "casting":
                if self.has_pour and not self.cmd_pour_request:
                     return # Wait for pour request
                
                # Create dummy item for casting
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
            
            # Update buffer count
            if self.role == "buffer":
                self.part_count = len(self.queue_out)
                
            # Emit Event
            if self.role == "casting":
                self._emit_event("LPDC_CYCLE_COMPLETE", {})
            elif self.role == "machining":
                self._emit_event("CNC_CYCLE_COMPLETE", {})

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        """Expose role-specific tags"""
        tags = {
            f"{self.id}.progress": round(self.progress, 2),
            f"{self.id}.queue_in": len(self.queue_in),
            f"{self.id}.queue_out": len(self.queue_out),
        }
        
        if self.role == "casting":
            tags[f"{self.id}.pressure_psi"] = round(self.pressure_psi, 1)
            tags[f"{self.id}.pour_request"] = self.cmd_pour_request
            tags[f"{self.id}.cycle_running"] = self.state == MachineState.RUNNING
        elif self.role == "machining":
            tags[f"{self.id}.spindle_rpm"] = round(self.spindle_rpm, 1)
            tags[f"{self.id}.trigger"] = self.cmd_trigger
            tags[f"{self.id}.busy"] = self.state == MachineState.RUNNING
        elif self.role == "buffer":
            tags[f"{self.id}.part_count"] = self.part_count
            tags[f"{self.id}.capacity"] = self.capacity
            tags[f"{self.id}.full"] = self.part_count >= self.capacity
            tags[f"{self.id}.empty"] = self.part_count == 0
            
        return tags
