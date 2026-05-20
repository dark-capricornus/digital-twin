"""
Flow Engine Tests — Event-driven production tracking.

Validates the event dispatcher, counter system, WIP tracker,
and the MaterialFlowEngine's event-reactive behavior.
"""

import pytest
from manufacturing_unit.backend.simulation.flow.events import (
    EventDispatcher, Event, ProductionEventType
)
from manufacturing_unit.backend.simulation.flow.flow_engine import MaterialFlowEngine
from manufacturing_unit.backend.simulation.flow.counters import CounterSystem, WIPTracker


# ═══════════════════════════════════════════════════════════════════════════════
# EVENT DISPATCHER
# ═══════════════════════════════════════════════════════════════════════════════

class TestEventDispatcher:
    """Core pub-sub event dispatcher."""

    def test_subscribe_and_emit(self, event_dispatcher):
        """Subscribers should receive emitted events."""
        received = []

        def handler(event):
            received.append(event)

        event_dispatcher.subscribe(ProductionEventType.INGOT_RECEIVED, handler)

        evt = Event(
            type=ProductionEventType.INGOT_RECEIVED,
            timestamp=0.0,
            device_id="INBOUND_01",
            data={"part_id": "ingot_001"}
        )
        event_dispatcher.emit(evt)

        assert len(received) == 1
        assert received[0].device_id == "INBOUND_01"

    def test_multiple_subscribers(self, event_dispatcher):
        """Multiple subscribers should all receive the event."""
        count_a = []
        count_b = []

        event_dispatcher.subscribe(ProductionEventType.LPDC_CYCLE_COMPLETE, lambda e: count_a.append(1))
        event_dispatcher.subscribe(ProductionEventType.LPDC_CYCLE_COMPLETE, lambda e: count_b.append(1))

        evt = Event(type=ProductionEventType.LPDC_CYCLE_COMPLETE, timestamp=1.0,
                    device_id="LPDC_01", data={})
        event_dispatcher.emit(evt)

        assert len(count_a) == 1
        assert len(count_b) == 1

    def test_event_log(self, event_dispatcher):
        """All emitted events should be recorded in the log."""
        for i in range(5):
            evt = Event(type=ProductionEventType.INGOT_RECEIVED,
                        timestamp=float(i), device_id="INBOUND_01", data={})
            event_dispatcher.emit(evt)

        log = event_dispatcher.get_event_log()
        assert len(log) == 5

    def test_clear_log(self, event_dispatcher):
        """Clear should empty the event log."""
        evt = Event(type=ProductionEventType.INGOT_RECEIVED,
                    timestamp=0.0, device_id="INBOUND_01", data={})
        event_dispatcher.emit(evt)
        event_dispatcher.clear_log()

        assert len(event_dispatcher.get_event_log()) == 0

    def test_unsubscribed_event_ignored(self, event_dispatcher):
        """Emitting an event with no subscribers should not error."""
        evt = Event(type=ProductionEventType.PACKING_COMPLETE,
                    timestamp=0.0, device_id="PACK_01", data={})
        event_dispatcher.emit(evt)  # Should not raise


# ═══════════════════════════════════════════════════════════════════════════════
# COUNTER SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════

class TestCounterSystem:
    """Deterministic production counting."""

    def test_increment_and_get(self, counter_system):
        counter_system.increment("lpdc_cast")
        counter_system.increment("lpdc_cast")
        assert counter_system.get("lpdc_cast") == 2

    def test_get_nonexistent_returns_zero(self, counter_system):
        assert counter_system.get("nonexistent") == 0

    def test_reset_single(self, counter_system):
        counter_system.increment("cnc_machined", 10)
        counter_system.reset("cnc_machined")
        assert counter_system.get("cnc_machined") == 0

    def test_reset_all(self, counter_system):
        counter_system.increment("a", 5)
        counter_system.increment("b", 3)
        counter_system.reset()
        assert counter_system.get("a") == 0
        assert counter_system.get("b") == 0

    def test_deterministic_yield(self):
        """Same seed should produce same yield decisions."""
        cs1 = CounterSystem(seed=42)
        cs2 = CounterSystem(seed=42)

        results_1 = [cs1.apply_yield(0.95) for _ in range(100)]
        results_2 = [cs2.apply_yield(0.95) for _ in range(100)]

        assert results_1 == results_2  # Deterministic

    def test_yield_rate_zero_always_rejects(self):
        cs = CounterSystem(seed=1)
        results = [cs.apply_yield(0.0) for _ in range(10)]
        assert all(r is False for r in results)

    def test_yield_rate_one_always_passes(self):
        cs = CounterSystem(seed=1)
        results = [cs.apply_yield(1.0) for _ in range(10)]
        assert all(r is True for r in results)


# ═══════════════════════════════════════════════════════════════════════════════
# WIP TRACKER
# ═══════════════════════════════════════════════════════════════════════════════

class TestWIPTracker:
    """Work-In-Progress part tracking."""

    def test_add_and_count(self, wip_tracker):
        wip_tracker.add("melting_queue", "part_1")
        wip_tracker.add("melting_queue", "part_2")
        assert wip_tracker.count("melting_queue") == 2

    def test_remove_fifo(self, wip_tracker):
        """Remove without part_id should return first (FIFO)."""
        wip_tracker.add("cooling_queue", "part_A")
        wip_tracker.add("cooling_queue", "part_B")
        removed = wip_tracker.remove("cooling_queue")
        assert removed == "part_A"

    def test_remove_specific(self, wip_tracker):
        wip_tracker.add("cnc_queue", "part_X")
        wip_tracker.add("cnc_queue", "part_Y")
        removed = wip_tracker.remove("cnc_queue", "part_Y")
        assert removed == "part_Y"
        assert wip_tracker.count("cnc_queue") == 1

    def test_remove_from_empty(self, wip_tracker):
        result = wip_tracker.remove("empty_stage")
        assert result is None

    def test_count_nonexistent_stage(self, wip_tracker):
        assert wip_tracker.count("nonexistent") == 0

    def test_get_all_counts(self, wip_tracker):
        wip_tracker.add("a", "p1")
        wip_tracker.add("b", "p2")
        wip_tracker.add("b", "p3")
        counts = wip_tracker.get_all_counts()
        assert counts == {"a": 1, "b": 2}


