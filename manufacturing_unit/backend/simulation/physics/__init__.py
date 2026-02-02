"""
Physics Module for Digital Twin Simulation

This module contains physics-based models for industrial equipment.
All models are Tier-1: fast, explainable, industrial-faithful.

Architecture:
- SimulationEngine owns all physics models
- VirtualPLC provides control inputs only
- OPC UA exposes sensor-like outputs only
"""

from .physics_base import PhysicsModel
from .furnace_physics import FurnacePhysics
from .lpdc_physics import LPDCPhysics
from .cooling_physics import CoolingPhysics
from .cnc_physics import CNCPhysics

__all__ = [
    'PhysicsModel',
    'FurnacePhysics',
    'LPDCPhysics',
    'CoolingPhysics',
    'CNCPhysics'
]
