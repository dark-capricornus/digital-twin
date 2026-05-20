import sys
import os
import json
import asyncio
import base64
import time
import logging
from contextlib import asynccontextmanager
from typing import List, Union
from pydantic import BaseModel
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
import paho.mqtt.client as mqtt

try:
    from manufacturing_unit.common.manifest_manager import ManifestManager
    from manufacturing_unit.common.websocket_manager import ConnectionManager
    from manufacturing_unit.common.sparkplug_decoder import decode_payload
except ImportError:
    try:
        from ..common.manifest_manager import ManifestManager
        from ..common.websocket_manager import ConnectionManager
        from ..common.sparkplug_decoder import decode_payload
    except ImportError:
        from common.manifest_manager import ManifestManager
        from common.websocket_manager import ConnectionManager
        from common.sparkplug_decoder import decode_payload

# Configure logging
logging.basicConfig(level=logging.INFO, format='[BRIDGE] %(asctime)s | %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger("Bridge")

# --- Configuration ---
MQTT_BROKER = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = "#"

# --- Global State ---
MAIN_LOOP = None
manager = ConnectionManager()
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Capture the main event loop for async broadcasting from sync callbacks
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    
    logger.info(f"Connecting to MQTT Broker {MQTT_BROKER}:{MQTT_PORT}...")
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start()
    except Exception as e:
        logger.error(f"MQTT Connection Failed: {e}")
        
    yield
    
    # Shutdown
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    logger.info("Bridge service shut down.")

app = FastAPI(lifespan=lifespan)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AssetLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.scope.get("type") == "websocket":
            return await call_next(request)
        start_time = time.time()
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        path = request.url.path
        if path.endswith(".glb") or path.endswith(".js"):
            logger.info(f"Served {path} | Status: {response.status_code} | {process_time:.2f}ms")
        return response

app.add_middleware(AssetLoggingMiddleware)

# --- MQTT Handlers ---
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        logger.info(f"Connected to MQTT Broker. Subscribing to {MQTT_TOPIC}...")
        client.subscribe(MQTT_TOPIC)
    else:
        logger.error(f"Failed to connect to MQTT Broker: {rc}")

def on_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload
    
    # Use unified decoder from common
    data, content_type = decode_payload(payload, topic)

    message = {
        "topic": topic,
        "type": content_type,
        "payload": data
    }
    
    # Broadcast to WebSockets using the thread-safe async helper
    global MAIN_LOOP
    if MAIN_LOOP and MAIN_LOOP.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), MAIN_LOOP)

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

# --- WebSocket Endpoints ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We listen for messages from the frontend (e.g. SCADA writes)
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                # Redirect writes to MQTT for the Data Gateway to pick up
                if msg.get("type") == "write":
                    logger.info(f"Relaying write command to MQTT: {msg}")
                    mqtt_client.publish("factory/commands", json.dumps(msg))
                elif msg.get("type") == "command":
                    # Transform frontend 'command' format to gateway 'write' format
                    payload = msg.get("payload", {})
                    command = payload.get("command")
                    device_id = payload.get("device_id")
                    value = payload.get("value", True)
                    
                    if command and device_id:
                        relay_msg = {
                            "type": "write",
                            "tag": f"{device_id}.{command}",
                            "value": value
                        }
                        logger.info(f"Relaying UI command to MQTT: {relay_msg}")
                        mqtt_client.publish("factory/commands", json.dumps(relay_msg))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# --- Static File Serving ---
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.get("/assets/models/plant.glb")
async def serve_glb():
    glb_path = os.path.join(frontend_dir, "assets", "models", "plant.glb")
    if os.path.exists(glb_path):
        return FileResponse(glb_path, media_type="model/gltf-binary")
    return {"error": "File not found"}, 404

# tags.json lives in /docs (shared with the data gateway / manifests),
# but the frontend fetches it from the web root. Serve it explicitly so
# StaticFiles doesn't 404 it.
_docs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "docs"))

@app.get("/tags.json")
async def serve_tags_json():
    tags_path = os.path.join(_docs_dir, "tags.json")
    if os.path.exists(tags_path):
        return FileResponse(tags_path, media_type="application/json")
    return {"error": "tags.json not found"}, 404

@app.get("/site_manifest.json")
async def serve_site_manifest():
    manifest_path = os.path.join(_docs_dir, "manifests", "site_manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/json")
    return {"error": "site_manifest.json not found"}, 404

@app.get("/telemetry_dictionary.json")
async def serve_telemetry_dictionary():
    dict_path = os.path.join(_docs_dir, "manifests", "telemetry_dictionary.json")
    if os.path.exists(dict_path):
        return FileResponse(dict_path, media_type="application/json")
    return {"error": "telemetry_dictionary.json not found"}, 404

@app.get("/assets.json")
async def serve_assets():
    assets_path = os.path.join(_docs_dir, "manifests", "assets.json")
    if os.path.exists(assets_path):
        return FileResponse(assets_path, media_type="application/json")
    return {"error": "assets.json not found"}, 404

# Mount the rest of the frontend
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Bridge Server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
