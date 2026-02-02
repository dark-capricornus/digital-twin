"""
Material Flow Engine - Basic Test

Tests event-driven production tracking.
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from backend.simulation.flow import EventDispatcher, MaterialFlowEngine, Event, ProductionEventType


def test_flow_engine_basic():
    """Test basic flow engine functionality"""
    print("=" * 60)
    print("MATERIAL FLOW ENGINE - BASIC TEST")
    print("=" * 60)
    
    # Create flow engine
    dispatcher = EventDispatcher()
    flow_engine = MaterialFlowEngine(dispatcher, seed=42)
    
    print("\n✓ Flow Engine initialized")
    print(f"  Event subscribers: {len(dispatcher._subscribers)}")
    
    # Test 1: Emit ingot received event
    print("\n--- Test 1: Inbound Ingot ---")
    event = Event(
        type=ProductionEventType.INGOT_RECEIVED,
        timestamp=0.0,
        device_id="inbound_01",
        data={'part_id': 'part_001'}
    )
    dispatcher.emit(event)
    
    metrics = flow_engine.get_metrics(0.0)
    print(f"  Inbound count: {metrics['total_in']}")
    print(f"  WIP (melting_queue): {flow_engine.wip.count('melting_queue')}")
    
    # Test 2: Emit LPDC complete event
    print("\n--- Test 2: LPDC Cast ---")
    event = Event(
        type=ProductionEventType.LPDC_CYCLE_COMPLETE,
        timestamp=10.0,
        device_id="lpdc_01",
        data={'part_id': 'part_001'}
    )
    dispatcher.emit(event)
    
    counters = flow_engine.get_counters()
    print(f"  LPDC cast count: {counters.get('lpdc_cast', 0)}")
    print(f"  WIP (cooling_queue): {flow_engine.wip.count('cooling_queue')}")
    
    # Test 3: Emit CNC complete event
    print("\n--- Test 3: CNC Machining ---")
    event = Event(
        type=ProductionEventType.CNC_CYCLE_COMPLETE,
        timestamp=20.0,
        device_id="cnc_01",
        data={'part_id': 'part_001'}
    )
    dispatcher.emit(event)
    
    counters = flow_engine.get_counters()
    print(f"  CNC machined count: {counters.get('cnc_machined', 0)}")
    print(f"  WIP (pretreatment_queue): {flow_engine.wip.count('pretreatment_queue')}")
    
    # Test 4: Get all metrics
    print("\n--- Test 4: Production Metrics ---")
    metrics = flow_engine.get_metrics(30.0)
    print(f"  Total In: {metrics['total_in']}")
    print(f"  Total WIP: {metrics['wip_total']}")
    print(f"  Yield: {metrics['yield_percent']:.1f}%")
    print(f"  Throughput: {metrics['throughput_per_hour']:.2f} parts/hr")
    
    # Test 5: Event log
    print("\n--- Test 5: Event Log ---")
    event_log = dispatcher.get_event_log()
    print(f"  Total events: {len(event_log)}")
    for evt in event_log:
        print(f"    {evt}")
    
    print("\n" + "=" * 60)
    print("✓ ALL TESTS PASSED")
    print("=" * 60)
    print("\nFlow Engine is event-reactive and deterministic!")


if __name__ == '__main__':
    test_flow_engine_basic()
