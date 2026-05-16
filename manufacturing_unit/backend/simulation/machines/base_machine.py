"""
Industrial-Grade Base Machine Class

CRITICAL RULES:
- IDLE/RUNNING/STOPPED/FAULTED states only
- Enable flag gates START command
- No direct OPC UA writes
- Cyclic tag publishing (every scan)
- PLC power gating enforced
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Dict, Any, Optional
from datetime import datetime

class MachineState(Enum):
    """Industrial State Codes (PackML Aligned)"""
    STOPPED = 0
    IDLE = 1
    RUNNING = 2
    FAULTED = 3


class BaseMachine(ABC):
    """
    Base class for all machines in the Virtual PLC.
    
    Enforces:
    - Power-aware execution
    - Enable-aware command handling
    - Cyclic tag publishing
    - Deterministic state transitions
    
    CRITICAL: This class ensures SCADA-indistinguishable behavior from real PLCs.
    """
    
    def __init__(self, machine_id: str, name: str, plc_ref=None):
        self.id = machine_id
        self.name = name
        self.plc = plc_ref  # Reference to parent PLC
        
        self.state = MachineState.STOPPED
        self.enabled = False  # CRITICAL: Must be True to START
        self.fault_code = 0   # 0 = no fault, >0 = fault code
        
        # Counters
        self.processed_count = 0
        self.runtime_total_hrs = 0.0 # Accumulated session runtime
        
        # Metrics
        self.power_kw = 0.0 # Instantaneous power consumption
        self.energy_kwh = 0.0 # Cumulative energy consumed
        
        # --- NEW: Simulated Industrial Tags (Not yet in SCADA) ---
        self.vibration = 0.05       # Base vibration (mm/s)
        self.motor_load = 0.0       # % load
        self.oil_level = 98.5       # % level
        self.air_pressure = 92.0    # PSI
        self.internal_temp = 28.5   # Celsius
        
        # Internal flags
        self._process_done = False
        
        # Event dispatcher (set by SimulationEngine)
        self._event_dispatcher: Optional[Any] = None
    
    # ============================================================
    # COMMAND HANDLERS (Standard across all machines)
    # ============================================================
    
    def handle_start_command(self) -> bool:
        """
        Command-driven transition: IDLE → RUNNING
        
        CRITICAL: Enforces enable flag check
        """
        # print(f"[MACHINE][{self.id}] handle_start_command entered. Current State: {self.state}")
        
        if self.state.value != MachineState.IDLE.value:
            # print(f"[MACHINE][{self.id}] Start rejected: State value is {self.state.value} (Not IDLE)")
            return False
        
        if not self.enabled:
            # Silently ignore start command if not enabled (prevents faulting when PLC is OFF)
            print(f"[MACHINE][{self.id}] Start ignored: Machine not enabled (PLC might be OFF)")
            return False
        
        if not self._pre_start_checks():
            # print(f"[MACHINE][{self.id}] Start failed: Pre-start checks failed")
            self.fault_code = 102  # "Pre-start check failed"
            self.state = MachineState.FAULTED
            return False
        
        # print(f"[MACHINE][{self.id}] Transitioning to RUNNING")
        self.state = MachineState.RUNNING
        self._on_start()  # Device-specific startup logic
        return True
    
    def handle_stop_command(self) -> bool:
        """Command-driven transition: RUNNING → IDLE (ready for restart)"""
        if self.state.value == MachineState.RUNNING.value:
            self.state = MachineState.IDLE
            self._on_stop()  # Device-specific shutdown logic
            return True
        return False
    
    def handle_reset_command(self) -> bool:
        """Command-driven transition: STOPPED/FAULTED → IDLE"""
        if self.state.value in [MachineState.STOPPED.value, MachineState.FAULTED.value]:
            self.fault_code = 0
            self.state = MachineState.IDLE
            self._on_reset()  # Device-specific reset logic
            return True
        return False
    
    def force_safe_state(self):
        """Called during PLC STOPPING - force to safe state"""
        if self.state.value == MachineState.RUNNING.value:
            self.state = MachineState.STOPPED
        self._on_safe_stop()
    
    def set_command(self, cmd_name: str, value: bool):
        """Interface for SCADA/HMI to send commands (edge-triggered)"""
        if not value:
            return
            
        if cmd_name == "start":
            self.handle_start_command()
        elif cmd_name == "stop":
            self.handle_stop_command()
        elif cmd_name == "reset":
            self.handle_reset_command()
    
    # ============================================================
    # CYCLIC EXECUTION (Called every PLC scan)
    # ============================================================
    
    def tick(self, dt: float):
        """
        Main simulation step. Enforces State Machine transitions.
        
        CRITICAL: This is called by SimulationEngine, which is gated by PLC power.
        """
        # Check for faults (automatic transition)
        if self.state.value == MachineState.RUNNING.value:
            if self._detect_fault():
                self.fault_code = self._get_fault_code()
                self.state = MachineState.FAULTED
                return
        
        # Execute device-specific logic
        if self.state.value == MachineState.RUNNING.value:
            self.runtime_total_hrs += dt / 3600.0
            self._execute_running_logic(dt)
        
        # Calculate power (State-dependent)
        self.power_kw = self._calculate_power()
        
        # Accumulate energy (kW * hours)
        self.energy_kwh += self.power_kw * (dt / 3600.0)
        
        # --- Simulate Industrial Tags ---
        is_running = self.state.value == MachineState.RUNNING.value
        
        # 1. Vibration (Operational intensity without random noise)
        if is_running:
            target_vib = 1.2
            self.vibration += (target_vib - self.vibration) * 0.1 # Smoothing
        else:
            self.vibration += (0.05 - self.vibration) * 0.05
            
        # 2. Motor Load
        if is_running:
            target_load = 75.0
            self.motor_load += (target_load - self.motor_load) * 0.1
        else:
            self.motor_load += (0.0 - self.motor_load) * 0.2
            
        # 3. Oil Level (Slow bleed simulation - logic-based, not random)
        if is_running:
            self.oil_level -= 0.0001 # Extremely slow decrease
            
        # 4. Air Pressure (Steady at setpoint)
        self.air_pressure = 92.0
        
        # 5. Internal Temp (Heats up when running - deterministic)
        if is_running:
            target_temp = 48.0
            self.internal_temp += (target_temp - self.internal_temp) * 0.1
        else:
            self.internal_temp += (28.5 - self.internal_temp) * 0.05
    
    def set_event_dispatcher(self, dispatcher):
        """Set event dispatcher for event emission"""
        self._event_dispatcher = dispatcher
    
    def _emit_event(self, event_type, data: Dict[str, Any] = None):
        """Emit production event to Flow Engine"""
        if self._event_dispatcher is None:
            return
        
        from ..flow.events import Event
        import time
        
        event = Event(
            type=event_type,
            timestamp=time.time(),
            device_id=self.id,
            data=data or {}
        )
        self._event_dispatcher.emit(event)
    
    # ============================================================
    # TAG INTERFACE (For OPC UA publishing)
    # ============================================================
    
    def get_tags(self) -> Dict[str, Any]:
        """
        Exposes state to SCADA layer.
        
        CRITICAL: Called EVERY scan, regardless of state.
        """
        # Map state enum to human-readable string for run_status
        state_map = {
            MachineState.STOPPED: "STOPPED",
            MachineState.IDLE: "IDLE",
            MachineState.RUNNING: "RUNNING",
            MachineState.FAULTED: "FAULTED"
        }
        
        base_tags = {
            f"{self.id}.state": self.state.value,
            f"{self.id}.run_status": state_map.get(self.state, "UNKNOWN"),
            f"{self.id}.is_running": self.state == MachineState.RUNNING,
            f"{self.id}.power_kw": round(self.power_kw, 2),
            f"{self.id}.energy_kwh": round(self.energy_kwh, 4),
            f"{self.id}.alarm_status": "NONE" if self.fault_code == 0 else f"FAULT_{self.fault_code}",
            f"{self.id}.progress": round(getattr(self, 'progress', 0.0), 2),
            f"{self.id}.vibration": round(self.vibration, 3),
            f"{self.id}.motor_load": round(self.motor_load, 1),
            f"{self.id}.oil_level": round(self.oil_level, 2),
            f"{self.id}.air_pressure": round(self.air_pressure, 1),
            f"{self.id}.internal_temp": round(self.internal_temp, 1),
            f"{self.id}.runtime_total_hrs": round(self.runtime_total_hrs, 2),
        }
        
        # Add device-specific tags
        device_tags = self._get_device_specific_tags()
        # Ensure device tags are also prefixed with machine ID if not already
        for k, v in device_tags.items():
            key = k if k.startswith(f"{self.id}.") else f"{self.id}.{k}"
            base_tags[key] = v
        
        return base_tags
    
    # ============================================================
    # ABSTRACT METHODS (Device-specific implementation)
    # ============================================================
    
    @abstractmethod
    def _pre_start_checks(self) -> bool:
        """Override: Return True if safe to start"""
        pass
    
    @abstractmethod
    def _detect_fault(self) -> bool:
        """Override: Return True if fault detected"""
        pass
    
    @abstractmethod
    def _get_fault_code(self) -> int:
        """Override: Return fault code"""
        pass
    
    @abstractmethod
    def _execute_running_logic(self, dt: float):
        """Override: Device-specific logic when RUNNING"""
        pass
    
    @abstractmethod
    def _get_device_specific_tags(self) -> Dict[str, Any]:
        """Override: Return dict of device-specific tags"""
        pass
    
    @abstractmethod
    def _calculate_power(self) -> float:
        """Override: Return current power consumption in kW"""
        pass
    
    # ============================================================
    # HOOKS (Optional overrides)
    # ============================================================
    
    def _on_start(self):
        """Hook: Called when transitioning to RUNNING"""
        pass
    
    def _on_stop(self):
        """Hook: Called when transitioning to STOPPED"""
        pass
    
    def _on_reset(self):
        """Hook: Called when resetting from STOPPED/FAULTED"""
        pass
    
    def _on_safe_stop(self):
        """Hook: Called during PLC STOPPING"""
        pass
