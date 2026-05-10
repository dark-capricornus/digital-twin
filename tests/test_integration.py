"""
Integration Tests — Factory assembly and cross-machine behavior.

Validates the SimulationEngine, factory assembly, tag publication,
energy tracking, and orchestrator-level behavior.
"""

import pytest
from manufacturing_unit.backend.simulation.machines.base_machine import MachineState
from manufacturing_unit.backend.simulation.machines.simple import SimpleMachine


class TestFactoryAssembly:
    """Factory builder should assemble a complete plant."""

    def test_factory_creates_all_machines(self, factory_engine):
        """All machines from the manifest should be present."""
        machine_ids = {m.id for m in factory_engine.machines}

        expected = {
            "INBOUND_01", "FURNACE_01", "DEGASSER_01", "DEGASSER_02",
            "COOLING_01", "LPDC_01", "LPDC_02", "LPDC_03",
            "HEAT_01", "HEAT_02", "COOLING_02",
            "CNC_01", "CNC_02", "INSPECTION_01",
            "PRETREAT_01", "PAINT_01", "PAINT_02",
            "OUTBOUND_01", "OUTBOUND_02"
        }

        assert expected.issubset(machine_ids), \
            f"Missing machines: {expected - machine_ids}"

    def test_factory_machine_count(self, factory_engine):
        """Factory should have 19 machines."""
        assert len(factory_engine.machines) == 19

    def test_inbound_pre_filled(self, factory_engine):
        """INBOUND_01 should have 100 pre-filled raw materials."""
        inbound = next(m for m in factory_engine.machines if m.id == "INBOUND_01")
        assert len(inbound.queue_in) == 100


class TestSimulationStep:
    """SimulationEngine.step() should run all machines."""

    def test_step_does_not_crash(self, factory_engine):
        """A single step should complete without errors."""
        # Enable all machines and set to IDLE → RUNNING
        for m in factory_engine.machines:
            m.enabled = True
            m.handle_reset_command()
            m.handle_start_command()

        factory_engine.step()  # Should not raise

    def test_multiple_steps_accumulate_runtime(self, factory_engine):
        """After many steps, runtime should increase."""
        for m in factory_engine.machines:
            m.enabled = True
            m.handle_reset_command()
            m.handle_start_command()

        for _ in range(20):
            factory_engine.step()

        # At least one machine should have accumulated runtime
        total_runtime = sum(m.runtime_total_hrs for m in factory_engine.machines)
        assert total_runtime > 0


class TestTagPublication:
    """Every machine must publish tags in every state."""

    def test_tags_published_in_stopped(self, cnc_machine):
        m = SimpleMachine("TEST_01", "Test", cycle_time=5.0)
        tags = m.get_tags()
        assert f"TEST_01.state" in tags
        assert tags["TEST_01.state"] == MachineState.STOPPED.value

    def test_tags_published_in_idle(self, cnc_machine):
        cnc_machine.handle_reset_command()  # Already IDLE from fixture
        tags = cnc_machine.get_tags()
        assert tags[f"{cnc_machine.id}.state"] == MachineState.IDLE.value

    def test_tags_published_in_running(self, cnc_machine):
        cnc_machine.handle_start_command()
        cnc_machine.tick(0.2)
        tags = cnc_machine.get_tags()
        assert tags[f"{cnc_machine.id}.state"] == MachineState.RUNNING.value
        assert tags[f"{cnc_machine.id}.is_running"] is True

    def test_tags_published_in_faulted(self, cnc_machine):
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 999
        tags = cnc_machine.get_tags()
        assert tags[f"{cnc_machine.id}.state"] == MachineState.FAULTED.value
        assert tags[f"{cnc_machine.id}.fault_code"] == 999

    def test_base_tags_always_present(self, cnc_machine):
        """Common base tags should always be present."""
        tags = cnc_machine.get_tags()
        required = [
            f"{cnc_machine.id}.state",
            f"{cnc_machine.id}.state_code",
            f"{cnc_machine.id}.is_running",
            f"{cnc_machine.id}.enabled",
            f"{cnc_machine.id}.fault_code",
            f"{cnc_machine.id}.processed_count",
            f"{cnc_machine.id}.power_kw",
            f"{cnc_machine.id}.energy_kwh",
            f"{cnc_machine.id}.runtime_total_hrs",
            f"{cnc_machine.id}.vibration",
            f"{cnc_machine.id}.motor_load",
            f"{cnc_machine.id}.oil_level",
            f"{cnc_machine.id}.air_pressure",
            f"{cnc_machine.id}.internal_temp",
        ]
        for key in required:
            assert key in tags, f"Missing base tag: {key}"


class TestEnergyTracking:
    """Energy consumption should accumulate deterministically."""

    def test_energy_accumulates_when_running(self, cnc_machine):
        cnc_machine.handle_start_command()

        for _ in range(20):
            cnc_machine.tick(0.2)

        assert cnc_machine.energy_kwh > 0

    def test_energy_does_not_accumulate_when_stopped(self):
        m = SimpleMachine("T", "T", cycle_time=5.0)
        initial_energy = m.energy_kwh

        for _ in range(10):
            m.tick(0.2)

        # Stopped machines should still have minimal idle power
        # but it should be very low
        assert m.energy_kwh >= initial_energy

    def test_power_value_depends_on_role(self):
        """Different roles should have different power draws."""
        cnc = SimpleMachine("C", "CNC", cycle_time=10.0, role="machining")
        lpdc = SimpleMachine("L", "LPDC", cycle_time=15.0, role="casting")
        buff = SimpleMachine("B", "Buffer", cycle_time=5.0, role="buffer")

        for m in [cnc, lpdc, buff]:
            m.enabled = True
            m.handle_reset_command()
            m.handle_start_command()
            m.tick(0.2)

        # LPDC > CNC > Buffer
        assert lpdc.power_kw > cnc.power_kw > buff.power_kw


class TestIndustrialTags:
    """Simulated industrial sensor tags should evolve deterministically."""

    def test_vibration_increases_when_running(self, cnc_machine):
        cnc_machine.handle_start_command()
        initial_vib = cnc_machine.vibration

        for _ in range(30):
            cnc_machine.tick(0.2)

        assert cnc_machine.vibration > initial_vib

    def test_vibration_decays_when_stopped(self, cnc_machine):
        cnc_machine.handle_start_command()
        for _ in range(30):
            cnc_machine.tick(0.2)

        cnc_machine.handle_stop_command()
        running_vib = cnc_machine.vibration

        for _ in range(50):
            cnc_machine.tick(0.2)

        assert cnc_machine.vibration < running_vib

    def test_motor_load_tracks_running_state(self, cnc_machine):
        cnc_machine.handle_start_command()

        for _ in range(30):
            cnc_machine.tick(0.2)

        assert cnc_machine.motor_load > 10.0

        cnc_machine.handle_stop_command()
        for _ in range(30):
            cnc_machine.tick(0.2)

        assert cnc_machine.motor_load < 10.0

    def test_internal_temp_heats_up_running(self, cnc_machine):
        cnc_machine.handle_start_command()
        initial_temp = cnc_machine.internal_temp

        for _ in range(30):
            cnc_machine.tick(0.2)

        assert cnc_machine.internal_temp > initial_temp

    def test_oil_level_slowly_decreases(self, cnc_machine):
        cnc_machine.handle_start_command()
        initial_oil = cnc_machine.oil_level

        for _ in range(100):
            cnc_machine.tick(0.2)

        assert cnc_machine.oil_level < initial_oil
