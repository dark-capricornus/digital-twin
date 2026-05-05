from asyncua import Client
from typing import Dict, Any
from data_gateway.core.interfaces import ISource, IAdapter
import asyncio
import logging

logger = logging.getLogger("opcua_source")

class OPCUASourceAdapter(ISource, IAdapter):
    """
    Reads data from an OPC UA Server (Virtual PLC).
    Flatten hierarchy into a simple dictionary.
    """
    def __init__(self, endpoint: str, namespace_uri: str = "http://digitaltwin.plc"):
        self.endpoint = endpoint
        self.namespace_uri = namespace_uri
        self.client = Client(url=self.endpoint)
        self._connected = False
        self.idx = 0
        self.plant_nodes = {} # [FIX] Initialize plant_nodes map

    async def _async_connect(self):
        if not self._connected:
            try:
                await self.client.connect()
                self.idx = await self.client.get_namespace_index(self.namespace_uri)
                self._connected = True
                logger.info(f"Connected to OPC UA at {self.endpoint}")
                
                # Pre-fetch plant nodes for efficiency
                from manufacturing_unit.common.manifest_manager import ManifestManager
                manifest = ManifestManager()
                plant_map = manifest.get_plant_telemetry_map()
                
                for browse_name, _ in plant_map.items():
                    category = "KPI" if "KPI" in browse_name else "WIP"
                    tag_name = f"VirtualPLC.Plant.{category}.{browse_name.split('_', 1)[-1]}"
                    node_path = [f"{self.idx}:VirtualPLC", f"{self.idx}:Plant", f"{self.idx}:{category}", f"{self.idx}:{browse_name}"]
                    try:
                        node = await self.client.nodes.objects.get_child(node_path)
                        self.plant_nodes[browse_name] = node
                    except Exception:
                        continue
            except Exception as e:
                logger.error(f"OPC UA Connection Failed: {e}")

    async def _async_read(self) -> dict:
        if not self._connected:
            await self._async_connect()
            if not self._connected:
                return {}

        results = {}
        try:
            try:
                from manufacturing_unit.common.manifest_manager import ManifestManager
            except ImportError:
                try:
                    from ...common.manifest_manager import ManifestManager
                except ImportError:
                    from common.manifest_manager import ManifestManager
            manifest = ManifestManager()
            
            # 1. Read Machine Tags
            machines = manifest.get_exposed_machines()
            for dev_id in machines:
                dev_data = {}
                dev_config = manifest.get_machine_config(dev_id)
                dev_type = dev_config.get("type")
                type_config = manifest.get_device_type_config(dev_type)
                
                # Targeted reading of categories
                for cat, tags in type_config.items():
                    for tag in tags:
                        node_path = [
                            f"{self.idx}:VirtualPLC",
                            f"{self.idx}:Devices",
                            f"{self.idx}:{dev_id}",
                            f"{self.idx}:{cat}",
                            f"{self.idx}:{tag}"
                        ]
                        try:
                            # Use get_child with path for efficiency
                            node = await self.client.nodes.objects.get_child(node_path)
                            val = await node.read_value()
                            dev_data[tag] = val
                        except Exception:
                            # Tag might not exist in this version of the PLC
                            continue
                
                if dev_data:
                    results[dev_id] = dev_data
                
            # 2. Read Plant KPIs
            plant_data = {}
            for browse_name, frontend_key in self.plant_nodes.items():
                node = self.plant_nodes.get(browse_name)
                try:
                    val = await node.read_value()
                    # Resolve frontend key from manifest if possible
                    plant_map = manifest.get_plant_telemetry_map()
                    f_key = plant_map.get(browse_name, browse_name)
                    plant_data[f_key] = val
                except Exception as e:
                    logger.warning(f"Failed to read plant node {browse_name}: {e}")
            
            # 3. Read PLC Status
            try:
                state_node = await self.client.nodes.objects.get_child([f"{self.idx}:VirtualPLC", f"{self.idx}:State"])
                plc_state = await state_node.read_value()
                plant_data["PLC_State"] = plc_state
                
                scan_node = await self.client.nodes.objects.get_child([f"{self.idx}:VirtualPLC", f"{self.idx}:ScanTime_ms"])
                scan_time = await scan_node.read_value()
                plant_data["PLC_ScanTime"] = scan_time
            except Exception:
                pass

            if plant_data:
                results["PLANT"] = plant_data

        except Exception as e:
            logger.error(f"OPC UA Read Error: {e}")
            self._connected = False
            
        return results

    async def connect(self):
        await self._async_connect()

    async def disconnect(self):
        if self._connected:
            try:
                await self.client.disconnect()
                self._connected = False
                logger.info("OPC UA Disconnected")
            except Exception as e:
                logger.error(f"OPC UA Disconnect Error: {e}")

    async def read(self) -> dict:
        """Native Async Read w/ Auto-Reconnect"""
        if not self._connected:
            await self._async_connect()
            if not self._connected:
                return {}

        return await self._async_read()

    async def write(self, tag: str, value: Any) -> bool:
        """
        Writes a value back to a specific tag on the OPC UA server.
        Expects tag in format: "DeviceID.TagName" (e.g. "DEGASSER_01.Start")
        or "PLC.Start"
        """
        if not self._connected:
            await self._async_connect()
            if not self._connected:
                return False

        try:
            # 1. Resolve Node Path
            if "." not in tag:
                logger.warning(f"Invalid tag format for write: {tag}")
                return False
                
            dev_id, tag_name = tag.split(".", 1)
            
            # 2. Map to OPC UA Path
            if dev_id in ["PLC", "VirtualPLC"]:
                 # Support both PLC.Start and VirtualPLC.Start
                 # We assume these are in the 'Control' folder
                 clean_tag = tag_name.split('.')[-1] # Handle VirtualPLC.Control.Start
                 node_path = [f"{self.idx}:VirtualPLC", f"{self.idx}:Control", f"{self.idx}:{clean_tag}"]
            else:
                 # Device commands are always in 'Inputs' folder
                 category = "Inputs"
                 node_path = [
                    f"{self.idx}:VirtualPLC",
                    f"{self.idx}:Devices",
                    f"{self.idx}:{dev_id}",
                    f"{self.idx}:{category}",
                    f"{self.idx}:{tag_name}"
                ]

            logger.info(f"Writing to OPC UA node: {tag} -> {node_path}")
            node = await self.client.nodes.objects.get_child(node_path)
            
            # Write with correct type (Boolean for commands)
            if isinstance(value, bool) or str(value).lower() in ["true", "false"]:
                from asyncua import ua
                bool_val = str(value).lower() == "true" if not isinstance(value, bool) else value
                await node.write_value(ua.DataValue(ua.Variant(bool_val, ua.VariantType.Boolean)))
            else:
                await node.write_value(value)
                
            return True
        except Exception as e:
            logger.error(f"OPC UA Write Error for {tag}: {e}")
            return False

