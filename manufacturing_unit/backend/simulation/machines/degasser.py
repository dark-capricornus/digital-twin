import random
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
        self.gas_flow_rate = 0.0
        self.rotor_speed = 0.0
        
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
        self.gas_flow_rate = 0.0
        self.rotor_speed = 0.0

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
                
            # Ramp down process variables
            self.gas_flow_rate *= 0.8
            self.rotor_speed *= 0.8
            
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
                
            # Simulate process variables
            self.gas_flow_rate = 12.5 + (self.progress / 10.0) # Gradually increase
            self.rotor_speed = 1500.0 + (self.progress * 5) # Gradually increase
            
            if self.progress >= 100.0:
                self.queue_out.append(self.current_item)
                self.current_item = None
                self.processed_count += 1
                self.progress = 0.0
                self.gas_flow_rate = 0.0
                self.rotor_speed = 0.0

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        tags = {}
        
        def add_tag(key, val):
            tags[f"{self.id}.{key}"] = val
            tags[key] = val

        # snake_case keys consumed by SimulationAdapter.TAG_MAP → SCADA UDT names.
        add_tag("Vacuum_Level", round(self.vacuum_level, 2))
        add_tag("Process_Temp", round(self.temperature, 1))
        add_tag("Progress", round(self.progress, 2))
        add_tag("Queue_In", len(self.queue_in))
        add_tag("Queue_Out", len(self.queue_out))
        add_tag("Alarm_Status", "NONE" if self.state.value != MachineState.FAULTED.value else "FAULT")
        
        # Plant level WIP for this sector
        wip_val = round(450.0 + (self.processed_count * 25.5) % 1000, 1)
        add_tag("Plant_WIP_Degassed_Metal", wip_val)
        
        return tags

    def _calculate_power(self) -> float:
        """
        Calculate power based on load and state.
        """
        is_running = self.state.value == MachineState.RUNNING.value
        has_load = self.current_item is not None
        
        if is_running and has_load:
            base = 85.0 # Pumps + Heaters
        elif is_running:
            base = 15.0 # Just heaters
        else:
            base = 0.0
            
        return round(base, 2)
