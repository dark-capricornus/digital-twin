/**
 * WebSocket Handler (Decoupled)
 * Purely handles connection and raw data extraction.
 * Writes UNPROCESSED data to StateManager buffer.
 */

class WebSocketHandler {
    constructor(url, stateManager, onStatusChange) {
        this.url = url;
        this.stateManager = stateManager;
        this.onStatusChange = onStatusChange;
        this.ws = null;
        this.isConnected = false;
        this.reconnectInterval = 3000;
        this.reconnectTimer = null;
    }

    connect() {
        try {
            if (this.ws) this.ws.close();
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected');
                this.isConnected = true;
                this.onStatusChange('connected');
                if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) { console.error('[WebSocket] Parse error:', error); }
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                this.onStatusChange('disconnected');
                this.scheduleReconnect();
            };
        } catch (error) {
            this.onStatusChange('disconnected');
            this.scheduleReconnect();
        }
    }

    handleMessage(data) {
        if (!data.topic || !data.payload) return;
        const payload = data.payload;

        // [USER] Case 0: Industrial Bridge OPC Batch (Direct ID mapping)
        if (data.topic === 'opc/batch' && data.type === 'json') {
            Object.keys(payload).forEach(devId => {
                const devData = payload[devId];
                const state = this.extractState(devData);
                this.stateManager.setRawState(devId, state, devData);
            });
            return;
        }

        // Case 1: Legacy Batch JSON (devices map)
        if (data.type === 'json' && payload.devices) {
            const systemKeys = ['topic', 'type', 'timestamp', 'source', 'status', 'connected_clients', 'active'];
            Object.keys(payload.devices).forEach(rawId => {
                if (systemKeys.includes(rawId.toLowerCase())) return;
                const devId = this._extractDeviceId(rawId, payload.devices[rawId]);
                if (devId) {
                    this.stateManager.setRawState(devId, this.extractState(payload.devices[rawId]), payload.devices[rawId]);
                }
            });
        } 
        // Case 2: Individual Device Update or Flat Payload
        else {
            const state = this.extractState(payload);
            const deviceId = this._extractDeviceId(data.topic, payload);
            if (deviceId) {
                this.stateManager.setRawState(deviceId, state, payload);
            }
        }
    }

    setManifest(manifest) {
        this.siteManifest = manifest;
    }

    _extractDeviceId(topic, payload) {
        if (!topic) return null;

        // 1. Precise Match: Topic contains a known sim_id or plc_path from manifest
        if (this.siteManifest && this.siteManifest.machines) {
            const topicUpper = topic.toUpperCase();
            for (const [id, config] of Object.entries(this.siteManifest.machines)) {
                if (topicUpper.includes(id) || 
                    (config.sim_id && topicUpper.includes(config.sim_id)) ||
                    (config.plc_path && topicUpper.includes(config.plc_path.toUpperCase()))) {
                    return id;
                }
            }
        }

        // 2. Sparkplug B format fallback: spBv1.0/group/.../unit/DEVICE_ID
        const parts = topic.split('/');
        if (parts.length >= 5) {
            const id = parts[parts.length - 1].trim().toUpperCase();
            if (this._isValidMachineId(id)) return id;
        }

        // 3. Fallback: check payload for device_id/id fields
        const payloadId = payload?.device_id || payload?.id;
        if (payloadId && typeof payloadId === 'string' && this._isValidMachineId(payloadId)) {
            return payloadId.toUpperCase();
        }

        // 4. Special Case: Plant-wide data
        if (topic.includes('Plant') || topic.includes('FACTORY')) return 'PLANT';

        return null;
    }

    _isValidMachineId(id) {
        if (!id) return false;
        if (this.siteManifest && this.siteManifest.machines) {
            return !!this.siteManifest.machines[id.toUpperCase()];
        }
        // Legacy fallback
        const machineIds = ['FURNACE', 'DEGASSER', 'LPDC', 'CNC', 'HEAT', 'INSPECTION', 'PAINT', 'COOLING', 'XRAY', 'QC', 'PRETREAT', 'OUTBOUND', 'SHIPPING'];
        return machineIds.some(m => id.toUpperCase().includes(m));
    }



    extractState(payload) {
        if (!payload || typeof payload !== 'object') return null;
        const stateKeys = ['State', 'state', 'Status', 'status', 'current_state'];
        for (const key of stateKeys) {
            if (payload[key] !== undefined) {
                const val = payload[key];
                if (typeof val === 'string' && ['connected', 'disconnected', 'online', 'offline'].includes(val.toLowerCase())) continue;
                return val;
            }
        }
        const runningKey = Object.keys(payload).find(k => ['isrunning', 'is_running', 'enabled'].includes(k.toLowerCase()));
        if (runningKey !== undefined) {
            const val = payload[runningKey];
            return (val === true || val === 1 || val === 'true') ? 'Running' : 'Stopped';
        }
        return null;
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
    }

    sendCommand(deviceId, command, value = null) {
        if (!this.isConnected || !this.ws) {
            console.error('[WebSocket] Cannot send command: Not connected');
            return false;
        }

        const payload = {
            topic: `spBv1.0/factory/DCMD/unit/${deviceId}`,
            type: 'command',
            timestamp: Date.now(),
            payload: {
                command: command,
                value: value,
                device_id: deviceId
            }
        };

        try {
            this.ws.send(JSON.stringify(payload));
            console.log(`[WebSocket] Command sent: ${command} -> ${deviceId}`);
            return true;
        } catch (error) {
            console.error('[WebSocket] Send error:', error);
            return false;
        }
    }
}

export default WebSocketHandler;
