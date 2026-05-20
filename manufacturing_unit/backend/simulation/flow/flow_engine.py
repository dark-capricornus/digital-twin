"""
Material Flow Engine

Event-driven production tracking engine.

CRITICAL RULES:
- Event-reactive ONLY (no dt-based processing)
- NO control logic
- NO physics calculations
- NO PLC sequencing
- Read-only metrics for UI/Analytics

Architecture:
  Physics/Machines emit events → Flow Engine reacts → Updates counts/WIP
"""

from typing import Dict, Any
import logging
from .events import EventDispatcher, Event, ProductionEventType
from .counters import CounterSystem, WIPTracker
from .kpi_tracker import KPITracker

logger = logging.getLogger("FlowEngine")


class MaterialFlowEngine:
    """
    Material Flow / Production Engine.
    
    Subscribes to production events and maintains counts, yield, WIP, and KPIs.
    
    CRITICAL:
    - Event-reactive only (no dt-based processing)
    - NO control logic
    - NO physics
    """
    
    def __init__(self, event_dispatcher: EventDispatcher, seed: int = 42):
        """
        Initialize Material Flow Engine.
        
        Args:
            event_dispatcher: Event dispatcher
            seed: Random seed for deterministic yield
        """
        self.dispatcher = event_dispatcher
        self.counters = CounterSystem(seed=seed)
        self.wip = WIPTracker()
        self.kpis = KPITracker(self.counters, self.wip)
        
        # Yield rates (deterministic, configurable)
        self.yield_rates = {
            'furnace_melt': 0.98,      # 98% melt yield
            'degasser': 0.99,           # 99% degasser efficiency
            'lpdc_cast': 0.95,          # 95% casting yield
            'heat_treatment': 0.97,     # 97% HT yield
            'cnc_machining': 0.96,      # 96% machining yield
            'paint': 0.98,              # 98% paint yield
            'xray': 0.92,               # 92% X-ray pass rate
            'inspection': 0.95,         # 95% final inspection pass rate
        }
        
        # Subscribe to all production events
        self._subscribe_to_events()
        
        logger.info("MaterialFlowEngine initialized (event-reactive mode)")
    
    def _subscribe_to_events(self) -> None:
        """Subscribe to all production events"""
        # Inbound
        self.dispatcher.subscribe(ProductionEventType.INGOT_RECEIVED, self._on_ingot_received)
        
        # Melting
        self.dispatcher.subscribe(ProductionEventType.FURNACE_MELT_READY, self._on_furnace_melt_ready)
        
        # Degassing
        self.dispatcher.subscribe(ProductionEventType.DEGASSER_COMPLETE, self._on_degasser_complete)
        
        # Casting
        self.dispatcher.subscribe(ProductionEventType.LPDC_CYCLE_COMPLETE, self._on_lpdc_complete)
        
        # Cooling
        self.dispatcher.subscribe(ProductionEventType.COOLING_COMPLETE, self._on_cooling_complete)
        
        # Heat Treatment
        self.dispatcher.subscribe(ProductionEventType.HEAT_TREATMENT_COMPLETE, self._on_heat_treatment_complete)
        
        # Machining
        self.dispatcher.subscribe(ProductionEventType.CNC_CYCLE_COMPLETE, self._on_cnc_complete)
        
        # Surface Treatment
        self.dispatcher.subscribe(ProductionEventType.PRETREATMENT_COMPLETE, self._on_pretreatment_complete)
        self.dispatcher.subscribe(ProductionEventType.PAINT_COMPLETE, self._on_paint_complete)
        
        # Inspection
        self.dispatcher.subscribe(ProductionEventType.XRAY_PASS, self._on_xray_pass)
        self.dispatcher.subscribe(ProductionEventType.XRAY_FAIL, self._on_xray_fail)
        self.dispatcher.subscribe(ProductionEventType.INSPECTION_PASS, self._on_inspection_pass)
        self.dispatcher.subscribe(ProductionEventType.INSPECTION_FAIL, self._on_inspection_fail)
        
        # Packing
        self.dispatcher.subscribe(ProductionEventType.PACKING_COMPLETE, self._on_packing_complete)
    
    # ========== Event Handlers ==========
    
    def _on_ingot_received(self, event: Event) -> None:
        """Handle inbound ingot"""
        self.counters.increment('inbound_received')
        part_id = event.data.get('part_id', f"part_{self.counters.get('inbound_received')}")
        self.wip.add('melting_queue', part_id)
        logger.debug(f"Ingot received: {part_id}")
    
    def _on_furnace_melt_ready(self, event: Event) -> None:
        """Handle furnace melt ready"""
        self.counters.increment('furnace_melt')
        part_id = event.data.get('part_id')
        
        # Apply yield
        if self.counters.apply_yield(self.yield_rates['furnace_melt']):
            self.wip.remove('melting_queue', part_id)
            self.wip.add('degasser_queue', part_id)
        else:
            self.counters.increment('furnace_scrap')
            self.wip.remove('melting_queue', part_id)
            logger.debug(f"Melt rejected: {part_id}")
    
    def _on_degasser_complete(self, event: Event) -> None:
        """Handle degasser complete"""
        self.counters.increment('degasser_processed')
        part_id = event.data.get('part_id')
        
        # Apply yield
        if self.counters.apply_yield(self.yield_rates['degasser']):
            self.wip.remove('degasser_queue', part_id)
            self.wip.add('lpdc_queue', part_id)
        else:
            self.counters.increment('degasser_scrap')
            self.wip.remove('degasser_queue', part_id)
    
    def _on_lpdc_complete(self, event: Event) -> None:
        """Handle LPDC cycle complete"""
        self.counters.increment('lpdc_cast')
        part_id = event.data.get('part_id')
        
        # Apply yield
        if self.counters.apply_yield(self.yield_rates['lpdc_cast']):
            self.wip.remove('lpdc_queue', part_id)
            self.wip.add('cooling_queue', part_id)
        else:
            self.counters.increment('lpdc_scrap')
            self.wip.remove('lpdc_queue', part_id)
            logger.debug(f"Cast rejected: {part_id}")
    
    def _on_cooling_complete(self, event: Event) -> None:
        """Handle cooling complete"""
        self.counters.increment('cooling_complete')
        part_id = event.data.get('part_id')
        self.wip.remove('cooling_queue', part_id)
        self.wip.add('heat_treatment_queue', part_id)
    
    def _on_heat_treatment_complete(self, event: Event) -> None:
        """Handle heat treatment complete"""
        self.counters.increment('heat_treatment_complete')
        part_id = event.data.get('part_id')
        
        # Apply yield
        if self.counters.apply_yield(self.yield_rates['heat_treatment']):
            self.wip.remove('heat_treatment_queue', part_id)
            self.wip.add('cnc_queue', part_id)
        else:
            self.counters.increment('heat_treatment_scrap')
            self.wip.remove('heat_treatment_queue', part_id)
    
    def _on_cnc_complete(self, event: Event) -> None:
        """Handle CNC cycle complete"""
        self.counters.increment('cnc_machined')
        part_id = event.data.get('part_id')
        
        # Apply yield
        if self.counters.apply_yield(self.yield_rates['cnc_machining']):
            self.wip.remove('cnc_queue', part_id)
            self.wip.add('pretreatment_queue', part_id)
        else:
            self.counters.increment('cnc_scrap')
            self.wip.remove('cnc_queue', part_id)
            logger.debug(f"Machined part rejected: {part_id}")
    
    def _on_pretreatment_complete(self, event: Event) -> None:
        """Handle pretreatment complete"""
        self.counters.increment('pretreatment_complete')
        part_id = event.data.get('part_id')
        self.wip.remove('pretreatment_queue', part_id)
        self.wip.add('paint_queue', part_id)
    
    def _on_paint_complete(self, event: Event) -> None:
        """Handle paint complete"""
        self.counters.increment('paint_complete')
        part_id = event.data.get('part_id')
        
        # Apply yield
        if self.counters.apply_yield(self.yield_rates['paint']):
            self.wip.remove('paint_queue', part_id)
            self.wip.add('xray_queue', part_id)
        else:
            self.counters.increment('paint_scrap')
            self.wip.remove('paint_queue', part_id)
    
    def _on_xray_pass(self, event: Event) -> None:
        """Handle X-ray pass"""
        self.counters.increment('xray_pass')
        part_id = event.data.get('part_id')
        self.wip.remove('xray_queue', part_id)
        self.wip.add('inspection_queue', part_id)
    
    def _on_xray_fail(self, event: Event) -> None:
        """Handle X-ray fail"""
        self.counters.increment('xray_fail')
        part_id = event.data.get('part_id')
        self.wip.remove('xray_queue', part_id)
        # Scrap
    
    def _on_inspection_pass(self, event: Event) -> None:
        """Handle final inspection pass"""
        self.counters.increment('inspection_pass')
        part_id = event.data.get('part_id')
        self.wip.remove('inspection_queue', part_id)
        self.wip.add('packing_queue', part_id)
    
    def _on_inspection_fail(self, event: Event) -> None:
        """Handle final inspection fail"""
        self.counters.increment('inspection_fail')
        part_id = event.data.get('part_id')
        self.wip.remove('inspection_queue', part_id)
        # Scrap
    
    def _on_packing_complete(self, event: Event) -> None:
        """Handle packing complete"""
        self.counters.increment('packing_complete')
        part_id = event.data.get('part_id')
        self.wip.remove('packing_queue', part_id)
        logger.debug(f"Part packed: {part_id}")
    
    # ========== Read-Only Metrics ==========
    
    def get_metrics(self, current_time: float) -> Dict[str, Any]:
        """
        Get all production metrics (read-only).
        
        Args:
            current_time: Current simulation time (seconds)
        
        Returns:
            Dict of all metrics for UI/Analytics
        """
        return self.kpis.get_all_metrics(current_time)
    
    def get_counters(self) -> Dict[str, int]:
        """Get all counters (read-only)"""
        return self.counters.get_all()
    
    def get_wip(self) -> Dict[str, int]:
        """Get WIP by stage (read-only)"""
        return self.wip.get_all_counts()
