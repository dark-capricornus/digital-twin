from abc import ABC, abstractmethod
from typing import Dict, Any, List

class ISource(ABC):
    """
    Interface for data sources (e.g. REST, OPC UA, PLC).
    """
    @abstractmethod
    async def read(self) -> Dict[str, Any]:
        """
        Reads data from the source.
        Returns a dictionary of {tag_name: value}.
        """
        pass

class ISink(ABC):
    """
    Interface for data sinks (e.g. Rapid SCADA File, API, MQTT).
    """
    @abstractmethod
    async def write(self, data: Dict[int, Any]) -> None:
        """
        Writes data to the sink.
        Expecting a dictionary of {channel_id: value}.
        """
        pass

class IAdapter(ABC):
    @abstractmethod
    async def connect(self):
        pass
        
    @abstractmethod
    async def disconnect(self):
        pass
