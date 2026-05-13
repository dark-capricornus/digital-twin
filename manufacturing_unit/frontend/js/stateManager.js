/**
 * State Manager
 * Maintains device state and applies colour-mapping rules.
 *
 * Colour priority (highest → lowest):
 *   RUNNING      – #00A651
 *   IDLE         – #FFC107
 *   FAULT        – #D32F2F
 *   STOPPED      – #616161
 *   MAINTENANCE  – #1976D2
 */

class StateManager {
    constructor() {
        this.deviceStates = new Map();
        this.stateBuffer = new Map();
        this.listeners = [];
        this.dictionary = null;
        this.siteManifest = null;
    }

    setDictionary(dict) {
        this.dictionary = dict;
    }

    setManifest(manifest) {
        this.siteManifest = manifest;
    }

    /**
     * Buffer raw state from WebSocket.
     * [ARCHITECTURE] No direct processing or UI updates here.
     */
    setRawState(rawId, state, payload) {
        let id = rawId.toUpperCase();

        // [DYNAMIC] Check for alias/mapping in manifest
        if (this.siteManifest && this.siteManifest.machines) {
            const config = this.siteManifest.machines[id];
            // If the machine config defines a specific ID mapping, use it
            // (Reserved for future complex mappings)
        }

        const existing = this.stateBuffer.get(id);
        if (existing) {
            this.stateBuffer.set(id, {
                state: state || existing.state,
                payload: { ...existing.payload, ...payload },
                timestamp: Date.now()
            });
        } else {
            this.stateBuffer.set(id, { state, payload, timestamp: Date.now() });
        }
    }

    /**
     * Process buffered updates into the primary store.
     * Returns the set of IDs that were updated in this cycle.
     */
    consumeBuffer() {
        if (this.stateBuffer.size === 0) return new Set();

        const updatedIds = new Set();
        this.stateBuffer.forEach((update, id) => {
            const color = this.getColorForState(id, update.state, update.payload);
            const existing = this.deviceStates.get(id);

            if (existing) {
                Object.assign(existing.data, update.payload);
                existing.state = update.state;
                existing.color = color;
                existing.lastUpdate = update.timestamp;
            } else {
                this.deviceStates.set(id, {
                    state: update.state,
                    color,
                    lastUpdate: update.timestamp,
                    data: { ...update.payload }
                });
            }
            updatedIds.add(id);
            this.listeners.forEach(cb => cb(id, color, update.state));
        });

        this.stateBuffer.clear();
        return updatedIds;
    }

    /**
     * Map a machine state to a hex mesh colour using the telemetry dictionary.
     */
    getColorForState(id, state, fullData = null) {
        if (!this.dictionary || !this.siteManifest) return 0x616161;

        const machineConfig = this.siteManifest.machines[id];
        if (!machineConfig) return 0x616161;

        const typeConfig = this.dictionary.device_types[machineConfig.type];
        if (!typeConfig || !typeConfig.state_resolver) {
            // [FALLBACK] Use legacy logic if resolver is missing
            return this._getLegacyColor(state, fullData);
        }

        const resolver = typeConfig.state_resolver;
        // [USER] Support both string and object-based resolvers
        const sourceTag = typeof resolver === 'string' ? resolver : resolver.source_tag;
        const sourceVal = fullData ? fullData[sourceTag] : state;

        // 1. Exact match in mappings
        if (typeof resolver !== 'string' && resolver.mappings && resolver.mappings[String(sourceVal)]) {
            const hex = resolver.mappings[String(sourceVal)].color;
            return parseInt(hex.replace('#', '0x'), 16);
        }

        // 2. Boolean fallback if the machine is "Enabled" or "Running"
        const booleanTag = typeof resolver === 'string' ? null : resolver.boolean_fallback;
        if (booleanTag && fullData) {
            const isRunning = fullData[booleanTag];
            if (isRunning === false || isRunning === 'false' || isRunning === 0) {
                return 0x616161; // STOPPED
            }
        }

        return this._getLegacyColor(sourceVal, fullData);
    }

    _getLegacyColor(state, fullData) {
        if (state === undefined || state === null) return 0x616161;
        const s = String(state).toLowerCase().trim();

        if (fullData) {
            const isRunning = fullData['is_running'] ?? fullData['enabled'] ?? fullData['IsRunning'] ?? fullData['Enabled'];
            if (isRunning === false || isRunning === 'false' || isRunning === 0) return 0x616161;
        }

        const runningWords = ['running', 'active', 'heating', 'melting', 'pouring', 'processing', 'enabled', 'stable'];
        if (runningWords.some(k => s.includes(k))) return 0x00A651;

        const idleWords = ['idle', 'waiting', 'starved', 'blocked', 'ready', 'paused'];
        if (idleWords.some(k => s.includes(k))) return 0xFFC107;

        if (s.includes('maintenance')) return 0x1976D2;

        const stoppedWords = ['stopped', 'stop', 'fault', 'error', 'offline', 'disabled', 'failure', 'off'];
        if (stoppedWords.some(k => s.includes(k))) return 0xD32F2F;

        return 0x616161;
    }

    onStateChange(callback) {
        this.listeners.push(callback);
    }

    getDeviceState(rawId) {
        if (!rawId) return null;
        const key = rawId.toUpperCase();
        return this.deviceStates.get(key) || null;
    }

    getAllStates() {
        return this.deviceStates;
    }

    getDeviceCount() {
        return this.deviceStates.size;
    }
}

/**
 * [USER] Global helper to resolve state to color with blinking support for mixed zones.
 * Used by Renderer for 3D chips and Zone indicators.
 */
export function colorForState(state, format = 'hex') {
    if (!state) return format === 'hex' ? 0x616161 : '#616161';
    let s = state.toString().toUpperCase();

    let hex;
    if (s === 'MIXED') {
        // [USER] Blinking Effect: Toggle between Running (Green) and Idle (Amber)
        // Rate: 1Hz (500ms on, 500ms off)
        const isAmber = Math.floor(Date.now() / 500) % 2 === 0;
        hex = isAmber ? '#FFC107' : '#00A651';
    } else if (s === 'RUNNING' || s === 'NORMAL') {
        hex = '#00A651';
    } else if (s === 'IDLE' || s === 'WAITING' || s === 'STANDBY') {
        hex = '#FFC107';
    } else if (s === 'FAULT' || s === 'FAULTED' || s === 'ALARM' || s === 'ERROR') {
        hex = '#D32F2F';
    } else if (s === 'MAINTENANCE') {
        hex = '#1976D2';
    } else {
        hex = '#616161'; // STOPPED, OFFLINE, etc.
    }

    if (format === 'hex') {
        return parseInt(hex.replace('#', '0x'), 16);
    }
    return hex;
}

export default StateManager;
