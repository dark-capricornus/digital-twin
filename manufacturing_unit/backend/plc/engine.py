import time
import asyncio
import logging
import json
import os
import sys

# --- Fix Path for Imports ---
# Allow importing 'backend' from project root
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from typing import List, Dict, Any, cast
from abc import ABC, abstractmethod
from asyncua import Server, ua
from asyncua.crypto.permission_rules import PermissionRuleset, User, UserRole
from asyncua.server.user_managers import UserManager
import builtins
from datetime import datetime

# --- Integration Imports ---
try:
    from manufacturing_unit.backend.plc.power_state import PLCPowerState
    from manufacturing_unit.backend.plc.adapter import SimulationAdapter
    from manufacturing_unit.backend.plc.opc_manager import OPCServerManager
    from manufacturing_unit.backend.simulation.factory import build_factory
    from manufacturing_unit.backend.simulation.machines.base_machine import BaseMachine, MachineState
    from manufacturing_unit.common.manifest_manager import ManifestManager
except ImportError:
    # Fallback for localized execution or older structures
    try:
        from ..plc.power_state import PLCPowerState
        from ..plc.adapter import SimulationAdapter
        from ..plc.opc_manager import OPCServerManager
        from ..simulation.factory import build_factory
        from ..simulation.machines.base_machine import BaseMachine, MachineState
        from ...common.manifest_manager import ManifestManager
    except ImportError:
        from plc.power_state import PLCPowerState
        from plc.adapter import SimulationAdapter
        from plc.opc_manager import OPCServerManager
        from simulation.factory import build_factory
        from simulation.machines.base_machine import BaseMachine, MachineState
        from common.manifest_manager import ManifestManager

# Fix for Python 3.11+ issubclass behavior change affecting asyncua
_orig_issubclass = builtins.issubclass

def safe_issubclass(C, A):
    if not isinstance(C, type):
        return False
    # Avoid recursion if C is the same class
    if C == A:
        return True
    return _orig_issubclass(C, A)

builtins.issubclass = safe_issubclass
# --- MONKEY PATCH END ---

