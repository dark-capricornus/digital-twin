from typing import Dict, Any
from .base_machine import BaseMachine, MachineState

class DegasserMachine(BaseMachine):
    """
    Degasser Unit: Removes gases from molten metal using vacuum.
    
    Simulation Logic:
    - Vacuum Level: Drops from 101.3 kPa (Atmospheric) to 0.5 kPa (Vacuum) during processing.
    - Temperature: Maintained around 700-750 C.
    """
    def __init__(self, machine_id: str, name: str, cycle_time: float):
        super().__init__(machine_id, name)
        self.cycle_time = cycle_time
        
        # specific physics state
        self.vacuum_level = 101.3 # Start at atm
        self.temperature = 720.0
        self.progress = 0.0
        
        # logic state
        self.current_item = None
        self.queue_in = []
        self.queue_out = []

    def _pre_start_checks(self) -> bool:
        return True

    def _detect_fault(self) -> bool:
        return False

    def _get_fault_code(self) -> int:
        return 0

    def force_safe_state(self):
        self.vacuum_level = 101.3
        self.progress = 0.0

    def _execute_running_logic(self, dt: float):
        # 1. Physics (Continuous)
        # Temp fluctuates slightly directly
        self.temperature = 720.0 + (self.processed_count % 5)
        
        # 2. Logic
        if self.current_item is None:
            # Idle / Loading
            if self.vacuum_level < 101.3:
                self.vacuum_level += 20.0 * dt # Repressurize fast
                if self.vacuum_level > 101.3: self.vacuum_level = 101.3
                
            if self.queue_in:
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
        else:
            # Processing
            self.progress += (dt / self.cycle_time) * 100.0
            
            # Vacuum moves towards 0.5 kPa
            if self.vacuum_level > 0.5:
                # Decay rate
                self.vacuum_level -= 15.0 * dt
                if self.vacuum_level < 0.5: self.vacuum_level = 0.5
                
            if self.progress >= 100.0:
                self.queue_out.append(self.current_item)
                self.current_item = None
                self.processed_count += 1
                self.progress = 0.0

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        return {
            f"{self.id}.VacuumLevel": round(self.vacuum_level, 2),
            f"{self.id}.Temp": round(self.temperature, 1),
            f"{self.id}.progress": round(self.progress, 2),
            f"{self.id}.queue_in": len(self.queue_in),
            f"{self.id}.queue_out": len(self.queue_out)
        }

    def _calculate_power(self) -> float:
        # High power when vacuum pumps are running
        is_running = self.state == MachineState.RUNNING
        has_load = self.current_item is not None
        
        if is_running and has_load:
            return 85.0 # Pumps + Heaters
        elif is_running:
            return 15.0 # Just heaters
        return 0.0
