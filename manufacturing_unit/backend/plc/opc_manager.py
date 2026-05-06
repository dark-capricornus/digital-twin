import logging
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
from asyncua import Server, ua
from asyncua.crypto.permission_rules import PermissionRuleset, User, UserRole
from asyncua.server.user_managers import UserManager

logger = logging.getLogger("OPCManager")

# Status tag names that should be String (state-machine / mode strings).
_STATUS_STRING_TAGS = {
    "State", "ProcessStep", "Stage_Status", "Booth_Cycle_Status", "Air_Flow_Status",
}
# Status tag names that should be Int32 (counters / discrete counts).
_STATUS_INT_TAGS = {
    "ProcessedCount", "RejectCount", "PartCount", "Capacity", "StateCode", "FaultCode",
}

def _infer_status_type(tag: str):
    if tag in _STATUS_STRING_TAGS:
        return ua.VariantType.String
    if tag in _STATUS_INT_TAGS:
        return ua.VariantType.Int32
    if tag.startswith("Is"):
        return ua.VariantType.Boolean
    return ua.VariantType.Double

def _default_for(v_type):
    if v_type == ua.VariantType.String:
        return "IDLE"
    if v_type == ua.VariantType.Boolean:
        return False
    if v_type == ua.VariantType.Int32:
        return 0
    return 0.0

class DevUserManager(UserManager):
    def get_user(self, isession, username, password, certificate):
        return User(role=UserRole.Admin)

class PermissiveRoleRuleset(PermissionRuleset):
    def check_validity(self, user, action_type_id, body):
        return True

class SubHandler(object):
    def __init__(self, command_callback):
        self.command_callback = command_callback

    def datachange_notification(self, node, val, data):
        id_str = str(node.nodeid.Identifier)
        if (".Inputs." in id_str or ".Control." in id_str):
            self.command_callback(id_str, val)

