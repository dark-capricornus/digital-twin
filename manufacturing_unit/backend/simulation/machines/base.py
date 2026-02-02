from abc import ABC, abstractmethod
from enum import Enum
from typing import Dict, Any, List, Optional

class MachineState(Enum):
    OFF = "OFF"
    IDLE = "IDLE"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    STOPPING = "STOPPING"
    FAULT = "FAULT"

class ParamValidator:
    """Helper to validate machine parameters."""
    @staticmethod
    def validate_positive(value, name):
        if value < 0:
            raise ValueError(f"{name} must be positive")
        return value

class Machine(ABC):
    """
    Abstract Base Class for all machines in the Digital Twin.
    Implements a Common PLC State Machine.
    """
    def __init__(self, machine_id: str, name: str, cycle_time: float):
        self._id = machine_id
        self._name = name
        self._cycle_time = ParamValidator.validate_positive(cycle_time, "Cycle time")
        
        # Internal State
        self._state = MachineState.OFF  # Default to OFF, requires PowerOn
        self._progress = 0.0  # 0 to 100%
        self._total_processed = 0
        
        # Control Signals (Momentary/Stateful)
        self.cmd_start = False
        self.cmd_stop = False
        self.cmd_reset = False
        self.cmd_estop = False
        self.cmd_auto = True  # Default to Auto Mode
        
        # Internal Logic Flags
        self._fault_active = False
        self._process_done = False # Signal from subclass that process is finished
        self._process_ready = False # Signal from subclass that initialization is done (STARTING->RUNNING)

        # Buffers
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []
        self.current_item = None
        
        # Phase 2: Event Dispatcher (set by SimulationEngine)
        self._event_dispatcher: Optional[Any] = None  # EventDispatcher from flow module

    @property
    def id(self):
        return self._id

    @property
    def state(self):
        return self._state

    def power_on(self):
        """Simulate power-on sequence."""
        if self._state == MachineState.OFF:
            self._state = MachineState.IDLE
    
    def set_event_dispatcher(self, dispatcher):
        """
        Set event dispatcher for event emission.
        
        Called by SimulationEngine during machine registration.
        """
        self._event_dispatcher = dispatcher
    
    def _emit_event(self, event_type, data: Dict[str, Any] = None):
        """
        Emit production event to Flow Engine.
        
        Args:
            event_type: ProductionEventType
            data: Event data (part_id, batch_id, etc.)
        """
        if self._event_dispatcher is None:
            return  # No dispatcher set (e.g., in unit tests)
        
        # Import here to avoid circular dependency
        from ..flow.events import Event
        import time
        
        event = Event(
            type=event_type,
            timestamp=time.time(),  # Will be replaced with sim_time in integration
            device_id=self._id,
            data=data or {}
        )
        self._event_dispatcher.emit(event)

    def set_command(self, cmd_name: str, value: bool):
        """Interface for SCADA/HMI to send commands."""
        if cmd_name == "start": self.cmd_start = value
        elif cmd_name == "stop": self.cmd_stop = value
        elif cmd_name == "reset": self.cmd_reset = value
        elif cmd_name == "estop": self.cmd_estop = value
        elif cmd_name == "auto": self.cmd_auto = value

    def tick(self, dt: float) -> None:
        """
        Main simulation step. Enforces State Machine transitions.
        """
        # 1. Update State Machine
        self._update_state_machine(dt)
        
        # 2. Execute Logic based on State
        if self._state == MachineState.RUNNING:
            self._process_tick(dt)
        elif self._state == MachineState.STARTING:
            self._starting_tick(dt)
        elif self._state == MachineState.STOPPING:
            self._stopping_tick(dt)
            
        # 3. Post-Tick Cleanup (Momentary commands)
        # In a real PLC, inputs stay high. Here we assume one-shot commands for simplicity 
        # unless driven continuously by the gateway. 
        # For now, we will NOT auto-reset them to allow the gateway to hold them if needed.
        # But we must ensure rising-edge logic if we want strict PLC behavior. 
        # Given the "Review" instructions: "Commands are momentary". 
        # Let's reset the momentary ones (Start/Stop/Reset) to simulate a "Key Press" handled in one cycle.
        self.cmd_start = False
        self.cmd_stop = False
        self.cmd_reset = False
        # E-Stop and Auto are usually latched switches or persistent signals.
    
    def check_interlocks(self) -> bool:
        """
        Check if safe to start. 
        Subclasses can override to check downstream/upstream, safety doors, etc.
        """
        # Default: Safe unless E-Stop or Fault active (already handled by priority logic)
        return True

    def _update_state_machine(self, dt: float):
        """
        Central PLC State Transition Logic.
        """
        # --- Priority 0: Hard Constraints / Safety ---
        if self.cmd_estop:
            self.set_fault(True)
        
        if self._fault_active:
            self._state = MachineState.FAULT

        # --- Priority 1: Transitions ---
        
        # FAULT -> IDLE
        if self._state == MachineState.FAULT:
            if self.cmd_reset and not self.cmd_estop:  # And check if underlying cause is gone?
                self._fault_active = False # Assume reset clears it if EStop is gone
                self._state = MachineState.IDLE
            return # Block other transitions

        # OFF -> IDLE
        if self._state == MachineState.OFF:
            # Requires power_on() call or implicit system start. 
            pass

        # IDLE -> STARTING
        if self._state == MachineState.IDLE:
            # STRICT RULE: Start Command + Auto Mode + Interlocks
            if self.cmd_start and self.cmd_auto and self.check_interlocks():
                self._state = MachineState.STARTING
                self._process_ready = False # Reset ready flag
                self._process_done = False
                
        # STARTING -> RUNNING
        if self._state == MachineState.STARTING:
            # Subclasses set _process_ready = True when ready (e.g. Temp reached)
            if self._process_ready:
                self._state = MachineState.RUNNING

        # RUNNING -> STOPPING
        if self._state == MachineState.RUNNING:
            if self.cmd_stop:
                self._state = MachineState.STOPPING
        
        # STOPPING -> IDLE
        if self._state == MachineState.STOPPING:
            # Wait for clean finish
            if self._process_done or self.current_item is None:
                self._state = MachineState.IDLE

    def _starting_tick(self, dt: float):
        """Default behavior for STARTING phase."""
        # By default, machines require no startup time.
        self._process_ready = True

    def _stopping_tick(self, dt: float):
        """Default behavior for STOPPING phase."""
        # Continue processing until item done
        if self.current_item:
            self._process_tick(dt) # Finish current work
        else:
            self._process_done = True

    @abstractmethod
    def _process_tick(self, dt: float) -> None:
        """
        Specific logic for RUNNING state.
        Should update self._process_done = True when cycle complete.
        """
        pass

    def get_tags(self) -> Dict[str, Any]:
        """
        Exposes state to SCADA layer.
        """
        return {
            f"{self._id}.state": self._state.value,
            f"{self._id}.progress": round(self._progress, 2),
            f"{self._id}.processed_count": self._total_processed,
            f"{self._id}.queue_in": len(self.queue_in),
            f"{self._id}.queue_out": len(self.queue_out),
            f"{self._id}.fault": self._fault_active,
            f"{self._id}.cmd_auto": self.cmd_auto
        }

    def set_fault(self, active: bool):
        """Simulate a fault injection."""
        self._fault_active = active
        if active:
            self._state = MachineState.FAULT

    def receive_item(self, item: Any) -> bool:
        """Try to push an item into the input queue."""
        # Allow receive in most states except strictly FAULT? 
        # Actually in FAULT conveyors might stop.
        if self._state == MachineState.FAULT:
            return False
        self.queue_in.append(item)
        return True

    def retrieve_item(self) -> Any:
        # Standard retrieve
        if self.queue_out:
            return self.queue_out.pop(0)
        return None
