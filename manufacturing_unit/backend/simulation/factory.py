from .engine import SimulationEngine
from .machines.base_machine import BaseMachine as Machine
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
    inbound = SimpleMachine("INBOUND_01", "Inbound Dock", cycle_time=2.0)
    # Pre-fill inbound queue
    for i in range(100):
        inbound.queue_in.append(f"RawMaterial-{i}")

    # 2. Storage - Buffer Role
    storage = SimpleMachine("STORAGE_01", "Raw Storage", cycle_time=5.0, 
                           role="buffer", capacity=50)

    # 3. Melting Furnace - Thermal
    furnace = ThermalMachine("FURNACE_01", "Melting Furnace", cycle_time=10.0, target_temp=750.0)

    # 4. Degasser
    from .machines.degasser import DegasserMachine
    degasser = DegasserMachine("DEGASSER_01", "Degasser", cycle_time=8.0)
    degasser2 = DegasserMachine("DEGASSER_02", "Degasser 2", cycle_time=8.0)

    # 5. Cooling Tank 1 - Thermal (Cooling)
    cooling1 = ThermalMachine("COOLING_01", "Cooling Tank 1", cycle_time=5.0, target_temp=25.0, cooling=True)

    # 6. LPDC (Die Casting) - Casting Role
    lpdc = SimpleMachine("LPDC_01", "LPDC Machine", cycle_time=15.0,
                        role="casting", has_pour=True)
    lpdc2 = SimpleMachine("LPDC_02", "LPDC Machine 2", cycle_time=15.0,
                        role="casting", has_pour=True)
    lpdc3 = SimpleMachine("LPDC_03", "LPDC Machine 3", cycle_time=15.0,
                        role="casting", has_pour=True)

    # 7. Heat Treatment - Thermal
    heat_treat = ThermalMachine("HEAT_01", "Heat Treatment", cycle_time=12.0, target_temp=500.0)
    heat_treat2 = ThermalMachine("HEAT_02", "Heat Treatment 2", cycle_time=12.0, target_temp=500.0)

    # 8. Cooling Tank 2 - Thermal (Cooling)
    cooling2 = ThermalMachine("COOLING_02", "Cooling Tank 2", cycle_time=5.0, target_temp=25.0, cooling=True)

    # 9. CNC Machining - Machining Role
    cnc = SimpleMachine("CNC_01", "CNC Machining", cycle_time=10.0,
                       role="machining", has_trigger=True)
    cnc2 = SimpleMachine("CNC_02", "CNC Machining 2", cycle_time=10.0,
                       role="machining", has_trigger=True)
    # Pre-fill REMOVED to ensure correct flow (HT -> CNC)

    # 10. Inspection
    # Fail rate 0.1 (10%) enabled - Rejects now captured by Orchestrator via queue_reject
    inspection = InspectionMachine("INSPECTION_01", "X-Ray Inspection", cycle_time=6.0, fail_rate=0.1)

    # 11. Pretreatment
    pretreat = SimpleMachine("PRETREAT_01", "Pretreatment", cycle_time=5.0)

    # 12. Paint Booth 1
    paint1 = SimpleMachine("PAINT_01", "Paint Booth 1", cycle_time=8.0)

    # 13. Paint Booth 2
    paint2 = SimpleMachine("PAINT_02", "Paint Booth 2", cycle_time=8.0)

    # 14. Packing (Removed)

    # 15. Outbound
    outbound = SimpleMachine("OUTBOUND_01", "Shipping Dock", cycle_time=2.0)

    # Add all to engine
    machines = [inbound, storage, furnace, degasser, degasser2, cooling1, lpdc, lpdc2, lpdc3, heat_treat, heat_treat2, 
                cooling2, cnc, cnc2, inspection, pretreat, paint1, paint2, outbound]
    
    for m in machines:
        engine.add_machine(m)

    # Phase 2: Material flow is now EVENT-DRIVEN via Flow Engine
    # NO legacy SimpleLinearFlow
    # Machines will emit events → Flow Engine reacts
    
    return engine
