import random
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
        # Control state
        self.heater_power = 0.0  # 0-100%
        
        # Logic State
        self.progress = 0.0
        self.current_item = None
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []
        
        # Specialized Parameters
        self.mode = "IDLE"
        self.step_timer = 0.0
        self.zone_temps = {"roof": target_temp, "wall": target_temp, "bath": target_temp}
        self.alarm_status = "NORMAL"

    # --- BaseMachine Overrides ---

    def tick(self, dt: float):
        """
        Override: Physics runs ALWAYS (unless SimulationEngine is frozen), 
        logic runs only if RUNNING.
        """
        if self.state.value != MachineState.RUNNING.value:
             self.heater_power = 0.0
        
        self.physics.step(dt, {'heater_power': self.heater_power})

        # Update Zone Temperatures (Deterministic variation based on bath temp)
        base_temp = self.physics.T_current
        self.zone_temps["bath"] = base_temp
        self.zone_temps["roof"] = base_temp + 10.0
        self.zone_temps["wall"] = base_temp - 5.0

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
        self.mode = "IDLE"
        self.step_timer = 0.0
        self.alarm_status = "NORMAL"
        
    def _execute_running_logic(self, dt: float):
        """
        Process Logic: Maintain Temp + Cook Product
        """
        import random
        current_temp = self.physics.T_current
        
        # 1. Thermostat Control
        if self.is_cooling_tank:
            self.heater_power = 0.0 
            self.mode = "COOLING"
        else:
            # Heating Logic
            if current_temp < self.target_temp - 5.0:
                 self.heater_power = 100.0
                 self.mode = "MELT"
            elif current_temp > self.target_temp + 5.0:
                 self.heater_power = 0.0
                 self.mode = "HOLD"
            else:
                 self.heater_power = 50.0 # Maintain
                 self.mode = "HOLD"
                 
        # 2. Process Material
        tolerance = 15.0
        temp_ok = abs(current_temp - self.target_temp) < tolerance
        
        # Load
        if self.current_item is None:
            if self.queue_in:
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
                self.step_timer = 0.0
                self.alarm_status = "NORMAL"
            else:
                # Furnace can be in other modes when idle
                if "furnace" in self.id:
                     if self.step_timer > 60.0: # Rotate idle modes every minute
                          self.mode = random.choice(["CHARGE", "PREHEAT", "CLEANING", "IDLE"])
                          self.step_timer = 0.0
                else:
                     self.mode = "IDLE"
                
                self.step_timer += dt
                return
                
        # Cook
        if not temp_ok and not self.is_cooling_tank:
             return # Wait for temp
             
        self.progress += (dt / self.cycle_time) * 100.0
        self.step_timer += dt
        
        # Specialized Logic for Heat Treat
        if "heat" in self.id.lower():
            if self.progress < 20: self.mode = "HEATING"
            elif self.progress < 50: self.mode = "SOAKING"
            elif self.progress < 60: self.mode = "TRANSFER"
            elif self.progress < 80: self.mode = "QUENCH"
            else: self.mode = "AGING"
            
            # Aging/Quench temp variation
            if self.mode == "QUENCH":
                self.physics.T_current -= dt * 25.0 # Fast cooling
            elif self.mode == "AGING":
                self.target_temp = 180.0
        
        # Finish
        if self.progress >= 100.0:
            if "heat" in self.id.lower():
                 self.target_temp = 540.0 # Reset for next batch
            self.queue_out.append(self.current_item)
            self.current_item = None
            self.processed_count += 1
            self.progress = 0.0
            self.step_timer = 0.0
            
            # Events
            if "furnace" in self.id:
                 self._emit_event("FURNACE_MELT_READY", {})
            elif "heat" in self.id:
                 self._emit_event("HEAT_TREATMENT_COMPLETE", {})
                 
    def _get_device_specific_tags(self) -> Dict[str, Any]:
        """Expose temperature and specialized modes/timers matching the tag report"""
        temp = round(self.physics.T_current, 1)
        tags = {}
        
        if self.is_cooling_tank:
            tags["process_temp"] = temp
            tags["target_temp"] = self.target_temp
            tags["progress"] = round(self.progress, 2)
            tags["cooling_mode"] = self.mode
            
        elif "furnace" in self.id.lower():
            tags["Roof_Temp"] = round(self.zone_temps["roof"], 1)
            tags["Wall_Temp"] = round(self.zone_temps["wall"], 1)
            tags["Bath_Temp"] = round(self.zone_temps["bath"], 1)
            tags["Furnace_Mode"] = self.mode
            tags["Melt_Timer"] = round(self.step_timer, 1) if self.mode == "MELT" else 0.0
            tags["Hold_Timer"] = round(self.step_timer, 1) if self.mode == "HOLD" else 0.0
            
        elif "heat" in self.id.lower():
            tags["Furnace_Temperature"] = temp
            tags["Temperature_Setpoint"] = self.target_temp
            tags["Process_Step"] = self.mode
            tags["Step_Timer"] = round(self.step_timer, 1)
            tags["Progress"] = round(self.progress, 2)
            
        return tags

    def _calculate_power(self) -> float:
        """
        Calculate power based on furnace/tank type and state.
        """
        is_running = self.state.value == MachineState.RUNNING.value
        
        if "furnace" in self.id.lower():
            base = 120.0 if is_running else 15.0
        elif "heat" in self.id.lower():
            base = 80.0 if is_running else 10.0
        elif "cooling" in self.id.lower():
            base = 5.0 if is_running else 1.0
        else:
            base = 10.0 if is_running else 1.0
            
        return round(base, 2)

    # --- Legacy Helper ---
    def receive_item(self, item: Any) -> bool:
        self.queue_in.append(item)
        return True
