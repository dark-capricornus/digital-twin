"""
Furnace Physics Validation Test

Validates:
1. Exponential rise to setpoint
2. No overshoot
3. Ramp-rate constraints
4. Over-temp alarm triggering

Expected Response:
- Exponential curve (not linear)
- Asymptotic approach to equilibrium
- No instantaneous jumps
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from backend.simulation.physics import FurnacePhysics
import matplotlib.pyplot as plt


def test_furnace_heating():
    """Test furnace heating response."""
    print("=" * 60)
    print("FURNACE PHYSICS VALIDATION")
    print("=" * 60)
    
    furnace = FurnacePhysics()
    
    # Simulation parameters
    dt = 0.2  # 200ms timestep
    duration = 300.0  # 5 minutes
    steps = int(duration / dt)
    
    # Data collection
    time_data = []
    temp_data = []
    rate_data = []
    power_in_data = []
    power_loss_data = []
    alarm_data = []
    
    # Test: Heat to 750°C
    target_temp = 750.0
    heater_power = 100.0  # 100% power
    
    print(f"\nTest: Heating to {target_temp}°C with {heater_power}% power")
    print(f"Timestep: {dt}s, Duration: {duration}s")
    print("-" * 60)
    
    for i in range(steps):
        t = i * dt
        
        # Step physics
        outputs = furnace.step(dt, {'heater_power': heater_power})
        
        # Collect data
        time_data.append(t)
        temp_data.append(outputs['temperature'])
        rate_data.append(outputs['heating_rate'])
        power_in_data.append(outputs['power_in'])
        power_loss_data.append(outputs['power_loss'])
        alarm_data.append(outputs['over_temp_alarm'])
        
        # Print periodic updates
        if i % 50 == 0:  # Every 10 seconds
            print(f"t={t:6.1f}s | T={outputs['temperature']:6.2f}°C | "
                  f"dT/dt={outputs['heating_rate']:6.3f}°C/s | "
                  f"Alarm={outputs['over_temp_alarm']}")
    
    # Validation checks
    print("\n" + "=" * 60)
    print("VALIDATION CHECKS")
    print("=" * 60)
    
    # Check 1: Exponential rise (not linear)
    # Temperature should increase rapidly at first, then slow down
    initial_rate = rate_data[10]  # After 2 seconds
    final_rate = rate_data[-1]
    print(f"✓ Initial heating rate: {initial_rate:.3f}°C/s")
    print(f"✓ Final heating rate: {final_rate:.3f}°C/s")
    
    if initial_rate > final_rate * 2:
        print("✓ PASS: Exponential behavior confirmed (rate decreases over time)")
    else:
        print("✗ FAIL: Linear behavior detected (rate should decrease)")
    
    # Check 2: No overshoot
    max_temp = max(temp_data)
    print(f"\n✓ Maximum temperature reached: {max_temp:.2f}°C")
    
    if max_temp <= furnace.T_max:
        print(f"✓ PASS: No overshoot (stayed below {furnace.T_max}°C)")
    else:
        print(f"✗ FAIL: Overshoot detected (exceeded {furnace.T_max}°C)")
    
    # Check 3: Ramp-rate constraint
    max_rate = max(rate_data)
    print(f"\n✓ Maximum heating rate: {max_rate:.3f}°C/s")
    
    if max_rate <= furnace.max_ramp_rate * 1.01:  # Allow 1% tolerance
        print(f"✓ PASS: Ramp-rate constraint respected ({furnace.max_ramp_rate}°C/s)")
    else:
        print(f"✗ FAIL: Ramp-rate exceeded ({furnace.max_ramp_rate}°C/s)")
    
    # Check 4: Over-temp alarm
    alarm_triggered = any(alarm_data)
    print(f"\n✓ Over-temp alarm triggered: {alarm_triggered}")
    
    if max_temp >= furnace.T_max * furnace.T_alarm_threshold and alarm_triggered:
        print("✓ PASS: Alarm triggered correctly")
    elif max_temp < furnace.T_max * furnace.T_alarm_threshold and not alarm_triggered:
        print("✓ PASS: Alarm not triggered (temp below threshold)")
    else:
        print("✗ FAIL: Alarm behavior incorrect")
    
    # Plot results
    print("\n" + "=" * 60)
    print("GENERATING PLOTS")
    print("=" * 60)
    
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('Furnace Physics Validation', fontsize=16, fontweight='bold')
    
    # Plot 1: Temperature vs Time
    axes[0, 0].plot(time_data, temp_data, 'b-', linewidth=2, label='Temperature')
    axes[0, 0].axhline(y=furnace.T_max, color='r', linestyle='--', label='Max Temp')
    axes[0, 0].axhline(y=furnace.T_max * furnace.T_alarm_threshold, color='orange', 
                       linestyle='--', label='Alarm Threshold')
    axes[0, 0].set_xlabel('Time (s)')
    axes[0, 0].set_ylabel('Temperature (°C)')
    axes[0, 0].set_title('Temperature Response (Should be Exponential)')
    axes[0, 0].grid(True, alpha=0.3)
    axes[0, 0].legend()
    
    # Plot 2: Heating Rate vs Time
    axes[0, 1].plot(time_data, rate_data, 'g-', linewidth=2)
    axes[0, 1].axhline(y=furnace.max_ramp_rate, color='r', linestyle='--', 
                       label='Max Ramp Rate')
    axes[0, 1].set_xlabel('Time (s)')
    axes[0, 1].set_ylabel('Heating Rate (°C/s)')
    axes[0, 1].set_title('Heating Rate (Should Decrease Over Time)')
    axes[0, 1].grid(True, alpha=0.3)
    axes[0, 1].legend()
    
    # Plot 3: Power Balance
    axes[1, 0].plot(time_data, power_in_data, 'r-', linewidth=2, label='Power In')
    axes[1, 0].plot(time_data, power_loss_data, 'b-', linewidth=2, label='Power Loss')
    axes[1, 0].set_xlabel('Time (s)')
    axes[1, 0].set_ylabel('Power (W)')
    axes[1, 0].set_title('Power Balance')
    axes[1, 0].grid(True, alpha=0.3)
    axes[1, 0].legend()
    
    # Plot 4: Alarm State
    axes[1, 1].plot(time_data, alarm_data, 'r-', linewidth=2)
    axes[1, 1].set_xlabel('Time (s)')
    axes[1, 1].set_ylabel('Alarm State')
    axes[1, 1].set_title('Over-Temperature Alarm')
    axes[1, 1].set_ylim([-0.1, 1.1])
    axes[1, 1].grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    # Save plot
    plot_path = os.path.join(os.path.dirname(__file__), 'furnace_response.png')
    plt.savefig(plot_path, dpi=150)
    print(f"✓ Plot saved: {plot_path}")
    
    plt.show()
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    test_furnace_heating()
