import random
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
        
        # Casting specific
        if role == "casting":
            self.furnace_level_kg = 1200.0
            self.shot_weight_kg = 18.5

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
            # Dynamic Pressure Profile
            if self.progress < 20: 
                self.cycle_status = "FILLING"
                # Ramp pressure from 0 to 45 PSI
                self.pressure_psi = (self.progress / 20.0) * 45.0
            elif self.progress < 70:
                self.cycle_status = "HOLDING"
                # Slight decay/oscillation in holding pressure
                self.pressure_psi = 60.0 + random.uniform(-0.2, 0.2)
            elif self.progress < 85:
                self.cycle_status = "COOLING"
                self.pressure_psi = 5.0
            elif self.progress < 95:
                self.cycle_status = "EJECTING"
                self.pressure_psi = 0.0
            else:
                self.cycle_status = "SPRAYING" # Die spray after ejection
                self.pressure_psi = 0.0
                
        elif self.role == "machining":
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
        
        # [ARCHITECTURE] Alias tags BOTH with and without prefix for robustness
        def add_tag(key, val):
            tags[f"{self.id}.{key}"] = val
            tags[key] = val

        # Role Tags
        if self.role == "casting":
            add_tag("Shot_Count", self.shot_count)
            add_tag("Model_ID", "WHEEL_V1_SPORT")
            add_tag("Riser_Pressure", round(self.pressure_psi * 0.95, 1))
            add_tag("Pressure_Setpoint", 60.0)
            add_tag("Holding_Pressure", 45.0 if self.cycle_status == "HOLDING" else 0.0)
            add_tag("Holding_Furnace_Temperature", round(getattr(self, 'holding_furnace_temp', 730.0), 1))
            add_tag("Die_Top_Temperature", round(getattr(self, 'die_top_temp', 450.0), 1))
            add_tag("Die_Bottom_Temperature", round(getattr(self, 'die_bottom_temp', 420.0), 1))
            add_tag("Cycle_Time", self.cycle_time)
            add_tag("Fill_Time", round(self.cycle_time * 0.2, 1))
            add_tag("Solidification_Time", round(self.cycle_time * 0.5, 1))
            add_tag("IsRunning", self.state == MachineState.RUNNING)
            add_tag("LPDC_Run_Status", self.state.value)
            add_tag("Cycle_Status", self.cycle_status)
            add_tag("Alarm_Status", self.alarm_status)
            add_tag("LPDC_Instant_kW", self.power_kw)
            add_tag("LPDC_Total_kWh", self.energy_kwh)
            
            # Consumption logic
            if hasattr(self, "furnace_level_kg"):
                add_tag("Furnace_Level_kg", round(self.furnace_level_kg, 1))
                add_tag("Shot_Weight_kg", self.shot_weight_kg)
                if self.cycle_status == "FILLING":
                     # Decrement level during filling based on progress in that stage
                     # This is a bit simplified but adds visual movement
                     self.furnace_level_kg -= 0.01 # Simulated consumption rate
            
        elif self.role == "machining":
            # Dynamic Spindle Speed simulation
            if self.state == MachineState.RUNNING and self.cycle_status == "RUNNING":
                current_rpm = 3500.0 + random.uniform(-15.0, 15.0)
            elif self.state == MachineState.RUNNING:
                current_rpm = 1200.0 + random.uniform(-5.0, 5.0) # Idle rotation
            else:
                current_rpm = 0.0

            add_tag("Spindle_RPM", round(current_rpm, 1))
            add_tag("Spindle_Speed", round(current_rpm, 1))
            add_tag("Program_ID", "PRG_8821_OP10")
            add_tag("Part_Count", self.processed_count)
            add_tag("Good_Part_Count", self.good_count)
            add_tag("Reject_Count", self.reject_count)
            add_tag("Cycle_Time", self.cycle_time)
            add_tag("IsRunning", self.state == MachineState.RUNNING)
            add_tag("Spindle_Vibration", round(random.uniform(0.002, 0.008), 4) if (self.state == MachineState.RUNNING and self.cycle_status == "RUNNING") else 0.0)
            add_tag("Coolant_Pressure", 85.0 if (self.state == MachineState.RUNNING and self.cycle_status == "RUNNING") else 0.0)
            add_tag("Tool_Number", random.randint(1, 12) if self.cycle_status == "RUNNING" else 0)
            add_tag("CNC_Run_Status", self.state.value)
            add_tag("Cycle_Status", self.cycle_status)
            add_tag("Alarm_Status", self.alarm_status)
            add_tag("CNC_Instant_kW", self.power_kw)
            add_tag("CNC_Total_kWh", self.energy_kwh)
            
        elif "paint" in self.role:
            prefix = "PB1" if "01" in self.id else "PB2"
            add_tag("Booth_Temperature", round(self.temperature, 1))
            add_tag("Booth_Humidity", round(self.humidity, 1))
            add_tag("Air_Flow_Status", "ACTIVE")
            add_tag("Booth_Cycle_Status", self.cycle_status)
            add_tag("IsRunning", self.state == MachineState.RUNNING)
            add_tag(f"{prefix}_Run_Status", self.state.value)
            add_tag("Paint_Run_Status", self.state.value)
            add_tag(f"{prefix}_Instant_kW", self.power_kw)
            add_tag(f"{prefix}_Total_kWh", self.energy_kwh)
            add_tag("Alarm_Status", self.alarm_status)
            
        elif "pretreat" in self.role:
            add_tag("Conveyor_Speed", self.conveyor_speed)
            add_tag("Stage_Status", self.cycle_status)
            add_tag("Dryer_Temperature", 120.0 if self.cycle_status == "DRY" else 45.0)
            add_tag("IsRunning", self.state == MachineState.RUNNING)
            add_tag("PT_Run_Status", self.state.value)
            add_tag("Pretreat_Run_Status", self.state.value)
            add_tag("PT_Instant_kW", self.power_kw)
            add_tag("PT_Total_kWh", self.energy_kwh)
            add_tag("Alarm_Status", self.alarm_status)
            
        elif self.role == "buffer" or "storage" in self.id.lower() or "inbound" in self.id.lower():
            add_tag("IsRunning", self.state == MachineState.RUNNING)
            add_tag("capacity", self.capacity)
            add_tag("Material_Count", self.part_count)
            add_tag("Pallet_Count", max(1, self.part_count // 4))
            add_tag("Fill_Level", round((self.part_count / self.capacity) * 100, 1))
            add_tag("Plant_WIP_Ingots_Available", 5000 - self.part_count)
            add_tag("Plant_KPI_Ingots_Consumed", 1500 + self.part_count)
            
        elif "outbound" in self.role or "outbound" in self.id.lower():
            add_tag("IsRunning", self.state == MachineState.RUNNING)
            add_tag("part_count", self.part_count)
            add_tag("capacity", self.capacity)
            add_tag("Pallet_Count", self.part_count)
            add_tag("Accumulating", self.part_count > 0)
            add_tag("Shipping_Status", "READY" if self.part_count > 0 else "WAITING")
            add_tag("Outbound_Status", "READY" if self.part_count > 0 else "WAITING")
            add_tag("Queue_Depth", len(self.queue_in))
            add_tag("System_Idle", "YES" if self.cycle_status == "IDLE" else "NO")
            add_tag("Plant_KPI_Total_Produced", 12500 + self.processed_count)
            add_tag("Dispatched_Count", self.processed_count)
            add_tag("Outbound_Instant_kW", self.power_kw)
            add_tag("Outbound_Total_kWh", self.energy_kwh)
            add_tag("Alarm_Status", self.alarm_status)
            
        return tags

    def _calculate_power(self) -> float:
        """
        Calculate power based on role and state.
        """
        is_running = self.state == MachineState.RUNNING
        
        if self.role == "machining":
            base = 40.0 if is_running else 2.0
        elif self.role == "casting":
            base = 60.0 if is_running else 10.0
        elif "paint" in self.role:
            base = 25.0 if is_running else 4.0
        elif self.role == "buffer":
            base = 2.0 if is_running else 0.5
        else:
            base = 10.0 if is_running else 1.0
            
        return round(base, 2)

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
