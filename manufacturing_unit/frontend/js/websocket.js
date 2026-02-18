/**
 * WebSocket Connection Handler
 * Connects to backend WebSocket and processes incoming device state messages
 */

class WebSocketHandler {
    constructor(url, onMessage, onStatusChange) {
        this.url = url;
        this.onMessage = onMessage;
        this.onStatusChange = onStatusChange;
        this.ws = null;
        this.reconnectInterval = 3000;
        this.reconnectTimer = null;
        
        // Diagnostic heartbeat to verify script is running
        setInterval(() => {
            if (this.ws) {
                console.log(`[WebSocket] Heartbeat - State: ${this.getReadyStateText()} | URL: ${this.url}`);
            }
        }, 5000);
    }

    getReadyStateText() {
        if (!this.ws) return 'NULL';
        const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        return states[this.ws.readyState] || 'UNKNOWN';
    }

    /**
     * Establish WebSocket connection
     */
    connect() {
        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected to', this.url);
                this.onStatusChange('connected');
                
                // Clear reconnect timer
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };

            this.ws.onmessage = (event) => {
                console.log("[RAW WS MESSAGE]", event.data);
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('[WebSocket] Parse error:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocket] Error:', error);
            };

            this.ws.onclose = () => {
                console.log('[WebSocket] Disconnected');
                this.onStatusChange('disconnected');
                this.scheduleReconnect();
            };

        } catch (error) {
            console.error('[WebSocket] Connection failed:', error);
            this.onStatusChange('disconnected');
            this.scheduleReconnect();
        }
    }

    /**
     * Aggressively search for a state value in a payload object
     */
    extractState(payload) {
        if (!payload || typeof payload !== 'object') return null;
        
        const keys = Object.keys(payload);
        
        // 1. Direct/Common keys (Precise match)
        const commonKeys = ['status', 'state', 'value', 'State', 'Status', 'val', 'current_state', 'IsRunning', 'is_running'];
        for (const key of commonKeys) {
            if (payload[key] !== undefined) return payload[key];
        }

        // 2. Suffix match (e.g., "Device Control/Status")
        const suffixes = ['/Status', '/State', '/is_running', '/IsRunning', '_status', '_state'];
        for (const key of keys) {
            for (const suffix of suffixes) {
                if (key.endsWith(suffix)) return payload[key];
            }
        }

        // 3. Contains match
        for (const key of keys) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes('status') || lowerKey.includes('state')) {
                return payload[key];
            }
        }

        // 4. Boolean IsRunning fallback
        const isRunningKey = keys.find(k => k.toLowerCase().includes('isrunning') || k.toLowerCase().includes('running'));
        if (isRunningKey) {
            const val = payload[isRunningKey];
            if (typeof val === 'boolean') return val ? 'Running' : 'Stopped';
            return val;
        }

        // 5. Counter-only fallback (e.g., Inspection unit)
        // If it sends telemetry but no state, assume it's at least "Active"
        const activityKeywords = ['count', 'kg', 'rejected', 'passed', 'produced', 'progress', 'throughput', 'degassed', 'temperature', 'rpm', 'pressure', 'val', 'current', 'part', 'ingot'];
        if (keys.some(k => activityKeywords.some(kw => k.toLowerCase().includes(kw)))) {
            return 'Active';
        }

        return null;
    }

    handleMessage(data) {
        if (!data.topic || !data.payload) return;
        
        const payload = data.payload;

        // --- Case 1: Batch JSON Object (Gateway Format) ---
        if (data.type === 'json' && !payload.metrics && !data.topic.includes('spBv1.0')) {
            const deviceMap = payload.devices || payload;
            
            // Filter out system keys and the bridge status heartbeat
            const systemKeys = ['topic', 'type', 'timestamp', 'source', 'status', 'connected_clients', 'active'];
            const deviceIds = Object.keys(deviceMap).filter(k => !systemKeys.includes(k.toLowerCase()));
            
            if (deviceIds.length > 0) {
                let processedCount = 0;
                deviceIds.forEach(rawId => {
                    const deviceId = rawId.trim();
                    const state = this.extractState(deviceMap[rawId]);
                    if (state !== null && state !== undefined) {
                        this.onMessage(deviceId, state, deviceMap[rawId]);
                        processedCount++;
                    }
                });
                if (processedCount > 0) {
                    console.log(`[WebSocket] Processed batch of ${processedCount} devices`);
                    return;
                }
            }
        }

        // --- Case 2: Individual Device Update (Sparkplug or JSON) ---
        const parts = data.topic.split('/');
        if (parts.length >= 5) {
            const deviceId = parts[4].trim();
            
            // Skip system/runtime topics if they don't look like machines
            if (deviceId.toLowerCase() === 'runtime' || deviceId.toLowerCase() === 'plc') return;

            const state = this.extractState(payload);

            if (state !== null && state !== undefined) {
                console.log(`[WebSocket] Update: ${deviceId} = ${state}`);
                this.onMessage(deviceId, state, payload);
                return;
            }
        }

        // Fallback logging for unhandled messages that look like they should contain data
        if (data.topic.includes('DDATA') || data.topic.includes('state')) {
            console.warn(`[WebSocket] Unparsed message on ${data.topic}. Payload keys:`, Object.keys(payload));
        }
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectTimer) return;
        
        this.onStatusChange('connecting');
        this.reconnectTimer = setTimeout(() => {
            console.log('[WebSocket] Attempting to reconnect...');
            this.connect();
        }, this.reconnectInterval);
    }

    /**
     * Close connection
     */
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

export default WebSocketHandler;
