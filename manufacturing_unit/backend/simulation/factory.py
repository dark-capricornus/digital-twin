from .engine import SimulationEngine
from .machines.base import Machine
from .machines.simple import SimpleMachine
from .machines.thermal import ThermalMachine
from .machines.inspection import InspectionMachine

def build_factory(plc_ref=None) -> SimulationEngine:
    """
    Build factory with all machines.
    
    Uses FIXED timestep of 0.2s (200ms / 5 Hz) for deterministic physics.
    
    CRITICAL: This function ONLY assembles machines and engines.
    - NO flow logic (handled by Flow Engine via events)
    - NO material transfer logic
    - NO dt-based processing
    """
    engine = SimulationEngine(time_step=0.2, plc_ref=plc_ref)  # FIXED 200ms timestep

    # 1. Inbound (Generator - logically just a machine that always has input)
    inbound = SimpleMachine("m_inbound", "Inbound Dock", cycle_time=2.0)
    # Pre-fill inbound queue
    for i in range(100):
        inbound.queue_in.append(f"RawMaterial-{i}")

    # 2. Storage - Buffer Role
    storage = SimpleMachine("m_storage", "Raw Storage", cycle_time=5.0, 
                           role="buffer", capacity=50)

    # 3. Melting Furnace - Thermal
    furnace = ThermalMachine("m_furnace", "Melting Furnace", cycle_time=10.0, target_temp=750.0)

    # 4. Degasser
    degasser = SimpleMachine("m_degasser", "Degasser", cycle_time=8.0)

    # 5. Cooling Tank 1 - Thermal (Cooling)
    cooling1 = ThermalMachine("m_cooling1", "Cooling Tank 1", cycle_time=5.0, target_temp=25.0, cooling=True)

    # 6. LPDC (Die Casting) - Casting Role
    lpdc = SimpleMachine("m_lpdc", "LPDC Machine", cycle_time=15.0,
                        role="casting", has_pour=True)

    # 7. Heat Treatment - Thermal
    heat_treat = ThermalMachine("m_heat", "Heat Treatment", cycle_time=12.0, target_temp=500.0)

    # 8. Cooling Tank 2 - Thermal (Cooling)
    cooling2 = ThermalMachine("m_cooling2", "Cooling Tank 2", cycle_time=5.0, target_temp=25.0, cooling=True)

    # 9. CNC Machining - Machining Role
    cnc = SimpleMachine("m_cnc", "CNC Machining", cycle_time=10.0,
                       role="machining", has_trigger=True)
    # Pre-fill REMOVED to ensure correct flow (HT -> CNC)

    # 10. Inspection
    # Fail rate 0.1 (10%) enabled - Rejects now captured by Orchestrator via queue_reject
    inspection = InspectionMachine("m_inspect", "X-Ray Inspection", cycle_time=6.0, fail_rate=0.1)

    # 11. Pretreatment
    pretreat = SimpleMachine("m_pretreat", "Pretreatment", cycle_time=5.0)

    # 12. Paint Booth 1
    paint1 = SimpleMachine("m_paint1", "Paint Booth 1", cycle_time=8.0)

    # 13. Paint Booth 2
    paint2 = SimpleMachine("m_paint2", "Paint Booth 2", cycle_time=8.0)

    # 14. Packing
    packing = SimpleMachine("m_pack", "Packing Line", cycle_time=4.0)

    # 15. Outbound
    outbound = SimpleMachine("m_outbound", "Shipping Dock", cycle_time=2.0)

    # Add all to engine
    machines = [inbound, storage, furnace, degasser, cooling1, lpdc, heat_treat, 
                cooling2, cnc, inspection, pretreat, paint1, paint2, packing, outbound]
    
    for m in machines:
        engine.add_machine(m)

    # Phase 2: Material flow is now EVENT-DRIVEN via Flow Engine
    # NO legacy SimpleLinearFlow
    # Machines will emit events → Flow Engine reacts
    
    return engine
