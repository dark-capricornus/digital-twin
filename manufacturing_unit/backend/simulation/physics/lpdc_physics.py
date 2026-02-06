"""
LPDC (Low Pressure Die Casting) Physics Model

Pressure-driven filling model with state machine.

Physics:
    Fill Rate: dh/dt = k_fill * sqrt(P_applied)
    
    where:
        h = melt height in die (0-100%)
        P_applied = applied pressure (conceptual, not dimensional PSI)
        k_fill = filling coefficient

State Machine:
    IDLE → FILLING → HOLDING → SOLIDIFYING → COMPLETE

Note on Pressure Units:
    Pressure is CONCEPTUAL (not dimensional PSI).
    Square-root behavior represents pressure-driven flow physics,
    but values are normalized for simulation purposes.
"""

from typing import Dict, Any
from .physics_base import PhysicsModel


class LPDCPhysics(PhysicsModel):
    """
    Pressure-driven die casting model with solidification.
    
    Models melt filling, pressure holding, and directional solidification.
    Uses finite state machine for cycle control.
    """
    
    def __init__(self):
        # State machine
        self.state = 'IDLE'
        self.timer = 0.0  # Internal timer for state transitions
        
        # Physical state
        self.fill_height = 0.0  # 0-100% (melt height in die)
        self.solidification_progress = 0.0  # 0-100%
        self.pressure = 0.0  # Conceptual pressure (not dimensional PSI)
        
        # Parameters
        self.k_fill = 2.0  # Filling coefficient (controls fill rate)
        self.hold_time = 5.0  # seconds (pressure hold duration)
        self.solidification_time = 10.0  # seconds (solidification duration)
        
        # Derived flags
        self.cycle_running = False
        self.last_to_solidify = False
    
    def reset(self) -> None:
        """Reset to idle state."""
        self.state = 'IDLE'
        self.timer = 0.0
        self.fill_height = 0.0
        self.solidification_progress = 0.0
        self.pressure = 0.0
        self.cycle_running = False
        self.last_to_solidify = False
    
    def step(self, dt: float, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Advance LPDC simulation by dt seconds.
        
        Args:
            dt: Time step (seconds)
            inputs: {
                'pour_request': bool,  # Start casting cycle
                'pressure_setpoint': float,  # Conceptual pressure (0-100)
                'reset_request': bool  # Reset to IDLE after completion
            }
        
        Returns:
            {
                'fill_percentage': float,  # 0-100%
                'pressure': float,  # Conceptual pressure
                'solidification_progress': float,  # 0-100%
                'cycle_state': str,  # State machine state
                'cycle_running': bool,  # True if active cycle
                'last_to_solidify': bool  # Solidification complete flag
            }
        """
        # Get control inputs
        pour_request = inputs.get('pour_request', False)
        pressure_setpoint = inputs.get('pressure_setpoint', 0.0)
        reset_request = inputs.get('reset_request', False)
        
        # Clamp pressure
        pressure_setpoint = max(0.0, min(100.0, pressure_setpoint))
        
        # State machine logic
        if self.state == 'IDLE':
            self.cycle_running = False
            self.last_to_solidify = False
            
            if pour_request:
                # Start new cycle
                self.state = 'FILLING'
                self.fill_height = 0.0
                self.solidification_progress = 0.0
                self.timer = 0.0
                self.cycle_running = True
        
        elif self.state == 'FILLING':
            self.cycle_running = True
            
            # Physics: Pressure-driven filling
            # dh/dt = k_fill * sqrt(P)
            if pressure_setpoint > 0:
                dh_dt = self.k_fill * (pressure_setpoint ** 0.5)
                self.fill_height += dh_dt * dt
                self.pressure = pressure_setpoint
            else:
                # No pressure = no filling
                self.pressure = 0.0
            
            # Transition: Fill complete
            if self.fill_height >= 100.0:
                self.fill_height = 100.0
                self.state = 'HOLDING'
                self.timer = 0.0
        
        elif self.state == 'HOLDING':
            self.cycle_running = True
            
            # Maintain pressure during hold
            self.pressure = pressure_setpoint
            
            # Timer-based transition
            self.timer += dt
            if self.timer >= self.hold_time:
                self.state = 'SOLIDIFYING'
                self.timer = 0.0
        
        elif self.state == 'SOLIDIFYING':
            self.cycle_running = True
            
            # Directional solidification (rule-based, not FEA)
            # Progresses linearly with time
            self.timer += dt
            self.solidification_progress = min(100.0, (self.timer / self.solidification_time) * 100.0)
            
            # Pressure can be released during solidification
            self.pressure = 0.0
            
            # Last-to-solidify detection (simplified)
            # In reality, this would be the center/hotspot of the casting
            if self.solidification_progress >= 100.0:
                self.last_to_solidify = True
                self.state = 'COMPLETE'
        
        elif self.state == 'COMPLETE':
            self.cycle_running = False
            self.pressure = 0.0
            
            # Wait for reset/ejection
            if reset_request:
                self.state = 'IDLE'
                self.fill_height = 0.0
                self.solidification_progress = 0.0
                self.last_to_solidify = False
        
        return {
            'fill_percentage': round(self.fill_height, 2),
            'pressure': round(self.pressure, 2),
            'solidification_progress': round(self.solidification_progress, 2),
            'cycle_state': self.state,
            'cycle_running': self.cycle_running,
            'last_to_solidify': self.last_to_solidify
        }
    
    def get_state(self) -> Dict[str, Any]:
        """Get internal state for debugging."""
        return {
            'state': self.state,
            'timer': self.timer,
            'fill_height': self.fill_height,
            'solidification_progress': self.solidification_progress,
            'pressure': self.pressure
        }
    
    def set_state(self, state: Dict[str, Any]) -> None:
        """Set internal state (for testing)."""
        if 'state' in state:
            self.state = state['state']
        if 'fill_height' in state:
            self.fill_height = state['fill_height']
        if 'solidification_progress' in state:
            self.solidification_progress = state['solidification_progress']
