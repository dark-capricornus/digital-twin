from typing import Dict, Any

class ScadaStore:
    """
    Single Source of Truth for the SCADA system.
    Thread-safe storage for machine tags.
    """
    _instance = None
    _store: Dict[str, Any] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ScadaStore, cls).__new__(cls)
            cls._store = {}
        return cls._instance

    @classmethod
    def update(cls, tags: Dict[str, Any]):
        """
        Update multiple tags at once.
        """
        cls._store.update(tags)

    @classmethod
    def get_all(cls) -> Dict[str, Any]:
        """
        Get entire state snapshot.
        """
        return cls._store.copy()

    @classmethod
    def get(cls, tag_name: str):
        return cls._store.get(tag_name)
