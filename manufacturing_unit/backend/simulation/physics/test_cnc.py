"""
CNC Physics Validation Test

Validates:
1. Linear progress vs time
2. MRR-based cycle time
3. Roughing vs finishing modes
4. Reset/re-arm logic

Expected Response:
- Linear progress (not exponential)
- Correct cycle time based on MRR
- Mode switching works
- Multiple cycles possible
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from backend.simulation.physics import CNCPhysics
import matplotlib.pyplot as plt


def test_cnc_machining():
    """Test CNC machining physics."""
    print("=" * 60)
    print("CNC PHYSICS VALIDATION")
    print("=" * 60)
    
    cnc = CNCPhysics()
    
    # Simulation parameters
    dt = 0.2  # 200ms timestep
    duration = 120.0  # 2 minutes
    steps = int(duration / dt)
    
    # Data collection
    time_data = []
    progress_data = []
    rpm_data = []
    mode_data = []
    busy_data = []
    
    # Test: Two cycles (roughing then finishing)
    print(f"\nTest: Two CNC cycles (roughing + finishing)")
    print(f"Timestep: {dt}s, Duration: {duration}s")
    print("-" * 60)
    
    cycle1_triggered = False
    cycle1_reset = False
    cycle2_triggered = False
    
    for i in range(steps):
        t = i * dt
        
        # Control logic
        inputs = {
            'trigger': False,
            'mode': 'roughing',
            'reset_request': False
        }
        
        # Cycle 1: Roughing (trigger at t=1s)
        if t >= 1.0 and not cycle1_triggered:
            inputs['trigger'] = True
            inputs['mode'] = 'roughing'
            cycle1_triggered = True
            print(f"\n>>> Cycle 1 TRIGGERED (roughing) at t={t:.1f}s")
        
        # Reset after cycle 1 completes
        if cycle1_triggered and not cycle1_reset and cnc.progress >= 100.0:
            inputs['reset_request'] = True
            cycle1_reset = True
            print(f">>> Cycle 1 RESET at t={t:.1f}s")
        
        # Cycle 2: Finishing (trigger at t=60s)
        if t >= 60.0 and cycle1_reset and not cycle2_triggered:
            inputs['trigger'] = True
            inputs['mode'] = 'finishing'
            cycle2_triggered = True
            print(f"\n>>> Cycle 2 TRIGGERED (finishing) at t={t:.1f}s")
        
        # Step physics
        outputs = cnc.step(dt, inputs)
        
        # Collect data
        time_data.append(t)
        progress_data.append(outputs['progress'])
        rpm_data.append(outputs['spindle_rpm'])
        mode_data.append(outputs['mode'])
        busy_data.append(outputs['busy'])
        
        # Print periodic updates
        if i % 50 == 0 or outputs['busy']:  # Every 10s or when busy
            if outputs['busy']:
                print(f"t={t:6.1f}s | Mode={outputs['mode']:10s} | "
                      f"Progress={outputs['progress']:5.1f}% | "
                      f"RPM={outputs['spindle_rpm']:4.0f} | "
                      f"Busy={outputs['busy']}")
    
    # Validation checks
    print("\n" + "=" * 60)
    print("VALIDATION CHECKS")
    print("=" * 60)
    
    # Check 1: Linear progress (not exponential)
    # Find first cycle progress data
    cycle1_start = next(i for i, p in enumerate(progress_data) if p > 0)
    cycle1_end = next(i for i, p in enumerate(progress_data[cycle1_start:]) if p >= 99.9) + cycle1_start
    
    cycle1_time = time_data[cycle1_end] - time_data[cycle1_start]
    cycle1_progress = progress_data[cycle1_start:cycle1_end]
    
    # Check linearity (variance should be low)
    if len(cycle1_progress) > 10:
        # Calculate expected linear progress
        expected_progress = [(i / len(cycle1_progress)) * 100 for i in range(len(cycle1_progress))]
        variance = sum((a - b) ** 2 for a, b in zip(cycle1_progress, expected_progress)) / len(cycle1_progress)
        
        print(f"✓ Cycle 1 duration: {cycle1_time:.1f}s")
        print(f"✓ Linearity variance: {variance:.2f}")
        
        if variance < 10.0:  # Low variance = linear
            print("✓ PASS: Progress is linear")
        else:
            print("✗ FAIL: Progress is not linear")
    
    # Check 2: MRR-based cycle time
    expected_time_roughing = cnc.volume_total / cnc.MRR_roughing
    print(f"\n✓ Expected roughing time: {expected_time_roughing:.1f}s")
    print(f"✓ Actual roughing time: {cycle1_time:.1f}s")
    
    if abs(cycle1_time - expected_time_roughing) < 2.0:  # 2s tolerance
        print("✓ PASS: Cycle time matches MRR calculation")
    else:
        print("✗ FAIL: Cycle time incorrect")
    
    # Check 3: Multiple cycles possible
    cycle2_completed = max(progress_data[300:]) >= 99.9 if len(progress_data) > 300 else False
    print(f"\n✓ Cycle 2 completed: {cycle2_completed}")
    
    if cycle2_completed:
        print("✓ PASS: Multiple cycles possible (reset logic works)")
    else:
        print("⚠ WARNING: Cycle 2 may not have completed (check duration)")
    
    # Check 4: Mode switching
    modes_used = list(dict.fromkeys([m for m in mode_data if m]))
    print(f"\n✓ Modes used: {modes_used}")
    
    if 'roughing' in modes_used and 'finishing' in modes_used:
        print("✓ PASS: Mode switching works")
    else:
        print("⚠ WARNING: Only one mode detected")
    
    # Plot results
    print("\n" + "=" * 60)
    print("GENERATING PLOTS")
    print("=" * 60)
    
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('CNC Physics Validation', fontsize=16, fontweight='bold')
    
    # Plot 1: Progress vs Time
    axes[0, 0].plot(time_data, progress_data, 'b-', linewidth=2)
    axes[0, 0].set_xlabel('Time (s)')
    axes[0, 0].set_ylabel('Progress (%)')
    axes[0, 0].set_title('Machining Progress (Should be Linear)')
    axes[0, 0].grid(True, alpha=0.3)
    axes[0, 0].set_ylim([0, 105])
    
    # Plot 2: Spindle RPM vs Time
    axes[0, 1].plot(time_data, rpm_data, 'g-', linewidth=2)
    axes[0, 1].set_xlabel('Time (s)')
    axes[0, 1].set_ylabel('Spindle RPM')
    axes[0, 1].set_title('Spindle Speed')
    axes[0, 1].grid(True, alpha=0.3)
    
    # Plot 3: Busy State
    axes[1, 0].plot(time_data, busy_data, 'r-', linewidth=2)
    axes[1, 0].set_xlabel('Time (s)')
    axes[1, 0].set_ylabel('Busy State')
    axes[1, 0].set_title('Machine Busy Flag')
    axes[1, 0].set_ylim([-0.1, 1.1])
    axes[1, 0].grid(True, alpha=0.3)
    
    # Plot 4: Mode (color-coded progress)
    # Split by mode
    roughing_mask = [m == 'roughing' for m in mode_data]
    finishing_mask = [m == 'finishing' for m in mode_data]
    
    axes[1, 1].plot([t for t, m in zip(time_data, roughing_mask) if m],
                    [p for p, m in zip(progress_data, roughing_mask) if m],
                    'b-', linewidth=2, label='Roughing')
    axes[1, 1].plot([t for t, m in zip(time_data, finishing_mask) if m],
                    [p for p, m in zip(progress_data, finishing_mask) if m],
                    'orange', linewidth=2, label='Finishing')
    axes[1, 1].set_xlabel('Time (s)')
    axes[1, 1].set_ylabel('Progress (%)')
    axes[1, 1].set_title('Progress by Mode')
    axes[1, 1].grid(True, alpha=0.3)
    axes[1, 1].legend()
    
    plt.tight_layout()
    
    # Save plot
    plot_path = os.path.join(os.path.dirname(__file__), 'cnc_progress.png')
    plt.savefig(plot_path, dpi=150)
    print(f"✓ Plot saved: {plot_path}")
    
    plt.show()
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    test_cnc_machining()
