import time
from typing import List, Dict, Any
from .machines import Machine
from .flow import EventDispatcher, MaterialFlowEngine

class SimulationEngine:
    """
    Manages the main simulation loop and time.
    Singleton-like role in the architecture.
    """
    def __init__(self, time_step: float = 0.2, plc_ref=None):
        """
        Initialize Simulation Engine with FIXED timestep.
        
        Args:
            time_step: Fixed simulation timestep in seconds (default: 0.2s = 200ms = 5 Hz)
            plc_ref: Reference to PLC for power state gating
        
        CRITICAL: Timestep is FIXED for deterministic physics.
        All machines step synchronously with this dt.
        """
        self.machines: List[Machine] = []
        self.time_step = time_step  # FIXED timestep (deterministic)
        self.running = False
        self.ticks = 0
        self.sim_time = 0.0  # Global simulation clock (seconds)
        self.post_step_callbacks = []
        self.plc_ref = plc_ref  # Reference to PLC for power gating
        
        # Phase 2: Material Flow Engine
        self.event_dispatcher = EventDispatcher()
        self.flow_engine = MaterialFlowEngine(self.event_dispatcher)
        self.flow_engine.kpis.set_start_time(self.sim_time)

    def add_machine(self, machine: Machine):
        """
        Add machine to simulation.
        
        Automatically sets event dispatcher for event emission.
        """
        self.machines.append(machine)
        machine.set_event_dispatcher(self.event_dispatcher)  # Wire event dispatcher

    def set_post_step_callback(self, callback):
        self.post_step_callbacks.append(callback)

    def step(self):
        """
        Advance simulation by one FIXED time step.
        
        All machines step synchronously with the same dt.
        Global simulation clock is incremented deterministically.
        
        CRITICAL: Only steps when PLC is RUNNING (gated by PLC power state).
        """
        # CRITICAL: Hard gate - do NOT step if PLC not running
        if self.plc_ref and not self.plc_ref.is_running():
            return  # Physics frozen
        
        # 1. Update all machines (physics + state)
        for machine in self.machines:
            machine.tick(self.time_step)
            
        # 2. Run registered post-step logic (e.g. Material Flow)
        for callback in self.post_step_callbacks:
            callback()
        
        # 3. Advance global simulation clock
        self.sim_time += self.time_step
        self.ticks += 1

    def run_loop(self):
        """
        Blocking run loop (for testing only).
        Real app will run step() in a thread.
        """
        self.running = True
        try:
            while self.running:
                self.step()
                time.sleep(self.time_step)
                if self.ticks % 10 == 0:
                    print(f"Tick {self.ticks}: {self.get_all_tags()}")
        except KeyboardInterrupt:
            self.running = False

    def get_all_tags(self) -> Dict[str, Any]:
        """
        Collects all tags from all machines for SCADA.
        """
        all_tags = {}
        for m in self.machines:
            all_tags.update(m.get_tags())
        return all_tags
    
    def get_production_metrics(self) -> Dict[str, Any]:
        """
        Get production metrics from Flow Engine (read-only).
        
        Returns:
            Dict of production KPIs for UI/Analytics
        """
        return self.flow_engine.get_metrics(self.sim_time)