# Configuration Loading
def load_config():
    config_path = os.path.join(os.path.dirname(__file__), "..", "config", "settings.json")
    try:
        with open(config_path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        # Fallback Defaults
        return {
            "opcua_port": 4840,
            "scan_rate_ms": 500,
            "simulation_dt_sec": 0.5,
            "exposed_machines": [
                "FURNACE_01", "LPDC_01", "LPDC_02", "LPDC_03", "CNC_01", "CNC_02", "INSPECTION_01", 
                "DEGASSER_01", "DEGASSER_02", "HEAT_01", "HEAT_02", "PAINT_01", "PAINT_02", 
                "INBOUND_01", "COOLING_01", 
                "COOLING_02", "PRETREAT_01", "OUTBOUND_01"
            ]
        }

CONFIG = cast(Dict[str, Any], load_config())
MANIFEST = ManifestManager()

PLC_SCAN_RATE_MS: float = float(cast(Any, CONFIG.get("scan_rate_ms", 100.0)))
OPCUA_PORT = int(cast(Any, CONFIG.get("opcua_port", 4840)))
OPCUA_HOST = os.getenv("OPCUA_HOST", "0.0.0.0")
OPCUA_ENDPOINT = f"opc.tcp://{OPCUA_HOST}:{OPCUA_PORT}/freeopcua/server/"
EXPOSED_MACHINES: builtins.set = builtins.set(MANIFEST.get_exposed_machines())

# Logging format mimicking PLC diagnostics
logging.basicConfig(level=logging.INFO, format='[PLC] %(asctime)s | %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger("VirtualPLC")

# Silence asyncua's per-request INFO chatter (browse/read/publish callbacks);
# keep WARNING+ so genuine issues still surface.
for _name in ("asyncua", "asyncua.server", "asyncua.server.internal_server",
              "asyncua.server.uaprocessor", "asyncua.uaprotocol",
              "asyncua.common.subscription", "asyncua.server.subscription_service"):
    logging.getLogger(_name).setLevel(logging.WARNING)

# --- 1. Device Architecture (Passive Function Blocks) ---
# DEPRECATED: Retained effectively as Interface/Legacy support for Phase 2.1
class DeviceBase(ABC):
    """
    Base class for all passive PLC devices.
    Rules:
    - No internal threads.
    - No self-updating timers (use dt passed from PLC).
    - Logic only runs inside update().
    """
    def __init__(self, device_id: str):
        self.device_id = device_id
        self.plc_running = False # Cache of PLC state
        
    def bind_to_plc_state(self, is_running: bool):
        """Called by PLC at start of scan to sync global state."""
        self.plc_running = is_running

    @abstractmethod
    def update(self, scan_time_sec: float):
        """
        Execute one scan cycle of logic.
        :param scan_time_sec: Time elapsed since last scan (deterministic delta).
        """
        pass

    @abstractmethod
    def get_tags(self) -> Dict[str, Any]:
        """Return dictionary of tag_name: value for OPC UA mapping."""
        return {}
    
    @abstractmethod
    def set_tag(self, tag_name: str, value: Any):
        """Handle write from PLC/SCADA."""
        pass

# --- 2. Device Implementations (DEPRECATED) ---
# These are kept so we don't break code imports, but they are NOT used if adapters are functioning.
# Actually, we will NOT use these classes at all in the new main().

class Furnace(DeviceBase):
    pass # Deprecated

class LPDC(DeviceBase):
    pass # Deprecated

class CNC(DeviceBase):
    pass # Deprecated

class Buffer(DeviceBase):
    pass # Deprecated

# --- 3. Virtual PLC Runtime ---

class VirtualPLC:
    def __init__(self):
        # CRITICAL: Use PLCPowerState enum instead of boolean
        self.power_state = PLCPowerState.OFF  # Start in OFF state - requires explicit START command
        self.opc = OPCServerManager(OPCUA_ENDPOINT, MANIFEST)
        
        # UNIFIED ARCHITECTURE: Own the Simulation Engine
        logger.info("Initializing Simulation Engine (Unified Architecture)...")
        self.sim_engine = build_factory(plc_ref=self)  # Pass self for power gating
        
        # Create Adapters for critical machines to match Phase 2 Node IDs
        self.devices: List[SimulationAdapter] = []
        
        # Machine Run State Latch (Per User Req 1)
        self.machine_run_state = {}
        
        # Attribute Initialization for Linter
        self.plant_nodes = {}
        
        # Transition Timers
        self._starting_timer = 0.0
        self._stopping_timer = 0.0
        self.boot_delay = 2.0 # 2 seconds to boot
        self.stop_delay = 2.0 # 2 seconds to shutdown
        
        # MAPPING LAYER: Connect Sim Machines to PLC Device Interfaces
        # Loaded dynamically from Site Manifest
        mapping = MANIFEST.get_machine_mappings()
        
        for dev_id, sim_id in mapping.items():
            if dev_id == "VIRTUAL_PLC":
                continue # PLC core handled internally
            # Find the machine in the engine
            machine = next((m for m in self.sim_engine.machines if m.id == sim_id), None)
            if machine:
                adapter = SimulationAdapter(machine, dev_id)
                self.devices.append(adapter)
                self.machine_run_state[dev_id] = False # Default to Stopped
            else:
                logger.warning(f"Could not link {dev_id} to simulation machine {sim_id}")
    
    def is_running(self) -> bool:
        """Check if PLC is in a state where simulation physics can step."""
        return self.power_state in [PLCPowerState.RUNNING, PLCPowerState.STARTING, PLCPowerState.STOPPING]

    async def init_opcua(self):
        """Initialize embedded OPC UA Server via Manager"""
        await self.opc.init(command_callback=self.process_individual_command_event)

        # Address space initialization is now handled by OPCServerManager.init()
                
        logger.info(f"OPC UA Server structure initialized.")

    async def process_individual_command_event(self, identifier: str, val: Any):
        """Processes a single command event from the OPC UA subscription."""
        try:
            logger.info(f"[EVENT-MATCH] Processing: {identifier} with Value: {val}")
            
            # Handle both:
            # - VirtualPLC.Control.Start (Global)
            # - VirtualPLC.Devices.FURNACE_01.Inputs.Start (Device-specific)
            parts = identifier.split('.')
            
            if "Control" in identifier:
                # Global PLC command
                tag = parts[-1]
                logger.info(f"Global PLC Command Received: {tag} = {val}")
                if val: # Only trigger on True
                    if tag == "Start":
                        await self.set_plc_state(True)
                    elif tag == "Stop":
                        await self.set_plc_state(False)
            
            elif "Devices" in identifier and "Inputs" in identifier:
                # Device specific command
                # Format: VirtualPLC.Devices.{dev_id}.Inputs.{tag}
                if len(parts) >= 5:
                    dev_id = parts[2]
                    tag = parts[4]
                
                    # Find the device in self.devices (which is a list of SimulationAdapter)
                    device = next((d for d in self.devices if d.device_id == dev_id), None)
                    
                    if device:
                        if val: # Only trigger on True (Edge trigger)
                            logger.info(f"Device Command: {dev_id}.{tag} = {val}")
                            # Use set_tag on adapter if it exists, otherwise on machine
                            if hasattr(device, 'set_tag'):
                                device.set_tag(tag, val)
                            elif hasattr(device, 'machine') and hasattr(device.machine, 'set_tag'):
                                device.machine.set_tag(tag, val)
                        
                        # Reset node after execution
                        asyncio.create_task(self._reset_node_after_event(identifier))
                else:
                    logger.warning(f"Command received for unknown device: {dev_id}")
        except Exception as e:
            logger.error(f"Error processing command event {identifier}: {e}")

    async def _reset_node_after_event(self, identifier: str):
        """Separate task to reset command node after execution."""
        await self.opc.reset_node(identifier)

    def start_plc(self):
        """Programmatic trigger for PLC Start sequence"""
        if self.power_state == PLCPowerState.OFF:
            logger.info(">>> PLC STARTING (Programmatic) <<<")
            self.power_state = PLCPowerState.STARTING

    def stop_plc(self):
        """Programmatic trigger for PLC Stop sequence"""
        if self.power_state == PLCPowerState.RUNNING:
            logger.info(">>> PLC STOPPING (Programmatic) <<<")
            self.power_state = PLCPowerState.STOPPING

    async def _handle_opcua_inputs(self):
        """Handle Global PLC Commands and poll individual inputs for redundancy."""
        controls = await self.opc.get_control_values()
        start = controls.get("start")
        stop = controls.get("stop")
        
        if start:
            if self.power_state == PLCPowerState.OFF:
                logger.info(">>> PLC STARTING via OPC UA <<<")
                self.power_state = PLCPowerState.STARTING
            await self.opc.reset_control("start")
            
        if stop:
            if self.power_state == PLCPowerState.RUNNING:
                logger.info(">>> PLC STOPPING via OPC UA <<<")
                self.power_state = PLCPowerState.STOPPING
            await self.opc.reset_control("stop")
                 
    async def _update_opcua_outputs(self, scan_ms: float):
        """Write Python Device States to OPC UA via Manager."""
        data = {}
        for device in self.devices:
            curr_tags = device.get_tags()
            for tag, val in curr_tags.items():
                if tag in ["Start", "Stop", "Trigger", "PourRequest"]:
                    continue
                data[f"{device.device_id}.{tag}"] = val
        
        plant_data = self.sim_engine.get_all_tags()
        await self.opc.write_batch(data, plant_data, self.power_state.name, scan_ms)

    async def run_scan_loop(self):
        """
        Deterministic Scan Cycle with Power State Machine.
        
        CRITICAL: Implements industrial PLC behavior with proper state transitions.
        """
        last_heartbeat = 0.0
        last_state_debug = 0.0
        
        try:
            while True:
                t0 = time.perf_counter()
                now = time.time()
                
                # --- 1. Input Scan (OPC UA -> PLC) ---
                await self._handle_opcua_inputs()
                
                # DEBUG: Heartbeat every ~2s (Fix 1)
                if now - last_heartbeat >= 2.0:
                    logger.info(f"[SCAN] PLC State = {self.power_state.name}")
                    last_heartbeat = now
                
                # DEBUG: Machine State every ~3s (Fix 4)
                if now - last_state_debug >= 3.0:
                    for dev in self.devices:
                        m_state = dev.machine.state.name if hasattr(dev.machine, 'state') else "UNKNOWN"
                        logger.info(f"[STATE] {dev.device_id} -> {m_state}")
                    last_state_debug = now
                
                # --- 2. Power State Machine ---
                if self.power_state == PLCPowerState.STARTING:
                    self._starting_timer += (PLC_SCAN_RATE_MS / 1000.0)
                    
                    if self._starting_timer < (PLC_SCAN_RATE_MS / 500.0): 
                        logger.info("PLC STARTING sequence - Initializing machines")
                        for dev in self.devices:
                            if hasattr(dev.machine, 'state'):
                                dev.machine.state = MachineState.IDLE
                        for dev in self.devices:
                            dev.bind_to_plc_state(True)
                    
                    if self._starting_timer >= self.boot_delay:
                        # Enable machines but do NOT automatically start them (Cold Start requirement)
                        for dev in self.devices:
                            if hasattr(dev.machine, 'enabled'):
                                dev.machine.enabled = True
                        
                        self.power_state = PLCPowerState.RUNNING
                        self._starting_timer = 0.0
                        logger.info("PLC now RUNNING — All machines initialized to IDLE (Ready)")
                
                elif self.power_state == PLCPowerState.RUNNING:
                    # Normal cyclic operation
                    self.sim_engine.step()  # Physics gated internally
                
                elif self.power_state == PLCPowerState.STOPPING:
                    self._stopping_timer += (PLC_SCAN_RATE_MS / 1000.0)
                    
                    if self._stopping_timer < (PLC_SCAN_RATE_MS / 500.0):
                        logger.info("PLC STOPPING sequence - Commanding all machines to stop")
                        for dev in self.devices:
                            dev.bind_to_plc_state(False)
                    
                    self.sim_engine.step()
                    
                    if self._stopping_timer >= self.stop_delay:
                        for machine_obj in self.sim_engine.machines: 
                            machine = cast(BaseMachine, machine_obj)
                            if machine.state.value != MachineState.STOPPED.value:
                                machine.state = MachineState.STOPPED
                            if hasattr(machine, 'force_safe_state'):
                                machine.force_safe_state()
                        
                        self.power_state = PLCPowerState.OFF
                        self._stopping_timer = 0.0
                        logger.info("PLC now OFF")

                # --- 3. Output Scan (PLC -> OPC UA) ---
                t1 = time.perf_counter()
                scan_ms = (t1 - t0) * 1000.0
                await self._update_opcua_outputs(scan_ms)
                
                # --- 4. Wait for Cycle ---
                elapsed = float((time.perf_counter() - t0) * 1000.0)
                limit_ms = float(PLC_SCAN_RATE_MS)
                sleep_ms = float(max(0.0, limit_ms - elapsed))
                await asyncio.sleep(sleep_ms / 1000.0)
        except Exception as e:
            logger.critical("PLC Scan Loop Crash", exc_info=True)
            raise e

# --- 4. Main Entry Point ---

async def main_async():
    # 1. Setup
    plc = VirtualPLC()
    
    # 2. Init OPC UA (Handles server start and subscriptions internally)
    await plc.init_opcua()
    
    # 3. Auto-start PLC so simulation runs immediately
    plc.start_plc()
    
    # 4. Enter Loop
    try:
        await plc.run_scan_loop()
    finally:
        # Cleanup
        await plc.opc.stop()

def main():
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("PLC Shutdown.")
    except OSError as e:
        if "Address already in use" in str(e) or e.errno == 10048:
             logger.error(f"Failed to bind to Port {OPCUA_PORT}. Check if another server is running.")
        else:
             logger.error(f"OSError: {e}")
        sys.exit(1)
    except Exception as e:
        logger.critical("Fatal application error", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()

