import logging
from .base_machine import BaseMachine, MachineState
from typing import Dict, Any, List

# Import physics models
import sys
import os
sys.path.append(os.path.dirname(__file__))
from ..physics import FurnacePhysics

logger = logging.getLogger("Physics")

class ThermalMachine(BaseMachine):
    """
    Machine with physics-based temperature model.
    Migrated to BaseMachine for SCADA compliance.
    """
    def __init__(self, machine_id: str, name: str, cycle_time: float, target_temp: float, cooling: bool = False):
        super().__init__(machine_id, name)
        self.cycle_time = cycle_time
        self.target_temp = target_temp
        self.is_cooling_tank = cooling
        
        # Physics Model
        self.physics = FurnacePhysics()
        
        # Control state
        self.heater_power = 0.0  # 0-100%
        
        # Logic State
        self.progress = 0.0
        self.current_item = None
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []

    # --- BaseMachine Overrides ---

    def tick(self, dt: float):
        """
        Override: Physics runs ALWAYS (unless SimulationEngine is frozen), 
        logic runs only if RUNNING.
        """
        # 1. Physics Step (Continuous)
        # Determine heater power based on simple thermostat logic (or manual if stopped?)
        # If STOPPED/FAULTED/IDLE, we might still want temp control to avoid freezing/overheating?
        # Industrial rule: If STOPPED, heaters usually OFF (Safe State).
        # We'll enforce safety in logic.
        
        # Apply Safe State logic for heaters if not RUNNING?
        # Actually, Furnace usually stays hot. 
        # But for this V1, let's assume "RUNNING" = "On/Controlling Temp". 
        # "STOPPED" = "Heaters Off".
        
        if self.state != MachineState.RUNNING:
             self.heater_power = 0.0
        
        self.physics.step(dt, {'heater_power': self.heater_power})

        # 2. Logic Step (Base implementation handles state transitions)
        super().tick(dt)

    def _pre_start_checks(self) -> bool:
        """Check if sensors are alive"""
        return True

    def _detect_fault(self) -> bool:
        """Over-temperature protection"""
        if self.physics.T_current > 1200.0:
            return True
        return False

    def _get_fault_code(self) -> int:
        return 201 # Over-temp

    def force_safe_state(self):
        """Kill power to heaters"""
        self.heater_power = 0.0
        
    def _execute_running_logic(self, dt: float):
        """
        Process Logic: Maintain Temp + Cook Product
        """
        current_temp = self.physics.T_current
        
        # 1. Thermostat Control
        if self.is_cooling_tank:
            # Cooling logic (passive or active?)
            # Assuming 'heater_power' acts as 'cooler power' if inverted? 
            # Or just heater=0 means natural cooling.
            self.heater_power = 0.0 
        else:
            # Heating Logic
            if current_temp < self.target_temp - 5.0:
                 self.heater_power = 100.0
            elif current_temp > self.target_temp + 5.0:
                 self.heater_power = 0.0
            else:
                 self.heater_power = 50.0 # Maintain
                 
        # 2. Process Material
        tolerance = 15.0
        temp_ok = abs(current_temp - self.target_temp) < tolerance
        
        if not temp_ok and not self.is_cooling_tank:
             return # Wait for temp (Heating only)
             
        # Load
        if self.current_item is None:
            if self.queue_in:
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
            else:
                return # Starved
                
        # Cook
        self.progress += (dt / self.cycle_time) * 100.0
        
        # Finish
        if self.progress >= 100.0:
            self.queue_out.append(self.current_item)
            self.current_item = None
            self.processed_count += 1
            self.progress = 0.0
            
            # Events
            if "furnace" in self.id:
                 self._emit_event("FURNACE_MELT_READY", {})
            elif "heat" in self.id:
                 self._emit_event("HEAT_TREATMENT_COMPLETE", {})
                 
    def _get_device_specific_tags(self) -> Dict[str, Any]:
        """Expose temperature and heater state"""
        # Physics state is updated in tick()
        return {
            f"{self.id}.temperature": round(self.physics.T_current, 1),
            f"{self.id}.target_temp": self.target_temp,
            f"{self.id}.max_temp": self.physics.T_max,
            f"{self.id}.burner_enable": self.heater_power > 0,
            f"{self.id}.progress": round(self.progress, 2),
            f"{self.id}.queue_in": len(self.queue_in),
            f"{self.id}.queue_out": len(self.queue_out),
        }

    # --- Legacy Helper ---
    def receive_item(self, item: Any) -> bool:
        self.queue_in.append(item)
        return True
