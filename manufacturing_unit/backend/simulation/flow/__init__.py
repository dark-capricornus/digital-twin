"""
Material Flow / Production Engine

Event-driven production tracking system.

Responsibilities:
- Subscribe to production events
- Maintain counts per stage
- Apply deterministic yield
- Track WIP
- Emit read-only metrics

NO:
- Control logic
- Physics calculations
- PLC sequencing
"""

from .events import Event, EventDispatcher, ProductionEventType
from .counters import CounterSystem
from .kpi_tracker import KPITracker
from .flow_engine import MaterialFlowEngine

__all__ = [
    'Event',
    'EventDispatcher',
    'ProductionEventType',
    'CounterSystem',
    'KPITracker',
    'MaterialFlowEngine'
]
