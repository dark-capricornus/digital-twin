import sys
import os
import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List, Union
from pydantic import BaseModel
import paho.mqtt.client as mqtt

# --- Fix Path for Imports ---
# Add the current directory to sys.path so standalone bridge can find sparkplug_b_pb2
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Try to import Sparkplug B decoder
try:
    import sparkplug_b_pb2
    HAS_SPARKPLUG_DECODER = True
except ImportError:
    HAS_SPARKPLUG_DECODER = False
    print("WARNING: sparkplug_b_pb2 not found. Sparkplug B messages will be sent as Base64.")

# --- Configuration ---
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_TOPIC = "#"  # Subscribe to everything (or use "spBv1.0/#")

# --- WebSocket Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Error sending to client: {e}")

manager = ConnectionManager()
app = FastAPI()

# --- MQTT Client ---
mqtt_client = mqtt.Client()

def on_connect(client, userdata, flags, rc):
    print(f"[BRIDGE] Connected to MQTT Broker with result code {rc}")
    print(f"[BRIDGE] Subscribing to topic: {MQTT_TOPIC}")
    client.subscribe(MQTT_TOPIC)

def decode_sparkplug_metrics(payload_bytes):
    """Decode Sparkplug B payload and extract metrics as dict"""
    if not HAS_SPARKPLUG_DECODER:
        return None
    
    try:
        payload = sparkplug_b_pb2.Payload()
        payload.ParseFromString(payload_bytes)
        
        metrics = {}
        for metric in payload.metrics:
            # Extract value based on datatype
            value = None
            if metric.HasField('int_value'):
                value = metric.int_value
            elif metric.HasField('long_value'):
                value = metric.long_value
            elif metric.HasField('float_value'):
                value = metric.float_value
            elif metric.HasField('double_value'):
                value = metric.double_value
            elif metric.HasField('boolean_value'):
                value = metric.boolean_value
            elif metric.HasField('string_value'):
                value = metric.string_value
            
            if metric.name and value is not None:
                metrics[metric.name] = value
        
        return metrics
    except Exception as e:
        print(f"Sparkplug decode error: {e}")
        return None

def on_message(client, userdata, msg):
    """
    Callback when MQTT message is received.
    Decodes payload and broadcasts to WS clients.
    """
    topic = msg.topic
    print(f"[BRIDGE] Received MQTT message on topic: {topic}")
    payload = msg.payload
    
    # Try to decode as JSON first
    try:
        data = json.loads(payload.decode('utf-8'))
        content_type = "json"
    except:
        # Try Sparkplug B decoding
        decoded_metrics = decode_sparkplug_metrics(payload)
        
        if decoded_metrics:
            # Successfully decoded Sparkplug B
            data = decoded_metrics
            content_type = "sparkplug"
        else:
            # Fallback: send as Base64
            data = base64.b64encode(payload).decode('utf-8')
            content_type = "binary"

    message = {
        "topic": topic,
        "type": content_type,
        "payload": data
    }
    
    # Broadcast to WebSockets (Async from Sync callback)
    # Use the captured main loop
    global MAIN_LOOP
    if MAIN_LOOP and MAIN_LOOP.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), MAIN_LOOP)
    else:
        print("Warning: Event loop not ready")

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

# --- Lifecycle ---
MAIN_LOOP = None

@app.on_event("startup")
async def startup_event():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    print(f"Starting MQTT Bridge... Loop captured: {MAIN_LOOP}")
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start() # Runs in background thread
    except Exception as e:
        print(f"Warning: Could not connect to MQTT Broker: {e}")

@app.on_event("shutdown")
def shutdown_event():
    mqtt_client.loop_stop()
    mqtt_client.disconnect()

# --- Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open. Client can send "ping"? 
            # We mostly push, but need to await something to keep socket alive
            data = await websocket.receive_text()
            # Echo or Ignore
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Publisher Endpoint ---
class MqttPublishRequest(BaseModel):
    topic: str
    payload: Union[dict, str]
    encoding: str = "json" # "json", "plain", "base64"

@app.post("/publish")
async def publish_message(request: MqttPublishRequest):
    try:
        if request.encoding == "base64":
            data = base64.b64decode(request.payload)
            # Ensure it is bytes
            if isinstance(data, str): data = data.encode('utf-8')
        elif request.encoding == "json":
            data = json.dumps(request.payload)
        else:
            data = str(request.payload)
            
        info = mqtt_client.publish(request.topic, data)
        info.wait_for_publish()
        return {"status": "success", "msg_id": info.mid}
    except Exception as e:
        return {"status": "error", "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    # Run server
    uvicorn.run(app, host="0.0.0.0", port=8001)
