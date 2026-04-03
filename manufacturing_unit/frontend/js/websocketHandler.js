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

        // Case 1: Batch JSON
        if (data.type === 'json' && !payload.metrics && !data.topic.includes('spBv1.0')) {
            const deviceMap = payload.devices || payload;
            const systemKeys = ['topic', 'type', 'timestamp', 'source', 'status', 'connected_clients', 'active'];
            
            Object.keys(deviceMap).forEach(rawId => {
                if (systemKeys.includes(rawId.toLowerCase())) return;
                const devicePayload = deviceMap[rawId];
                if (devicePayload && typeof devicePayload === 'object') {
                    // [ARCHITECTURE] Push to Buffer
                    this.stateManager.setRawState(rawId, this.extractState(devicePayload), devicePayload);
                }
            });
        } 
        // Case 2: Individual Device
        else {
            const parts = data.topic.split('/');
            if (parts.length >= 5) {
                const deviceId = parts[4].trim();
                const skipIds = ['runtime', 'plc', 'plant', 'commands'];
                if (!skipIds.includes(deviceId.toLowerCase())) {
                    // [ARCHITECTURE] Push to Buffer
                    this.stateManager.setRawState(deviceId, state, payload);
                }
            }
        }
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
