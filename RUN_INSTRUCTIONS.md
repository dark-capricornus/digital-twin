# Digital Twin Project - Run Instructions

This guide provides step-by-step instructions to start the various components of the manufacturing unit digital twin.

## Prerequisites

1.  **Python Environment**: Ensure you have the virtual environment activated.
    ```bash
    .\env\Scripts\activate
    ```
2.  **Dependencies**: Install required packages if not already done.
    ```bash
    pip install -r requirements.txt
    ```
3.  **MQTT Broker**: Ensure **Mosquitto** is running on your machine (default port 1883).
    - You can check this by running `tasklist | findstr mosquitto` in a terminal.

---

## Startup Order

To ensure correct data flow, please start the components in the following order:

### 1. Virtual PLC & Simulation
This component starts the OPC UA server and the core manufacturing simulation.
- **Root Directory**: `d:\Digital Twin`
- **Command**:
  ```bash
  python manufacturing_unit/backend/plc/engine.py
  ```

### 2. Data Gateway
This component acts as an adapter, pulling data from the Virtual PLC (OPC UA) and publishing it to the MQTT Broker.
- **Root Directory**: `d:\Digital Twin`
- **Command**:
  ```bash
  python manufacturing_unit/data_gateway/main.py
  ```

### 3. MQTT Bridge
This component subscribes to MQTT messages and broadcasts them to the Frontend via WebSockets.
- **Root Directory**: `d:\Digital Twin`
- **Command**:
  ```bash
  python manufacturing_unit/backend/middleware/bridge.py
  ```

### 4. Frontend Visualization
Use a simple HTTP server to serve the 3D visualization.
- **Directory**: `d:\Digital Twin\manufacturing_unit\frontend`
- **Command**:
  ```bash
  # Change directory first
  cd manufacturing_unit/frontend
  # Run a simple server
  python -m http.server 8080
  ```
- **Access**: Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## Monitoring Data Flow

- **OPC UA**: Verify connection at `opc.tcp://127.0.0.1:4840`.
- **MQTT**: Use `mosquitto_sub -t "#" -v` to see raw messages.
- **WebSockets**: Check the browser console (F12) on the frontend for live device updates.
