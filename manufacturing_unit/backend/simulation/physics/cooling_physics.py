"""
Cooling / Solidification Physics Model

Newton's Law of Cooling with shrinkage risk detection.

Physics:
    dT/dt = -k_cool * coolant_flow * (T - T_coolant)

Features:
- Exponential decay to coolant temperature
- Cooling rate calculation
- Shrinkage risk flag (rapid cooling detection)
- Last-to-solidify detection (rule-based)

Phase-1 Boundary:
    LPDC → Cooling handoff is LOGICAL, not thermal-coupled.
    Cooling starts with assumed initial temperature.
    Thermal coupling will be added in later phases.
"""

from typing import Dict, Any
from .physics_base import PhysicsModel


class CoolingPhysics(PhysicsModel):
    """
    Cooling model for post-casting heat removal.
    
    Models Newton's law of cooling with shrinkage risk detection.
    """
    
    def __init__(self):
        # Physical state
        self.T_part = 500.0  # °C (initial casting temperature)
        self.T_coolant = 25.0  # °C (coolant temperature)
        
        # Parameters
        self.k_cool = 0.05  # Cooling coefficient (1/s)
        
        # Thresholds
        self.critical_cooling_rate = 50.0  # °C/s (shrinkage risk threshold)
        self.solidus_temp = 450.0  # °C (below this = solidified)
        
        # Derived state
        self.cooling_rate = 0.0  # °C/s (current cooling rate)
        self.shrinkage_risk = False
        self.last_to_solidify = False
    
    def reset(self) -> None:
        """Reset to initial hot state."""
        self.T_part = 500.0
        self.cooling_rate = 0.0
        self.shrinkage_risk = False
        self.last_to_solidify = False
    
    def step(self, dt: float, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Advance cooling simulation by dt seconds.
        
        Args:
            dt: Time step (seconds)
            inputs: {
                'coolant_flow': float,  # 0-1 (flow rate multiplier)
                'initial_temp': float  # Optional: set initial temp (for handoff)
            }
        
        Returns:
            {
                'part_temperature': float,  # °C
                'cooling_rate': float,  # °C/s (absolute value)
                'shrinkage_risk': bool,  # True if cooling too fast
                'last_to_solidify': bool  # True if below solidus temp
            }
        """
        # Get control inputs
        coolant_flow = inputs.get('coolant_flow', 1.0)  # 0-1
        coolant_flow = max(0.0, min(1.0, coolant_flow))  # Clamp
        
        # Optional: Set initial temperature (for LPDC → Cooling handoff)
        if 'initial_temp' in inputs:
            self.T_part = inputs['initial_temp']
        
        # Physics: Newton's Law of Cooling
        # dT/dt = -k * flow * (T - T_coolant)
        dT_dt = -self.k_cool * coolant_flow * (self.T_part - self.T_coolant)
        
        # Integrate temperature
        self.T_part += dT_dt * dt
        
        # Prevent going below coolant temperature
        if self.T_part < self.T_coolant:
            self.T_part = self.T_coolant
            dT_dt = 0.0
        
        # Store cooling rate (absolute value for display)
        self.cooling_rate = abs(dT_dt)
        
        # Shrinkage risk detection (rule-based)
        # Rapid cooling can cause internal stresses and shrinkage defects
        self.shrinkage_risk = self.cooling_rate > self.critical_cooling_rate
        
        # Last-to-solidify detection (rule-based)
        # In reality, this would be the center/hotspot of the casting
        # For Phase-1, we use a simple temperature threshold
        self.last_to_solidify = self.T_part < self.solidus_temp
        
        return {
            'part_temperature': round(self.T_part, 2),
            'cooling_rate': round(self.cooling_rate, 2),
            'shrinkage_risk': self.shrinkage_risk,
            'last_to_solidify': self.last_to_solidify
        }
    
    def get_state(self) -> Dict[str, Any]:
        """Get internal state for debugging."""
        return {
            'T_part': self.T_part,
            'cooling_rate': self.cooling_rate,
            'shrinkage_risk': self.shrinkage_risk,
            'last_to_solidify': self.last_to_solidify
        }
    
    def set_state(self, state: Dict[str, Any]) -> None:
        """Set internal state (for testing)."""
        if 'T_part' in state:
            self.T_part = state['T_part']
        if 'cooling_rate' in state:
            self.cooling_rate = state['cooling_rate']
