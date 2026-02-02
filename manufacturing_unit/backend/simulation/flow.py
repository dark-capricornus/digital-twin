from typing import List
from .machines.base import Machine

class SimpleLinearFlow:
    """
    Manages the transfer of material between machines in a linear sequence.
    Replaces previously monkey-patched logic in factory.py.
    """
    def __init__(self, machines: List[Machine]):
        self.machines = machines

    def execute(self) -> None:
        """
        Moves items from Machine N output -> Machine N+1 input.
        Iterates backwards to prevent instantaneous teleportation across the entire line in one tick.
        """
        # Logic matches original "waterfall" implementation
        for i in range(len(self.machines) - 1):
            source = self.machines[i]
            target = self.machines[i+1]
            
            # Move from Source Out -> Target In
            item = source.retrieve_item()
            if item:
                target.receive_item(item)
