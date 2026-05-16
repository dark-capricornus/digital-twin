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
        
        # Logistics Analytics
        self.flow_history: List[float] = [] # Track throughput over time
        self.consumption_rate = 0.0
        self.production_rate = 0.0
        self.tte = 0.0
        self.ttf = 0.0
        
        # Casting specific
        if role == "casting":
            self.furnace_level_kg = 1200.0
            self.shot_weight_kg = 18.5

    # --- BaseMachine Implementation ---

    def _pre_start_checks(self) -> bool:
        """Safe to start if no critical faults (implied by BaseMachine check too)"""
        # print(f"[SIMPLE-MACHINE][{self.id}] Running pre-start checks...")
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
            # [USER] Operations: RUNNING -> IDLE -> TOOL_CHANGE -> COMPLETE
            if self.progress < 10: self.cycle_status = "IDLE"
            elif self.progress < 75: self.cycle_status = "RUNNING"
            elif self.progress < 90: self.cycle_status = "TOOL_CHANGE"
            else: self.cycle_status = "COMPLETE"

        elif "paint" in self.role:
            # [USER] Operations: SPRAYING -> IDLE -> CLEANING
            if self.progress < 70: 
                 self.cycle_status = "SPRAYING"
                 self.alarm_status = "NORMAL"
            elif self.progress < 85: 
                 self.cycle_status = "IDLE"
            else: 
                 self.cycle_status = "CLEANING"
            
            # Simulate Environment
            self.temperature = 22.0 + random.uniform(-0.5, 0.5)
            self.humidity = 60.0 + random.uniform(-2, 2)
            
            # Occasional Alarms
            if random.random() < 0.005: # Rare alarm
                 if "PAINT_01" in self.id:
                      self.alarm_status = random.choice(["Low Paint Pressure", "Filter Block", "Gun Fault"])
                 else: # Paint 02
                      self.alarm_status = random.choice(["Low Lacquer Pressure", "Air Fault", "Exhaust Fault"])

        elif self.role == "pretreat":
            # [USER] Operations: DEGREASE -> RINSE -> PHOSPHATE -> DRY
            if self.progress < 25: self.cycle_status = "DEGREASE"
            elif self.progress < 50: self.cycle_status = "RINSE"
            elif self.progress < 75: self.cycle_status = "PHOSPHATE"
            else: self.cycle_status = "DRY"

        elif self.role == "inspection":
            if self.progress < 80: self.cycle_status = "SCANNING"
            elif self.progress < 95: self.cycle_status = "COMPLETE"
            else: self.cycle_status = "IDLE"

        elif self.role == "heat_treat":
            if self.progress < 30: self.cycle_status = "HEATING"
            elif self.progress < 60: self.cycle_status = "SOAKING"
            elif self.progress < 70: self.cycle_status = "TRANSFER"
            elif self.progress < 80: self.cycle_status = "QUENCH"
            else: self.cycle_status = "AGING"
            
            # Temp simulation
            setpoint = 540.0
            if self.cycle_status == "HEATING":
                self.furnace_temp = 100.0 + (self.progress / 30.0) * (setpoint - 100.0)
            elif self.cycle_status == "SOAKING":
                self.furnace_temp = setpoint + random.uniform(-1, 1)
            elif self.cycle_status == "QUENCH":
                self.furnace_temp = setpoint - (self.progress - 70.0) * 10.0 # Rapid drop
            else: # AGING or TRANSFER
                self.furnace_temp = 180.0 if self.cycle_status == "AGING" else setpoint
            
            self.temp_setpoint = setpoint if self.cycle_status != "AGING" else 180.0

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
        if self.role in ["buffer", "inbound_buffer", "outbound_buffer"]:
            # Logic handled in _get_device_specific_tags to ensure total stock visibility
            pass
            
            # Simple Flow Calculation (Moving Average)
            self.flow_history.append(dt)
            if len(self.flow_history) > 100: self.flow_history.pop(0)
            
            # Use simulation events to drive rates
            if self.role == "inbound_buffer":
                # Simulated drain based on furnace demand (approx 0.5 parts/min)
                self.consumption_rate = 0.5 + random.uniform(-0.05, 0.05)
            else:
                # Simulated fill based on machine output (approx 0.4 parts/min)
                self.production_rate = 0.4 + random.uniform(-0.04, 0.04)
        if self.role == "casting":
            self._emit_event("LPDC_CYCLE_COMPLETE", {})
        elif self.role == "machining":
            self._emit_event("CNC_CYCLE_COMPLETE", {})

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        tags = {}
        
        if self.role == "casting":
            tags["Shot_Count"] = self.shot_count
            tags["Model_ID"] = "WHEEL_V1_SPORT"
            tags["Riser_Pressure"] = round(self.pressure_psi * 0.95, 1)
            tags["Pressure_Setpoint"] = 60.0
            tags["Holding_Pressure"] = 45.0 if self.cycle_status == "HOLDING" else 0.0
            tags["Holding_Furnace_Temp"] = round(getattr(self, 'holding_furnace_temp', 730.0), 1)
            tags["Die_Top_Temp"] = round(getattr(self, 'die_top_temp', 450.0), 1)
            tags["Die_Bottom_Temp"] = round(getattr(self, 'die_bottom_temp', 420.0), 1)
            tags["Cycle_Time"] = self.cycle_time
            # Cycle profile: FILLING 0-20%, HOLDING 20-70%, COOLING 70-85%, EJECTING 85-95%.
            # Fill = filling phase; solidification = under pressure (HOLDING + COOLING).
            tags["Fill_Time"] = round(self.cycle_time * 0.20, 2)
            tags["Solidification_Time"] = round(self.cycle_time * 0.65, 2)
            tags["Cycle_Status"] = self.cycle_status
            
        elif self.role == "machining":
            tags["Spindle_Speed"] = round(3500.0 if self.cycle_status == "RUNNING" else 0.0, 1)
            tags["Program_ID"] = "PRG_8821_OP10"
            tags["Part_Count"] = self.processed_count
            tags["Total_Parts_Machined"] = getattr(self, 'total_machined', self.processed_count)
            tags["Good_Part_Count"] = self.good_count
            tags["Reject_Count"] = self.reject_count
            tags["Cycle_Time"] = self.cycle_time
            tags["Cycle_Status"] = self.cycle_status
            
        elif "paint" in self.role:
            tags["Booth_Temp"] = round(self.temperature, 1)
            tags["Booth_Humidity"] = round(self.humidity, 1)
            tags["Air_Flow_Status"] = "ACTIVE"
            tags["Booth_Cycle_Status"] = self.cycle_status
            
        elif self.role == "pretreat":
            tags["Conveyor_Speed"] = round(1.2 if self.state.value == MachineState.RUNNING.value else 0.0, 1)
            tags["Stage_Status"] = self.cycle_status
            tags["Dryer_Temperature"] = round(120.0 if self.cycle_status == "DRY" else 45.0, 1)
            tags["Progress"] = round(self.progress, 1)
            tags["Step_Timer"] = round((self.progress / 100.0) * self.cycle_time, 1)
            
        elif self.role == "inbound_buffer" or "inbound" in self.id.lower():
            capacity = self.capacity or 500
            # Total stock = items waiting + processing + ready
            total_parts = len(self.queue_in) + (1 if self.current_item else 0) + len(self.queue_out)
            self.part_count = total_parts 
            
            tags["Part_Count"] = self.part_count
            tags["Capacity"] = capacity
            tags["Utilization"] = round((self.part_count / capacity) * 100, 1)
            tags["Total_Runtime"] = round(self.runtime_total_hrs, 2)
            
            # Inventory Status Logic
            if self.part_count == 0: tags["Inventory_Status"] = "EMPTY"
            elif self.part_count < (capacity * 0.2): tags["Inventory_Status"] = "LOW_STOCK"
            elif self.part_count >= capacity: tags["Inventory_Status"] = "FULL"
            else: tags["Inventory_Status"] = "HEALTHY"

            # Predictive TTE (Time to Empty)
            # Simulated consumption rate if not provided by orchestrator
            consumption = getattr(self, 'consumption_rate', 0.5) 
            tags["Consumption_Rate"] = round(consumption, 2)
            tags["TTE"] = round(self.part_count / consumption, 1) if consumption > 0 else 999.0

        elif self.role == "outbound_buffer" or "outbound" in self.id.lower():
            capacity = self.capacity or 200
            # Total stock = items waiting + processing + ready
            total_parts = len(self.queue_in) + (1 if self.current_item else 0) + len(self.queue_out)
            self.part_count = total_parts

            tags["Part_Count"] = self.part_count
            tags["Capacity"] = capacity
            tags["Utilization"] = round((self.part_count / capacity) * 100, 1)
            tags["Total_Runtime"] = round(self.runtime_total_hrs, 2)
            
            # Storage Pressure Logic
            if self.part_count >= capacity: tags["Storage_Pressure"] = "BLOCKED"
            elif self.part_count > (capacity * 0.85): tags["Storage_Pressure"] = "BACKPRESSURE"
            else: tags["Storage_Pressure"] = "CLEAR"

            # Predictive TTF (Time to Full)
            production = getattr(self, 'production_rate', 0.4)
            tags["Production_Rate"] = round(production, 2)
            tags["TTF"] = round((capacity - self.part_count) / production, 1) if production > 0 else 999.0
            tags["Ready_For_Shipping"] = (self.part_count >= capacity * 0.8)
        
        elif self.role == "inspection":
            tags["Scan_Status"] = self.cycle_status
            tags["Inspection_Cycle"] = self.processed_count + 1
            tags["Inspection_Cycle_Time"] = self.cycle_time
            tags["Inspected_Count"] = self.processed_count
            tags["OK_Count"] = self.good_count
            tags["Not_Good_Count"] = self.reject_count
        
        elif self.role == "heat_treat":
            tags["Furnace_Temperature"] = round(getattr(self, 'furnace_temp', 0.0), 1)
            tags["Temperature_Setpoint"] = round(getattr(self, 'temp_setpoint', 0.0), 1)
            tags["Process_Step"] = self.cycle_status
            tags["Step_Timer"] = round(self.stage_timer, 1)
            tags["Progress"] = round(self.progress, 1)
                
        return tags

    def _calculate_power(self) -> float:
        """
        Calculate power based on role and state.
        """
        is_running = self.state.value == MachineState.RUNNING.value
        
        if self.role == "machining":
            base = 40.0 if is_running else 2.0
        elif self.role == "casting":
            base = 60.0 if is_running else 10.0
        elif "paint" in self.role:
            base = 25.0 if is_running else 4.0
        elif self.role == "heat_treat":
            base = 120.0 if is_running else 15.0
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
