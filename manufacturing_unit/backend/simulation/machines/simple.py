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
        
        # New Process Stages & Timers
        self.cycle_status = "IDLE"
        self.stage_timer = 0.0
        self.shot_count = 0
        self.good_count = 0
        self.reject_count = 0
        self.alarm_status = "NORMAL"
        
        # Environment (Booth / Pre-treat)
        self.temperature = 25.0
        self.humidity = 45.0
        self.conveyor_speed = 0.0
        
        # Accumulation State
        self.accumulating = False

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
        self.cycle_status = "IDLE"
        self.stage_timer = 0.0
        self.alarm_status = "NORMAL"
        
    def _execute_running_logic(self, dt: float):
        """
        Executed ONLY when State=RUNNING.
        """
        import random
        
        # 1. Try to Load
        if self.current_item is None:
            if self.queue_in:
                if self.role == "machining" and self.has_trigger and not self.cmd_trigger:
                     self.cycle_status = "IDLE"
                     return
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
                self.stage_timer = 0.0
                self.cmd_trigger = False
                self.cmd_pour_request = False
            elif self.role == "casting":
                if self.has_pour and not self.cmd_pour_request:
                     self.cycle_status = "IDLE"
                     return
                self.current_item = "MoltenMetal_Shot"
                self.progress = 0.0
                self.stage_timer = 0.0
                self.cmd_pour_request = False
                self.alarm_status = "NORMAL"
                # Simulated Casting Params
                self.holding_furnace_temp = 730.0 + random.uniform(-2, 2)
                self.die_top_temp = 450.0 + random.uniform(-5, 5)
                self.die_bottom_temp = 420.0 + random.uniform(-5, 5)
            elif "paint" in self.role or "pretreat" in self.role:
                # Continuous load simulation
                self.current_item = "Part"
                self.progress = 0.0
                self.stage_timer = 0.0
                self.alarm_status = "NORMAL"
            else:
                self.cycle_status = "IDLE"
                return

        # 2. Role-specific Stage Transitions
        self.progress += (dt / self.cycle_time) * 100.0
        self.stage_timer += dt

        if self.role == "casting":
            if self.progress < 20: 
                self.cycle_status = "FILLING"
                self.pressure_psi = 45.0
            elif self.progress < 70:
                self.cycle_status = "HOLDING"
                self.pressure_psi = 60.0 # Solidification pressure
            elif self.progress < 90:
                self.cycle_status = "COOLING"
                self.pressure_psi = 5.0
            else:
                self.cycle_status = "EJECTING"
                self.pressure_psi = 0.0
                
        elif self.role == "machining":
            self.spindle_rpm = 3500.0
            if self.progress < 15: self.cycle_status = "STARTING"
            elif self.progress < 85: self.cycle_status = "RUNNING"
            elif self.progress < 95: self.cycle_status = "TOOL_CHANGE"
            else: self.cycle_status = "COMPLETE"

        elif "paint" in self.role:
            # Cycle between SPRAYING -> IDLE -> CLEANING
            if self.progress < 70: 
                 self.cycle_status = "SPRAYING"
                 self.alarm_status = "NORMAL"
            elif self.progress < 90: 
                 self.cycle_status = "CLEANING"
            else: 
                 self.cycle_status = "IDLE"
            
            # Simulate Environment
            self.temperature = 22.0 + random.uniform(-0.5, 0.5)
            self.humidity = 60.0 + random.uniform(-2, 2)
            
            # Occasional Alarms
            if random.random() < 0.005: # Rare alarm
                 if "PAINT_01" in self.id:
                      self.alarm_status = random.choice(["Low Paint Pressure", "Filter Block", "Gun Fault"])
                 else: # Paint 02
                      self.alarm_status = random.choice(["Low Lacquer Pressure", "Air Fault", "Exhaust Fault"])

        elif "pretreat" in self.role:
            self.conveyor_speed = 1.2 # m/min
            if self.progress < 25: self.cycle_status = "DEGREASE"
            elif self.progress < 50: self.cycle_status = "RINSE"
            elif self.progress < 75: self.cycle_status = "PHOSPHATE"
            else: self.cycle_status = "DRY"

        # 3. Finish
        if self.progress >= 100.0:
            self.queue_out.append(self.current_item)
            self.current_item = None
            self.processed_count += 1
            self.shot_count += 1
            
            # Simple QA Simulation
            if random.random() < 0.02: # 2% reject rate
                self.reject_count += 1
            else:
                self.good_count += 1
                
            self.progress = 0.0
            self.stage_timer = 0.0
            
        # 4. Accumulation Logic
        # If we have more than 5 items waiting to be picked up by the next machine
        self.accumulating = len(self.queue_out) > 5
            
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
            f"{self.id}.cycle_status": self.cycle_status,
            f"{self.id}.stage_timer": round(self.stage_timer, 1),
            f"{self.id}.alarm_status": self.alarm_status,
            f"{self.id}.accumulating": self.accumulating,
        }
        
        # Role Tags
        if self.role == "casting":
            tags[f"{self.id}.pressure_psi"] = round(self.pressure_psi, 1)
            tags[f"{self.id}.pressure_setpoint"] = 60.0
            tags[f"{self.id}.riser_pressure"] = round(self.pressure_psi * 0.95, 1)
            tags[f"{self.id}.holding_pressure"] = 45.0 if self.cycle_status == "HOLDING" else 0.0
            tags[f"{self.id}.holding_furnace_temp"] = round(getattr(self, 'holding_furnace_temp', 730.0), 1)
            tags[f"{self.id}.die_top_temp"] = round(getattr(self, 'die_top_temp', 450.0), 1)
            tags[f"{self.id}.die_bottom_temp"] = round(getattr(self, 'die_bottom_temp', 420.0), 1)
            tags[f"{self.id}.fill_time"] = self.cycle_time * 0.2
            tags[f"{self.id}.solidification_time"] = self.cycle_time * 0.5
            tags[f"{self.id}.shot_count"] = self.shot_count
            tags[f"{self.id}.model_id"] = "WHEEL_V1_SPORT"
            
        elif self.role == "machining":
            tags[f"{self.id}.spindle_rpm"] = round(self.spindle_rpm, 1)
            tags[f"{self.id}.program_id"] = "PRG_8821_OP10"
            tags[f"{self.id}.good_count"] = self.good_count
            tags[f"{self.id}.reject_count"] = self.reject_count
            
        elif "paint" in self.role:
            tags[f"{self.id}.temperature"] = round(self.temperature, 1)
            tags[f"{self.id}.humidity"] = round(self.humidity, 1)
            tags[f"{self.id}.air_flow"] = "ACTIVE"
            
        elif "pretreat" in self.role:
            tags[f"{self.id}.conveyor_speed"] = self.conveyor_speed
            tags[f"{self.id}.dryer_temp"] = 120.0 if self.cycle_status == "DRY" else 45.0
            
        elif self.role == "buffer":
            tags[f"{self.id}.part_count"] = self.part_count
            tags[f"{self.id}.capacity"] = self.capacity
            
        return tags

    def _calculate_power(self) -> float:
        """
        Calculate power based on role and state.
        """
        is_running = self.state == MachineState.RUNNING
        
        if self.role == "machining":
            return 40.0 if is_running else 2.0
        elif self.role == "casting":
            return 60.0 if is_running else 10.0
        elif "paint" in self.role:
            return 25.0 if is_running else 4.0
        elif self.role == "buffer":
            return 2.0 if is_running else 0.5
            
        return 10.0 if is_running else 1.0

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
