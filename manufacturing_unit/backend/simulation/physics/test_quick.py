"""
Quick Physics Validation (No Plotting)

Runs all physics models through basic validation without matplotlib.
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from backend.simulation.physics import (
    FurnacePhysics,
    LPDCPhysics,
    CoolingPhysics,
    CNCPhysics,
)


def test_furnace_basic():
    """Basic furnace test."""
    print("\n" + "=" * 60)
    print("FURNACE PHYSICS - BASIC TEST")
    print("=" * 60)

    furnace = FurnacePhysics()
    dt = 0.2

    temp_before = furnace.T_current
    print(f"Initial temp: {temp_before:.1f}°C")

    # Heat for 10 seconds
    steps = int(10 / dt)
    for _ in range(steps):
        outputs = furnace.step(dt, {"heater_power": 100.0})

    temp_after = outputs["temperature"]
    heating_rate = outputs["heating_rate"]
    over_temp_alarm = temp_after >= 0.98 * furnace.T_max

    print(f"After 10s @ 100% power: {temp_after:.1f}°C")
    print(f"Heating rate: {heating_rate:.3f}°C/s")
    print(f"Over-temp alarm: {over_temp_alarm}")

    # ✅ Correct validation: compare before vs after
    if temp_after > temp_before:
        print("✓ PASS: Temperature increased as expected")
    else:
        print("✗ FAIL: Temperature did not increase (unexpected)")

    return True


def test_lpdc_basic():
    """Basic LPDC test."""
    print("\n" + "=" * 60)
    print("LPDC PHYSICS - BASIC TEST")
    print("=" * 60)

    lpdc = LPDCPhysics()
    dt = 0.2

    print(f"Initial state: {lpdc.state}")

    # Trigger pour
    outputs = lpdc.step(dt, {"pour_request": True, "pressure_setpoint": 50.0})
    print(f"After pour request: {outputs['cycle_state']}")

    # Fill for 5 seconds
    steps = int(5 / dt)
    for _ in range(steps):
        outputs = lpdc.step(dt, {"pressure_setpoint": 50.0})

    print(f"After 5s filling: Fill={outputs['fill_percentage']:.1f}%")
    print(f"State: {outputs['cycle_state']}")

    if outputs["fill_percentage"] > 0.0:
        print("✓ PASS: Filling progressed")
    else:
        print("✗ FAIL: No fill progress")

    return True


def test_cooling_basic():
    """Basic cooling test."""
    print("\n" + "=" * 60)
    print("COOLING PHYSICS - BASIC TEST")
    print("=" * 60)

    cooling = CoolingPhysics()
    dt = 0.2

    temp_before = cooling.T_part
    print(f"Initial temp: {temp_before:.1f}°C")

    # Cool for 10 seconds
    steps = int(10 / dt)
    for _ in range(steps):
        outputs = cooling.step(dt, {"coolant_flow": 1.0})

    temp_after = outputs["part_temperature"]

    print(f"After 10s cooling: {temp_after:.1f}°C")
    print(f"Cooling rate: {outputs['cooling_rate']:.2f}°C/s")
    print(f"Shrinkage risk: {outputs['shrinkage_risk']}")

    if temp_after < temp_before:
        print("✓ PASS: Temperature decreased as expected")
    else:
        print("✗ FAIL: Temperature did not decrease")

    return True


def test_cnc_basic():
    """Basic CNC test."""
    print("\n" + "=" * 60)
    print("CNC PHYSICS - BASIC TEST")
    print("=" * 60)

    cnc = CNCPhysics()
    dt = 0.2

    progress_before = cnc.progress
    print(f"Initial progress: {progress_before:.1f}%")

    # Trigger job
    outputs = cnc.step(dt, {"trigger": True, "mode": "roughing"})
    print(f"After trigger: Busy={outputs['busy']}")

    # Run for 10 seconds
    steps = int(10 / dt)
    for _ in range(steps):
        outputs = cnc.step(dt, {})

    progress_after = outputs["progress"]

    print(f"After 10s machining: Progress={progress_after:.1f}%")
    print(f"Spindle RPM: {outputs['spindle_rpm']:.0f}")
    print(f"Busy: {outputs['busy']}")

    if progress_after > progress_before:
        print("✓ PASS: Machining progressed")
    else:
        print("✗ FAIL: No progress")

    return True


if __name__ == "__main__":
    print("=" * 60)
    print("PHYSICS MODELS - QUICK VALIDATION")
    print("=" * 60)

    try:
        test_furnace_basic()
        test_lpdc_basic()
        test_cooling_basic()
        test_cnc_basic()

        print("\n" + "=" * 60)
        print("ALL BASIC TESTS COMPLETED")
        print("=" * 60)
        print("\nFor detailed validation with plots, run:")
        print("  python -m backend.simulation.physics.test_furnace")
        print("  python -m backend.simulation.physics.test_lpdc")
        print("  python -m backend.simulation.physics.test_cooling")
        print("  python -m backend.simulation.physics.test_cnc")

    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
