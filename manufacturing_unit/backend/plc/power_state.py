"""
PLC Power State Management

Implements industrial-grade PLC power state machine:
OFF → STARTING → RUNNING → STOPPING → OFF
"""

from enum import Enum

class PLCPowerState(Enum):
    """
    PLC Global Power State Machine
    
    Matches real industrial PLC behavior (Siemens S7 / Rockwell ControlLogix)
    """
    OFF = 0       # No scan execution, outputs frozen, physics halted
    STARTING = 1  # Single-pass initialization sequence
    RUNNING = 2   # Normal cyclic operation
    STOPPING = 3  # Single-pass shutdown sequence
    FAULT = 4     # Critical error, requires manual intervention