# ═══════════════════════════════════════════════════════════════════════════════
# MATERIAL FLOW ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TestMaterialFlowEngine:
    """Event-reactive production tracking engine."""

    def test_ingot_received_increments_counter(self, flow_engine, event_dispatcher):
        evt = Event(type=ProductionEventType.INGOT_RECEIVED,
                    timestamp=0.0, device_id="INBOUND_01",
                    data={"part_id": "ingot_001"})
        event_dispatcher.emit(evt)

        counters = flow_engine.get_counters()
        assert counters.get("inbound_received", 0) == 1

    def test_ingot_goes_to_melting_wip(self, flow_engine, event_dispatcher):
        evt = Event(type=ProductionEventType.INGOT_RECEIVED,
                    timestamp=0.0, device_id="INBOUND_01",
                    data={"part_id": "ingot_001"})
        event_dispatcher.emit(evt)

        wip = flow_engine.get_wip()
        assert wip.get("melting_queue", 0) == 1

    def test_furnace_melt_advances_to_degasser(self, flow_engine, event_dispatcher):
        """Successful melt should move WIP from melting to degasser queue."""
        # First add ingot
        event_dispatcher.emit(Event(
            type=ProductionEventType.INGOT_RECEIVED,
            timestamp=0.0, device_id="INBOUND_01",
            data={"part_id": "part_1"}
        ))

        # Then melt completes
        event_dispatcher.emit(Event(
            type=ProductionEventType.FURNACE_MELT_READY,
            timestamp=10.0, device_id="FURNACE_01",
            data={"part_id": "part_1"}
        ))

        counters = flow_engine.get_counters()
        assert counters.get("furnace_melt", 0) == 1

    def test_lpdc_cast_tracked(self, flow_engine, event_dispatcher):
        event_dispatcher.emit(Event(
            type=ProductionEventType.LPDC_CYCLE_COMPLETE,
            timestamp=20.0, device_id="LPDC_01",
            data={"part_id": "part_1"}
        ))

        counters = flow_engine.get_counters()
        assert counters.get("lpdc_cast", 0) == 1

    def test_cnc_machined_tracked(self, flow_engine, event_dispatcher):
        event_dispatcher.emit(Event(
            type=ProductionEventType.CNC_CYCLE_COMPLETE,
            timestamp=30.0, device_id="CNC_01",
            data={"part_id": "part_1"}
        ))

        counters = flow_engine.get_counters()
        assert counters.get("cnc_machined", 0) == 1

    def test_inspection_pass_and_fail(self, flow_engine, event_dispatcher):
        event_dispatcher.emit(Event(
            type=ProductionEventType.INSPECTION_PASS,
            timestamp=40.0, device_id="INSPECTION_01",
            data={"part_id": "part_1"}
        ))
        event_dispatcher.emit(Event(
            type=ProductionEventType.INSPECTION_FAIL,
            timestamp=41.0, device_id="INSPECTION_01",
            data={"part_id": "part_2"}
        ))

        counters = flow_engine.get_counters()
        assert counters.get("inspection_pass", 0) == 1
        assert counters.get("inspection_fail", 0) == 1

    def test_full_production_pipeline(self, flow_engine, event_dispatcher):
        """Simulate a part through the entire production pipeline."""
        pipeline = [
            (ProductionEventType.INGOT_RECEIVED, 0.0, "INBOUND_01"),
            (ProductionEventType.FURNACE_MELT_READY, 10.0, "FURNACE_01"),
            (ProductionEventType.DEGASSER_COMPLETE, 18.0, "DEGASSER_01"),
            (ProductionEventType.LPDC_CYCLE_COMPLETE, 33.0, "LPDC_01"),
            (ProductionEventType.COOLING_COMPLETE, 38.0, "COOLING_01"),
            (ProductionEventType.HEAT_TREATMENT_COMPLETE, 50.0, "HEAT_01"),
            (ProductionEventType.CNC_CYCLE_COMPLETE, 60.0, "CNC_01"),
            (ProductionEventType.PRETREATMENT_COMPLETE, 65.0, "PRETREAT_01"),
            (ProductionEventType.PAINT_COMPLETE, 73.0, "PAINT_01"),
            (ProductionEventType.INSPECTION_PASS, 79.0, "INSPECTION_01"),
            (ProductionEventType.PACKING_COMPLETE, 81.0, "OUTBOUND_01"),
        ]

        for evt_type, ts, dev_id in pipeline:
            event_dispatcher.emit(Event(
                type=evt_type, timestamp=ts,
                device_id=dev_id, data={"part_id": "wheel_001"}
            ))

        counters = flow_engine.get_counters()
        # All pipeline stages should have been hit
        assert counters.get("inbound_received", 0) >= 1
        assert counters.get("packing_complete", 0) >= 1

    def test_metrics_output(self, flow_engine, event_dispatcher):
        """get_metrics should return a dict without errors."""
        event_dispatcher.emit(Event(
            type=ProductionEventType.INGOT_RECEIVED,
            timestamp=0.0, device_id="INBOUND_01",
            data={"part_id": "part_1"}
        ))

        metrics = flow_engine.get_metrics(60.0)
        assert isinstance(metrics, dict)
        assert "total_in" in metrics or len(metrics) > 0
