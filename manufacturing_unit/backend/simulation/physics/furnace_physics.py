"""
Furnace Thermal Physics Model

First-order thermal model for melting/holding furnace.

Physics:
    dT/dt = (P_in - P_loss) / C_thermal
    
    where:
        P_in = heater_power_% * P_max
        P_loss = k_loss * (T - T_ambient)
        C_thermal = heat capacity (J/K)

Features:
- Exponential rise to setpoint
- Ramp-rate constraints (industrial realism)
- Over-temperature alarm (derived)
- Heat loss to environment
"""

from typing import Dict, Any
from .physics_base import PhysicsModel


class FurnacePhysics(PhysicsModel):
    """
    First-order thermal model for industrial furnace.
    
    Models heat input, thermal mass, and heat loss.
    Temperature evolves via differential equation, not direct writes.
    """
    
    def __init__(self):
        # Physical parameters
        self.T_ambient = 20.0  # °C (ambient temperature)
        self.T_current = 20.0  # °C (current furnace temperature)
        self.C_thermal = 50000.0  # J/K (thermal mass / heat capacity)
        self.k_loss = 80.0  # W/K (heat loss coefficient - reduced for efficiency)
        self.P_max = 1500000.0  # W (maximum heater power - increased 10x for fast sim)
        
        # Constraints (industrial realism)
        self.max_ramp_rate = 50.0  # °C/s (faster heating for simulation responsiveness)
        self.T_max = 900.0  # °C (safety limit)
        self.T_min = 20.0  # °C (cannot go below ambient)
        
        # Alarm thresholds
        self.T_alarm_threshold = 0.98  # 98% of max temp triggers alarm
        
        # Internal state
        self.heating_rate = 0.0  # °C/s (current rate of temperature change)
        self.power_in = 0.0  # W (current heater power)
        self.power_loss = 0.0  # W (current heat loss)
    
    def reset(self) -> None:
        """Reset to cold start conditions."""
        self.T_current = self.T_ambient
        self.heating_rate = 0.0
        self.power_in = 0.0
        self.power_loss = 0.0
    
    def step(self, dt: float, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Advance thermal simulation by dt seconds.
        
        Args:
            dt: Time step (seconds)
            inputs: {'heater_power': 0-100}  # Heater power percentage
        
        Returns:
            {
                'temperature': float,  # °C
                'heating_rate': float,  # °C/s
                'power_in': float,  # W
                'power_loss': float,  # W
                'over_temp_alarm': bool
            }
        """
        # Get control input
        heater_power_pct = inputs.get('heater_power', 0.0)  # 0-100%
        heater_power_pct = max(0.0, min(100.0, heater_power_pct))  # Clamp
        
        # Calculate power balance
        self.power_in = (heater_power_pct / 100.0) * self.P_max
        self.power_loss = self.k_loss * (self.T_current - self.T_ambient)
        
        # Temperature rate of change (first-order ODE)
        dT_dt = (self.power_in - self.power_loss) / self.C_thermal
        
        # Apply ramp rate constraint (industrial realism)
        # Real furnaces can't change temperature instantly
        dT_dt = max(-self.max_ramp_rate, min(self.max_ramp_rate, dT_dt))
        
        # Integrate temperature
        self.T_current += dT_dt * dt
        
        # Apply physical limits
        self.T_current = max(self.T_min, min(self.T_max, self.T_current))
        
        # Store heating rate for output
        self.heating_rate = dT_dt
        
        # Derived alarm (over-temperature detection)
        over_temp_alarm = self.T_current >= (self.T_max * self.T_alarm_threshold)
        
        return {
            'temperature': round(self.T_current, 2),
            'heating_rate': round(self.heating_rate, 3),
            'power_in': round(self.power_in, 1),
            'power_loss': round(self.power_loss, 1),
            'over_temp_alarm': over_temp_alarm
        }
    
    def get_state(self) -> Dict[str, Any]:
        """Get internal state for debugging."""
        return {
            'T_current': self.T_current,
            'heating_rate': self.heating_rate,
            'power_in': self.power_in,
            'power_loss': self.power_loss
        }
    
    def set_state(self, state: Dict[str, Any]) -> None:
        """Set internal state (for testing)."""
        if 'T_current' in state:
            self.T_current = state['T_current']
        if 'heating_rate' in state:
            self.heating_rate = state['heating_rate']
