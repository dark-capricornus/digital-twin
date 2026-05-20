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

    @abstractmethod
    async def write(self, tag: str, value: Any) -> bool:
        """
        Writes data back to the source (Control commands).
        """
        pass

class ISink(ABC):
    """
    Interface for data sinks (e.g. Rapid SCADA File, API, MQTT).
    """
    @abstractmethod
    async def write(self, data: Dict[Any, Any]) -> None:
        """
        Writes data to the sink.
        """
        pass

    @abstractmethod
    def set_command_callback(self, callback) -> None:
        """
        Set a callback for incoming commands from the sink.
        Callback signature: async def callback(tag: str, value: Any)
        """
        pass

class IAdapter(ABC):
    @abstractmethod
    async def connect(self):
        pass
        
    @abstractmethod
    async def disconnect(self):
        pass
