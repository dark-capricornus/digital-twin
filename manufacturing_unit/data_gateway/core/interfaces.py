from abc import ABC, abstractmethod
from typing import Dict, Any, List

class ISource(ABC):
    """
    Interface for data sources (e.g. REST, OPC UA, PLC).
    """
    @abstractmethod
<<<<<<< HEAD
    def read(self) -> Dict[str, Any]:
=======
    async def read(self) -> Dict[str, Any]:
>>>>>>> v1
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
<<<<<<< HEAD
    def write(self, data: Dict[int, Any]) -> None:
=======
    async def write(self, data: Dict[int, Any]) -> None:
>>>>>>> v1
        """
        Writes data to the sink.
        Expecting a dictionary of {channel_id: value}.
        """
        pass

class IAdapter(ABC):
    @abstractmethod
<<<<<<< HEAD
    def connect(self):
        pass
        
    @abstractmethod
    def disconnect(self):
=======
    async def connect(self):
        pass
        
    @abstractmethod
    async def disconnect(self):
>>>>>>> v1
        pass
