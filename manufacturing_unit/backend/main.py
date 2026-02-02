import asyncio
import threading
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from simulation.factory import build_factory
from scada.store import ScadaStore

app = FastAPI(title="Alloy Wheel Digital Twin SCADA API")

# Allow CORS for WebGL
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Simulation Engine
sim_engine = build_factory()
simulation_thread = None
running = False

def simulation_loop():
    global running
    print(">>> Simulation Started")
    while running:
        start_time = time.time()
        
        # 1. Step Simulation
        sim_engine.step()
        
        # 2. Update SCADA Store
        ScadaStore.update(sim_engine.get_all_tags())
        
        # 3. Sleep remainder of tick
        elapsed = time.time() - start_time
        sleep_time = max(0, sim_engine.time_step - elapsed)
        time.sleep(sleep_time)
    print(">>> Simulation Stopped")

@app.on_event("startup")
def startup_event():
    global simulation_thread, running
    running = True
    simulation_thread = threading.Thread(target=simulation_loop, daemon=True)
    simulation_thread.start()

@app.on_event("shutdown")
def shutdown_event():
    global running
    running = False
    if simulation_thread:
        simulation_thread.join(timeout=2.0)

@app.get("/")
def read_root():
    return {"status": "ok", "service": "Digital Twin V1"}

@app.get("/api/state")
def get_state():
    """Returns the full SCADA state snapshot."""
    return ScadaStore.get_all()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
