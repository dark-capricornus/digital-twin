import time
import asyncio
import logging
import json
import os
import sys

# --- Fix Path for Imports ---
# Allow importing 'backend' from project root
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from typing import List, Dict, Any
from abc import ABC, abstractmethod
from asyncua import Server, ua
from asyncua.crypto.permission_rules import PermissionRuleset, User, UserRole
from asyncua.server.user_managers import UserManager
import builtins
from datetime import datetime

# --- Integration Imports ---
from backend.simulation.factory import build_factory
from backend.plc.adapter import SimulationAdapter
from backend.plc.power_state import PLCPowerState
from backend.simulation.machines.base_machine import MachineState

# --- Custom User Manager for Dev/Ignition Compatibility ---
class DevUserManager(UserManager):
    def get_user(self, isession, username, password, certificate):
        # Force everyone (Anonymous included) to be Admin for Phase 2 stability
        return User(role=UserRole.Admin)

# --- Custom Permissive Ruleset for Option 1 ---
class PermissiveRoleRuleset(PermissionRuleset):
    """
    Allow EVERYTHING for EVERYONE.
    Used for Phase 2 Validation to prevent Service-Level BadUserAccessDenied.
    """
    def check_validity(self, user, action_type_id, body):
        return True

# --- MONKEY PATCH START ---
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
            "exposed_machines": ["m_furnace", "m_lpdc", "m_cnc", "m_storage"]
        }

CONFIG = load_config()
PLC_SCAN_RATE_MS = CONFIG["scan_rate_ms"]
OPCUA_PORT = CONFIG["opcua_port"]
OPCUA_ENDPOINT = f"opc.tcp://127.0.0.1:{OPCUA_PORT}/freeopcua/server/"
EXPOSED_MACHINES = set(CONFIG.get("exposed_machines", []))

