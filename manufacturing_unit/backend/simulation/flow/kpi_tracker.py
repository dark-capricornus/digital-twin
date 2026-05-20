"""
KPI Tracker for Material Flow Engine

Calculates production KPIs from counters.

CRITICAL RULES:
- Read-only consumer of counter state
- NO control logic
- NO physics calculations
- Deterministic calculations only
"""

from typing import Dict, Any
from .counters import CounterSystem, WIPTracker


class KPITracker:
    """
    Production KPI calculator.
    
    Calculates metrics from counters for analytics/UI.
    """
    
    def __init__(self, counters: CounterSystem, wip: WIPTracker):
        """
        Initialize KPI tracker.
        
        Args:
            counters: Counter system
            wip: WIP tracker
        """
        self.counters = counters
        self.wip = wip
        self.start_time = 0.0
    
    def set_start_time(self, time: float) -> None:
        """Set simulation start time"""
        self.start_time = time
    
    def calculate_yield(self) -> float:
        """
        Calculate overall yield percentage.
        
        Returns:
            Yield % (0-100)
        """
        total_in = self.counters.get('inbound_received')
        good_out = self.counters.get('inspection_pass')
        
        if total_in == 0:
            return 0.0
        
        return (good_out / total_in) * 100.0
    
    def calculate_throughput(self, current_time: float) -> float:
        """
        Calculate throughput (parts per hour).
        
        Args:
            current_time: Current simulation time (seconds)
        
        Returns:
            Parts per hour
        """
        elapsed_hours = (current_time - self.start_time) / 3600.0
        
        if elapsed_hours == 0:
            return 0.0
        
        total_out = self.counters.get('packing_complete')
        return total_out / elapsed_hours
    
    def calculate_scrap_rate(self) -> float:
        """
        Calculate scrap rate percentage.
        
        Returns:
            Scrap % (0-100)
        """
        total_in = self.counters.get('inbound_received')
        
        if total_in == 0:
            return 0.0
        
        # Sum all scrap counters
        scrap_count = sum(
            count for name, count in self.counters.get_all().items()
            if 'scrap' in name or 'reject' in name or 'fail' in name
        )
        
        return (scrap_count / total_in) * 100.0
    
    def get_wip_by_stage(self) -> Dict[str, int]:
        """
        Get WIP count by stage.
        
        Returns:
            Dict of stage -> count
        """
        return self.wip.get_all_counts()
    
    def get_total_wip(self) -> int:
        """
        Get total WIP across all stages.
        
        Returns:
            Total WIP count
        """
        return sum(self.wip.get_all_counts().values())
    
    def get_all_metrics(self, current_time: float) -> Dict[str, Any]:
        """
        Get all KPIs.
        
        Args:
            current_time: Current simulation time (seconds)
        
        Returns:
            Dict of all metrics
        """
        return {
            # Production counts
            'total_in': self.counters.get('inbound_received'),
            'total_produced': self.counters.get('packing_complete'),
            'good_count': self.counters.get('inspection_pass'),
            'scrap_count': sum(
                count for name, count in self.counters.get_all().items()
                if 'scrap' in name or 'reject' in name or 'fail' in name
            ),
            
            # Rates
            'yield_percent': round(self.calculate_yield(), 2),
            'scrap_rate_percent': round(self.calculate_scrap_rate(), 2),
            'throughput_per_hour': round(self.calculate_throughput(current_time), 2),
            
            # WIP
            'wip_total': self.get_total_wip(),
            'wip_by_stage': self.get_wip_by_stage(),
            
            # Stage counts (for detailed analytics)
            'stage_counts': {
                'lpdc_cast': self.counters.get('lpdc_cast'),
                'cnc_machined': self.counters.get('cnc_machined'),
                'painted': self.counters.get('paint_complete'),
                'inspected': self.counters.get('inspection_pass') + self.counters.get('inspection_fail'),
            }
        }
