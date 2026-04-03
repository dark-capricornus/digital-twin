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
        try:
            print(f">>> Gateway Started. Polling every {interval}s...")
            while self.running:
                await self.step()
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            self.running = False
            print(">>> Gateway Stopped (Cancelled).")
        except Exception as e:
            self.running = False
            print(f">>> Gateway Stopped. Error: {e}")
