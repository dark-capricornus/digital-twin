"""
State Machine Tests — BaseMachine transitions and command handling.

Validates the PackML-aligned state machine (STOPPED → IDLE → RUNNING → FAULTED)
with enable-gating, command edge-triggering, and safe-stop behavior.
"""

import pytest
from manufacturing_unit.backend.simulation.machines.base_machine import MachineState
from manufacturing_unit.backend.simulation.machines.simple import SimpleMachine


class TestInitialState:
    """Machines should boot into a predictable, safe state."""

    def test_default_state_is_stopped(self):
        m = SimpleMachine("TEST_01", "Test Machine", cycle_time=5.0)
        assert m.state == MachineState.STOPPED

    def test_default_not_enabled(self):
        m = SimpleMachine("TEST_01", "Test Machine", cycle_time=5.0)
        assert m.enabled is False

    def test_default_fault_code_zero(self):
        m = SimpleMachine("TEST_01", "Test Machine", cycle_time=5.0)
        assert m.fault_code == 0

    def test_default_counters_zero(self):
        m = SimpleMachine("TEST_01", "Test Machine", cycle_time=5.0)
        assert m.processed_count == 0
        assert m.energy_kwh == 0.0
        assert m.runtime_total_hrs == 0.0


class TestStateTransitions:
    """Core PackML-aligned transitions."""

    def test_stopped_to_idle_via_reset(self, cnc_machine):
        """STOPPED → IDLE on Reset command."""
        m = SimpleMachine("T", "T", cycle_time=5.0)
        assert m.state == MachineState.STOPPED
        m.handle_reset_command()
        assert m.state == MachineState.IDLE

    def test_idle_to_running_via_start(self, cnc_machine):
        """IDLE → RUNNING on Start command (enabled=True)."""
        assert cnc_machine.state == MachineState.IDLE
        cnc_machine.handle_start_command()
        assert cnc_machine.state == MachineState.RUNNING

    def test_running_to_idle_via_stop(self, cnc_machine):
        """RUNNING → IDLE on Stop command."""
        cnc_machine.handle_start_command()
        assert cnc_machine.state == MachineState.RUNNING
        cnc_machine.handle_stop_command()
        assert cnc_machine.state == MachineState.IDLE

    def test_faulted_to_idle_via_reset(self, cnc_machine):
        """FAULTED → IDLE on Reset command."""
        cnc_machine.state = MachineState.FAULTED
        cnc_machine.fault_code = 999
        cnc_machine.handle_reset_command()
        assert cnc_machine.state == MachineState.IDLE
        assert cnc_machine.fault_code == 0

    def test_stopped_to_idle_clears_fault(self):
        """Reset from STOPPED clears fault code."""
        m = SimpleMachine("T", "T", cycle_time=5.0)
        m.fault_code = 42
        m.handle_reset_command()
        assert m.fault_code == 0


class TestEnableGating:
    """Start command MUST be gated by enabled flag."""

    def test_start_rejected_when_disabled(self):
        """Start fails silently if enabled=False."""
        m = SimpleMachine("T", "T", cycle_time=5.0)
        m.handle_reset_command()  # STOPPED → IDLE
        assert m.state == MachineState.IDLE
        result = m.handle_start_command()
        assert result is False
        assert m.state == MachineState.IDLE  # Still IDLE, NOT RUNNING

    def test_start_accepted_when_enabled(self, cnc_machine):
        """Start succeeds when enabled=True."""
        result = cnc_machine.handle_start_command()
        assert result is True
        assert cnc_machine.state == MachineState.RUNNING


class TestCommandEdgeTrigger:
    """Commands should only fire on rising edge (value=True)."""

    def test_set_command_false_is_noop(self, cnc_machine):
        cnc_machine.set_command("start", False)
        assert cnc_machine.state == MachineState.IDLE  # No transition

    def test_set_command_true_fires(self, cnc_machine):
        cnc_machine.set_command("start", True)
        assert cnc_machine.state == MachineState.RUNNING


class TestInvalidTransitions:
    """Reject illegal state transitions gracefully."""

    def test_start_from_stopped_fails(self):
        m = SimpleMachine("T", "T", cycle_time=5.0)
        m.enabled = True
        result = m.handle_start_command()
        assert result is False
        assert m.state == MachineState.STOPPED

    def test_stop_from_idle_fails(self, cnc_machine):
        result = cnc_machine.handle_stop_command()
        assert result is False
        assert cnc_machine.state == MachineState.IDLE

    def test_reset_from_running_fails(self, cnc_machine):
        cnc_machine.handle_start_command()
        result = cnc_machine.handle_reset_command()
        assert result is False
        assert cnc_machine.state == MachineState.RUNNING

    def test_double_start_noop(self, cnc_machine):
        cnc_machine.handle_start_command()
        result = cnc_machine.handle_start_command()
        assert result is False  # Already RUNNING


class TestForceStop:
    """PLC-level safe stop should reset operational state."""

    def test_force_safe_state_resets_cycle(self, cnc_machine):
        """SimpleMachine.force_safe_state resets process variables."""
        cnc_machine.handle_start_command()
        assert cnc_machine.state == MachineState.RUNNING
        cnc_machine.force_safe_state()
        assert cnc_machine.progress == 0.0
        assert cnc_machine.cycle_status == "IDLE"

    def test_force_safe_state_resets_operational_values(self, cnc_machine):
        cnc_machine.handle_start_command()
        cnc_machine.progress = 50.0
        cnc_machine.spindle_rpm = 3500.0
        cnc_machine.force_safe_state()
        assert cnc_machine.progress == 0.0
        assert cnc_machine.spindle_rpm == 0.0
