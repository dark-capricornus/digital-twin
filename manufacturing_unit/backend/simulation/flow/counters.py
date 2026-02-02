"""
Counter System for Material Flow Engine

Deterministic production counting.

CRITICAL RULES:
- Counts are event-driven, not time-based
- Yield is deterministic (rate-based or seeded)
- NO random.random() - use seeded RNG if needed
"""

from typing import Dict
import random


class CounterSystem:
    """
    Production counter system.
    
    Maintains counts for all production stages.
    All increments are event-driven.
    """
    
    def __init__(self, seed: int = 42):
        """
        Initialize counter system.
        
        Args:
            seed: Random seed for deterministic yield calculations
        """
        self._counters: Dict[str, int] = {}
        self._rng = random.Random(seed)  # Seeded RNG for deterministic yield
    
    def increment(self, counter_name: str, amount: int = 1) -> None:
        """
        Increment a counter.
        
        Args:
            counter_name: Name of counter (e.g., 'lpdc_cast', 'cnc_machined')
            amount: Amount to increment by
        """
        if counter_name not in self._counters:
            self._counters[counter_name] = 0
        self._counters[counter_name] += amount
    
    def get(self, counter_name: str) -> int:
        """
        Get counter value.
        
        Args:
            counter_name: Name of counter
        
        Returns:
            Counter value (0 if not exists)
        """
        return self._counters.get(counter_name, 0)
    
    def get_all(self) -> Dict[str, int]:
        """Get all counters"""
        return self._counters.copy()
    
    def reset(self, counter_name: str = None) -> None:
        """
        Reset counter(s).
        
        Args:
            counter_name: Counter to reset (None = reset all)
        """
        if counter_name is None:
            self._counters.clear()
        elif counter_name in self._counters:
            self._counters[counter_name] = 0
    
    def apply_yield(self, yield_rate: float) -> bool:
        """
        Apply deterministic yield check.
        
        Uses seeded RNG for reproducibility.
        
        Args:
            yield_rate: Yield rate (0.0 to 1.0)
        
        Returns:
            True if part passes yield check, False if rejected
        """
        return self._rng.random() < yield_rate
    
    def apply_defect_rate(self, defect_rate: float) -> bool:
        """
        Apply deterministic defect check.
        
        Uses seeded RNG for reproducibility.
        
        Args:
            defect_rate: Defect rate (0.0 to 1.0)
        
        Returns:
            True if part is defective, False if good
        """
        return self._rng.random() < defect_rate


class WIPTracker:
    """
    Work-In-Progress tracker.
    
    Tracks parts at each stage of production.
    """
    
    def __init__(self):
        self._wip: Dict[str, list] = {}
    
    def add(self, stage: str, part_id: str) -> None:
        """
        Add part to WIP at stage.
        
        Args:
            stage: Production stage (e.g., 'cooling_queue', 'cnc_queue')
            part_id: Part identifier
        """
        if stage not in self._wip:
            self._wip[stage] = []
        self._wip[stage].append(part_id)
    
    def remove(self, stage: str, part_id: str = None) -> str:
        """
        Remove part from WIP at stage.
        
        Args:
            stage: Production stage
            part_id: Part identifier (None = remove first)
        
        Returns:
            Removed part ID (or None if empty)
        """
        if stage not in self._wip or not self._wip[stage]:
            return None
        
        if part_id is None:
            return self._wip[stage].pop(0)  # FIFO
        else:
            if part_id in self._wip[stage]:
                self._wip[stage].remove(part_id)
                return part_id
            return None
    
    def count(self, stage: str) -> int:
        """
        Get WIP count at stage.
        
        Args:
            stage: Production stage
        
        Returns:
            Number of parts in WIP
        """
        return len(self._wip.get(stage, []))
    
    def get_all_counts(self) -> Dict[str, int]:
        """Get WIP counts for all stages"""
        return {stage: len(parts) for stage, parts in self._wip.items()}
    
    def get_parts(self, stage: str) -> list:
        """Get list of parts at stage"""
        return self._wip.get(stage, []).copy()
