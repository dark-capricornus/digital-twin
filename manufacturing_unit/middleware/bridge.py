import sys
import os
import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
import time
from contextlib import asynccontextmanager
from typing import List, Union
from pydantic import BaseModel
import paho.mqtt.client as mqtt
from asyncua import Client, ua

# --- Lifecycle and State ---
MAIN_LOOP = None
# Allow overriding OPC-UA host for production readiness
OPCUA_HOST = os.getenv("OPCUA_HOST", "127.0.0.1")
opc_client = Client(url=f"opc.tcp://{OPCUA_HOST}:4840/freeopcua/server/")

# --- OPC-UA Polling Cache ---
_opc_node_cache: dict = {}   # device_id -> {tag_name -> asyncua Node}
_opc_idx: int = None


async def _build_opc_cache():
    """Browse VirtualPLC.Devices and VirtualPLC.Plant, cache all tag nodes."""
    global _opc_node_cache, _opc_idx
    try:
        _opc_idx = await opc_client.get_namespace_index("http://digitaltwin.plc")
        devices_node = opc_client.get_node(f"ns={_opc_idx};s=VirtualPLC.Devices")
        dev_nodes = await devices_node.get_children()
        cache = {}
        for dev_node in dev_nodes:
            dev_name = (await dev_node.read_browse_name()).Name
            tag_nodes = {}
            # Collect tags from Status (and Inputs for completeness)
            for folder_name in ("Status",):
                try:
                    folder = opc_client.get_node(f"ns={_opc_idx};s=VirtualPLC.Devices.{dev_name}.{folder_name}")
                    children = await folder.get_children()
                    for child in children:
                        tag_name = (await child.read_browse_name()).Name
                        tag_nodes[tag_name] = child
                except Exception:
                    pass
            if tag_nodes:
                cache[dev_name] = tag_nodes

        # Also cache Plant-level WIP/KPI tags under a virtual "PLANT" device
        # OPC-UA browse names: WIP_ingots_kg, KPI_total_wheels_produced, etc.
        # Frontend expects: Plant_WIP_Ingots_Available, Plant_KPI_Total_Produced, etc.
        _plant_tag_map = {
            "WIP_ingots_kg": "Plant_WIP_Ingots_Available",
            "WIP_molten_metal_kg": "Plant_WIP_Molten_Metal",
            "WIP_degassed_metal_kg": "Plant_WIP_Degassed_Metal",
            "WIP_cast_parts": "Plant_WIP_Cast_Parts",
            "WIP_cooled_parts_1": "Plant_WIP_Cooled_Parts_1",
            "WIP_cooled_parts_2": "Plant_WIP_Cooled_Parts_2",
            "WIP_heat_treated_parts": "Plant_WIP_Heat_Treated_Parts",
            "WIP_pretreated_parts": "Plant_WIP_Pretreated_Parts",
            "WIP_machined_parts": "Plant_WIP_Machined_Parts",
            "WIP_painted_parts": "Plant_WIP_Painted_Parts",
            "WIP_xray_passed": "Plant_WIP_Passed_Parts",
            "WIP_qc_passed": "Plant_WIP_QC_Passed",
            "WIP_scrap_parts": "Plant_WIP_Scrap_Parts",
            "KPI_total_ingots_consumed": "Plant_KPI_Ingots_Consumed",
            "KPI_total_wheels_produced": "Plant_KPI_Total_Produced",
            "KPI_total_scrap": "Plant_KPI_Total_Scrap",
            "KPI_batches_completed": "Plant_KPI_Batches",
            "KPI_throughput_wheels_hr": "Plant_KPI_Throughput",
            "KPI_yield_percent": "Plant_KPI_Yield",
        }
        plant_tags = {}
        for folder_name in ("WIP", "KPI"):
            try:
                folder = opc_client.get_node(f"ns={_opc_idx};s=VirtualPLC.Plant.{folder_name}")
                children = await folder.get_children()
                for child in children:
                    browse_name = (await child.read_browse_name()).Name
                    frontend_key = _plant_tag_map.get(browse_name, f"Plant_{browse_name}")
                    plant_tags[frontend_key] = child
            except Exception:
                pass
        if plant_tags:
            cache["PLANT"] = plant_tags

        _opc_node_cache = cache
        print(f"[BRIDGE][OPC] Cached {len(_opc_node_cache)} devices, "
              f"{sum(len(v) for v in _opc_node_cache.values())} tags")
    except Exception as e:
        print(f"[BRIDGE][OPC] Cache build error: {e}")


async def poll_opcua_and_broadcast():
    """Background task: read all device tags from OPC-UA every 500ms and broadcast."""
    await asyncio.sleep(3)  # Allow OPC-UA server to stabilise
    while True:
        try:
            if manager.active_connections:
                if not _opc_node_cache:
                    await _build_opc_cache()
                if _opc_node_cache:
                    batch = {}
                    for dev_id, tag_nodes in _opc_node_cache.items():
                        if not tag_nodes:
                            continue
                        try:
                            nodes = list(tag_nodes.values())
                            values = await opc_client.read_values(nodes)
                            dev_data = {tag: val for tag, val in zip(tag_nodes.keys(), values)
                                        if val is not None}
                            if dev_data:
                                batch[dev_id] = dev_data
                        except Exception:
                            pass
                    if batch:
                        await manager.broadcast({
                            "topic": "opc/batch",
                            "type": "json",
                            "payload": batch
                        })
        except Exception as e:
            print(f"[BRIDGE][OPC POLL] Error: {e}")
            _opc_node_cache.clear()  # Force cache rebuild next cycle
        await asyncio.sleep(0.5)


# --- Fix Path for Imports ---
# Ensure the current directory (middleware) is in the path for sparkplug_b_pb2
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Try to import Sparkplug B decoder
try:
    import sparkplug_b_pb2
    HAS_SPARKPLUG_DECODER = True
    print("[BRIDGE] Sparkplug B decoder loaded successfully.")
except ImportError as e:
    HAS_SPARKPLUG_DECODER = False
    print(f"WARNING: sparkplug_b_pb2 not found ({e}). Sparkplug B messages will be sent as Base64.")

# --- Configuration ---
# Allow overriding MQTT host for production readiness
MQTT_BROKER = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
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
        asyncio.create_task(poll_opcua_and_broadcast())
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

# --- Asset Logging Middleware ---
class AssetLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # [FIX] Skip middleware for WebSocket upgrades to prevent protocol interference
        if request.scope.get("type") == "websocket":
            return await call_next(request)
            
        start_time = time.time()
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        
        path = request.url.path
        if path.endswith(".glb") or path.endswith(".js"):
            print(f"[BRIDGE][SERVE] {path} | Status: {response.status_code} | {process_time:.2f}ms")
        return response

app.add_middleware(AssetLoggingMiddleware)

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

# --- Unified Static Serving ---
# Map to frontend directory
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
docs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "docs"))

@app.get("/tags.json")
async def serve_tags():
    tags_path = os.path.join(docs_dir, "tags.json")
    if os.path.exists(tags_path):
        return FileResponse(tags_path, media_type="application/json")
    return {"error": "tags.json not found in docs/"}, 404

@app.get("/assets/models/plant.glb")
async def serve_glb():
    glb_path = os.path.join(frontend_dir, "assets", "models", "plant.glb")
    if os.path.exists(glb_path):
        return FileResponse(glb_path, media_type="model/gltf-binary")
    return {"error": "File not found"}, 404

# Mount the rest of the frontend
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    # Use standard port 8000 for unified industrial interface
    print("[BRIDGE] Starting Unified Server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
