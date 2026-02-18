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

    async def _async_connect(self):
        if not self._connected:
            try:
                await self.client.connect()
                self.idx = await self.client.get_namespace_index(self.namespace_uri)
                self._connected = True
                logger.info(f"Connected to OPC UA at {self.endpoint}")
            except Exception as e:
                logger.error(f"OPC UA Connection Failed: {e}")

    async def _async_read(self) -> dict:
        if not self._connected:
            await self._async_connect()
            if not self._connected:
                return {}

        results = {}
        try:
            # We want to crawl Objects/VirtualPLC/Devices
            # For simplicity, we can fetch specific known machines or crawl the tree
            # Crawling is more robust to changes in engine.py
            
            # 1. Get VirtualPLC Node
            objects = self.client.nodes.objects
            plc_node = await objects.get_child(f"{self.idx}:VirtualPLC")
            devs_node = await plc_node.get_child(f"{self.idx}:Devices")
            
            # 2. Iterate Devices
            devices = await devs_node.get_children()
            for dev in devices:
                dev_name = (await dev.read_browse_name()).Name
                dev_data = {}
                
                # 3. Iterate Categories (Inputs, Outputs, Status)
                categories = await dev.get_children()
                for cat in categories:
                    # 4. Iterate Tags
                    tags = await cat.get_children()
                    for tag_node in tags:
                        tag_name = (await tag_node.read_browse_name()).Name
                        val = await tag_node.read_value()
                        dev_data[tag_name] = val
                
                results[dev_name] = dev_data
                
            # 5. Also get Plant KPIs if possible
            plant_node = await plc_node.get_child(f"{self.idx}:Plant")
            plant_data = {}
            plant_categories = await plant_node.get_children()
            for cat in plant_categories:
                # Iterate tags within WIP/KPI
                tags = await cat.get_children()
                for tag_node in tags:
                    tag_name = (await tag_node.read_browse_name()).Name
                    val = await tag_node.read_value()
                    # Prefix with category if needed, or just flatten
                    # The frontend expects keys like "KPI_yield_percent"
                    # But the tag names in PLC are "yield_percent" or "KPI_yield_percent"?
                    # engine.py uses QualifiedName(f"KPI_{k}", idx)
                    plant_data[tag_name] = val
                    
            results["PLANT"] = plant_data

        except Exception as e:
            logger.error(f"OPC UA Read Error: {e}")
            self._connected = False # Force reconnect next time
            
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
