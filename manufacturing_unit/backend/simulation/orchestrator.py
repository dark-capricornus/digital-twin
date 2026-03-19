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
        self._process_low_material_flow()
        self._update_kpis(current_time)
        self._check_batch_lifecycle()

    def _collect_outputs(self):
        # 1. Furnace
        if self._collect_items(self.m_furnace):
             self.wip["molten_metal_kg"] += 10

        # 2. Degasser
        if self._collect_items(self.m_degasser) or self._collect_items(self.m_degasser2):
            self.wip["degassed_metal_kg"] += 10
            
        # 3. LPDC
        if self._collect_items(self.m_lpdc) or self._collect_items(self.m_lpdc2) or self._collect_items(self.m_lpdc3):
            self.wip["cast_parts"] += 1
            
        # 4. Cooling 1
        if self._collect_items(self.m_cooling1):
            self.wip["cooled_parts_1"] += 1

        # 5. Heat Treat
        if self._collect_items(self.m_heat) or self._collect_items(self.m_heat2):
            self.wip["heat_treated_parts"] += 1
            
        # 6. Cooling 2
        if self._collect_items(self.m_cooling2):
            self.wip["cooled_parts_2"] += 1

        # 7. CNC
        if self._collect_items(self.m_cnc) or self._collect_items(self.m_cnc2):
            self.wip["machined_parts"] += 1

        # 8. Pretreat
        if self._collect_items(self.m_pretreat):
            self.wip["pretreated_parts"] += 1
            
        # 9. Paint Booths (1 \u0026 2)
        if self._collect_items(self.m_paint1) or self._collect_items(self.m_paint2):
            self.wip["painted_parts"] += 1
            
        # 10. Inspection
        items = self._pop_all_items(self.m_inspect)
        if items:
            for _ in items:
                import random
                if random.random() < 0.03:
                    self.wip["scrap_parts"] += 1
                    self.kpis["total_scrap"] += 1
                else:
                    self.wip["xray_passed"] += 1

        if self.m_inspect is not None:
            reject_queue = getattr(self.m_inspect, 'queue_reject', None)
            if reject_queue:
                rejects_count = len(reject_queue)
                self.wip["scrap_parts"] += rejects_count
                self.kpis["total_scrap"] += rejects_count
                reject_queue.clear()

        # 11. QC (Packing) - Removed, parts go straight to Outbound
                    
        # 12. Outbound
        self._collect_items(self.m_outbound)

    def _process_low_material_flow(self):
        BUFFER_LIMIT_KG = 50 
        
        # 1. Furnace
        if self.wip["ingots_kg"] >= 10 and self.wip["degassed_metal_kg"] < BUFFER_LIMIT_KG:
            target_furnace = None
            if self._is_idle(self.m_furnace): target_furnace = self.m_furnace
            
            if target_furnace:
                self.wip["ingots_kg"] -= 10
                self.kpis["total_ingots_consumed"] += 10
                self._start_machine(target_furnace, "IngotBatch")
            
        # 2. Degasser
        if self.wip["molten_metal_kg"] >= 10:
            target_degasser = None
            if self._is_idle(self.m_degasser): target_degasser = self.m_degasser
            elif self._is_idle(self.m_degasser2): target_degasser = self.m_degasser2
            
            if target_degasser:
                self.wip["molten_metal_kg"] -= 10
                self._start_machine(target_degasser, "MoltenBatch")
            
        # 3. LPDC
        if self.wip["degassed_metal_kg"] >= 10:
            target_lpdc = None
            if self._is_idle(self.m_lpdc): target_lpdc = self.m_lpdc
            elif self._is_idle(self.m_lpdc2): target_lpdc = self.m_lpdc2
            elif self._is_idle(self.m_lpdc3): target_lpdc = self.m_lpdc3

            if target_lpdc:
                self.wip["degassed_metal_kg"] -= 10
                self._start_machine(target_lpdc, "DegassedMetal")
            
        # 4. Cooling 1
        if self.wip["cast_parts"] >= 1 and self._is_idle(self.m_cooling1):
            self.wip["cast_parts"] -= 1
            self._start_machine(self.m_cooling1, "CastPart")

        # 5. Heat Treat
        if self.wip["cooled_parts_1"] >= 1:
            target_heat = None
            if self._is_idle(self.m_heat): target_heat = self.m_heat
            elif self._is_idle(self.m_heat2): target_heat = self.m_heat2
            
            if target_heat:
                self.wip["cooled_parts_1"] -= 1
                self._start_machine(target_heat, "CooledPart1")
            
        # 6. Cooling 2
        if self.wip["heat_treated_parts"] >= 1 and self._is_idle(self.m_cooling2):
            self.wip["heat_treated_parts"] -= 1
            self._start_machine(self.m_cooling2, "HTPart")

        # 7. CNC
        if self.wip["cooled_parts_2"] >= 1:
            target_cnc = None
            if self._is_idle(self.m_cnc): target_cnc = self.m_cnc
            elif self._is_idle(self.m_cnc2): target_cnc = self.m_cnc2

            if target_cnc:
                self.wip["cooled_parts_2"] -= 1
                self._start_machine(target_cnc, "CooledPart2")
        
        # trigger existing items in queue if they get stuck
        for m in [self.m_cnc, self.m_cnc2]:
            if m and len(m.queue_in) > 0 and m.current_item is None:
                m.set_command("trigger", True)
            
        # 8. Pretreat
        if self.wip["machined_parts"] >= 1 and self._is_idle(self.m_pretreat):
            self.wip["machined_parts"] -= 1
            self._start_machine(self.m_pretreat, "MachinedPart")

        # 9. Paint Booths (Load Balancing)
        if self.wip["pretreated_parts"] >= 1:
            target_paint = None
            if self._is_idle(self.m_paint1): target_paint = self.m_paint1
            elif self._is_idle(self.m_paint2): target_paint = self.m_paint2
            
            if target_paint:
                self.wip["pretreated_parts"] -= 1
                self._start_machine(target_paint, "PretreatedPart")
            
        # 10. Inspection
        if self.wip["painted_parts"] >= 1 and self._is_idle(self.m_inspect):
            self.wip["painted_parts"] -= 1
            self._start_machine(self.m_inspect, "PaintedPart")
            
        # 11. QC/Packing (Removed, passed directly to Outbound)
            
        # 12. Outbound
        if self.wip["xray_passed"] >= 1:
            target_outbound = None
            if self._is_idle(self.m_outbound): target_outbound = self.m_outbound
            
            if target_outbound:
                self.wip["xray_passed"] -= 1
                self.kpis["total_wheels_produced"] += 1
                self._start_machine(target_outbound, "Wheel")

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
        if hasattr(machine, 'role'):
            if machine.role == 'casting':
                machine.set_command('pour_request', True)
            elif machine.role == 'machining':
                machine.set_command('trigger', True)

    def get_wip_state(self) -> Dict[str, int]:
        return self.wip.copy()
        
    def get_kpis(self) -> Dict[str, Any]:
        return self.kpis.copy()
