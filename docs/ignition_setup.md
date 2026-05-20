# Ignition SCADA Setup Guide

This guide describes how to connect **Inductive Automation Ignition** to the Digital Twin's VirtualPLC and import the pre-configured tags.

## 1. Prerequisites
- **Ignition Gateway** installed and running (8.1+ recommended).
- **Digital Twin Backend** running (VirtualPLC OPC UA server active on port 4840).

---

## 2. Connect to the OPC UA Server
1. Open the **Ignition Gateway Webpage** (default: `http://localhost:8088`).
2. Navigate to **Config > OPC Client > OPC Connections**.
3. Click **Create new OPC Connection**.
4. Select **OPC UA** and click **Next**.
5. **Discovery URL**: Enter `opc.tcp://localhost:4840` (Update `localhost` if the backend is on a different machine).
6. Click **Discover**.
7. Select the **VirtualPLC Service** from the list and click **Next**.
8. **Connection Name**: Enter `Alloywheel_industry` (This must match the `opcServer` property in `tags_v2.json`).
9. Finish the wizard. Ensure the status changes to **Connected**.

---

## 3. Import Tags
1. Open **Ignition Designer**.
2. In the **Tag Browser** panel, select the **Tags** root or a target folder.
3. Right-click and select **Import Tags**.
4. Browse to the following file in your project directory:
   `d:\digital_twin\docs\tags_v2.json`
5. Click **Open**.
6. You should now see the `Production_Floor`, `PLC`, and `Plant_Analytics` folders in your Tag Browser.

---

## 4. Global PLC Control
The simulation is **gated by the PLC Power State**. By default, it starts in `OFF` mode.

### **To Start Simulation:**
- Navigate to the `PLC/Start` tag.
- Write `True` to the tag.
- The `PLC/State` tag will transition: `OFF` → `STARTING` → `RUNNING`.
- Once `RUNNING`, all machines will begin their production cycles.

### **To Stop Simulation:**
- Write `True` to the `PLC/Stop` tag.
- The simulation will complete current tasks and transition to `OFF`.

---

## 5. Troubleshooting
- **Tags are "Bad_NotFound"**: Check the Namespace index. The backend uses `ns=2`. If your Ignition connection is using a different index, you may need to update the `opcItemPath` in the tags.
- **Connection Refused**: Ensure the backend service is running and port `4840` is not blocked by a firewall.
- **Read-Only Tags**: Control tags (`Start`/`Stop`) are writable, while Status tags (`State`, `Progress`, etc.) are read-only from the simulation.

---

**Project Files Reference:**
- Tags Export: [tags_v2.json](file:///d:/digital_twin/docs/tags_v2.json)
- Site Manifest: [site_manifest.json](file:///d:/digital_twin/docs/manifests/site_manifest.json)
