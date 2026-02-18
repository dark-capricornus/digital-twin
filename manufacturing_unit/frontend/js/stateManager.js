/**
 * State Manager
 * Maintains device state and applies color mapping rules
 */

class StateManager {
    constructor() {
        this.deviceStates = new Map(); // deviceId -> {state, color}
        this.listeners = [];
    }

    /**
     * Update device state and determine color
     * @param {string} deviceId - Device identifier
     * @param {string} state - Device state (e.g., "Running", "Stopped", "Idle")
     */
    updateDeviceState(rawId, state) {
        const deviceId = rawId.toLowerCase();
        const color = this.getColorForState(state);
        
        this.deviceStates.set(deviceId, {
            state: state,
            color: color,
            lastUpdate: Date.now()
        });

        // Notify listeners
        this.listeners.forEach(callback => {
            callback(deviceId, color, state);
        });
    }

    /**
     * Apply color mapping rules (v1)
     * @param {string} state - Device state
     * @returns {number} - Hex color code
     */
    getColorForState(state) {
        if (state === undefined || state === null) return 0x808080; // Gray for unknown

        const stateString = String(state).toLowerCase();
        
        // 1. ACTIVE / RUNNING (GREEN) - High Priority
        const runningKeywords = ['running', 'active', 'heating', 'melting', 'pouring', 'processing', 'enabled', 'true', 'on'];
        if (runningKeywords.some(k => stateString.includes(k))) return 0x00cc00; // VIBRANT GREEN

        // 2. IDLE / WAITING (YELLOW)
        const idleKeywords = ['idle', 'waiting', 'starved', 'blocked', 'ready', 'paused'];
        if (idleKeywords.some(k => stateString.includes(k))) return 0xffd700; // GOLD/YELLOW

        // 3. STOPPED / FAULT (RED)
        const stopKeywords = ['stopped', 'stop', 'fault', 'error', 'offline', 'disabled', 'false', '0', '0.0', 'off', 'failure'];
        if (stopKeywords.some(k => stateString.includes(k))) return 0xcc0000; // DEEP RED

        // 4. Numerical values (if > 0 assume active/running)
        if (typeof state === 'number' && !isNaN(state)) {
             return state > 0 ? 0x00cc00 : 0xcc0000;
        }
        
        // 5. Activity keywords fallback
        const activityTerms = ['count', 'kg', 'produced', 'progress', 'throughput', 'degassed', 'temp', 'rpm', 'pressure', 'val', 'current', 'part'];
        if (activityTerms.some(term => stateString.includes(term))) {
            return 0x00cc00; // VIBRANT GREEN
        }

        return 0xcc0000; // Default to RED if unknown/stopped-like
    }

    /**
     * Register a callback for state changes
     * @param {Function} callback - (deviceId, color, state) => void
     */
    onStateChange(callback) {
        this.listeners.push(callback);
    }

    /**
     * Get current state for a device
     * @param {string} deviceId
     * @returns {Object|null}
     */
    getDeviceState(rawId) {
        return this.deviceStates.get(rawId.toLowerCase()) || null;
    }

    /**
     * Get all device states
     * @returns {Map}
     */
    getAllStates() {
        return this.deviceStates;
    }

    /**
     * Get device count
     * @returns {number}
     */
    getDeviceCount() {
        return this.deviceStates.size;
    }
}

export default StateManager;
