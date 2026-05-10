"""
Fault Injection Tests — Simulating industrial fault scenarios.

Tests fault detection, fault code assignment, automatic state transitions,
recovery via reset, and cascading fault effects across the system.
"""

import pytest
from manufacturing_unit.backend.simulation.machines.base_machine import MachineState
from manufacturing_unit.backend.simulation.machines.simple import SimpleMachine
from manufacturing_unit.backend.simulation.machines.thermal import ThermalMachine
from manufacturing_unit.backend.simulation.machines.degasser import DegasserMachine
from manufacturing_unit.backend.simulation.machines.inspection import InspectionMachine


class TestManualFaultInjection:
    """Directly set machine to FAULTED and verify behavior."""

    def test_inject_fault_sets_state_and_code(self, cnc_machine):
        """Directly injecting a fault transitions to FAULTED."""
        cnc_machine.handle_start_command()
        assert cnc_machine.state == MachineState.RUNNING

        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 501

        assert cnc_machine.state == MachineState.FAULTED
        assert cnc_machine.fault_code == 501

    def test_faulted_machine_stops_processing(self, cnc_machine):
        """A faulted machine should not increment counters on tick."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_1")
        cnc_machine.tick(1.0)  # Should process
        count_before = cnc_machine.processed_count

        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 999
        cnc_machine.tick(1.0)  # Should NOT process

        assert cnc_machine.processed_count == count_before

    def test_faulted_machine_still_publishes_tags(self, cnc_machine):
        """Tags must be published in every state (SCADA requirement)."""
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 123
        tags = cnc_machine.get_tags()

        assert tags[f"{cnc_machine.id}.state"] == MachineState.FAULTED.value
        assert tags[f"{cnc_machine.id}.fault_code"] == 123
        assert tags[f"{cnc_machine.id}.is_running"] is False


class TestFaultRecovery:
    """Reset from FAULTED should restore machine to operable state."""

    def test_reset_clears_fault_code(self, cnc_machine):
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 501
        cnc_machine.handle_reset_command()

        assert cnc_machine.state == MachineState.IDLE
        assert cnc_machine.fault_code == 0

    def test_machine_can_restart_after_recovery(self, cnc_machine):
        """After fault recovery, machine should be startable again."""
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 501
        cnc_machine.handle_reset_command()
        result = cnc_machine.handle_start_command()

        assert result is True
        assert cnc_machine.state == MachineState.RUNNING

    def test_counters_preserved_across_fault_recovery(self, cnc_machine):
        """Production counters should survive fault → reset → restart."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_A")

        # Run until part completes
        for _ in range(60):
            cnc_machine.tick(0.2)

        count_before = cnc_machine.processed_count

        # Inject fault, reset, restart
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 100
        cnc_machine.handle_reset_command()
        cnc_machine.handle_start_command()

        assert cnc_machine.processed_count == count_before  # Preserved
        assert cnc_machine.state == MachineState.RUNNING


class TestThermalOverTempFault:
    """Thermal machines should self-fault on over-temperature.

    NOTE: The FurnacePhysics model clamps T_current to T_max (900°C),
    but _detect_fault() checks > 1200°C. To test fault detection logic,
    we bypass the physics clamp by setting T_current after the physics step
    or by raising T_max above the fault threshold.
    """

    def test_furnace_over_temp_triggers_fault(self, furnace):
        """Furnace exceeding 1200°C should automatically FAULT."""
        furnace.handle_start_command()
        assert furnace.state == MachineState.RUNNING

        # Raise physics T_max so the clamp doesn't prevent over-temp
        furnace.physics.T_max = 2000.0
        furnace.physics.T_current = 1300.0
        furnace.physics.T_ambient = 1300.0  # Prevent cooling in physics step

        furnace.tick(0.2)

        assert furnace.state == MachineState.FAULTED
        assert furnace.fault_code == 201  # Over-temp code

    def test_furnace_safe_temp_no_fault(self, furnace):
        """Furnace within safe limits should not fault."""
        furnace.handle_start_command()
        furnace.physics.T_current = 750.0

        for _ in range(10):
            furnace.tick(0.2)

        assert furnace.state == MachineState.RUNNING
        assert furnace.fault_code == 0

    def test_furnace_physics_clamp_prevents_natural_overtemp(self, furnace):
        """Physics T_max (900°C) prevents natural reach of 1200°C fault."""
        furnace.handle_start_command()
        furnace.heater_power = 100.0

        # Run for many steps at full power
        for _ in range(500):
            furnace.tick(0.2)

        # Temperature should be clamped at T_max (900), not reaching 1200
        assert furnace.physics.T_current <= furnace.physics.T_max
        assert furnace.state == MachineState.RUNNING

    def test_furnace_recovery_after_over_temp(self, furnace):
        """Furnace can recover from over-temp after reset."""
        furnace.handle_start_command()
        furnace.physics.T_max = 2000.0
        furnace.physics.T_current = 1300.0
        furnace.physics.T_ambient = 1300.0
        furnace.tick(0.2)

        assert furnace.state == MachineState.FAULTED

        # Cool down and reset
        furnace.physics.T_current = 400.0
        furnace.physics.T_ambient = 25.0
        furnace.physics.T_max = 900.0  # Restore normal limit
        furnace.handle_reset_command()

        assert furnace.state == MachineState.IDLE
        assert furnace.fault_code == 0


