"""
LPDC Physics Validation Test

Validates:
1. Smooth monotonic fill curve
2. State machine transitions
3. Pressure-driven filling physics
4. Solidification progression

Expected Response:
- Smooth fill curve (square-root behavior)
- Clean state transitions
- No backwards progress
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from backend.simulation.physics import LPDCPhysics
import matplotlib.pyplot as plt


def test_lpdc_cycle():
    """Test complete LPDC casting cycle."""
    print("=" * 60)
    print("LPDC PHYSICS VALIDATION")
    print("=" * 60)
    
    lpdc = LPDCPhysics()
    
    # Simulation parameters
    dt = 0.2  # 200ms timestep
    duration = 30.0  # 30 seconds
    steps = int(duration / dt)
    
    # Data collection
    time_data = []
    fill_data = []
    pressure_data = []
    solidification_data = []
    state_data = []
    
    # Test: Complete casting cycle
    print(f"\nTest: Complete LPDC casting cycle")
    print(f"Timestep: {dt}s, Duration: {duration}s")
    print("-" * 60)
    
    pour_triggered = False
    
    for i in range(steps):
        t = i * dt
        
        # Control logic
        inputs = {
            'pour_request': False,
            'pressure_setpoint': 0.0,
            'reset_request': False
        }
        
        # Trigger pour at t=1s
        if t >= 1.0 and not pour_triggered:
            inputs['pour_request'] = True
            pour_triggered = True
        
        # Apply pressure during filling and holding
        if lpdc.state in ['FILLING', 'HOLDING']:
            inputs['pressure_setpoint'] = 50.0  # Conceptual pressure
        
        # Reset after completion
        if lpdc.state == 'COMPLETE' and t >= 25.0:
            inputs['reset_request'] = True
        
        # Step physics
        outputs = lpdc.step(dt, inputs)
        
        # Collect data
        time_data.append(t)
        fill_data.append(outputs['fill_percentage'])
        pressure_data.append(outputs['pressure'])
        solidification_data.append(outputs['solidification_progress'])
        state_data.append(outputs['cycle_state'])
        
        # Print state transitions
        if i == 0 or state_data[-1] != state_data[-2] if len(state_data) > 1 else False:
            print(f"t={t:6.1f}s | State: {outputs['cycle_state']:12s} | "
                  f"Fill={outputs['fill_percentage']:5.1f}% | "
                  f"Solid={outputs['solidification_progress']:5.1f}%")
    
    # Validation checks
    print("\n" + "=" * 60)
    print("VALIDATION CHECKS")
    print("=" * 60)
    
    # Check 1: Monotonic fill (no backwards progress)
    fill_decreases = sum(1 for i in range(1, len(fill_data)) if fill_data[i] < fill_data[i-1])
    print(f"✓ Fill decreases detected: {fill_decreases}")
    
    if fill_decreases == 0:
        print("✓ PASS: Fill is monotonic (no backwards progress)")
    else:
        print("✗ FAIL: Fill decreased (should only increase)")
    
    # Check 2: State transitions
    states_visited = list(dict.fromkeys(state_data))  # Unique states in order
    print(f"\n✓ States visited: {' → '.join(states_visited)}")
    
    expected_sequence = ['IDLE', 'FILLING', 'HOLDING', 'SOLIDIFYING', 'COMPLETE']
    if states_visited == expected_sequence or states_visited == expected_sequence + ['IDLE']:
        print("✓ PASS: State sequence correct")
    else:
        print(f"✗ FAIL: Expected {expected_sequence}")
    
    # Check 3: Fill reaches 100%
    max_fill = max(fill_data)
    print(f"\n✓ Maximum fill: {max_fill:.1f}%")
    
    if max_fill >= 99.9:
        print("✓ PASS: Fill reached 100%")
    else:
        print("✗ FAIL: Fill did not complete")
    
    # Check 4: Solidification completes
    max_solid = max(solidification_data)
    print(f"\n✓ Maximum solidification: {max_solid:.1f}%")
    
    if max_solid >= 99.9:
        print("✓ PASS: Solidification completed")
    else:
        print("✗ FAIL: Solidification incomplete")
    
    # Plot results
    print("\n" + "=" * 60)
    print("GENERATING PLOTS")
    print("=" * 60)
    
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('LPDC Physics Validation', fontsize=16, fontweight='bold')
    
    # Plot 1: Fill Percentage vs Time
    axes[0, 0].plot(time_data, fill_data, 'b-', linewidth=2)
    axes[0, 0].set_xlabel('Time (s)')
    axes[0, 0].set_ylabel('Fill Percentage (%)')
    axes[0, 0].set_title('Fill Curve (Should be Smooth & Monotonic)')
    axes[0, 0].grid(True, alpha=0.3)
    axes[0, 0].set_ylim([0, 105])
    
    # Plot 2: Pressure vs Time
    axes[0, 1].plot(time_data, pressure_data, 'r-', linewidth=2)
    axes[0, 1].set_xlabel('Time (s)')
    axes[0, 1].set_ylabel('Pressure (Conceptual)')
    axes[0, 1].set_title('Applied Pressure')
    axes[0, 1].grid(True, alpha=0.3)
    
    # Plot 3: Solidification Progress
    axes[1, 0].plot(time_data, solidification_data, 'g-', linewidth=2)
    axes[1, 0].set_xlabel('Time (s)')
    axes[1, 0].set_ylabel('Solidification (%)')
    axes[1, 0].set_title('Solidification Progress')
    axes[1, 0].grid(True, alpha=0.3)
    axes[1, 0].set_ylim([0, 105])
    
    # Plot 4: State Machine
    # Convert states to numeric for plotting
    state_map = {'IDLE': 0, 'FILLING': 1, 'HOLDING': 2, 'SOLIDIFYING': 3, 'COMPLETE': 4}
    state_numeric = [state_map.get(s, 0) for s in state_data]
    
    axes[1, 1].plot(time_data, state_numeric, 'k-', linewidth=2, drawstyle='steps-post')
    axes[1, 1].set_xlabel('Time (s)')
    axes[1, 1].set_ylabel('State')
    axes[1, 1].set_title('State Machine Transitions')
    axes[1, 1].set_yticks(list(state_map.values()))
    axes[1, 1].set_yticklabels(list(state_map.keys()))
    axes[1, 1].grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    # Save plot
    plot_path = os.path.join(os.path.dirname(__file__), 'lpdc_fill_curve.png')
    plt.savefig(plot_path, dpi=150)
    print(f"✓ Plot saved: {plot_path}")
    
    plt.show()
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    test_lpdc_cycle()
