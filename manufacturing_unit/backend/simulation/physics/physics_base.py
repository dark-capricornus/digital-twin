"""
Base Physics Model Class

Defines the interface for all physics models in the Digital Twin.

Key Principles:
1. Deterministic: Same inputs + dt → same outputs
2. Internal state allowed: State evolves only via step(dt, inputs)
3. No external side effects: No mutation of external objects
4. No randomness: All behavior must be reproducible
5. Δt-based evolution: All state changes via time integration
"""

from abc import ABC, abstractmethod
from typing import Dict, Any


class PhysicsModel(ABC):
    """
    Base class for all physics models.
    
    All physics models must:
    - Maintain internal state (temperature, pressure, position, etc.)
    - Update state ONLY via step() method
    - Return sensor-like outputs (measurements)
    - Accept control inputs (setpoints, commands)
    - Be deterministic (no randomness)
    """
    
    @abstractmethod
    def reset(self) -> None:
        """
        Reset model to initial conditions.
        
        This should restore all internal state variables to their
        default/startup values. Used for simulation restart or
        equipment reset scenarios.
        """
        pass
    
    @abstractmethod
    def step(self, dt: float, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Advance physics simulation by dt seconds.
        
        This is the core physics update loop. All state evolution
        happens here via time integration.
        
        Args:
            dt: Time step in seconds (typically 0.2s for 5 Hz updates)
            inputs: Control inputs from PLC/controller
                   Examples: {'heater_power': 75.0, 'pressure_setpoint': 50.0}
        
        Returns:
            outputs: Physical measurements and derived values
                    Examples: {'temperature': 650.0, 'fill_percentage': 45.0}
        
        Rules:
        - Must be deterministic (same inputs → same outputs)
        - No external side effects (only update internal state)
        - No randomness
        - Respect physical constraints (limits, ramp rates, etc.)
        """
        pass
    
    def get_state(self) -> Dict[str, Any]:
        """
        Get current internal state for debugging/logging.
        
        Optional method for diagnostics. Returns internal state variables.
        Default implementation returns empty dict.
        """
        return {}
    
    def set_state(self, state: Dict[str, Any]) -> None:
        """
        Set internal state (for testing/initialization).
        
        Optional method for test setup. Allows direct state injection.
        Use with caution - prefer reset() + step() for normal operation.
        """
        pass