class TestFaultDuringProcessing:
    """Faults during active processing should halt work-in-progress."""

    def test_cnc_fault_mid_cycle(self, cnc_machine):
        """Fault during active machining should freeze progress."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_1")
        cnc_machine.cmd_trigger = True  # Required for machining role

        # Partially process
        for _ in range(10):
            cnc_machine.tick(0.2)

        assert cnc_machine.progress > 0
        progress_at_fault = cnc_machine.progress

        # Inject fault
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 301

        # Tick while faulted — progress should NOT advance
        for _ in range(10):
            cnc_machine.tick(0.2)

        assert cnc_machine.progress == progress_at_fault

    def test_casting_fault_resets_pressure(self, lpdc_machine):
        """Fault during casting should leave pressure as-is (no processing)."""
        lpdc_machine.handle_start_command()

        # Run a few cycles to build pressure
        for _ in range(10):
            lpdc_machine.tick(0.2)

        pressure_before = lpdc_machine.pressure_psi

        lpdc_machine.state = MachineState.FAULTED
        lpdc_machine.fault_code = 401

        # Pressure should not change when faulted
        for _ in range(5):
            lpdc_machine.tick(0.2)

        assert lpdc_machine.pressure_psi == pressure_before


class TestFaultTagExposure:
    """Verify fault information is properly exposed via OPC UA tags."""

    def test_fault_code_in_tags(self, cnc_machine):
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 502
        tags = cnc_machine.get_tags()

        assert f"{cnc_machine.id}.fault_code" in tags
        assert tags[f"{cnc_machine.id}.fault_code"] == 502

    def test_state_code_reflects_faulted(self, cnc_machine):
        cnc_machine.state = MachineState.FAULTED
        tags = cnc_machine.get_tags()
        assert tags[f"{cnc_machine.id}.state_code"] == MachineState.FAULTED.value

    def test_is_running_false_when_faulted(self, cnc_machine):
        cnc_machine.state = MachineState.FAULTED
        tags = cnc_machine.get_tags()
        assert tags[f"{cnc_machine.id}.is_running"] is False

    def test_degasser_alarm_status_when_faulted(self, degasser):
        degasser.state = MachineState.FAULTED
        tags = degasser.get_tags()
        assert tags.get("Alarm_Status") == "Alarm"

    def test_inspection_alarm_when_faulted(self, inspection):
        inspection.state = MachineState.FAULTED
        tags = inspection.get_tags()
        assert tags[f"{inspection.id}.Alarm_Status"] == "Fault"


class TestForceStopAsFaultMitigation:
    """PLC-level force_safe_state as fault mitigation."""

    def test_force_stop_kills_furnace_heater(self, furnace):
        """Force stop should cut heater power."""
        furnace.handle_start_command()
        furnace.heater_power = 100.0

        furnace.force_safe_state()

        assert furnace.heater_power == 0.0
        assert furnace.mode == "IDLE"

    def test_force_stop_resets_degasser_vacuum(self, degasser):
        """Force stop should vent vacuum to atmospheric."""
        degasser.handle_start_command()
        degasser.vacuum_level = 0.5  # Deep vacuum

        degasser.force_safe_state()

        assert degasser.vacuum_level == 101.3  # Atmospheric

    def test_force_stop_clears_cnc_spindle(self, cnc_machine):
        """Force stop should zero out spindle RPM."""
        cnc_machine.handle_start_command()
        cnc_machine.spindle_rpm = 3500.0
        cnc_machine.pressure_psi = 85.0

        cnc_machine.force_safe_state()

        assert cnc_machine.spindle_rpm == 0.0
        assert cnc_machine.pressure_psi == 0.0


class TestMultiMachineFaultScenario:
    """Fault in one machine should not affect others (isolation)."""

    def test_fault_isolation(self):
        """Faulting CNC should not affect LPDC running beside it."""
        cnc = SimpleMachine("CNC_01", "CNC", cycle_time=10.0, role="machining")
        lpdc = SimpleMachine("LPDC_01", "LPDC", cycle_time=15.0, role="casting")

        for m in [cnc, lpdc]:
            m.enabled = True
            m.handle_reset_command()
            m.handle_start_command()

        assert cnc.state == MachineState.RUNNING
        assert lpdc.state == MachineState.RUNNING

        # Fault CNC
        cnc.state = MachineState.FAULTED
        cnc.fault_code = 301

        # LPDC should still be running
        lpdc.tick(0.2)
        assert lpdc.state == MachineState.RUNNING
        assert cnc.state == MachineState.FAULTED

    def test_simultaneous_faults(self):
        """Multiple machines can be faulted independently."""
        machines = []
        for i in range(4):
            m = SimpleMachine(f"M_{i:02d}", f"Machine {i}", cycle_time=5.0)
            m.enabled = True
            m.handle_reset_command()
            m.handle_start_command()
            machines.append(m)

        # Fault machines 0 and 2
        machines[0].state = MachineState.FAULTED
        machines[0].fault_code = 100
        machines[2].state = MachineState.FAULTED
        machines[2].fault_code = 200

        assert machines[0].state == MachineState.FAULTED
        assert machines[1].state == MachineState.RUNNING
        assert machines[2].state == MachineState.FAULTED
        assert machines[3].state == MachineState.RUNNING

        # Reset machine 0 only
        machines[0].handle_reset_command()
        assert machines[0].state == MachineState.IDLE
        assert machines[2].state == MachineState.FAULTED  # Still faulted
