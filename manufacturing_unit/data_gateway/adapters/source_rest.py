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

    def connect(self):
        # Setup session if needed
        pass

    def disconnect(self):
        pass

    def read(self) -> dict:
        try:
            response = requests.get(self.url, timeout=2.0)
            if response.status_code == 200:
                return response.json()
            else:
                print(f"[WARN] REST Source returned {response.status_code}")
                return {}
        except Exception as e:
            print(f"[ERROR] REST Source Read Failed: {e}")
            return {}
