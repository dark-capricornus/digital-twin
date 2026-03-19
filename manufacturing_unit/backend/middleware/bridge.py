import sys
import os
import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import List, Union
from pydantic import BaseModel
import paho.mqtt.client as mqtt
from asyncua import Client, ua

# --- Lifecycle and State ---
MAIN_LOOP = None
opc_client = Client(url="opc.tcp://127.0.0.1:4840/freeopcua/server/")


# --- Fix Path for Imports ---
# Calculate the project root absolute path (which is 4 levels up: bridge.py -> middleware -> backend -> manufacturing_unit -> root)
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Try to import Sparkplug B decoder
try:
    import sparkplug_b_pb2
    HAS_SPARKPLUG_DECODER = True
except ImportError:
    HAS_SPARKPLUG_DECODER = False
    print("WARNING: sparkplug_b_pb2 not found. Sparkplug B messages will be sent as Base64.")

# --- Configuration ---
MQTT_BROKER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "#"  # Subscribe to everything (or use "spBv1.0/#")

# --- WebSocket Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[BRIDGE] New WebSocket client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[BRIDGE] WebSocket client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
                
        for conn in dead_connections:
            if conn in self.active_connections:
                self.active_connections.remove(conn)

manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    print(f"Starting MQTT Bridge... Loop captured: {MAIN_LOOP}")
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start() # Runs in background thread
    except Exception as e:
        print(f"Warning: Could not connect to MQTT Broker: {e}")
        
    try:
        await opc_client.connect()
        print(f"[BRIDGE] Connected to OPC-UA Server at {opc_client.server_url}")
    except Exception as e:
        print(f"Warning: Could not connect to OPC UA Server: {e}")
    
    yield
    
    # --- Shutdown ---
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    try:
        await opc_client.disconnect()
    except:
        pass
    print("MQTT Bridge shut down.")

app = FastAPI(lifespan=lifespan)

# Add CORS middleware to allow connectivity from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this to specific origins for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# The startup and shutdown logic is now handled in the lifespan context manager

# --- Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "write" and msg.get("node_id"):
                    node_id_str = msg["node_id"]
                    val = msg.get("value", True)
                    
                    # Fix 5: Harden NodeId normalization (Industrial Standard Pathing)
                    if "Devices" not in node_id_str:
                        print(f"[BRIDGE][WARN] Normalizing NodeID: {node_id_str} -> VirtualPLC.Devices.{node_id_str}")
                        node_id_str = f"VirtualPLC.Devices.{node_id_str}"
                    
                    # Fix 6: Ensure strict Input-only write model
                    allowed_tags = ["Start", "Stop", "Trigger", "PourRequest"]
                    if not any(tag in node_id_str for tag in allowed_tags):
                        print(f"[BRIDGE][REJECT] Invalid write target: {node_id_str}")
                        continue
                    
                    # Fix 3: Enhanced Debug Logging
                    print(f"[BRIDGE][WRITE] Target: {node_id_str}, Value: {val}")
                    
                    try:
                        # Convert types
                        if isinstance(val, bool): variant_type = ua.VariantType.Boolean
                        elif isinstance(val, int): variant_type = ua.VariantType.Int32
                        elif isinstance(val, float): variant_type = ua.VariantType.Double
                        else: variant_type = ua.VariantType.String
                            
                        # Resolve Namespace Index dynamically
                        try:
                            idx = await opc_client.get_namespace_index("http://digitaltwin.plc")
                        except:
                            idx = 2
                            
                        node = opc_client.get_node(f"ns={idx};s={node_id_str}")
                        dv = ua.DataValue(ua.Variant(val, variant_type))
                        await node.write_value(dv)
                        print(f"[BRIDGE][WRITE SUCCESS]")
                    except Exception as e:
                        print(f"[BRIDGE][WRITE ERROR] Node: {node_id_str}, Error: {e}")
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"[BRIDGE] WebSocket error: {e}")
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
            payload_to_decode = request.payload
            if not isinstance(payload_to_decode, str):
                return {"status": "error", "error": "base64 encoding requires a string payload"}
            data = base64.b64decode(payload_to_decode)
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
    print("[BRIDGE] Starting server on ws://localhost:8001/ws")
    uvicorn.run(app, host="0.0.0.0", port=8001)
