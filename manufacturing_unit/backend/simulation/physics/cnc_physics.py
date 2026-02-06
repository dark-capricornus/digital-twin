"""
CNC Machining Physics Model

Material Removal Rate (MRR) based cycle-time physics.

Physics:
    Cycle Time = Volume_to_remove / MRR
    
    where:
        MRR_roughing = 1000 mm³/s
        MRR_finishing = 200 mm³/s

Features:
- Linear progress vs time
- Roughing vs finishing modes
- Explicit reset logic (fixes single-run bug)
- No geometry simulation (volume-based only)
"""

from typing import Dict, Any
from .physics_base import PhysicsModel


class CNCPhysics(PhysicsModel):
    """
    MRR-based CNC machining model.
    
    Models material removal as linear progress based on mode.
    """
    
    def __init__(self):
        # State
        self.mode = 'roughing'  # 'roughing' or 'finishing'
        self.progress = 0.0  # 0-100%
        self.spindle_rpm = 0.0  # RPM (cosmetic)
        self.busy = False
        
        # Parameters
        self.MRR_roughing = 1000.0  # mm³/s
        self.MRR_finishing = 200.0  # mm³/s
        self.volume_total = 50000.0  # mm³ (part volume to remove)
        
        # Spindle speeds (cosmetic, for realism)
        self.RPM_roughing = 3000
        self.RPM_finishing = 6000
        
        # Control flags
        self.job_active = False
    
    def reset(self) -> None:
        """Reset to idle state."""
        self.progress = 0.0
        self.spindle_rpm = 0.0
        self.busy = False
        self.job_active = False
        self.mode = 'roughing'
    
    def step(self, dt: float, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Advance CNC simulation by dt seconds.
        
        Args:
            dt: Time step (seconds)
            inputs: {
                'trigger': bool,  # Start machining cycle
                'mode': str,  # 'roughing' or 'finishing'
                'reset_request': bool  # Reset after completion
            }
        
        Returns:
            {
                'progress': float,  # 0-100%
                'spindle_rpm': float,  # RPM
                'mode': str,  # Current mode
                'busy': bool  # True if machining active
            }
        """
        # Get control inputs
        trigger = inputs.get('trigger', False)
        mode = inputs.get('mode', 'roughing')
        reset_request = inputs.get('reset_request', False)
        
        # Validate mode
        if mode not in ['roughing', 'finishing']:
            mode = 'roughing'
        
        # Trigger logic: Start new job
        # CRITICAL FIX: Only trigger if NOT already running AND progress is 0
        # This prevents re-triggering mid-job
        if trigger and not self.job_active and self.progress == 0.0:
            self.job_active = True
            self.mode = mode
            self.progress = 0.0
            self.busy = True
        
        # Job execution
        if self.job_active and self.progress < 100.0:
            # Calculate MRR based on mode
            MRR = self.MRR_roughing if self.mode == 'roughing' else self.MRR_finishing
            
            # Physics: Volume removed per time step
            volume_removed = MRR * dt
            
            # Convert to progress percentage
            progress_increment = (volume_removed / self.volume_total) * 100.0
            self.progress += progress_increment
            
            # Spindle RPM (cosmetic, for realism)
            self.spindle_rpm = self.RPM_roughing if self.mode == 'roughing' else self.RPM_finishing
            
            self.busy = True
        
        # Job completion
        if self.progress >= 100.0:
            self.progress = 100.0
            self.spindle_rpm = 0.0
            self.busy = False
            self.job_active = False  # Mark job as complete
        
        # Reset logic: Allow re-arming for next cycle
        # CRITICAL FIX: Explicit reset to allow multiple cycles
        if reset_request and not self.job_active:
            self.progress = 0.0
            self.spindle_rpm = 0.0
            self.busy = False
        
        return {
            'progress': round(self.progress, 2),
            'spindle_rpm': round(self.spindle_rpm, 0),
            'mode': self.mode,
            'busy': self.busy
        }
    
    def get_state(self) -> Dict[str, Any]:
        """Get internal state for debugging."""
        return {
            'mode': self.mode,
            'progress': self.progress,
            'spindle_rpm': self.spindle_rpm,
            'busy': self.busy,
            'job_active': self.job_active
        }
    
    def set_state(self, state: Dict[str, Any]) -> None:
        """Set internal state (for testing)."""
        if 'progress' in state:
            self.progress = state['progress']
        if 'mode' in state:
            self.mode = state['mode']
        if 'spindle_rpm' in state:
            self.spindle_rpm = state['spindle_rpm']
        if 'busy' in state:
            self.busy = state['busy']
