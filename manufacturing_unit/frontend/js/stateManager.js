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
        this.deviceStates = new Map(); // Processed Source of Truth: deviceId → { state, color, lastUpdate, data }
        this.stateBuffer = new Map();  // Buffered Raw Updates: deviceId → { state, payload }
        this.listeners = [];
    }

    /**
     * Buffer raw state from WebSocket.
     * [ARCHITECTURE] No direct processing or UI updates here.
     */
    setRawState(rawId, state, payload) {
        // Alias storage_*/inbound_*/buffer_*/raw_materials → rawmaterials so they share one entry in all views
        let id = rawId.toLowerCase();
        if (id.startsWith('storage') || id.startsWith('inbound') || id.startsWith('buffer') || id === 'raw_materials') {
            id = 'rawmaterials';
        }
        // Merge payloads when multiple source IDs alias to the same target
        // (e.g. INBOUND_01 + STORAGE_01 both → rawmaterials) so neither side wins/loses fields.
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
            const color = this.getColorForState(update.state, update.payload);
            const existing = this.deviceStates.get(id);

            if (existing) {
                // Mutate in-place: avoids { ...50tags, ...50tags } = 100 property copies per device per cycle
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
        let key = rawId.toLowerCase();
        if (key.startsWith('storage') || key.startsWith('inbound') || key.startsWith('buffer') || key === 'raw_materials') {
            key = 'rawmaterials';
        }
        
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
