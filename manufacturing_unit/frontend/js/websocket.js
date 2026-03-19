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
        this.isConnected = false;
        this.reconnectInterval = 3000;
        this.reconnectTimer = null;
    }

    getReadyStateText() {
        if (!this.ws) return 'NULL';
        const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        return states[this.ws.readyState] || 'UNKNOWN';
    }

    connect() {
        try {
            if (this.ws) {
                this.ws.close();
            }
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected to', this.url);
                this.isConnected = true;
                this.onStatusChange('connected');
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };

            this.ws.onmessage = (event) => {
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
                this.isConnected = false;
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
     * Derive a canonical state string from a device payload object.
     *
     * Priority order (strict):
     *  1. Explicit State / Status string key  → use as-is
     *  2. IsRunning / Enabled booleans        → 'Running' | 'Stopped'
     *  3. No recognisable signal              → null (message is skipped)
     *
     * The old "activity keywords" fallback has been removed — it was the
     * main cause of OFF machines being reported as 'Active' / green because
     * they still emitted numeric telemetry (Temperature, PressurePSI …).
     */
    extractState(payload) {
        if (!payload || typeof payload !== 'object') return null;

        // ── 1. Explicit state string (most reliable) ──────────────────────
        // Check 'State' before 'Status' — Status can be a gateway-level key
        // with values like 'connected' that should not drive machine colour.
        const stateKeys = ['State', 'state', 'Status', 'status', 'current_state'];
        for (const key of stateKeys) {
            if (payload[key] !== undefined) {
                const val = payload[key];
                // Reject gateway-level values that bleed into device messages
                if (typeof val === 'string' &&
                    ['connected', 'disconnected', 'connecting', 'online', 'offline'].includes(val.toLowerCase())) {
                    continue; // skip — this is a connection-status flag, not a machine state
                }
                return val;
            }
        }

        // ── 2. Boolean / numeric IsRunning / Enabled ──────────────────────
        // Only use these flags when no explicit state string is present.
        const runningKey = Object.keys(payload).find(k =>
            k.toLowerCase() === 'isrunning' || k.toLowerCase() === 'is_running' || k.toLowerCase() === 'enabled'
        );

        if (runningKey !== undefined) {
            const val = payload[runningKey];
            if (typeof val === 'boolean') return val ? 'Running' : 'Stopped';
            if (val === 1 || val === '1' || val === 'true') return 'Running';
            if (val === 0 || val === '0' || val === 'false') return 'Stopped';
        }

        // ── 3. Nothing usable — let caller skip this message ──────────────
        // Partial telemetry update without state/status keys.
        // Return null so we don't overwrite the existing running state.
        return null;
    }

    handleMessage(data) {
        if (!data.topic || !data.payload) return;

        const payload = data.payload;

        // ── Case 1: Batch JSON Object (digital-twin/state gateway format) ──
        if (data.type === 'json' && !payload.metrics && !data.topic.includes('spBv1.0')) {
            const deviceMap = payload.devices || payload;

            // Strip gateway-level envelope keys that are not machine IDs
            const systemKeys = [
                'topic', 'type', 'timestamp', 'source', 'status',
                'connected_clients', 'active'
            ];
            const deviceIds = Object.keys(deviceMap).filter(
                k => !systemKeys.map(s => s.toLowerCase()).includes(k.toLowerCase())
            );

            if (deviceIds.length > 0) {
                let processedCount = 0;
                deviceIds.forEach(rawId => {
                    const devicePayload = deviceMap[rawId];
                    if (!devicePayload || typeof devicePayload !== 'object') return;

                    const state = this.extractState(devicePayload);
                    // Pass null state forward so telemetry still updates
                    if (state !== undefined) {
                        this.onMessage(rawId.trim(), state, devicePayload);
                        processedCount++;
                    }
                });
                if (processedCount > 0) {
                    console.log(`[WebSocket] Batch processed: ${processedCount} devices`);
                    return;
                }
            }
        }

        // ── Case 2: Individual Device (Sparkplug B / single JSON) ─────────
        const parts = data.topic.split('/');
        if (parts.length >= 5) {
            const deviceId = parts[4].trim();

            // Skip Sparkplug system/runtime topics
            const skipIds = ['runtime', 'plc', 'plant', 'commands'];
            if (skipIds.includes(deviceId.toLowerCase())) return;

            const state = this.extractState(payload);

            // Pass null state forward so telemetry still updates
            if (state !== undefined) {
                if (state !== null) {
                    console.log(`[WebSocket] Update: ${deviceId} = ${state}`);
                }
                this.onMessage(deviceId, state, payload);
            }
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.onStatusChange('connecting');
        this.reconnectTimer = setTimeout(() => {
            console.log('[WebSocket] Attempting to reconnect...');
            this.connect();
        }, this.reconnectInterval);
    }

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
