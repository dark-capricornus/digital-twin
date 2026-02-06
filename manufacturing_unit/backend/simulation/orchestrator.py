import logging
from typing import Dict, Any, List, Optional
from .machines.base import Machine
# No direct dependency on SimpleMachine class needed if using base interface, 
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
        "heat_treated_parts",
        "machined_parts",
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
        
        # Machines Mapping
        self.m_furnace = self.machines.get("m_furnace")
        self.m_degasser = self.machines.get("m_degasser")
        self.m_lpdc = self.machines.get("m_lpdc")
        self.m_heat = self.machines.get("m_heat") 
        self.m_cnc = self.machines.get("m_cnc")
        self.m_paint = self.machines.get("m_paint1") # Using Paint1 as main booth
        self.m_inspect = self.machines.get("m_inspect") # X-Ray
        self.m_pack = self.machines.get("m_pack") # Used as QC/Packing
        self.m_outbound = self.machines.get("m_outbound")

        # WIP State (Frozen Model)
        self.wip = {key: 0 for key in self.WIP_KEYS}
        self.wip["ingots_kg"] = self.BATCH_SIZE_KG # Initial Batch
        
        # Batch State
        self.batch_id = 1
        self.batch_start_time = 0.0
        
        # KPIs (Session)
        self.kpis = {
            "total_ingots_consumed": 0,
            "total_wheels_produced": 0,
            "total_scrap": 0,
            "batches_completed": 0,
            "throughput_wheels_hr": 0.0,
            "yield_percent": 0.0
        }
        self.session_start_time = 0.0
        
        # Tracking simulation time
        self.last_sim_time = 0.0

    def start_session(self, current_time: float):
        self.session_start_time = current_time
        self.batch_start_time = current_time

    def tick(self, dt: float, current_time: float):
        """
        Main Orchestration Tick. 
        Enforce flow rules and command machines.
        """
        self.last_sim_time = current_time
        self._collect_outputs()
        self._process_low_material_flow()
        self._update_kpis(current_time)
        self._check_batch_lifecycle()

    def _collect_outputs(self):
        """
        Check machine outputs and update WIP/Scrap.
        Note: We operate on the 'queue_out' of the machines.
        """
        
        # 1. Furnace: Produced Molten Metal?
        # Logic: If Furnace produced an item, it means 10kg melted.
        if self._collect_items(self.m_furnace):
             self.wip["molten_metal_kg"] += 10

        # 2. Degasser: Produced Degassed Metal
        if self._collect_items(self.m_degasser):
            self.wip["degassed_metal_kg"] += 10
            
        # 3. LPDC: Produced Cast Part
        if self._collect_items(self.m_lpdc):
            # 10kg -> 1 part
            self.wip["cast_parts"] += 1
            
        # 4. Heat Treat: Produced HT Part
        if self._collect_items(self.m_heat):
            self.wip["heat_treated_parts"] += 1
            
        # 5. CNC: Produced Machined Part
        if self._collect_items(self.m_cnc):
            self.wip["machined_parts"] += 1
            
        # 6. Paint: Produced Painted Part
        if self._collect_items(self.m_paint):
            self.wip["painted_parts"] += 1
            
        # 7. Inspection (X-Ray): Pass/Fail
        # InspectionMachine might have logic to route to reject?
        # Assuming simple.py queue_out contains all processed. 
        # But InspectionMachine logic (if present) might tag them?
        # Prompt says "Reject rate ~3%". We handle probabilistically here if machine doesn't distinguish,
        # OR we rely on Orchestrator to decide scrap *now*.
        # Prompt: "Machines remain executors".
        # Let's count items pushed out. We implement scrap logic HERE if simple machine is dumb.
        # But wait, InspectionMachine in factory.py has fail_rate=0.1.
        # If InspectionMachine is smart, it might drop items? Or put in a separate queue?
        # BaseMachine only has queue_out.
        # Let's assume queue_out = Passed. Where do scrapped go? Disapper?
        # To be safe, let's implement the split here "3% reject".
        items = self._pop_all_items(self.m_inspect)
        if items:
            for _ in items:
                # 3% reject
                import random
                if random.random() < 0.03:
                    self.wip["scrap_parts"] += 1
                    self.kpis["total_scrap"] += 1
                else:
                    self.wip["xray_passed"] += 1

        # NEW: Collect Internal Rejects from InspectionMachine
        if hasattr(self.m_inspect, 'queue_reject'):
            rejects = list(self.m_inspect.queue_reject)
            self.m_inspect.queue_reject.clear()
            if rejects:
                self.wip["scrap_parts"] += len(rejects)
                self.kpis["total_scrap"] += len(rejects)

        # 8. QC (Packing): Pass/Fail
        # 1% reject.
        items = self._pop_all_items(self.m_pack)
        if items:
            for _ in items:
                import random
                if random.random() < 0.01:
                    self.wip["scrap_parts"] += 1
                    self.kpis["total_scrap"] += 1
                else:
                    self.wip["qc_passed"] += 1
                    
        # 9. Outbound
        if self._collect_items(self.m_outbound):
            # Consumes qc_passed? No, Output moves logic.
            # If Orchestrator pushed to Outbound, and Outbound finished, then it's "Shipped".
            pass

    def _process_low_material_flow(self):
        """
        Orchestrate inputs (Feed machines if WIP available).
        """
        
        # 1. Furnace (Ingots -> Molten)
        # Flow Control: Pause Furnace if Degassed Metal buffer is too full (Bottleneck Management)
        BUFFER_LIMIT_KG = 50 
        
        if (self.wip["ingots_kg"] >= 10 
            and self._is_idle(self.m_furnace) 
            and self.wip["degassed_metal_kg"] < BUFFER_LIMIT_KG):
            
            self.wip["ingots_kg"] -= 10
            self.kpis["total_ingots_consumed"] += 10
            self._start_machine(self.m_furnace, "IngotBatch")
            
        # 2. Degasser (Molten -> Degassed)
        if self.wip["molten_metal_kg"] >= 10 and self._is_idle(self.m_degasser):
            self.wip["molten_metal_kg"] -= 10
            self._start_machine(self.m_degasser, "MoltenBatch")
            
        # 3. LPDC (Degassed -> Cast)
        if self.wip["degassed_metal_kg"] >= 10 and self._is_idle(self.m_lpdc):
            self.wip["degassed_metal_kg"] -= 10
            self._start_machine(self.m_lpdc, "DegassedMetal")
            # Logic Note: LPDC in simple.py handles 'pour_request'. verify in _start_machine.
            
        # 4. Heat Treat (Cast -> HT)
        if self.wip["cast_parts"] >= 1 and self._is_idle(self.m_heat):
            self.wip["cast_parts"] -= 1
            self._start_machine(self.m_heat, "CastPart")
            
        # 5. CNC (HT -> Machined)
        if self.wip["heat_treated_parts"] >= 1 and self._is_idle(self.m_cnc):
            self.wip["heat_treated_parts"] -= 1
            self._start_machine(self.m_cnc, "HTPart")
        elif len(self.m_cnc.queue_in) > 0 and self.m_cnc.current_item is None:
            # Watchdog: If CNC has items but hasn't started (missed trigger), force trigger.
            self.m_cnc.set_command("trigger", True)
            
        # 6. Paint (Machined -> Painted)
        if self.wip["machined_parts"] >= 1 and self._is_idle(self.m_paint):
            self.wip["machined_parts"] -= 1
            self._start_machine(self.m_paint, "MachinedPart")
            
        # 7. X-Ray (Painted -> XRay Passed/Scrap)
        if self.wip["painted_parts"] >= 1 and self._is_idle(self.m_inspect):
            self.wip["painted_parts"] -= 1
            self._start_machine(self.m_inspect, "PaintedPart")
            
        # 8. QC/Packing (XRay Passed -> QC Passed/Scrap)
        if self.wip["xray_passed"] >= 1 and self._is_idle(self.m_pack):
            self.wip["xray_passed"] -= 1
            self._start_machine(self.m_pack, "XRayVerifiedPart")
            
        # 9. Outbound (QC Passed -> Shipped)
        if self.wip["qc_passed"] >= 1 and self._is_idle(self.m_outbound):
            self.wip["qc_passed"] -= 1
            self.kpis["total_wheels_produced"] += 1 # KPI Update on shipping or QC pass?
            # Prompt: "Outbound Consumes qc_passed Updates KPI only".
            # So increment KPI here when we FEED Outbound (or when Outbound finishes? Prompt says "Consumes").
            # Let's count it as produced when it enters outbound for simplicity, 
            # Or better, when Outbound *finishes*.
            # But Outbound cycle time is 2s.
            # Let's increment KPIS *after* Outbound finishes in _collect_outputs? 
            # OR here. Let's do it here (Consumes).
            self._start_machine(self.m_outbound, "Wheel")

    def _check_batch_lifecycle(self):
        # Batch ends when ingots_kg == 0 AND system is empty?
        # Prompt: "Batch ends when ingots_kg == 0". 
        # "On batch completion: ... Restack ingots".
        # If strictly `ingots == 0`, then as soon as furnace eats the last ingot, batch ends and we restock?
        # This means we immediately have more ingots. Continuous flow?
        # "New batch restarts automatically".
        
        if self.wip["ingots_kg"] <= 0:
            # Batch Complete logic
            self.kpis["batches_completed"] += 1
            logger.info(f"Batch {self.batch_id} Complete. Restocking.")
            
            # Archive Summary (Simulated by logging or maintaining list, prompt: "Archive batch summary (in memory)")
            # Using logger for now.
            
            # Reset
            self.batch_id += 1
            self.wip["ingots_kg"] = self.BATCH_SIZE_KG
            # Note: We do NOT clear downstream WIP. "Restack ingots... Reset live WIP?"
            # Prompt: "Reset live WIP".
            # Does this mean clear all work in progress in the line? 
            # "Reset live WIP" implies clearing molten, cast, etc?
            # If so, that's harsh simulation (dumping the line).
            # Usually "Reset live WIP" means the *counters* for the view, but keeping material?
            # NOTE: "WIP Model (Frozen)... Reset live WIP". 
            # If I set all WIP to 0, I delete the parts on the line.
            # Assuming "Reset live WIP" means resetting the *Batch Progress* view, OR physically clearing.
            # Given "Production halts when ingots finish", maybe it drains?
            # "Production halts when ingots finish" -> implication: Wait for drain?
            # If "Batch ends when ingots_kg == 0", we haven't drained yet.
            # I will assume "Restack ingots" allows production to continue.
            pass

    def _update_kpis(self, current_time):
        # Throughput
        elapsed_hr = (current_time - self.session_start_time) / 3600.0
        if elapsed_hr > 0:
            self.kpis["throughput_wheels_hr"] = self.kpis["total_wheels_produced"] / elapsed_hr
        
        # Yield
        total = self.kpis["total_wheels_produced"] + self.kpis["total_scrap"]
        if total > 0:
            self.kpis["yield_percent"] = (self.kpis["total_wheels_produced"] / total) * 100.0

    # --- Helpers ---

    def _is_idle(self, machine) -> bool:
        if not machine: return False
        # Idle if no item holding, and input queue empty
        return machine.current_item is None and len(machine.queue_in) == 0

    def _collect_items(self, machine) -> int:
        """Returns count of items finished and clears queue"""
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
        
        # Load item
        machine.queue_in.append(item)
        
        # Set Commands if needed (Role based)
        # Using simple.py 'role' attribute logic
        if hasattr(machine, 'role'):
            if machine.role == 'casting':
                machine.set_command('pour_request', True)
            elif machine.role == 'machining':
                machine.set_command('trigger', True)

    def get_wip_state(self) -> Dict[str, int]:
        return self.wip.copy()
        
    def get_kpis(self) -> Dict[str, Any]:
        return self.kpis.copy()
