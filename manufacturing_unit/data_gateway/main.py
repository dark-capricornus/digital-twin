import time
import sys
import argparse
from data_gateway.core.engine import DataEngine
from data_gateway.core.interfaces import ISource, ISink
from data_gateway.adapters.sink_mqtt import MQTTSink
from data_gateway.adapters.sink_file import RapidScadaFileSink
import requests
from typing import Dict, Any

from data_gateway.adapters.source_rest import RestSourceAdapter

def main():
    # Parse Arguments
    parser = argparse.ArgumentParser(description="Digital Twin Data Gateway")
    parser.add_argument("--sink", choices=["mqtt", "file"], default="mqtt", help="Select data sink (mqtt or file)")
    args, unknown = parser.parse_known_args()

    print(f">>> Initializing Data Gateway using {args.sink.upper()} Sink...")
    
    # 1. Configuration
    API_URL = "http://localhost:8000/api/state"
    
    # 2. Components
    source = RestSourceAdapter(API_URL)
    sink: ISink
    
    if args.sink == "mqtt":
        MQTT_BROKER = "localhost"
        MQTT_PORT = 1883
        MQTT_TOPIC = "digital-twin/state"
        sink = MQTTSink(MQTT_BROKER, MQTT_PORT, MQTT_TOPIC)
    else:
        # Default file path for file sink
        FILE_PATH = "gateway_output.txt" 
        sink = RapidScadaFileSink(FILE_PATH)
    
    # Mapping
    mapping = None
    if args.sink == "file":
         mapping = {str(i): i for i in range(100, 1000)}
    
    engine = DataEngine(source, sink, mapping)
    
    # 3. Start
    try:
        sink.connect()
        engine.run(interval=1.0)
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"[FATAL] Gateway Error: {e}")
    finally:
        if 'sink' in locals():
            sink.disconnect()

if __name__ == "__main__":
    main()
