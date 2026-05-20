"""
Shared Fixtures for the Digital Twin Test Suite.

Provides pre-configured machine, flow engine, and factory instances
used across all test modules.
"""

import sys
import os
import pytest

# Ensure the project root is on the Python path so that
# `manufacturing_unit.backend.*` imports resolve correctly.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from manufacturing_unit.backend.simulation.machines.base_machine import BaseMachine, MachineState
from manufacturing_unit.backend.simulation.machines.simple import SimpleMachine
from manufacturing_unit.backend.simulation.machines.thermal import ThermalMachine
from manufacturing_unit.backend.simulation.machines.degasser import DegasserMachine
from manufacturing_unit.backend.simulation.machines.inspection import InspectionMachine
from manufacturing_unit.backend.simulation.factory import build_factory
from manufacturing_unit.backend.simulation.flow.events import EventDispatcher, Event, ProductionEventType
from manufacturing_unit.backend.simulation.flow.flow_engine import MaterialFlowEngine
from manufacturing_unit.backend.simulation.flow.counters import CounterSystem, WIPTracker


# ─── Machine Fixtures ────────────────────────────────────────────────────────

@pytest.fixture
def cnc_machine():
    """A CNC machining SimpleMachine, enabled and IDLE (ready to start)."""
    m = SimpleMachine("CNC_01", "CNC Machining", cycle_time=10.0,
                       role="machining", has_trigger=True)
    m.enabled = True
    m.handle_reset_command()  # STOPPED -> IDLE
    return m


@pytest.fixture
def lpdc_machine():
    """An LPDC casting SimpleMachine, enabled and IDLE."""
    m = SimpleMachine("LPDC_01", "LPDC Machine", cycle_time=15.0,
                       role="casting", has_pour=True)
    m.enabled = True
    m.handle_reset_command()
    return m


@pytest.fixture
def furnace():
    """A melting furnace (ThermalMachine), enabled and IDLE."""
    m = ThermalMachine("FURNACE_01", "Melting Furnace",
                        cycle_time=10.0, target_temp=750.0)
    m.enabled = True
    m.handle_reset_command()
    return m


@pytest.fixture
def cooling_tank():
    """A cooling tank (ThermalMachine, cooling mode), enabled and IDLE."""
    m = ThermalMachine("COOLING_01", "Cooling Tank",
                        cycle_time=5.0, target_temp=25.0, cooling=True)
    m.enabled = True
    m.handle_reset_command()
    return m


@pytest.fixture
def degasser():
    """A degasser machine, enabled and IDLE."""
    m = DegasserMachine("DEGASSER_01", "Degasser", cycle_time=8.0)
    m.enabled = True
    m.handle_reset_command()
    return m


@pytest.fixture
def inspection():
    """An X-ray inspection machine with 10% fail rate, enabled and IDLE."""
    m = InspectionMachine("INSPECTION_01", "X-Ray Inspection",
                           cycle_time=6.0, fail_rate=0.10)
    m.enabled = True
    m.handle_reset_command()
    return m


@pytest.fixture
def paint_booth():
    """A paint booth SimpleMachine, enabled and IDLE."""
    m = SimpleMachine("PAINT_01", "Paint Booth 1", cycle_time=8.0, role="paint")
    m.enabled = True
    m.handle_reset_command()
    return m


@pytest.fixture
def pretreat_machine():
    """A pretreatment SimpleMachine, enabled and IDLE."""
    m = SimpleMachine("PRETREAT_01", "Pretreatment", cycle_time=5.0, role="pretreat")
    m.enabled = True
    m.handle_reset_command()
    return m


# ─── Flow Engine Fixtures ────────────────────────────────────────────────────

@pytest.fixture
def event_dispatcher():
    """A fresh EventDispatcher."""
    return EventDispatcher()


@pytest.fixture
def flow_engine(event_dispatcher):
    """A MaterialFlowEngine wired to a fresh dispatcher."""
    return MaterialFlowEngine(event_dispatcher, seed=42)


@pytest.fixture
def counter_system():
    """A seeded CounterSystem."""
    return CounterSystem(seed=42)


@pytest.fixture
def wip_tracker():
    """A fresh WIPTracker."""
    return WIPTracker()


# ─── Factory / Integration Fixtures ──────────────────────────────────────────

@pytest.fixture
def factory_engine():
    """A full SimulationEngine built by factory (no PLC reference)."""
    return build_factory(plc_ref=None)
