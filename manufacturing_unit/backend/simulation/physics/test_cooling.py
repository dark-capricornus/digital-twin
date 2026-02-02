"""
Cooling Physics Validation Test

Validates:
1. Exponential decay to coolant temperature
2. Cooling rate calculation
3. Shrinkage risk detection
4. Last-to-solidify flag

Expected Response:
- Exponential decay curve
- No temperature below coolant temp
- Proper flag triggering
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from backend.simulation.physics import CoolingPhysics
import matplotlib.pyplot as plt


def test_cooling():
    """Test cooling physics."""
    print("=" * 60)
    print("COOLING PHYSICS VALIDATION")
    print("=" * 60)
    
    cooling = CoolingPhysics()
    
    # Simulation parameters
    dt = 0.2  # 200ms timestep
    duration = 120.0  # 2 minutes
    steps = int(duration / dt)
    
    # Data collection
    time_data = []
    temp_data = []
    rate_data = []
    shrinkage_data = []
    solidify_data = []
    
    # Test: Cool from 500°C to ambient
    print(f"\nTest: Cooling from 500°C to ambient")
    print(f"Timestep: {dt}s, Duration: {duration}s")
    print("-" * 60)
    
    for i in range(steps):
        t = i * dt
        
        # Step physics (full coolant flow)
        outputs = cooling.step(dt, {'coolant_flow': 1.0})
        
        # Collect data
        time_data.append(t)
        temp_data.append(outputs['part_temperature'])
        rate_data.append(outputs['cooling_rate'])
        shrinkage_data.append(outputs['shrinkage_risk'])
        solidify_data.append(outputs['last_to_solidify'])
        
        # Print periodic updates
        if i % 50 == 0:  # Every 10 seconds
            print(f"t={t:6.1f}s | T={outputs['part_temperature']:6.2f}°C | "
                  f"Rate={outputs['cooling_rate']:6.2f}°C/s | "
                  f"Shrink={outputs['shrinkage_risk']} | "
                  f"Solid={outputs['last_to_solidify']}")
    
    # Validation checks
    print("\n" + "=" * 60)
    print("VALIDATION CHECKS")
    print("=" * 60)
    
    # Check 1: Exponential decay
    initial_rate = rate_data[10]
    final_rate = rate_data[-1]
    print(f"✓ Initial cooling rate: {initial_rate:.2f}°C/s")
    print(f"✓ Final cooling rate: {final_rate:.2f}°C/s")
    
    if initial_rate > final_rate * 2:
        print("✓ PASS: Exponential decay confirmed (rate decreases)")
    else:
        print("✗ FAIL: Linear behavior detected")
    
    # Check 2: No temperature below coolant
    min_temp = min(temp_data)
    print(f"\n✓ Minimum temperature: {min_temp:.2f}°C")
    print(f"✓ Coolant temperature: {cooling.T_coolant:.2f}°C")
    
    if min_temp >= cooling.T_coolant - 0.1:  # Allow small tolerance
        print("✓ PASS: Temperature stayed above coolant temp")
    else:
        print("✗ FAIL: Temperature went below coolant temp")
    
    # Check 3: Shrinkage risk detection
    shrinkage_detected = any(shrinkage_data)
    print(f"\n✓ Shrinkage risk detected: {shrinkage_detected}")
    
    if initial_rate > cooling.critical_cooling_rate:
        if shrinkage_detected:
            print("✓ PASS: Shrinkage risk correctly detected")
        else:
            print("✗ FAIL: Shrinkage risk should have been detected")
    else:
        if not shrinkage_detected:
            print("✓ PASS: No shrinkage risk (cooling rate OK)")
        else:
            print("✗ FAIL: False shrinkage alarm")
    
    # Check 4: Last-to-solidify flag
    solidified = any(solidify_data)
    final_temp = temp_data[-1]
    print(f"\n✓ Last-to-solidify flag set: {solidified}")
    print(f"✓ Final temperature: {final_temp:.2f}°C")
    print(f"✓ Solidus temperature: {cooling.solidus_temp:.2f}°C")
    
    if final_temp < cooling.solidus_temp and solidified:
        print("✓ PASS: Solidification flag set correctly")
    elif final_temp >= cooling.solidus_temp and not solidified:
        print("✓ PASS: Not yet solidified")
    else:
        print("✗ FAIL: Solidification flag incorrect")
    
    # Plot results
    print("\n" + "=" * 60)
    print("GENERATING PLOTS")
    print("=" * 60)
    
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('Cooling Physics Validation', fontsize=16, fontweight='bold')
    
    # Plot 1: Temperature vs Time
    axes[0, 0].plot(time_data, temp_data, 'b-', linewidth=2, label='Part Temperature')
    axes[0, 0].axhline(y=cooling.T_coolant, color='cyan', linestyle='--', 
                       label='Coolant Temp')
    axes[0, 0].axhline(y=cooling.solidus_temp, color='orange', linestyle='--', 
                       label='Solidus Temp')
    axes[0, 0].set_xlabel('Time (s)')
    axes[0, 0].set_ylabel('Temperature (°C)')
    axes[0, 0].set_title('Cooling Curve (Should be Exponential Decay)')
    axes[0, 0].grid(True, alpha=0.3)
    axes[0, 0].legend()
    
    # Plot 2: Cooling Rate vs Time
    axes[0, 1].plot(time_data, rate_data, 'g-', linewidth=2)
    axes[0, 1].axhline(y=cooling.critical_cooling_rate, color='r', linestyle='--', 
                       label='Critical Rate')
    axes[0, 1].set_xlabel('Time (s)')
    axes[0, 1].set_ylabel('Cooling Rate (°C/s)')
    axes[0, 1].set_title('Cooling Rate (Should Decrease Over Time)')
    axes[0, 1].grid(True, alpha=0.3)
    axes[0, 1].legend()
    
    # Plot 3: Shrinkage Risk
    axes[1, 0].plot(time_data, shrinkage_data, 'r-', linewidth=2)
    axes[1, 0].set_xlabel('Time (s)')
    axes[1, 0].set_ylabel('Shrinkage Risk')
    axes[1, 0].set_title('Shrinkage Risk Detection')
    axes[1, 0].set_ylim([-0.1, 1.1])
    axes[1, 0].grid(True, alpha=0.3)
    
    # Plot 4: Solidification Flag
    axes[1, 1].plot(time_data, solidify_data, 'orange', linewidth=2)
    axes[1, 1].set_xlabel('Time (s)')
    axes[1, 1].set_ylabel('Last-to-Solidify')
    axes[1, 1].set_title('Solidification Detection')
    axes[1, 1].set_ylim([-0.1, 1.1])
    axes[1, 1].grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    # Save plot
    plot_path = os.path.join(os.path.dirname(__file__), 'cooling_curve.png')
    plt.savefig(plot_path, dpi=150)
    print(f"✓ Plot saved: {plot_path}")
    
    plt.show()
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    test_cooling()
