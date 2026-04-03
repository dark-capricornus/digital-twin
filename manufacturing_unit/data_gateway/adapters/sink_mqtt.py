import json
import logging
import paho.mqtt.client as mqtt
from typing import Dict, Any
from data_gateway.core.interfaces import ISink, IAdapter

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mqtt_sink")

class MQTTSink(ISink, IAdapter):
    """
    Writes data to an MQTT Broker.
    Topic Format: <base_topic>/<channel_id> or generic JSON payload
    """
    def __init__(self, broker: str, port: int, topic: str):
        self.broker = broker
        self.port = port
        self.topic = topic
        self.client = mqtt.Client()
    
    async def connect(self):
        try:
            logger.info(f"Connecting to MQTT Broker {self.broker}:{self.port}...")
            # Paho connect is blocking, so we might want to wrap it if it takes time, 
            # but usually it's fast enough or we can leave it blocking for startup.
            # To be strictly async-safe:
            # await asyncio.to_thread(self.client.connect, self.broker, self.port, 60)
            self.client.connect(self.broker, self.port, 60)
            self.client.loop_start()
            logger.info("MQTT Connected ✔")
        except Exception as e:
            logger.error(f"MQTT Connection Failed: {e}")

    async def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()

    async def write(self, data: Dict[int, Any]) -> None:
        if not data:
            return

        # Prepare payload
        # For Ignition MQTT Engine with JSON Decoder, we can send a flat JSON
        # or a Sparkplug B structured payload.
        # User requested: self.client.publish(self.topic, json.dumps(payload), ...)
        
        # We need to decide if we send the whole batch as one JSON or individual tags.
        # User's request implies a single payload: "sink.write(normalized_data)"
        
        try:
            payload = json.dumps(data)
            logger.info(f"Publishing to MQTT topic {self.topic}: {payload}")
            
            # publish is non-blocking (returns MessageInfo)
            self.client.publish(
                self.topic,
                payload,
                qos=0,
                retain=False
            )
        except Exception as e:
            logger.error(f"MQTT Publish Failed: {e}")
