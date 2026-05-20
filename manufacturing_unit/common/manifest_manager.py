import json
import os
from typing import Dict, Any, List

class ManifestManager:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ManifestManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
            
        self.base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.manifest_dir = os.path.join(self.base_dir, "docs", "manifests")
        
        self.site_manifest = self._load_json("site_manifest.json")
        self.telemetry_dict = self._load_json("telemetry_dictionary.json")
        self._initialized = True

    def _load_json(self, filename: str) -> Dict[str, Any]:
        path = os.path.join(self.manifest_dir, filename)
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"[MANIFEST] Error loading {filename}: {e}")
            return {}

    def get_machine_config(self, machine_id: str) -> Dict[str, Any]:
        return self.site_manifest.get("machines", {}).get(machine_id, {})

    def get_device_type_config(self, device_type: str) -> Dict[str, Any]:
        return self.telemetry_dict.get("device_types", {}).get(device_type, {})

    def get_tag_category(self, device_type: str, tag_name: str) -> str:
        type_config = self.get_device_type_config(device_type)
        for category, tags in type_config.items():
            if tag_name in tags:
                return category
        return "Status" # Default

    def get_plant_telemetry_map(self) -> Dict[str, Any]:
        """Returns a flat map of OPC-UA browse names to frontend keys for Plant WIP/KPI."""
        res = {}
        plant_telemetry = self.site_manifest.get("plant_telemetry", {})
        for category in ["WIP", "KPI"]:
            res.update(plant_telemetry.get(category, {}))
        return res

    def get_exposed_machines(self) -> List[str]:
        return list(self.site_manifest.get("machines", {}).keys())

    def get_machine_mappings(self) -> Dict[str, str]:
        """Returns a map of machine_id -> sim_id."""
        return {k: v.get("sim_id") for k, v in self.site_manifest.get("machines", {}).items()}
