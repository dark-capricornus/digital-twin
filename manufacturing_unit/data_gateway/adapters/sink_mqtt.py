import json
import logging
import asyncio
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
    def __init__(self, broker: str, port: int, topic: str, command_topic: str = "factory/commands"):
        self.broker = broker
        self.port = port
        self.topic = topic
        self.command_topic = command_topic
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.command_callback = None
        self._loop = None
    
    def set_command_callback(self, callback) -> None:
        self.command_callback = callback

    async def connect(self):
        try:
            self._loop = asyncio.get_running_loop()
            logger.info(f"Connecting to MQTT Broker {self.broker}:{self.port}...")
            
            # Setup Callbacks
            self.client.on_connect = self._on_connect
            self.client.on_message = self._on_message
            
            self.client.connect(self.broker, self.port, 60)
            self.client.loop_start()
            logger.info("MQTT Connected ✔")
        except Exception as e:
            logger.error(f"MQTT Connection Failed: {e}")

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            logger.info(f"Connected to MQTT Broker. Subscribing to {self.command_topic}...")
            client.subscribe(self.command_topic)
        else:
            logger.error(f"Failed to connect to MQTT: {rc}")

    def _on_message(self, client, userdata, msg):
        if self.command_callback and self._loop:
            try:
                payload = json.loads(msg.payload.decode())
                # Support both {"tag": "...", "value": ...} and {"type": "write", "tag": "...", "value": ...}
                tag = payload.get("tag")
                value = payload.get("value")
                
                if tag is not None and value is not None:
                    logger.info(f"Command received: {tag} = {value}")
                    # Bridge to async using the stored loop
                    asyncio.run_coroutine_threadsafe(self.command_callback(tag, value), self._loop)
            except Exception as e:
                logger.error(f"Error processing command message: {e}")

    async def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()

    async def write(self, data: Dict[Any, Any]) -> None:
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
