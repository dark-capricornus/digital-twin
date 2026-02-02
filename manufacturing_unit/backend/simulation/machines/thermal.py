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
        
        # Simulation State
        self.progress = 0.0
        self.current_item = None
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []
        self.processed_count = 0

    def receive_item(self, item: Any) -> bool:
        self.queue_in.append(item)
        return True

    def _pre_start_checks(self) -> bool:
        return True

    def _detect_fault(self) -> bool:
        # Fault if temp exceeds safe limit drastically?
        if self.physics.T_current > 1200.0: # Arbitrary safety limit
            return True
        return False

    def _get_fault_code(self) -> int:
        return 201 # Over-temp

    def _execute_running_logic(self, dt: float):
        """
        Combined logic for Heating (formerly Starting) and Processing (Running).
        """
        # 1. Thermal Control (Bang-Bang)
        current_temp = self.physics.T_current
        
        # Simple Logic: Heat/Cool to target
        if current_temp < self.target_temp - 5.0:
            self.heater_power = 100.0
        elif current_temp > self.target_temp + 5.0:
            self.heater_power = 0.0
        else:
            self.heater_power = 50.0  # Maintain
            
        if self.is_cooling_tank:
             # Invert logic implies different physics, but FurnacePhysics is likely generic heat transfer
             # If target is low (25C) and current is high (500C), heater=0 allows cooling.
             # We assume physics handles cooling naturally if power=0.
             self.heater_power = 0.0 # Force natural cooling? Or active cooling?
             # For now keep naive control, assuming physics handles ambient loss.
             pass

        # Step Physics
        physics_outputs = self.physics.step(dt, {'heater_power': self.heater_power})

        # 2. Production Logic (Only if Temp within tolerance)
        tolerance = 10.0
        temp_ok = abs(current_temp - self.target_temp) < tolerance
        
        if not temp_ok:
            return # Wait for temp
            
        # 3. Item Processing
        if self.current_item is None:
            if self.queue_in:
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
            else:
                return

        self.progress += (dt / self.cycle_time) * 100.0
        
        if self.progress >= 100.0:
            self.queue_out.append(self.current_item)
            self.current_item = None
            self.processed_count += 1
            self.progress = 0.0
            
            if "furnace" in self.id:
                 self._emit_event("FURNACE_MELT_READY", {})
            elif "heat" in self.id:
                 self._emit_event("HEAT_TREATMENT_COMPLETE", {})

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        """Expose physics outputs as tags."""
        # Get physics state (read-only peek)
        physics_outputs = self.physics.step(0.0, {'heater_power': self.heater_power})
        
        return {
            f"{self.id}.temperature": round(physics_outputs['temperature'], 1),
            f"{self.id}.target_temp": self.target_temp,
            f"{self.id}.burner_enable": self.heater_power > 0,
            f"{self.id}.heating_rate": round(physics_outputs['heating_rate'], 3),
            f"{self.id}.progress": round(self.progress, 2),
            f"{self.id}.queue_in": len(self.queue_in),
            f"{self.id}.queue_out": len(self.queue_out),
        }
