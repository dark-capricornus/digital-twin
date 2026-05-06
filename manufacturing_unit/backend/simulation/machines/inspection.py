from typing import Dict, Any, List
import random
try:
    from .base_machine import BaseMachine, MachineState
except ImportError:
    from simulation.machines.base_machine import BaseMachine, MachineState

class InspectionMachine(BaseMachine):
    """
    Machine that can reject parts.
    Used for: Inspection.
    Migrated to BaseMachine for SCADA compliance.
    """
    def __init__(self, machine_id: str, name: str, cycle_time: float, fail_rate: float = 0.05):
        super().__init__(machine_id, name)
        self.cycle_time = cycle_time
        self.fail_rate = fail_rate
        self.reject_count = 0
        
        # Logic State
        self.progress = 0.0
        self.current_item = None
        self.queue_in: List[Any] = []
        self.queue_out: List[Any] = []
        self.queue_reject: List[Any] = []
        
        # New SCADA states
        self.scan_status = "IDLE"

    # --- BaseMachine Implementation ---

    def _pre_start_checks(self) -> bool:
        return True

    def _detect_fault(self) -> bool:
        return False

    def _get_fault_code(self) -> int:
        return 0

    def force_safe_state(self):
        """Reset progress on Stop"""
        self.progress = 0.0
        self.scan_status = "IDLE"
        
    def _execute_running_logic(self, dt: float):
        # 1. Try to load
        if self.current_item is None:
            if self.queue_in:
                self.current_item = self.queue_in.pop(0)
                self.progress = 0.0
                self.scan_status = "SCANNING"
            else:
                self.scan_status = "IDLE"
                return

        # 2. Process
        self.progress += (dt / self.cycle_time) * 100.0
        
        # 3. Finish / Decide
        if self.progress >= 100.0:
            self.scan_status = "COMPLETE"
            import random
            if random.random() < self.fail_rate:
                self.reject_count += 1
                self.queue_reject.append(self.current_item) # Capture reject
                self._emit_event("INSPECTION_FAIL", {'reject_reason': 'random_failure'})
            else:
                self.queue_out.append(self.current_item)
                self._emit_event("INSPECTION_PASS", {})
            
            self.current_item = None
            self.processed_count += 1
            self.progress = 0.0

    def _get_device_specific_tags(self) -> Dict[str, Any]:
        return {
            f"{self.id}.scan_status": self.scan_status,
            f"{self.id}.inspected_count": self.processed_count,
            f"{self.id}.ok_count": self.processed_count - self.reject_count,
            f"{self.id}.ng_count": self.reject_count,
            f"{self.id}.inspection_cycle_time": self.cycle_time,
            f"{self.id}.progress": float(int(float(self.progress) * 100) / 100.0),
            
            # Explicit aliasing for XRay schema
            f"{self.id}.Scan_Status": self.scan_status,
            f"{self.id}.Inspected_Count": self.processed_count,
            f"{self.id}.OK_Count": self.processed_count - self.reject_count,
            f"{self.id}.NG_Count": self.reject_count,
            f"{self.id}.Inspection_Cycle_Time": self.cycle_time,
            f"{self.id}.Beam_Current_mA": 12.5 if self.scan_status == "SCANNING" else 0.0,
            f"{self.id}.Beam_Voltage_kV": 160.0 if self.scan_status == "SCANNING" else 0.0,
            f"{self.id}.Alarm_Status": "Clear" if self.state.value != MachineState.FAULTED.value else "Fault",
            f"{self.id}.XRay_Run_Status": self.state.value,
            f"{self.id}.XRay_Instant_kW": self.power_kw,
            f"{self.id}.XRay_Total_kWh": self.energy_kwh
        }

    def _calculate_power(self) -> float:
        """
        Calculate power based on load and state.
        """
        return 15.0 if self.state.value == MachineState.RUNNING.value else 2.0

    # --- Legacy Helper ---

    def receive_item(self, item: Any) -> bool:
        self.queue_in.append(item)
        return True
