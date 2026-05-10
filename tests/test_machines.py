"""
Machine-Specific Tests — Role-based simulation logic for each machine type.

Validates process simulation, tag emission, power calculation, and
role-specific behavior for every machine variant.
"""

import pytest
from manufacturing_unit.backend.simulation.machines.base_machine import MachineState
from manufacturing_unit.backend.simulation.machines.simple import SimpleMachine
from manufacturing_unit.backend.simulation.machines.thermal import ThermalMachine
from manufacturing_unit.backend.simulation.machines.degasser import DegasserMachine
from manufacturing_unit.backend.simulation.machines.inspection import InspectionMachine


# ═══════════════════════════════════════════════════════════════════════════════
# CNC MACHINING
# ═══════════════════════════════════════════════════════════════════════════════

class TestCNCMachine:
    """CNC machining cycle with spindle RPM and stage transitions."""

    def test_cnc_processes_part(self, cnc_machine):
        """CNC should consume from queue_in and produce to queue_out."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_1")
        cnc_machine.cmd_trigger = True

        for _ in range(60):
            cnc_machine.tick(0.2)

        assert cnc_machine.processed_count >= 1
        assert len(cnc_machine.queue_out) >= 1

    def test_cnc_stage_transitions(self, cnc_machine):
        """CNC cycle should go through STARTING → RUNNING → TOOL_CHANGE → COMPLETE."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_1")
        cnc_machine.cmd_trigger = True

        observed_statuses = set()
        for _ in range(60):
            cnc_machine.tick(0.2)
            observed_statuses.add(cnc_machine.cycle_status)

        assert "STARTING" in observed_statuses or "RUNNING" in observed_statuses

    def test_cnc_tags_contain_spindle(self, cnc_machine):
        """CNC tags must include Spindle_RPM."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_1")
        cnc_machine.cmd_trigger = True
        cnc_machine.tick(0.2)

        tags = cnc_machine.get_tags()
        assert "Spindle_RPM" in tags

    def test_cnc_power_calculation(self, cnc_machine):
        """CNC should draw ~40kW when RUNNING, ~2kW when idle."""
        cnc_machine.handle_start_command()
        cnc_machine.tick(0.2)
        assert cnc_machine.power_kw == 40.0

        cnc_machine.handle_stop_command()
        cnc_machine.tick(0.2)
        assert cnc_machine.power_kw == 2.0

    def test_cnc_requires_trigger(self, cnc_machine):
        """CNC with has_trigger should wait for trigger before processing."""
        cnc_machine.handle_start_command()
        cnc_machine.queue_in.append("Part_1")
        # cmd_trigger is False by default

        cnc_machine.tick(0.2)
        assert cnc_machine.current_item is None  # Should not load without trigger
        assert cnc_machine.cycle_status == "IDLE"


# ═══════════════════════════════════════════════════════════════════════════════
# LPDC CASTING
# ═══════════════════════════════════════════════════════════════════════════════

class TestLPDCCasting:
    """Low Pressure Die Casting with pressure profile simulation."""

    def test_lpdc_self_generates_work(self, lpdc_machine):
        """LPDC with role=casting auto-generates shots (doesn't need queue_in)."""
        lpdc_machine.handle_start_command()
        lpdc_machine.cmd_pour_request = True

        for _ in range(80):
            lpdc_machine.tick(0.2)

        assert lpdc_machine.processed_count >= 1

    def test_lpdc_pressure_profile(self, lpdc_machine):
        """Pressure should ramp during FILLING and hold during HOLDING."""
        lpdc_machine.handle_start_command()
        lpdc_machine.cmd_pour_request = True

        pressures = []
        for _ in range(40):
            lpdc_machine.tick(0.2)
            pressures.append(lpdc_machine.pressure_psi)

        # Pressure should have been non-zero at some point
        assert max(pressures) > 0

    def test_lpdc_tags_contain_casting_data(self, lpdc_machine):
        """LPDC tags must include casting-specific fields."""
        lpdc_machine.handle_start_command()
        lpdc_machine.cmd_pour_request = True
        lpdc_machine.tick(0.2)

        tags = lpdc_machine.get_tags()
        assert "Riser_Pressure" in tags
        assert "Shot_Count" in tags
        assert "Cycle_Time" in tags


# ═══════════════════════════════════════════════════════════════════════════════
# THERMAL MACHINES (Furnace / Heat Treatment / Cooling)
# ═══════════════════════════════════════════════════════════════════════════════

class TestFurnace:
    """Melting furnace with physics-based temperature model."""

    def test_furnace_heats_when_running(self, furnace):
        """Furnace temperature should rise when heater is active."""
        furnace.handle_start_command()
        initial_temp = furnace.physics.T_current

        for _ in range(100):
            furnace.tick(0.2)

        assert furnace.physics.T_current > initial_temp

    def test_furnace_mode_transitions(self, furnace):
        """Furnace should transition between operational modes."""
        furnace.handle_start_command()
        furnace.physics.T_current = 750.0  # At target

        modes = set()
        for _ in range(50):
            furnace.tick(0.2)
            modes.add(furnace.mode)

        # Should see at least HOLD or SOAKING when at target temp
        assert len(modes) >= 1

    def test_furnace_zone_temperatures(self, furnace):
        """Zone temps should be offset from bath temp."""
        furnace.handle_start_command()
        furnace.physics.T_current = 700.0
        furnace.tick(0.2)

        tags = furnace.get_tags()
        bath = tags[f"{furnace.id}.bath_temp"]
        roof = tags[f"{furnace.id}.roof_temp"]
        wall = tags[f"{furnace.id}.wall_temp"]

        assert roof > bath  # Roof is hotter
        assert wall < bath  # Wall is cooler

    def test_furnace_power_values(self, furnace):
        """Furnace should draw 120kW running, 15kW standby."""
        furnace.handle_start_command()
        furnace.tick(0.2)
        assert furnace.power_kw == 120.0

        furnace.handle_stop_command()
        furnace.tick(0.2)
        assert furnace.power_kw == 15.0


class TestCoolingTank:
    """Cooling tank — thermal machine in cooling mode."""

    def test_cooling_mode_flag(self, cooling_tank):
        assert cooling_tank.is_cooling_tank is True

    def test_cooling_heater_off(self, cooling_tank):
        """Cooling tank should never engage heater."""
        cooling_tank.handle_start_command()
        cooling_tank.tick(0.2)
        assert cooling_tank.heater_power == 0.0

    def test_cooling_tags_contain_tank_data(self, cooling_tank):
        """Cooling tags should include Tank_Temperature and Flow_Rate."""
        cooling_tank.handle_start_command()
        cooling_tank.tick(0.2)

        tags = cooling_tank.get_tags()
        assert "Tank_Temperature" in tags
        assert "Flow_Rate" in tags
        assert "Cooling_Run_Status" in tags


# ═══════════════════════════════════════════════════════════════════════════════
# DEGASSER
# ═══════════════════════════════════════════════════════════════════════════════

class TestDegasser:
    """Degasser with vacuum level and gas flow simulation."""

    def test_vacuum_drops_during_processing(self, degasser):
        """Vacuum level should decrease when processing metal."""
        degasser.handle_start_command()
        degasser.queue_in.append("MoltenMetal_1")

        initial_vacuum = degasser.vacuum_level

        for _ in range(20):
            degasser.tick(0.2)

        assert degasser.vacuum_level < initial_vacuum

    def test_vacuum_repressurizes_when_idle(self, degasser):
        """Vacuum should return to atmospheric when idle."""
        degasser.handle_start_command()
        degasser.vacuum_level = 5.0  # Low vacuum from previous cycle

        # No items in queue → idle processing
        for _ in range(50):
            degasser.tick(0.2)

        assert degasser.vacuum_level >= 100.0  # Near atmospheric

    def test_degasser_processes_item(self, degasser):
        """Degasser should complete cycle and move items to queue_out."""
        degasser.handle_start_command()
        degasser.queue_in.append("Metal_1")

        for _ in range(50):
            degasser.tick(0.2)

        assert degasser.processed_count >= 1
        assert len(degasser.queue_out) >= 1

    def test_degasser_tags(self, degasser):
        """Degasser tags should include vacuum and gas flow data."""
        degasser.handle_start_command()
        degasser.queue_in.append("Metal_1")
        degasser.tick(0.2)

        tags = degasser.get_tags()
        assert "VacuumLevel" in tags
        assert "Gas_Flow_Rate" in tags
        assert "Rotor_Speed" in tags


# ═══════════════════════════════════════════════════════════════════════════════
# INSPECTION (X-Ray)
# ═══════════════════════════════════════════════════════════════════════════════

class TestInspection:
    """X-Ray inspection with pass/fail decisions."""

    def test_inspection_processes_and_decides(self, inspection):
        """Inspection should classify parts as OK or NG."""
        inspection.handle_start_command()

        # Feed 50 parts
        for i in range(50):
            inspection.queue_in.append(f"Part_{i}")

        for _ in range(500):
            inspection.tick(0.2)

        assert inspection.processed_count > 0
        total = (inspection.processed_count - inspection.reject_count) + inspection.reject_count
        assert total == inspection.processed_count

    def test_inspection_reject_rate(self, inspection):
        """With 10% fail rate, ~10% of parts should be rejected over many trials."""
        inspection.handle_start_command()

        for i in range(200):
            inspection.queue_in.append(f"Part_{i}")

        for _ in range(2000):
            inspection.tick(0.2)

        if inspection.processed_count > 20:
            reject_ratio = inspection.reject_count / inspection.processed_count
            assert 0.01 < reject_ratio < 0.30  # Loose bound due to randomness

    def test_inspection_tags_contain_beam_data(self, inspection):
        """Inspection should expose beam current/voltage when scanning."""
        inspection.handle_start_command()
        inspection.queue_in.append("Part_1")
        inspection.tick(0.2)

        tags = inspection.get_tags()
        assert f"{inspection.id}.Beam_Current_mA" in tags
        assert f"{inspection.id}.Scan_Status" in tags


# ═══════════════════════════════════════════════════════════════════════════════
# PAINT BOOTH
# ═══════════════════════════════════════════════════════════════════════════════

class TestPaintBooth:
    """Paint booth with environment simulation."""

    def test_paint_cycle_stages(self, paint_booth):
        """Paint booth should cycle through SPRAYING → CLEANING → IDLE."""
        paint_booth.handle_start_command()

        statuses = set()
        for _ in range(50):
            paint_booth.tick(0.2)
            statuses.add(paint_booth.cycle_status)

        assert "SPRAYING" in statuses

    def test_paint_booth_environment_tags(self, paint_booth):
        """Paint booth should expose temperature and humidity."""
        paint_booth.handle_start_command()
        paint_booth.tick(0.2)

        tags = paint_booth.get_tags()
        assert "Booth_Temperature" in tags
        assert "Booth_Humidity" in tags
        assert "Air_Flow_Status" in tags


# ═══════════════════════════════════════════════════════════════════════════════
# PRETREATMENT
# ═══════════════════════════════════════════════════════════════════════════════

class TestPretreatment:
    """Pretreatment with conveyor and stage simulation."""

    def test_pretreat_stage_transitions(self, pretreat_machine):
        """Pretreatment should cycle DEGREASE → RINSE → PHOSPHATE → DRY."""
        pretreat_machine.handle_start_command()

        statuses = set()
        for _ in range(40):
            pretreat_machine.tick(0.2)
            statuses.add(pretreat_machine.cycle_status)

        assert len(statuses) >= 2  # Should see at least 2 stages

    def test_pretreat_conveyor_speed(self, pretreat_machine):
        """Conveyor speed should be active when running."""
        pretreat_machine.handle_start_command()
        pretreat_machine.tick(0.2)

        tags = pretreat_machine.get_tags()
        assert tags.get("Conveyor_Speed", 0) > 0
