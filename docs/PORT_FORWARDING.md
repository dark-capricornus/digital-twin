# Digital Twin - Port Forwarding Guide (VS Code)

This guide provides instructions for accessing the **Digital Twin V1 Dashboard** remotely or on a mobile device using VS Code's built-in Port Forwarding.

---

## 1. Prerequisites
Ensure all services are running locally before attempting to forward ports:
1.  **Frontend**: (e.g., `python -m http.server 8000`)
2.  **Backend/Bridge**: (`python manufacturing_unit/backend/middleware/bridge.py`)
3.  **Simulation Orchestrator**: Should be active.

---

## 2. Setting Up VS Code Port Forwarding
VS Code allows you to forward local ports to a public URL.

### Step 1: Forward the Unified Industrial Server
The Digital Twin V1 الآن uses a consolidated architecture. Forward **Port 8000** only.

1. In VS Code, go to the **Ports** tab.
2. Select **Port 8000** (Unified Server).
3. Right-click and set **Port Visibility** to **Public** (required for mobile access).
4. Copy the **Forwarded Address** (e.g., `https://<id>-8000.devtunnels.ms`).

### Step 2: Accessing from Mobile
Simply paste the Forwarded Address into your mobile browser. The UI will automatically detect the tunnel and connect its WebSocket internally via the same host.

---

## 3. How Connectivity Works
The Digital Twin V1 includes **Smart Port Mapping**. 

*   When you access the dashboard via the `8000` URL provided by VS Code (e.g., `https://xyz-8000.app.github.dev`), the frontend automatically detects the subdomain-based port forwarding.
*   It dynamically identifies that the matching WebSocket must be on the `xyz-8001.app.github.dev` subdomain and switches protocols (HTTP -> WS or HTTPS -> WSS) appropriately.

---

## 4. Mobile Access (Smartphone/Tablet)
1.  Copy the URL for port `8000` from the VS Code **Forwarded Address** column.
2.  Open this URL on your mobile browser (e.g., Chrome, Safari).
3.  The 3D visualization and real-time telemetry should load and update automatically.

---

## 5. Troubleshooting
*   **WebSocket Connection Failed**: Ensure port `8001` is also forwarded and its visibility is set to **Public**.
*   **"Site cannot be reached"**: Check your local firewall settings to allow VS Code to map ports.
*   **UI Loads but No Data**: Use the **Health Check** script to verify local backend services:
    ```bash
    python manufacturing_unit/backend/middleware/verify_production_readiness.py
    ```

---

## 6. Security Note
> [!WARNING]
> Setting Port Visibility to **Public** makes your local dashboard accessible to anyone with the URL. Use this only for temporary testing and switch back to **Private** or stop port forwarding when finished.
