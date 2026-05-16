import logging
from typing import Dict, Any, List, Optional

from .machines.base_machine import BaseMachine as Machine
# but we access queue_in/out lists.

logger = logging.getLogger("Orchestrator")

class ProductionOrchestrator:
    """
    V1 Plant-Level Production Orchestration.
    
    Responsibilities:
    - Manage Material Flow (WIP)
    - Enforce Stage Blocking Rules
    - Manage Batch Lifecycle
    - Time-based Progression
    - Command Machines (Exceution)
    """
    
    # WIP Model Keys
    WIP_KEYS = [
        "ingots_kg",
        "molten_metal_kg",
        "degassed_metal_kg",
        "cast_parts",
        "cooled_parts_1",
        "heat_treated_parts",
        "cooled_parts_2",
        "machined_parts",
        "pretreated_parts",
        "painted_parts",
        "xray_passed",
        "qc_passed",
        "scrap_parts"
    ]
    
    INGOT_KG_PER_WHEEL = 10
    BATCH_SIZE_KG = 50
    SCALED_REAL_TIME = True 

    def __init__(self, machines: List[Machine]):
        self.machines = {m.id: m for m in machines}
        
        # Machines Mapping (Complete 21-machine chain)
        self.m_furnace = self.machines.get("FURNACE_01")
        self.m_degasser = self.machines.get("DEGASSER_01")
        self.m_degasser2 = self.machines.get("DEGASSER_02")
        self.m_cooling1 = self.machines.get("COOLING_01")
        self.m_lpdc = self.machines.get("LPDC_01")
        self.m_lpdc2 = self.machines.get("LPDC_02")
        self.m_lpdc3 = self.machines.get("LPDC_03")
        self.m_heat = self.machines.get("HEAT_01") 
        self.m_heat2 = self.machines.get("HEAT_02") 
        self.m_cooling2 = self.machines.get("COOLING_02")
        self.m_cnc = self.machines.get("CNC_01")
        self.m_cnc2 = self.machines.get("CNC_02")
        self.m_pretreat = self.machines.get("PRETREAT_01")
        self.m_paint1 = self.machines.get("PAINT_01")
        self.m_paint2 = self.machines.get("PAINT_02")
        self.m_inspect = self.machines.get("INSPECTION_01")
        self.m_outbound = self.machines.get("OUTBOUND_01")

        # WIP State
        self.wip = {key: 0 for key in self.WIP_KEYS}
        self.wip["ingots_kg"] = self.BATCH_SIZE_KG
        
        # Batch State
        self.batch_id = 1
        self.batch_start_time = 0.0
        
        # KPIs
        self.kpis = {
            "total_ingots_consumed": 0,
            "total_wheels_produced": 0,
            "total_scrap": 0,
            "batches_completed": 0,
            "throughput_wheels_hr": 0.0,
            "yield_percent": 0.0
        }
        self.session_start_time = 0.0
        self.last_sim_time = 0.0

    def start_session(self, current_time: float):
        self.session_start_time = current_time
        self.batch_start_time = current_time

    def tick(self, dt: float, current_time: float):
        self.last_sim_time = current_time
        self._collect_outputs()
        self._process_sequential_flow()
        self._update_kpis(current_time)
        self._check_batch_lifecycle()

    def _collect_outputs(self):
        # 1. Furnace -> Molten Metal
        if self._collect_items(self.m_furnace):
             self.wip["molten_metal_kg"] += 10

        # 2. Degassers -> Degassed Metal
        if self._collect_items(self.m_degasser) or self._collect_items(self.m_degasser2):
            self.wip["degassed_metal_kg"] += 10
            
        # 3. LPDC -> Cast Parts
        if self._collect_items(self.m_lpdc) or self._collect_items(self.m_lpdc2) or self._collect_items(self.m_lpdc3):
            self.wip["cast_parts"] += 1
            
        # 4. Inspection -> Inspected Parts (QC Passed)
        items = self._pop_all_items(self.m_inspect)
        if items:
            for _ in items:
                import random
                if random.random() < 0.02:
                    self.wip["scrap_parts"] += 1
                    self.kpis["total_scrap"] += 1
                else:
                    self.wip["qc_passed"] += 1 

        # 5. Heat Treat -> HT Parts
        if self._collect_items(self.m_heat) or self._collect_items(self.m_heat2):
            self.wip["heat_treated_parts"] += 1
            
        # 6. CNC -> Machined Parts
        if self._collect_items(self.m_cnc) or self._collect_items(self.m_cnc2):
            self.wip["machined_parts"] += 1

        # 7. Pretreat -> Pretreated Parts
        if self._collect_items(self.m_pretreat):
            self.wip["pretreated_parts"] += 1
            
        # 8. Paint 01 -> Painted 01
        if self._collect_items(self.m_paint1):
            self.wip["painted_parts"] += 1
            
        # 9. Paint 02 -> Painted 02 (XRay Passed)
        if self._collect_items(self.m_paint2):
            self.wip["xray_passed"] += 1
                    
        # 10. Cooling 01
        if self._collect_items(self.m_cooling1):
            self.wip["cooled_parts_1"] += 1
            
        # 11. Cooling 02
        if self._collect_items(self.m_cooling2):
            self.wip["cooled_parts_2"] += 1

        # 12. Outbound
        self._collect_items(self.m_outbound)

    def _process_sequential_flow(self):
        # [USER] Flow: Raw (Inbound) -> Furnace -> Degassers -> LPDCs -> Inspection -> Heat Treatment -> Machining -> Pretreatment -> Paint 01 -> Paint 02 -> Outbound

        # 1. Furnace (Input: Inbound)
        if self.wip["ingots_kg"] >= 10:
            if self._is_idle(self.m_furnace) and not self._is_faulted(self.m_furnace):
                self.wip["ingots_kg"] -= 10
                self.kpis["total_ingots_consumed"] += 10
                self._start_machine(self.m_furnace, "IngotBatch")
            
        # 2. Degasser (Input: Furnace Output)
        if self.wip["molten_metal_kg"] >= 10:
            target = self._get_idle_non_faulted([self.m_degasser, self.m_degasser2])
            if target:
                self.wip["molten_metal_kg"] -= 10
                self._start_machine(target, "MoltenBatch")
            
        # 3. LPDC (Input: Degasser Output)
        if self.wip["degassed_metal_kg"] >= 10:
            target = self._get_idle_non_faulted([self.m_lpdc, self.m_lpdc2, self.m_lpdc3])
            if target:
                self.wip["degassed_metal_kg"] -= 10
                self._start_machine(target, "DegassedMetal")
            
        # 4. Cooling 01 (Input: LPDC Output)
        if self.wip["cast_parts"] >= 1:
            if self._is_idle(self.m_cooling1) and not self._is_faulted(self.m_cooling1):
                self.wip["cast_parts"] -= 1
                self._start_machine(self.m_cooling1, "CastPart")

        # 5. Inspection (Input: Cooling 01 Output)
        if self.wip["cooled_parts_1"] >= 1:
            if self._is_idle(self.m_inspect) and not self._is_faulted(self.m_inspect):
                self.wip["cooled_parts_1"] -= 1
                self._start_machine(self.m_inspect, "CooledPart1")

        # 6. Heat Treat (Input: Inspection Output)
        if self.wip["qc_passed"] >= 1:
            target = self._get_idle_non_faulted([self.m_heat, self.m_heat2])
            if target:
                self.wip["qc_passed"] -= 1
                self._start_machine(target, "InspectedPart")

        # 7. Cooling 02 (Input: Heat Treat Output)
        if self.wip["heat_treated_parts"] >= 1:
            if self._is_idle(self.m_cooling2) and not self._is_faulted(self.m_cooling2):
                self.wip["heat_treated_parts"] -= 1
                self._start_machine(self.m_cooling2, "HTPart")
            
        # 8. Machining (Input: Cooling 02 Output)
        if self.wip["cooled_parts_2"] >= 1:
            target = self._get_idle_non_faulted([self.m_cnc, self.m_cnc2])
            if target:
                self.wip["cooled_parts_2"] -= 1
                self._start_machine(target, "CooledPart2")
        
        # 9. Pretreatment (Input: Machining Output)
        if self.wip["machined_parts"] >= 1:
            if self._is_idle(self.m_pretreat) and not self._is_faulted(self.m_pretreat):
                self.wip["machined_parts"] -= 1
                self._start_machine(self.m_pretreat, "MachinedPart")

        # 10. Paint 01 (Input: Pretreatment Output)
        if self.wip["pretreated_parts"] >= 1:
            if self._is_idle(self.m_paint1) and not self._is_faulted(self.m_paint1):
                self.wip["pretreated_parts"] -= 1
                self._start_machine(self.m_paint1, "PretreatedPart")

        # 11. Paint 02 (Input: Paint 01 Output)
        if self.wip["painted_parts"] >= 1:
            if self._is_idle(self.m_paint2) and not self._is_faulted(self.m_paint2):
                self.wip["painted_parts"] -= 1
                self._start_machine(self.m_paint2, "PaintedPart1")
            
        # 12. Outbound (Input: Paint 02 Output)
        if self.wip["xray_passed"] >= 1:
            if self._is_idle(self.m_outbound) and not self._is_faulted(self.m_outbound):
                self.wip["xray_passed"] -= 1
                self.kpis["total_wheels_produced"] += 1
                self._start_machine(self.m_outbound, "Wheel")

    def _check_batch_lifecycle(self):
        if self.wip["ingots_kg"] <= 0:
            self.kpis["batches_completed"] += 1
            logger.info(f"Batch {self.batch_id} Complete. Restocking.")
            self.batch_id += 1
            self.wip["ingots_kg"] = self.BATCH_SIZE_KG

    def _update_kpis(self, current_time):
        elapsed_hr = (current_time - self.session_start_time) / 3600.0
        if elapsed_hr > 0:
            self.kpis["throughput_wheels_hr"] = self.kpis["total_wheels_produced"] / elapsed_hr
        
        total = self.kpis["total_wheels_produced"] + self.kpis["total_scrap"]
        if total > 0:
            self.kpis["yield_percent"] = (self.kpis["total_wheels_produced"] / total) * 100.0

    # --- Helpers ---
    def _is_idle(self, machine) -> bool:
        if not machine: return False
        return machine.current_item is None and len(machine.queue_in) == 0

    def _is_faulted(self, machine) -> bool:
        if not machine: return False
        from .machines.base_machine import MachineState
        return getattr(machine, 'state', None) == MachineState.FAULTED

    def _get_idle_non_faulted(self, machine_list: List[Machine]) -> Optional[Machine]:
        for m in machine_list:
            if m and self._is_idle(m) and not self._is_faulted(m):
                return m
        return None

    def _collect_items(self, machine) -> int:
        if not machine: return 0
        count = len(machine.queue_out)
        if count > 0:
            machine.queue_out.clear()
        return count
        
    def _pop_all_items(self, machine) -> List[Any]:
        if not machine: return []
        items = list(machine.queue_out)
        machine.queue_out.clear()
        return items

    def _start_machine(self, machine, item):
        if not machine: return
        machine.queue_in.append(item)
        
        # Explicitly transition machine to RUNNING state
        if hasattr(machine, 'handle_start_command'):
            machine.handle_start_command()
            
        if hasattr(machine, 'role'):
            if machine.role == 'casting':
                machine.set_command('pour_request', True)
            elif machine.role == 'machining':
                machine.set_command('trigger', True)

    def get_wip_state(self) -> Dict[str, int]:
        return self.wip.copy()
        
    def get_kpis(self) -> Dict[str, Any]:
        return self.kpis.copy()

    def get_input_buffer_for_machine(self, machine_id: str) -> int:
        """Helper to map machine IDs to their current WIP input buffer"""
        mapping = {
            "FURNACE_01": "ingots_kg",
            "DEGASSER_01": "molten_metal_kg",
            "DEGASSER_02": "molten_metal_kg",
            "LPDC_01": "degassed_metal_kg",
            "LPDC_02": "degassed_metal_kg",
            "LPDC_03": "degassed_metal_kg",
            "COOLING_01": "cast_parts",
            "INSPECTION_01": "cooled_parts_1",
            "HEAT_01": "qc_passed",
            "HEAT_02": "qc_passed",
            "COOLING_02": "heat_treated_parts",
            "CNC_01": "cooled_parts_2",
            "CNC_02": "cooled_parts_2",
            "PRETREAT_01": "machined_parts",
            "PAINT_01": "pretreated_parts",
            "PAINT_02": "painted_parts",
            "OUTBOUND_01": "xray_passed",
            "OUTBOUND_02": "xray_passed"
        }
        key = mapping.get(machine_id)
        return self.wip.get(key, 0) if key else 0
