
import asyncio
import logging
import time
import sys
import os
from datetime import datetime

# Adjust path to import backend
# Assuming this script is at root d:\Digital Twin\run_tests.py
sys.path.append(os.path.join(os.path.dirname(__file__)))

try:
    from backend.plc.engine import VirtualPLC
    from backend.plc.power_state import PLCPowerState
    from backend.simulation.machines.base_machine import MachineState
    from asyncua import ua
except ImportError as e:
    print(f"CRITICAL: Import failed - {e}")
    sys.exit(1)

# Configure logging
# CRITICAL: Write to file because console capture is broken
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler("integration_results.log", mode='w'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("IntegrationTest")

class TestResult:
    def __init__(self, name):
        self.name = name
        self.status = "PENDING"
        self.message = ""

    def pass_test(self, msg=""):
        self.status = "PASS"
        self.message = msg
        logger.info(f"✅ PASS: {self.name} {msg}")

    def fail_test(self, msg):
        self.status = "FAIL"
        self.message = msg
        logger.error(f"❌ FAIL: {self.name} {msg}")

    def block_test(self, msg):
        self.status = "BLOCKED"
        self.message = msg
        logger.warning(f"⚠️ BLOCKED: {self.name} {msg}")

async def run_integration_tests():
    logger.info(">>> STARTING INTEGRATION TESTS <<<")
    results = []
    
    # Setup PLC
    try:
        plc = VirtualPLC()
        await plc.init_opcua()
        
        # Start PLC Loop in background task
        scan_task = asyncio.create_task(plc.run_scan_loop())
        # Give it a moment to initialize
        await asyncio.sleep(1.0)
    except Exception as e:
        logger.critical(f"Failed to start PLC: {e}")
        return

    # ==========================================
    # PRE-INTEGRATION TESTING
    # ==========================================

    # --- Test 1: Power State Transitions ---
    t1 = TestResult("Test 1: Power State Transitions")
    try:
        # Initial State should be OFF
        if plc.power_state != PLCPowerState.OFF:
            t1.fail_test(f"Initial state was {plc.power_state}, expected OFF")
        else:
            # Simulate START command
            await plc.cmd_start.set_value(True)
            # wait for scan loop to process
            await asyncio.sleep(0.5) 
            
            if plc.power_state != PLCPowerState.RUNNING:
                 t1.fail_test(f"State is {plc.power_state} after START command, expected RUNNING")
            else:
                 # RUNNING -> STOPPING -> OFF
                 await plc.cmd_stop.set_value(True)
                 await asyncio.sleep(0.5)
                 
                 if plc.power_state != PLCPowerState.OFF:
                     t1.fail_test(f"State is {plc.power_state} after STOP command, expected OFF")
                 else:
                     t1.pass_test()
    except Exception as e:
        t1.fail_test(str(e))
    results.append(t1)

    # Re-enable PLC for subsequent tests
    await plc.cmd_start.set_value(True)
    await asyncio.sleep(0.5)


    # --- Test 2: Deterministic Scan Cycle ---
    t2 = TestResult("Test 2: Deterministic Scan Cycle")
    try:
        if not plc.tag_scan_time: 
             t2.fail_test("ScanTime tag missing")
        else:
             times = []
             for _ in range(5):
                 val = await plc.tag_scan_time.get_value()
                 times.append(val)
                 await asyncio.sleep(0.2)
             
             if all(x == 0 for x in times):
                 t2.fail_test("Scan time is 0 (not updating?)")
             else:
                 t2.pass_test(f"Scan times ok: {times}")
    except Exception as e:
        t2.fail_test(str(e))
    results.append(t2)

    # --- Test 3: Physics Engine Gating ---
    t3 = TestResult("Test 3: Physics Engine Gating")
    try:
        # Get random machine to check physics
        furnace = next((m for m in plc.sim_engine.machines if "Furnace" in m.name), None)
        if not furnace:
            t3.block_test("Furnace not found")
        else:
            # While RUNNING
            # We need to manually START the machine (it starts in IDLE)
            furnace.handle_start_command() 
            furnace.target_temp = 1000 # ensure it heats
            
            # NOTE: BaseMachine logic: tick() runs, if RUNNING -> _execute_running_logic
            # Furnace needs to be in RUNNING state.
            # VirtualPLC initialization sets machine.enabled = True on START.
            
            temp_1 = getattr(furnace, 'temperature', 0)
            await asyncio.sleep(0.5)
            temp_2 = getattr(furnace, 'temperature', 0)
            
            # If heating logic works, temp should rise
            if temp_2 <= temp_1:
                 # It might be at target or heating rate 0?
                 # Force temp down
                 furnace.temperature = 0
                 temp_1 = 0
                 await asyncio.sleep(0.5)
                 temp_2 = getattr(furnace, 'temperature', 0)
            
            if temp_2 <= temp_1:
                 t3.fail_test(f"Temperature did not increase in RUNNING: {temp_1} -> {temp_2}")
            else:
                 # Stop PLC
                 await plc.cmd_stop.set_value(True)
                 await asyncio.sleep(0.5)
                 
                 temp_3 = getattr(furnace, 'temperature', 0)
                 await asyncio.sleep(0.5)
                 temp_4 = getattr(furnace, 'temperature', 0)
                 
                 # Restart for future tests
                 await plc.cmd_start.set_value(True)
                 await asyncio.sleep(0.5)
                 # Restore machine state
                 furnace.handle_start_command()
                 
                 if temp_4 != temp_3 and abs(temp_4 - temp_3) > 0.01:
                     t3.fail_test(f"Physics continued in OFF state: {temp_3} -> {temp_4}")
                 else:
                     t3.pass_test()
    except Exception as e:
        t3.fail_test(str(e))
    results.append(t3)

    # --- Test 9: Enable Flag Gating ---
    t9 = TestResult("Test 9: Enable Flag Gating")
    try:
        adapter = plc.devices[0]
        machine = adapter.machine
        
        # Disable
        machine.enabled = False
        machine.state = MachineState.IDLE
        
        # Try start
        res = machine.handle_start_command()
        
        if res:
            t9.fail_test("START command succeeded while disabled")
        elif machine.state != MachineState.FAULTED:
            t9.fail_test(f"State mismatch: {machine.state}, expected FAULTED")
        elif machine.fault_code != 101:
            t9.fail_test(f"Wrong fault code: {machine.fault_code}")
        else:
            t9.pass_test()
        
        # Reset
        machine.enabled = True
        machine.handle_reset_command()
        
    except Exception as e:
        t9.fail_test(str(e))
    results.append(t9)
    
    # --- Test 12: Cyclic State Publishing ---
    t12 = TestResult("Test 12: Cyclic State Publishing")
    try:
         # Monitor timestamps of a random tag
         tag = list(plc.opcua_nodes.values())[0] # Pick first one
         ts1 = (await tag.read_data_value()).SourceTimestamp
         await asyncio.sleep(0.2) # Wait for >1 scan (100ms)
         ts2 = (await tag.read_data_value()).SourceTimestamp
         
         if ts1 == ts2:
             t12.fail_test("Timestamp did not update (Conditional publishing suspected)")
         else:
             t12.pass_test()
             
    except Exception as e:
        t12.fail_test(str(e))
    results.append(t12)


    # Cleanup
    scan_task.cancel()
    try:
        await scan_task
    except asyncio.CancelledError:
        pass
    
    # Summary
    logger.info("\n>>> TEST SUMMARY <<<")
    passage = True
    for r in results:
        if r.status != "PASS":
             passage = False
        logger.info(f"{r.status}: {r.name} - {r.message}")
        
    if passage:
        logger.info("✅ OVERALL STATUS: INTEGRATION READY")
    else:
        logger.error("❌ OVERALL STATUS: GATES FAILED")

if __name__ == "__main__":
    try:
        asyncio.run(run_integration_tests())
    except KeyboardInterrupt:
        pass