# Logging format mimicking PLC diagnostics
logging.basicConfig(level=logging.INFO, format='[PLC] %(asctime)s | %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger("VirtualPLC")

class SubHandler(object):
    """
    Subscription Handler to log data changes (writes).
    This serves as server-side confirmation that a write command reached the Python layer.
    """
    def datachange_notification(self, node, val, data):
        # We try to get the NodeId/Name slightly robustly
        node_id = node.nodeid
        logger.info(f"Write/Change Received -> Node: {node_id}, Value: {val}")

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
        pass
    
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
        self.power_state = PLCPowerState.OFF  # Start in OFF state
        self.opcua_server = Server(user_manager=DevUserManager())
        self.opcua_nodes = {} # Map: "Device.Tag" -> UA Node
        
        # UNIFIED ARCHITECTURE: Own the Simulation Engine
        logger.info("Initializing Simulation Engine (Unified Architecture)...")
        self.sim_engine = build_factory(plc_ref=self)  # Pass self for power gating
        
        # Create Adapters for critical machines to match Phase 2 Node IDs
        self.devices: List[SimulationAdapter] = []
        
        # Machine Run State Latch (Per User Req 1)
        self.machine_run_state = {}
        
        # MAPPING LAYER: Connect Sim Machines to PLC Device Interfaces
        # We manually map specific machines to preserve the specific NodeIDs SCADA expects.
        mapping = {
            "Furnace_01": "m_furnace",
            "LPDC_01": "m_lpdc",
            "CNC_01": "m_cnc",
            "Inspection_01": "m_inspect" 
        }
        
        for dev_id, sim_id in mapping.items():
            # Find the machine in the engine
            machine = next((m for m in self.sim_engine.machines if m.id == sim_id), None)
            if machine:
                adapter = SimulationAdapter(machine, dev_id)
                self.devices.append(adapter)
                self.machine_run_state[dev_id] = False # Default to Stopped
            else:
                logger.warning(f"Could not link {dev_id} to simulation machine {sim_id}")
    
    def is_running(self) -> bool:
        """Check if PLC is in RUNNING state (for physics gating)"""
        return self.power_state == PLCPowerState.RUNNING

    async def init_opcua(self):
        """Initialize embedded OPC UA Server with strict Industrial Hierarchy"""
        await self.opcua_server.init()
        self.opcua_server.set_endpoint(OPCUA_ENDPOINT)
        self.opcua_server.set_server_name("VirtualPLC Service")

        # SERVICE LEVEL PERMISSIONS (OPTION 1 FIX)
        # Use our custom permissive ruleset to allow ALL services (Call, MonitoredItem, etc.)
        self.opcua_server.permission_ruleset = PermissiveRoleRuleset()

        # Setup Address Space
        idx = await self.opcua_server.register_namespace("http://digitaltwin.plc")
        logger.info(f"Registered Namespace 'http://digitaltwin.plc' with Index: {idx}")
        
        objects = self.opcua_server.nodes.objects
        
        # --- Subscription (Write Logging) Setup ---
        handler = SubHandler()
        self.cmd_sub = await self.opcua_server.create_subscription(500, handler)
        
        # --- Hierarchy: Objects -> VirtualPLC -> Devices ---
        # 1. VirtualPLC Root
        plc_id = ua.NodeId("VirtualPLC", idx)
        plc_node = await objects.add_object(plc_id, ua.QualifiedName("VirtualPLC", idx))
        
        # 2. PLC Core Tags
        self.tag_state = await plc_node.add_variable(ua.NodeId("VirtualPLC.State", idx), ua.QualifiedName("State", idx), "STOPPED")
        await self.tag_state.set_writable() # OPTION 1

        self.tag_scan_time = await plc_node.add_variable(ua.NodeId("VirtualPLC.ScanTime_ms", idx), ua.QualifiedName("ScanTime_ms", idx), 0.0)
        await self.tag_scan_time.set_writable() # OPTION 1
        
        # 3. PLC Commands Folder
        cmds_node = await plc_node.add_object(ua.NodeId("VirtualPLC.Commands", idx), ua.QualifiedName("Commands", idx))
        
        # Note: Users previously used "PLC" root. We keep "PLC" as an alias or use the new structure? 
        # The prompt explicitly asked for 'Objects -> VirtualPLC', so we use that.
        
        self.cmd_start = await cmds_node.add_variable(ua.NodeId("VirtualPLC.Commands.Start", idx), ua.QualifiedName("Start", idx), False)
        self.cmd_stop = await cmds_node.add_variable(ua.NodeId("VirtualPLC.Commands.Stop", idx), ua.QualifiedName("Stop", idx), False)
        
        logger.info(f"Created Start Command Node: {self.cmd_start.nodeid}")

        # Allow Write for Commands (REQ 1)
        for node in [self.cmd_start, self.cmd_stop]:
            await node.set_writable() 
            await self.cmd_sub.subscribe_data_change(node)

        # --- 3b. Plant Logic (V1 Orchestration) ---
        # Expose Global Plant Tags (WIP, KPI)
        self.plant_nodes = {}
        plant_node = await plc_node.add_object(ua.NodeId("VirtualPLC.Plant", idx), ua.QualifiedName("Plant", idx))
        
        # We pre-create nodes based on expected keys or just dynamic?
        # Let's verify what keys exist now by peeking or assuming standard keys.
        # Ideally we'd iterate sim_engine keys, but sim_engine might not be initialized fully or stepped yet.
        # But `build_factory` created the engine. check what `get_all_tags` returns.
        # Since Orchestrator is lazy loaded in step(), `get_all_tags` might not have Plant tags yet!
        # Force init of orchestrator? Or just handle "lazy creation"?
        # OPC UA nodes structure must be static usually or created at startup.
        # I'll force init the orchestrator in engine.py NOW or just hardcode the known WIP keys.
        # Hardcoding is safer for static address space.
        
        # Expected WIP Keys
        wip_keys = [
            "ingots_kg", "molten_metal_kg", "degassed_metal_kg", "cast_parts", 
            "heat_treated_parts", "machined_parts", "painted_parts", 
            "xray_passed", "qc_passed", "scrap_parts"
        ]
        for k in wip_keys:
            tag_name = f"VirtualPLC.Plant.WIP.{k}"
            # Explicitly set to Int32 to match write logic
            node = await plant_node.add_variable(ua.NodeId(tag_name, idx), ua.QualifiedName(f"WIP_{k}", idx), 0, ua.VariantType.Int32)
            self.plant_nodes[f"Plant.WIP.{k}"] = node
            
        # Expected KPI Keys
        kpi_keys = [
            "total_ingots_consumed", "total_wheels_produced", "total_scrap", 
            "batches_completed", "throughput_wheels_hr", "yield_percent"
        ]
        for k in kpi_keys:
            tag_name = f"VirtualPLC.Plant.KPI.{k}"
            is_float = "throughput" in k or "yield" in k
            val = 0.0 if is_float else 0
            # Explicitly set type
            v_type = ua.VariantType.Double if is_float else ua.VariantType.Int32
            node = await plant_node.add_variable(ua.NodeId(tag_name, idx), ua.QualifiedName(f"KPI_{k}", idx), val, v_type)
            self.plant_nodes[f"Plant.KPI.{k}"] = node


        devs_node = await plc_node.add_object(ua.NodeId("VirtualPLC.Devices", idx), ua.QualifiedName("Devices", idx))
        
        # Categorization Rules
        # Categorization Rules
        tag_categories = {
            "Furnace_01": {
                "Temperature": "Status", 
                "TargetTemp": "Status",
                "FurnaceMaxTemp": "Status",
                "BurnerEnable": "Outputs"
            },
            "LPDC_01": {
                "PourRequest": "Inputs", 
                "PressurePSI": "Status",
                "Progress": "Status",
                "ProcessedCount": "Status",
                "State": "Status"
            },
            "CNC_01": {
                "Trigger": "Inputs",
                "SpindleRPM": "Status",
                "Progress": "Status",
                "ProcessedCount": "Status",
                "State": "Status"
            },
            "Inspection_01": {
                "RejectCount": "Status",
                "Progress": "Status"
            }
        }
        

        # Register Device Tags via Adapters
        for device in self.devices:
            dev_id_str = device.device_id
            
            # 5. User Device Object
            d_nodeid = ua.NodeId(f"VirtualPLC.Devices.{dev_id_str}", idx)
            d_node = await devs_node.add_object(d_nodeid, ua.QualifiedName(dev_id_str, idx))
            
            # 6. Functional Folders
            grp_inputs = await d_node.add_object(ua.NodeId(f"{d_nodeid.Identifier}.Inputs", idx), ua.QualifiedName("Inputs", idx))
            grp_outputs = await d_node.add_object(ua.NodeId(f"{d_nodeid.Identifier}.Outputs", idx), ua.QualifiedName("Outputs", idx))
            grp_status = await d_node.add_object(ua.NodeId(f"{d_nodeid.Identifier}.Status", idx), ua.QualifiedName("Status", idx))
            
            cat_map = {"Inputs": grp_inputs, "Outputs": grp_outputs, "Status": grp_status}
            
            initial_tags = device.get_tags()
            
            # Special case for CNC Trigger (Ensure it isn't duplicated if in initial_tags)
            if "CNC" in dev_id_str:
                # We handle Trigger in the main loop if it exists, or manually here?
                # The manual logic guarantees type/writable. Let's keep manual logic but update permissions logic.
                trig_nid = ua.NodeId(f"{d_nodeid.Identifier}.Inputs.Trigger", idx)
                trig_node = await grp_inputs.add_variable(trig_nid, ua.QualifiedName("Trigger", idx), False, ua.VariantType.Boolean)
                # OPTION 1: PERMISSIVE ADMIN ACCESS
                await trig_node.set_writable()
                await self.cmd_sub.subscribe_data_change(trig_node)
                self.opcua_nodes[f"{dev_id_str}.Trigger"] = trig_node

            for tag, val in initial_tags.items():
                if tag == "Trigger": continue # Handled above

                category = "Status" # Default
                if dev_id_str in tag_categories and tag in tag_categories[dev_id_str]:
                    category = tag_categories[dev_id_str][tag]
                
                parent_folder = cat_map[category]
                
                ua_type = ua.VariantType.Double if isinstance(val, float) else \
                          ua.VariantType.Boolean if isinstance(val, bool) else \
                          ua.VariantType.String if isinstance(val, str) else \
                          ua.VariantType.Int32
                
                tag_nodeid_str = f"VirtualPLC.Devices.{dev_id_str}.{category}.{tag}"
                tag_nodeid = ua.NodeId(tag_nodeid_str, idx)
                
                
                node = await parent_folder.add_variable(tag_nodeid, ua.QualifiedName(tag, idx), val, ua_type)
                
                # OPTION 1: PERMISSIVE ADMIN ACCESS (Validation Mode)
                # Ensure Ignition recognizes these as writable tags.
                # set_writable() adds CurrentWrite to AccessLevel and UserAccessLevel.
                await node.set_writable()

                # DEBUG: Monitor all Inputs for console logging
                if category == "Inputs":
                    await self.cmd_sub.subscribe_data_change(node)

                self.opcua_nodes[f"{dev_id_str}.{tag}"] = node
                
        logger.info(f"OPC UA Server initialized at {OPCUA_ENDPOINT}")

    async def _handle_opcua_inputs(self):
        """Read Commands from OPC UA and Apply (Edge Trigger -> Latch)"""
        # 1. PLC Control
        start = await self.cmd_start.get_value()
        stop = await self.cmd_stop.get_value()
        
        if start:
            if self.power_state == PLCPowerState.OFF:
                logger.info(">>> PLC STARTING via OPC UA <<<")
                self.power_state = PLCPowerState.STARTING
            
            # Enable all machines when PLC starts
            for dev in self.devices:
                if hasattr(dev.machine, 'enabled'):
                    dev.machine.enabled = True
                    
            await self.cmd_start.set_value(False)
            
        if stop:
            if self.power_state == PLCPowerState.RUNNING:
                logger.info(">>> PLC STOPPING via OPC UA <<<")
                self.power_state = PLCPowerState.STOPPING
                
            await self.cmd_stop.set_value(False)

        # 2. Device Inputs
        for key, node in self.opcua_nodes.items():
             dev_id, tag = key.split('.')
             val = await node.get_value()
             
             # Find adapter
             device = next((d for d in self.devices if d.device_id == dev_id), None)
             if device:
                 device.set_tag(tag, val)
                 
    async def _update_opcua_outputs(self, scan_ms: float):
        """
        Write Python Device States to OPC UA.
        
        CRITICAL: Batch all writes with asyncio.gather for deterministic publishing.
        All tags published EVERY scan with timestamps and Good quality.
        """
        timestamp = datetime.utcnow()
        write_tasks = []
        
        # PLC State
        state_str = self.power_state.name  # OFF/STARTING/RUNNING/STOPPING/FAULT
        write_tasks.append(self._write_tag_with_quality(self.tag_state, state_str, ua.VariantType.String, timestamp))
        write_tasks.append(self._write_tag_with_quality(self.tag_scan_time, scan_ms, ua.VariantType.Double, timestamp))
        
        # Device States
        for device in self.devices:
            curr_tags = device.get_tags()
            for tag, val in curr_tags.items():
                key = f"{device.device_id}.{tag}"
                node = self.opcua_nodes.get(key)
                if node:
                    # Determine variant type
                    if isinstance(val, bool):
                        variant_type = ua.VariantType.Boolean
                    elif isinstance(val, int):
                        variant_type = ua.VariantType.Int32
                    elif isinstance(val, float):
                        variant_type = ua.VariantType.Double
                    else:
                        variant_type = ua.VariantType.String
                    
                    write_tasks.append(self._write_tag_with_quality(node, val, variant_type, timestamp))
                    
        # Update Plant Nodes (V1 Orchestration)
        all_sim_tags = self.sim_engine.get_all_tags()
        for tag_key, node in self.plant_nodes.items():
            if tag_key in all_sim_tags:
                val = all_sim_tags[tag_key]
                
                # STRICT TYPE ENFORCEMENT based on Key Name
                # To prevent Int/Float mismatch crashes
                try:
                    is_kpi_float = "throughput" in tag_key or "yield" in tag_key
                    if is_kpi_float:
                         val = float(val)
                         variant_type = ua.VariantType.Double
                    elif "ingots" in tag_key or "parts" in tag_key or "wheels" in tag_key or "scrap" in tag_key or "batches" in tag_key or "WIP" in tag_key:
                         val = int(val)
                         variant_type = ua.VariantType.Int32
                    else:
                         # Fallback
                         if isinstance(val, int):
                             variant_type = ua.VariantType.Int32
                         elif isinstance(val, float):
                             variant_type = ua.VariantType.Double
                         else:
                             variant_type = ua.VariantType.String

                    write_tasks.append(self._write_tag_with_quality(node, val, variant_type, timestamp))
                except Exception as e:
                    logger.error(f"Error preparing write for {tag_key}: {e}")

        # CRITICAL: Await ALL writes
        try:
            await asyncio.gather(*write_tasks)
        except Exception as e:
            logger.error(f"Batch Write Failed: {e}")
            # Identify which task failed? Hard with gather.
            # But the detailed try-except above catches preparation errors.
            # The gather catches write errors (like TypeMismatch). 
            # We need to Log strict Type info if it fails.
            pass
    
    async def _write_tag_with_quality(self, node, value, variant_type, timestamp):
        """
        Write tag with explicit timestamp and quality.
        Corrects DataValue instantiation for frozen dataclass with StatusCode_ field.
        """
        data_value = ua.DataValue(
            Value=ua.Variant(value, variant_type),
            StatusCode_=ua.StatusCode(ua.StatusCodes.Good),
            SourceTimestamp=timestamp,
            ServerTimestamp=timestamp
        )
        await node.write_value(data_value)

    async def run_scan_loop(self):
        """
        Deterministic Scan Cycle with Power State Machine.
        
        CRITICAL: Implements industrial PLC behavior with proper state transitions.
        """
        logger.info("PLC Scan Loop Started.")
        
        try:
            while True:
                t0 = time.perf_counter()
                
                # --- 1. Input Scan (OPC UA -> PLC) ---
                await self._handle_opcua_inputs()
                
                # DEBUG: Periodic State Dump (approx every 2s)
                if int(t0) % 2 == 0 and int(t0 * 10) % 5 == 0: 
                    # Get values safely
                    cnc_trig = await self.opcua_nodes["CNC_01.Trigger"].get_value() if "CNC_01.Trigger" in self.opcua_nodes else "?"
                    lpdc_pour = await self.opcua_nodes["LPDC_01.PourRequest"].get_value() if "LPDC_01.PourRequest" in self.opcua_nodes else "?"
                    logger.info(f"STATUS DUMP | CNC.Trigger: {cnc_trig} | LPDC.PourRequest: {lpdc_pour}")
                
                # --- 2. Power State Machine ---
                if self.power_state == PLCPowerState.STARTING:
                    # Single-pass initialization
                    logger.info("PLC STARTING sequence")
                    
                    # 1. Initialize all machines to IDLE first (Safety)
                    for dev in self.devices:
                        if hasattr(dev.machine, 'state'):
                            from backend.simulation.machines.base_machine import MachineState
                            dev.machine.state = MachineState.IDLE
                    
                    # 2. Propagate RUNNING signal to Adapters (Triggers autonomous starts like Furnace)
                    for dev in self.devices:
                        dev.bind_to_plc_state(True)
                    
                    # CRITICAL FIX: Start ALL machines, not just mapped adapters
                    # Unmapped machines (Degasser, Heat Treat) must run for flow to work
                    for machine in self.sim_engine.machines:
                        machine.state = MachineState.RUNNING

                    # Auto-transition to RUNNING
                    self.power_state = PLCPowerState.RUNNING
                    logger.info("PLC now RUNNING")
                
                elif self.power_state == PLCPowerState.RUNNING:
                    # Normal cyclic operation
                    self.sim_engine.step()  # Physics gated internally
                
                elif self.power_state == PLCPowerState.STOPPING:
                    # Single-pass shutdown
                    logger.info("PLC STOPPING sequence")
                    
                    # Propagate STOP signal to Adapters
                    for dev in self.devices:
                        dev.bind_to_plc_state(False)

                    # Force all machines to safe state
                    for machine in self.sim_engine.machines:
                        machine.state = MachineState.IDLE
                        if hasattr(machine, 'force_safe_state'):
                            machine.force_safe_state()
                    
                    # Physics already frozen by is_running() gate
                    # Auto-transition to OFF
                    self.power_state = PLCPowerState.OFF
                    logger.info("PLC now OFF")

                # --- 3. Output Scan (PLC -> OPC UA) ---
                t1 = time.perf_counter()
                scan_ms = (t1 - t0) * 1000.0
                await self._update_opcua_outputs(scan_ms)
                
                # --- 4. Wait for Cycle ---
                elapsed = (time.perf_counter() - t0) * 1000.0
                sleep_ms = max(0, PLC_SCAN_RATE_MS - elapsed)
                await asyncio.sleep(sleep_ms / 1000.0)
        except Exception as e:
            logger.critical("PLC Scan Loop Crash", exc_info=True)
            raise e

# --- 4. Main Entry Point ---

async def main_async():
    # 1. Setup
    plc = VirtualPLC()
    
    # 2. Init OPC UA
    await plc.init_opcua()
    
    # 3. LIFECYCLE MANAGEMENT: Start Server Context Here
    async with plc.opcua_server:
        # 4. Enter Loop
        await plc.run_scan_loop()

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

