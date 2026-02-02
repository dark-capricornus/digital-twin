import os
import datetime
from data_gateway.core.interfaces import ISink, IAdapter

class RapidScadaFileSink(ISink, IAdapter):
    """
    Writes data to a generic text file for Rapid SCADA Import.
    Format:
    ChannelID;Value
    """
    def __init__(self, file_path: str):
        self.file_path = file_path
        self.temp_path = file_path + ".tmp"

    def connect(self):
        # Ensure dir exists
        os.makedirs(os.path.dirname(os.path.abspath(self.file_path)), exist_ok=True)

    def disconnect(self):
        pass

    def write(self, data: dict) -> None:
        if not data:
            return

        try:
            # Write to tmp first to ensure atomicity
            with open(self.temp_path, "w") as f:
                for channel_id, value in data.items():
                    # Handle boolean conversion for SCADA (1/0)
                    if isinstance(value, bool):
                        val_str = "1" if value else "0"
                    else:
                        val_str = str(value)
                    
                    f.write(f"{channel_id};{val_str}\n")
            
            # Atomic rename (replace)
            os.replace(self.temp_path, self.file_path)
            
        except Exception as e:
            print(f"[ERROR] File Sink Write Failed: {e}")

class PrintSink(ISink):
    """Debug Sink that prints to console."""
    def write(self, data: dict) -> None:
        print(f"[DEBUG] Writing {len(data)} tags to SCADA: {list(data.items())[:3]}...")
