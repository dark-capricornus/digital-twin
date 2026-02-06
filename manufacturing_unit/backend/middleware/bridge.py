import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List, Union
from pydantic import BaseModel
import paho.mqtt.client as mqtt

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
    print(f"Connected to MQTT Broker with result code {rc}")
    client.subscribe(MQTT_TOPIC)

def on_message(client, userdata, msg):
    """
    Callback when MQTT message is received.
    Decodes payload and broadcasts to WS clients.
    """
    topic = msg.topic
    payload = msg.payload
    
    # Try to decode as JSON, otherwise send as Base64 (for Sparkplug B)
    try:
        data = json.loads(payload.decode('utf-8'))
        content_type = "json"
    except:
        # Binary data (Sparkplug B) -> Send as Base64
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
    uvicorn.run(app, host="0.0.0.0", port=8000)
