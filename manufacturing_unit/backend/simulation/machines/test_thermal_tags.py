from thermal import ThermalMachine
import json

def test_machine_tags(machine_id, name, target_temp, cooling):
    m = ThermalMachine(machine_id, name, cycle_time=5.0, target_temp=target_temp, cooling=cooling)
    m.physics.T_current = 25.5
    m.mode = "RUNNING"
    tags = m._get_device_specific_tags()
    print(f"\nTags for {machine_id}:")
    for k, v in tags.items():
        print(f"  {k}: {v}")

if __name__ == "__main__":
    # Test Cooling Tank
    test_machine_tags("COOLING_01", "Cooling Tank", 25.0, True)
    # Test Furnace
    test_machine_tags("FURNACE_01", "Furnace", 750.0, False)
    # Test Heat Treatment
    test_machine_tags("HEAT_01", "Heat Treat", 500.0, False)