class OPCServerManager:
    def __init__(self, endpoint: str, manifest_manager):
        self.endpoint = endpoint
        self.manifest = manifest_manager
        self.server = Server(user_manager=DevUserManager())
        self.nodes = {} # Map: "Device.Tag" -> UA Node
        self.node_types = {} # Map: "Device.Tag" -> ua.VariantType
        self.plant_nodes = {}
        self.plant_node_types = {}
        self.plc_nodes = {}
        self.idx = 0
        
    async def init(self, command_callback):
        await self.server.init()
        self.server.set_endpoint(self.endpoint)
        self.server.set_server_name("VirtualPLC Service")
        self.server.permission_ruleset = PermissiveRoleRuleset()

        self.idx = await self.server.register_namespace("http://digitaltwin.plc")
        objects = self.server.nodes.objects
        
        # 1. VirtualPLC Root
        plc_node = await objects.add_object(ua.NodeId("VirtualPLC", self.idx), ua.QualifiedName("VirtualPLC", self.idx))
        
        # 2. PLC Core Tags
        self.plc_nodes["state"] = await plc_node.add_variable(ua.NodeId("VirtualPLC.State", self.idx), ua.QualifiedName("State", self.idx), "STOPPED")
        self.plc_nodes["scan_time"] = await plc_node.add_variable(ua.NodeId("VirtualPLC.ScanTime_ms", self.idx), ua.QualifiedName("ScanTime_ms", self.idx), 0.0)
        
        # 3. PLC Control Folder
        cmds_node = await plc_node.add_object(ua.NodeId("VirtualPLC.Control", self.idx), ua.QualifiedName("Control", self.idx))
        self.plc_nodes["start"] = await cmds_node.add_variable(ua.NodeId("VirtualPLC.Control.Start", self.idx), ua.QualifiedName("Start", self.idx), False, ua.VariantType.Boolean)
        self.plc_nodes["stop"] = await cmds_node.add_variable(ua.NodeId("VirtualPLC.Control.Stop", self.idx), ua.QualifiedName("Stop", self.idx), False, ua.VariantType.Boolean)
        
        for node in [self.plc_nodes["start"], self.plc_nodes["stop"], self.plc_nodes["state"], self.plc_nodes["scan_time"]]:
            await node.set_writable(True)

        # 4. Plant Hierarchy
        plant_node = await plc_node.add_object(ua.NodeId("VirtualPLC.Plant", self.idx), ua.QualifiedName("Plant", self.idx))
        wip_folder = await plant_node.add_object(ua.NodeId("VirtualPLC.Plant.WIP", self.idx), ua.QualifiedName("WIP", self.idx))
        kpi_folder = await plant_node.add_object(ua.NodeId("VirtualPLC.Plant.KPI", self.idx), ua.QualifiedName("KPI", self.idx))
        
        plant_map = self.manifest.get_plant_telemetry_map()
        for browse_name, frontend_key in plant_map.items():
            category = "KPI" if "KPI" in browse_name else "WIP"
            parent = kpi_folder if category == "KPI" else wip_folder
            tag_name = f"VirtualPLC.Plant.{category}.{browse_name.split('_', 1)[-1]}"
            
            is_float = "throughput" in browse_name or "yield" in browse_name
            v_type = ua.VariantType.Double if is_float else ua.VariantType.Int32
            node = await parent.add_variable(ua.NodeId(tag_name, self.idx), ua.QualifiedName(browse_name, self.idx), 0.0 if is_float else 0, v_type)
            self.plant_nodes[browse_name] = node
            self.plant_node_types[browse_name] = v_type

        # 5. Devices
        devs_node = await plc_node.add_object(ua.NodeId("VirtualPLC.Devices", self.idx), ua.QualifiedName("Devices", self.idx))
        
        for dev_id in self.manifest.get_exposed_machines():
            dev_config = self.manifest.get_machine_config(dev_id)
            dev_type = dev_config.get("type")
            type_config = self.manifest.get_device_type_config(dev_type)
            
            d_node = await devs_node.add_object(ua.NodeId(f"VirtualPLC.Devices.{dev_id}", self.idx), ua.QualifiedName(dev_id, self.idx))
            cat_nodes = {}
            for cat in ["Inputs", "Outputs", "Status"]:
                cat_nodes[cat] = await d_node.add_object(ua.NodeId(f"VirtualPLC.Devices.{dev_id}.{cat}", self.idx), ua.QualifiedName(cat, self.idx))
            
            for cat, tags in type_config.items():
                for tag in tags:
                    tag_nodeid = f"VirtualPLC.Devices.{dev_id}.{cat}.{tag}"
                    # Default values and types
                    if cat == "Inputs":
                        val = False
                        v_type = ua.VariantType.Boolean
                    elif cat == "Status":
                        v_type = _infer_status_type(tag)
                        val = _default_for(v_type)
                    else:
                        val = 0.0
                        v_type = ua.VariantType.Double
                    
                    node = await cat_nodes[cat].add_variable(ua.NodeId(tag_nodeid, self.idx), ua.QualifiedName(tag, self.idx), val, v_type)
                    if cat == "Inputs":
                        await node.set_writable(True)
                    self.nodes[f"{dev_id}.{tag}"] = node
                    self.node_types[f"{dev_id}.{tag}"] = v_type

        # 6. Subscription
        handler = SubHandler(command_callback)
        sub = await self.server.create_subscription(100, handler)
        await sub.subscribe_data_change(list(self.nodes.values()) + [self.plc_nodes["start"], self.plc_nodes["stop"]])
        
        await self.server.start()
        logger.info(f"OPC-UA Server started at {self.endpoint}")

    async def stop(self):
        await self.server.stop()

    async def write_batch(self, data: Dict[str, Any], plant_data: Dict[str, Any], plc_state: str, scan_time: float):
        timestamp = datetime.utcnow()
        tasks = []
        
        tasks.append(self._write_node(self.plc_nodes["state"], plc_state, ua.VariantType.String, timestamp))
        tasks.append(self._write_node(self.plc_nodes["scan_time"], scan_time, ua.VariantType.Double, timestamp))
        
        for key, val in data.items():
            if key in self.nodes:
                v_type = self.node_types[key]
                tasks.append(self._write_node(self.nodes[key], val, v_type, timestamp))

        for key, val in plant_data.items():
            # key is like "WIP_ingots_kg"
            if key in self.plant_nodes:
                v_type = self.plant_node_types[key]
                tasks.append(self._write_node(self.plant_nodes[key], val, v_type, timestamp))
                
        await asyncio.gather(*tasks)

    async def _write_node(self, node, value, v_type, timestamp):
        try:
            # Ensure value matches v_type to avoid BadTypeMismatch
            if v_type == ua.VariantType.Double:
                value = float(value)
            elif v_type == ua.VariantType.Int32:
                value = int(value)
            elif v_type == ua.VariantType.Boolean:
                value = bool(value)
            elif v_type == ua.VariantType.String:
                value = str(value)
                
            dv = ua.DataValue(ua.Variant(value, v_type), SourceTimestamp=timestamp, ServerTimestamp=timestamp)
            await node.write_value(dv)
        except Exception as e:
            logger.error(f"Error writing to node {node}: {e} (Value: {value}, Type: {v_type})")
            raise e
        
    async def get_control_values(self):
        return {
            "start": await self.plc_nodes["start"].get_value(),
            "stop": await self.plc_nodes["stop"].get_value()
        }
    
    async def reset_control(self, name: str):
        if name in self.plc_nodes:
            await self.plc_nodes[name].set_value(False)
            
    async def reset_node(self, identifier: str):
        # Find node by identifier string
        for node in self.nodes.values():
            if str(node.nodeid.Identifier) == identifier:
                await asyncio.sleep(0.05)
                await node.set_value(False)
                break
