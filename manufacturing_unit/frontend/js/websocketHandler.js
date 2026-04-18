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

        // Extract Canonical State
        const state = this.extractState(payload);

        // [ARCHITECTURE] Robust Device ID Extraction
        const deviceId = this._extractDeviceId(data.topic, payload);
        if (!deviceId) return;

        // Case 1: Batch JSON (devices map)
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
            this.stateManager.setRawState(deviceId, state, payload);
        }
    }

    _extractDeviceId(topic, payload) {
        if (!topic) return null;

        // 1. Try common Sparkplug B format: spBv1.0/group/.../unit/DEVICE_ID
        const parts = topic.split('/');
        if (parts.length >= 5) {
            const id = parts[parts.length - 1].trim().toUpperCase();
            if (this._isValidMachineId(id)) return id;
        }

        // 2. Try OPC Path format: VirtualPLC.Devices.DEVICE_ID.Status
        // Look for known machine prefixes with numbers
        const machinePattern = /(FURNACE|DEGASSER|LPDC|CNC|HEAT|INSPECTION|PAINT|COOLING|XRAY|QC|PRETREAT|OUTBOUND|RAWMATERIALS|SHIPPING)[_]*(\d+)/i;
        const match = topic.match(machinePattern);
        if (match) {
            const prefix = match[1].toUpperCase();
            const num = match[2].padStart(2, '0');
            return `${prefix}_${num}`;
        }

        // 3. Fallback: check payload for device_id/id fields
        const payloadId = payload?.device_id || payload?.id;
        if (payloadId && typeof payloadId === 'string' && this._isValidMachineId(payloadId)) {
            return payloadId.toUpperCase();
        }

        // 4. Special Case: Plant-wide data
        if (topic.includes('Plant') || topic.includes('FACTORY')) return 'PLANT';

        // 5. Direct Prefix check for name-only matches
        const machineIds = ['FURNACE', 'DEGASSER', 'LPDC', 'CNC', 'HEAT', 'INSPECTION', 'PAINT', 'COOLING', 'XRAY', 'QC', 'PRETREAT', 'OUTBOUND', 'RAWMATERIALS', 'SHIPPING'];
        const upperTopic = topic.toUpperCase();
        for (const m of machineIds) {
            if (upperTopic.includes(m)) {
                const subMatch = upperTopic.match(new RegExp(`${m}[_]*(\\d+)`));
                if (subMatch) return `${m}_${subMatch[1].padStart(2, '0')}`;
                return m; // Return base name if no number found (e.g. RAWMATERIALS)
            }
        }

        return null;
    }

    _isValidMachineId(id) {
        if (!id) return false;
        const machineIds = ['FURNACE', 'DEGASSER', 'LPDC', 'CNC', 'HEAT', 'INSPECTION', 'PAINT', 'COOLING', 'XRAY', 'QC', 'PRETREAT', 'OUTBOUND', 'RAWMATERIALS', 'SHIPPING'];
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
