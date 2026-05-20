import asyncio
import requests
import json
from data_gateway.core.interfaces import ISource, IAdapter

class RestSourceAdapter(ISource, IAdapter):
    """
    Reads data from a REST API (e.g., Python Simulation).
    """
    def __init__(self, url: str):
        self.url = url
        self._connected = True # specialized state for REST

    async def connect(self):
        # Setup session if needed
        pass

    async def disconnect(self):
        pass

    async def read(self) -> dict:
        try:
            # Offload blocking HTTP request to thread
            response = await asyncio.to_thread(requests.get, self.url, timeout=2.0)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"[WARN] REST Source returned {response.status_code}")
                return {}
        except Exception as e:
            print(f"[ERROR] REST Source Read Failed: {e}")
            return {}
