"""
Event System for Material Flow Engine

Event-driven architecture for production tracking.

CRITICAL RULES:
- Events are emitted by physics/machines
- Flow Engine ONLY reacts to events
- NO polling, NO state inspection
- Deterministic and reproducible
"""

from dataclasses import dataclass
from typing import Dict, Any, Callable, List
from enum import Enum


class ProductionEventType(str, Enum):
    """
    Production event types.
    
    Events are emitted when physical processes complete,
    NOT on every simulation tick.
    """
    # Inbound
    INGOT_RECEIVED = "INGOT_RECEIVED"
    
    # Melting
    FURNACE_MELT_READY = "FURNACE_MELT_READY"
    
    # Degassing
    DEGASSER_COMPLETE = "DEGASSER_COMPLETE"
    
    # Casting
    LPDC_CYCLE_COMPLETE = "LPDC_CYCLE_COMPLETE"
    LPDC_CAST_REJECTED = "LPDC_CAST_REJECTED"
    
    # Cooling
    COOLING_COMPLETE = "COOLING_COMPLETE"
    
    # Heat Treatment
    HEAT_TREATMENT_COMPLETE = "HEAT_TREATMENT_COMPLETE"
    
    # Machining
    CNC_CYCLE_COMPLETE = "CNC_CYCLE_COMPLETE"
    CNC_PART_REJECTED = "CNC_PART_REJECTED"
    
    # Surface Treatment
    PRETREATMENT_COMPLETE = "PRETREATMENT_COMPLETE"
    PAINT_COMPLETE = "PAINT_COMPLETE"
    
    # Inspection
    XRAY_PASS = "XRAY_PASS"
    XRAY_FAIL = "XRAY_FAIL"
    INSPECTION_PASS = "INSPECTION_PASS"
    INSPECTION_FAIL = "INSPECTION_FAIL"
    
    # Packing
    PACKING_COMPLETE = "PACKING_COMPLETE"
    
    # Scrap
    PART_SCRAPPED = "PART_SCRAPPED"


@dataclass
class Event:
    """
    Production event.
    
    Emitted when a physical process completes or a state change occurs.
    """
    type: ProductionEventType
    timestamp: float  # Simulation time (seconds)
    device_id: str
    data: Dict[str, Any]  # Event-specific data (part_id, batch_id, etc.)
    
    def __repr__(self) -> str:
        return f"Event({self.type.value}, t={self.timestamp:.1f}s, device={self.device_id})"


class EventDispatcher:
    """
    Event dispatcher for pub-sub pattern.
    
    CRITICAL:
    - Events are emitted by machines/physics
    - Flow Engine subscribes to events
    - NO polling, NO state inspection
    """
    
    def __init__(self):
        self._subscribers: Dict[ProductionEventType, List[Callable]] = {}
        self._event_log: List[Event] = []  # For debugging/replay
    
    def subscribe(self, event_type: ProductionEventType, callback: Callable[[Event], None]) -> None:
        """
        Subscribe to an event type.
        
        Args:
            event_type: Event type to subscribe to
            callback: Function to call when event is emitted
        """
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(callback)
    
    def emit(self, event: Event) -> None:
        """
        Emit an event to all subscribers.
        
        Args:
            event: Event to emit
        """
        # Log event
        self._event_log.append(event)
        
        # Notify subscribers
        if event.type in self._subscribers:
            for callback in self._subscribers[event.type]:
                callback(event)
    
    def get_event_log(self) -> List[Event]:
        """Get event log (for debugging/analysis)"""
        return self._event_log.copy()
    
    def clear_log(self) -> None:
        """Clear event log"""
        self._event_log.clear()
