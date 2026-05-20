import asyncio
import logging
import os
import sys

# Ensure project root is in path for imports
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

try:
    from manufacturing_unit.data_gateway.core.engine import DataEngine
    from manufacturing_unit.data_gateway.adapters.source_opcua import OPCUASourceAdapter
    from manufacturing_unit.data_gateway.adapters.sink_mqtt import MQTTSink
    from manufacturing_unit.common.manifest_manager import ManifestManager
except ImportError:
    try:
        from .core.engine import DataEngine
        from .adapters.source_opcua import OPCUASourceAdapter
        from .adapters.sink_mqtt import MQTTSink
        from ..common.manifest_manager import ManifestManager
    except ImportError:
        from data_gateway.core.engine import DataEngine
        from data_gateway.adapters.source_opcua import OPCUASourceAdapter
        from data_gateway.adapters.sink_mqtt import MQTTSink
        from common.manifest_manager import ManifestManager

logging.basicConfig(level=logging.INFO, format='[GATEWAY] %(asctime)s | %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger("GatewayMain")

async def main():
    # 1. Initialize Manifest
    manifest = ManifestManager()
    
    # 2. Setup Adapters
    # In production, these would come from a config file or env vars
    opc_endpoint = os.getenv("OPCUA_ENDPOINT", "opc.tcp://localhost:4840/freeopcua/server/")
    mqtt_host = os.getenv("MQTT_HOST", "localhost")
    mqtt_port = int(os.getenv("MQTT_PORT", "1883"))
    mqtt_topic = "opc/batch"
    
    source = OPCUASourceAdapter(endpoint=opc_endpoint)
    sink = MQTTSink(broker=mqtt_host, port=mqtt_port, topic=mqtt_topic)
    
    # 3. Connect Sinks
    await sink.connect()
    
    # 4. Initialize Engine
    # The engine now works on the raw dictionary from source, 
    # which is already structured by machine ID thanks to the refactored source adapter.
    engine = DataEngine(source=source, sink=sink)
    
    # 5. Run Loop
    try:
        logger.info("Starting Data Gateway...")
        await engine.run(interval=0.5) # 500ms scan rate
    except KeyboardInterrupt:
        logger.info("Gateway stopping...")
    finally:
        await source.disconnect()
        await sink.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
