import asyncio
from typing import Dict, Any, Optional
from data_gateway.core.interfaces import ISource, ISink

class DataEngine:
    """
    Core Logic: Read -> Normalize -> Map -> Write.
    Stateless / Minimally stateful.
    """
    def __init__(self, source: ISource, sink: ISink, mapping: Optional[Dict[str, int]] = None):
        self.source = source
        self.sink = sink
        self.mapping = mapping
        self.running = False
        
        # Link Command Flow (Sink -> Source)
        self.sink.set_command_callback(self.on_command_received)

    async def on_command_received(self, tag: str, value: Any):
        """
        Callback triggered when a command arrives from the Sink (MQTT).
        Relays it to the Source (OPC UA).
        """
        print(f">>> Command Relayed: {tag} -> {value}")
        await self.source.write(tag, value)

    async def step(self):
        # 1. Read
        raw_data = await self.source.read()
        if not raw_data:
            return

        # 2. Normalize/Map
        normalized_data = self.process(raw_data)

        # 3. Write
        await self.sink.write(normalized_data)

    def process(self, raw_data: Dict[str, Any]) -> Dict[Any, Any]:
        """
        Maps String Tags to Channel IDs.
        If mapping is None, returns raw data as-is.
        """
        if self.mapping is None:
            return raw_data

        output = {}
        for tag, value in raw_data.items():
            if tag in self.mapping:
                channel_id = self.mapping[tag]
                output[channel_id] = value
        return output

    async def run(self, interval: float = 1.0):
        self.running = True
        retry_delay = 5.0
        
        print(f">>> Gateway Started. Polling every {interval}s...")
        
        while self.running:
            try:
                await self.step()
                await asyncio.sleep(interval)
                # Reset delay on success
                retry_delay = 5.0
            except asyncio.CancelledError:
                self.running = False
                print(">>> Gateway Stopped (Cancelled).")
            except Exception as e:
                print(f">>> Gateway Iteration Failed: {e}. Retrying in {retry_delay}s...")
                await asyncio.sleep(retry_delay)
                # Exponential backoff (max 60s)
                retry_delay = min(retry_delay * 2, 60.0)
