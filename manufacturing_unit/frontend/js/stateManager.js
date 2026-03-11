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
        this.deviceStates = new Map(); // deviceId → { state, color, lastUpdate }
        this.listeners = [];
    }

    /**
     * Update device state and compute colour.
     * @param {string} rawId
     * @param {string|boolean|number} state  – canonical state from extractState()
     * @param {object} [fullData]            – full telemetry payload (optional)
     */
    updateDeviceState(rawId, state, fullData = null) {
        const deviceId = rawId.toLowerCase();

        // Preserve existing state if new state is null (partial telemetry payload)
        let resolvedState = state;
        if (resolvedState === null && this.deviceStates.has(deviceId)) {
            resolvedState = this.deviceStates.get(deviceId).state;
        }

        const color = this.getColorForState(resolvedState, fullData);

        this.deviceStates.set(deviceId, {
            state: resolvedState,
            color,
            lastUpdate: Date.now()
        });

        this.listeners.forEach(cb => cb(deviceId, color, resolvedState));
    }

    /**
     * Map a machine state to a hex mesh colour.
     *
     * Rules are applied in strict priority order.  Loose substring matches on
     * 'true' / 'false' have been removed — they caused healthy OFF machines to
     * flash green/red whenever another telemetry field happened to serialise a
     * boolean.
     *
     * @param {string|boolean|number} state
     * @param {object|null} fullData  – raw payload, used to check IsRunning / Enabled
     * @returns {number} hex colour
     */
    getColorForState(state, fullData = null) {

        // ── Guard ─────────────────────────────────────────────────────────
        if (state === undefined || state === null) return 0x2b2b2b; // Solid neutral grey

        const s = String(state).toLowerCase().trim();

        // ── 0. Override: if IsRunning or Enabled is explicitly false in the
        //       payload, the machine MUST NOT show green — even if State says
        //       'IDLE' which could otherwise be ambiguous.
        if (fullData) {
            const isRunning = fullData['IsRunning'] ?? fullData['is_running'];
            const enabled = fullData['Enabled'] ?? fullData['enabled'];

            // If the machine is explicitly off, clamp to STOPPED colour
            if (isRunning === false || enabled === false) {
                // Only apply the override for non-running state strings.
                // ('Running' + IsRunning=true is the normal running path.)
                const isRunningState = ['running', 'active', 'heating', 'melting',
                    'pouring', 'processing'].some(k => s.includes(k));
                if (!isRunningState) return 0x616161; // Solid Grey (STOPPED)
            }
        }

        // ── 1. RUNNING / ACTIVE → #00A651 ───────────────────────────────
        const runningWords = [
            'running', 'active', 'heating', 'melting', 'pouring', 'processing', 'enabled'
        ];
        if (runningWords.some(k => s.includes(k))) return 0x00A651;

        // ── 2. IDLE / WAITING → #FFC107 ────────────────────────────────────
        const idleWords = ['idle', 'waiting', 'starved', 'blocked', 'ready', 'paused'];
        if (idleWords.some(k => s.includes(k))) return 0xFFC107;

        // ── 3. STOPPED / FAULT / MAINTENANCE ────────────────────────────────
        if (s.includes('maintenance')) return 0x1976D2;

        const stoppedWords = [
            'stopped', 'stop', 'fault', 'error', 'offline', 'disabled', 'failure', 'off'
        ];
        if (stoppedWords.some(k => s.includes(k))) return 0xD32F2F; // FAULT RED

        // Final fallback for explicitly stopped (Grey)
        if (s === 'stopped') return 0x616161;

        // ── 4. Numeric state ──────────────────────────────────────────────
        if (!isNaN(Number(s)) && s !== '') {
            return Number(s) > 0 ? 0x00A651 : 0xD32F2F;
        }

        // ── 5. Unknown / unrecognised → grey ─────────────────────────────
        return 0x616161;
    }

    onStateChange(callback) {
        this.listeners.push(callback);
    }

    getDeviceState(rawId) {
        const key = rawId.toLowerCase();
        // 1. Exact match
        if (this.deviceStates.has(key)) return this.deviceStates.get(key);
        // 2. Fuzzy match (strip non-alphanumeric)
        const normKey = key.replace(/[^a-z0-9]/g, '');
        for (const [storedKey, val] of this.deviceStates.entries()) {
            if (storedKey.replace(/[^a-z0-9]/g, '') === normKey) return val;
        }
        return null;
    }

    getAllStates() {
        return this.deviceStates;
    }

    getDeviceCount() {
        return this.deviceStates.size;
    }
}

export default StateManager;
