/**
 * UI Updater (Decoupled)
 * Purely handles DOM updates.
 * Batches logic into throttled cycles to avoid layout thrashing.
 */

class UIUpdater {
    constructor(app, stateManager) {
        this.app = app;
        this.stateManager = stateManager;
        this.domCache = new Map();
        this.updateInterval = 500; // [ARCHITECTURE] Optimized 2Hz update rate
        this.timer = null;
    }

    start() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.cycle(), this.updateInterval);
    }

    startUpdateLoop() {
        this.start();
    }

    cycle() {
        // [ARCHITECTURE] UI Update Loop
        // Process all buffered changes since the last cycle
        const updatedIds = this.stateManager.consumeBuffer();

        // Queue label updates for the rAF loop — keeps setInterval non-blocking
        if (updatedIds.size > 0 && this.app.renderer) {
            this.app.renderer.applyUpdatedIds(updatedIds);
        }

        if (updatedIds.size === 0 && !this.app.forceRefresh) return;
        this.app.forceRefresh = false;

        // 1. Update Global Analytics (Hierarchy)
        const hierarchy = this.app.analytics.update(this.stateManager.deviceStates, this.app.machineGroups);
        const plant = hierarchy.plant;

        // 2. Targeted Dashboard Updates (KPI Row)
        this.updateDashboard(plant);
        this.updateTopStrip(plant);

        // 3. Update Detail Sidebar (Targeted)
        const activeCtx = this.app.activeContext;
        if (activeCtx.id && ['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(activeCtx.type)) {
            const data = this.stateManager.getDeviceState(activeCtx.id)?.data;
            if (data) {
                this.updateLiveSidebar(activeCtx.id, data);
                
                // [SPECIFIC] Energy Panel update
                if (this.app.primaryMode === 'energy') {
                    this.app.updateDeviceEnergyPanel(activeCtx.id, data);
                }
            }
        }

        // 4. Update Left Sidebar (Targeted Structural Check)
        const leftSidebar = this._getDomElement('left-sidebar');
        if (leftSidebar && leftSidebar.classList.contains('open')) {
            const leftNavList = this._getDomElement('left-nav-list');
            const activeType = leftNavList?.getAttribute('data-active-type');
            const activeId = leftNavList?.getAttribute('data-active-id');

            // [LOGIC FIX] Normalized Structural Integrity Check
            const targetCtx = this.app.getLeftSidebarContext();
            const domId = activeId || null;
            const targetId = targetCtx.id || null;
            
            if (activeType !== targetCtx.type || domId !== targetId) {
                this.app.renderLeftSidebar(hierarchy);
                return;
            }

            // [STABILITY] Targeted Label Updates (No Flicker)
            this.updateAllDeviceLists(hierarchy);

            if (activeType === 'zones_scope' || activeType === 'zone') {
                this.updateZones(hierarchy);
            } else if (activeType === 'gemba') {
                this.updateGemba(hierarchy);
            }
        }

        // 5. Update Alarm Chip
        this.updateAlarmChip();
    }

    updateAllDeviceLists(hierarchy) {
        // [STRICT RENDER] Updates status and telemetry in the sidebar lists without rebuilding the DOM.
        
        // 1. Update Machine Status across all lists
        Object.keys(hierarchy.machines).forEach(mid => {
            const m = hierarchy.machines[mid];
            const statusEl = this._getDomElement(`status-${mid}`);
            if (statusEl) {
                const state = (m.state || 'OFFLINE').toUpperCase();
                const color = state === 'RUNNING' || state === 'NORMAL' ? 'var(--success)' : 
                             (['FAULT', 'ALARM', 'ERROR', 'STOPPED'].includes(state) ? 'var(--danger)' : 'var(--text-dim)');
                statusEl.style.background = color;
                statusEl.style.boxShadow = (color === 'var(--success)') ? '0 0 6px var(--success)66' : 'none';
            }
            
            // 2. [USER] Targeted Load Update for Sidebar List
            const loadEl = this._getDomElement(`list-load-${mid}`);
            if (loadEl) {
                const val = (m.instantKW || 0).toFixed(2);
                if (loadEl.textContent !== val) {
                    loadEl.textContent = val;
                }
            }
        });

        // 2. Update Department/Category Status in Plant Overview
        const departments = hierarchy.departments || hierarchy.zones || {};
        Object.keys(departments).forEach(deptId => {
            const dept = departments[deptId];
            const deptStatusEl = this._getDomElement(`dept-status-${deptId}`);
            if (deptStatusEl) {
                // [LOGIC] Zones don't have a status, so we derive it from machine states
                const status = dept.status || (dept.instantKW > 0 ? 'RUNNING' : 'IDLE');
                // textContent removal: transitioning to color-only indicator dots
                const isActive = status === 'RUNNING' || status === 'NORMAL' || status === 'STABLE';
                deptStatusEl.style.background = isActive ? 'var(--success)' : 'var(--text-dim)';
                deptStatusEl.style.boxShadow = isActive ? '0 0 8px var(--success)66' : 'none';
            }
        });
    }

    updateDashboard(plant) {
        const mapping = {
            'plant-kw': plant.instantKW,
            'plant-prod': plant.production,
            'plant-oee': plant.oee,
            'plant-epu': plant.energyPerUnit,
            'plant-util': plant.utilization
        };

        Object.entries(mapping).forEach(([id, val]) => {
            if (val === undefined || val === null) return; // Anti-Blink Guard
            const el = this._getDomElement(id);
            if (!el) return;
            
            const formatted = typeof val === 'number' ? 
                (id === 'plant-kw' || id === 'plant-epu' ? val.toFixed(2) : Math.round(val).toLocaleString()) : 
                (val || '---');
                
            if (el.textContent !== formatted) {
                el.textContent = formatted;
            }
        });
    }

    updateZones(hierarchy) {
        Object.keys(hierarchy.zones).forEach(zoneId => {
            const data = hierarchy.zones[zoneId];
            if (!data) return;
            
            // 1. Sidebar List Item updates
            const prodListEl = this._getDomElement(`metric-${zoneId}-production`);
            if (prodListEl) {
                const text = `${Math.round(data.production || 0).toLocaleString()} unit`;
                if (prodListEl.textContent !== text) prodListEl.textContent = text;
            }

            const utilBarEl = this._getDomElement(`bar-${zoneId}-utilization`);
            if (utilBarEl) {
                const width = `${(data.utilization || 0).toFixed(1)}%`;
                if (utilBarEl.style.width !== width) utilBarEl.style.width = width;
            }

            // 2. Zone Detail Panel updates (if in detail view)
            const kpis = {
                'instantKW': (v) => `${(v || 0).toFixed(2)}`,
                'production': (v) => `${Math.round(v || 0).toLocaleString()}`,
                'energyPerUnit': (v) => `${(v || 0).toFixed(2)}`,
                'scrapRate': (v) => `${(v || 0).toFixed(2)}%`
            };

            Object.entries(kpis).forEach(([key, formatter]) => {
                const val = data[key];
                if (val === undefined || val === null) return; // Anti-Blink Guard
                
                const el = this._getDomElement(`metric-${zoneId}-${key}`);
                if (el) {
                    const formatted = formatter(val);
                    const valNode = el.querySelector('.val-text') || el;
                    if (valNode.textContent !== formatted) {
                        valNode.textContent = formatted;
                    }
                }
            });
        });
    }

    updateTopStrip(plant) {
        const overallStatus = this._getDomElement('overall-status');
        if (overallStatus) {
            overallStatus.textContent = plant.status || 'STABLE';
            overallStatus.className = `status-value ${plant.status?.toLowerCase() || 'stable'}`;
        }
    }

    updateKPIRow(plant) {
        const kpis = {
            'plant-performance': plant.performance,
            'plant-availability': plant.availability,
            'plant-quality': plant.quality
        };
        Object.entries(kpis).forEach(([id, val]) => {
            const el = this._getDomElement(id);
            if (el) el.textContent = `${(val || 0).toFixed(1)}%`;
        });
    }

    updateLiveSidebar(id, data) {
        const type = this.app.getDeviceType(id);
        const schema = this.app.sidebarSchemas[type];
        if (!schema) return;

        Object.values(schema).flat().forEach(tag => {
            const val = this.app.getValue(data, tag);
            // [USER] Anti-Blink Guard: Skip update if tag is missing in this packet
            if (val !== undefined && val !== null) {
                const el = this._getDomElement(`metric-${id}-${tag}`);
                if (el) {
                    const valNode = el.querySelector('.val-text') || el;
                    const formatted = this.app.formatValue(val, tag);
                    if (valNode.textContent !== formatted) {
                        valNode.textContent = formatted;
                    }
                }
            }
        });

        // Also update standard metadata if present (State, Health)
        const state = (this.stateManager.getDeviceState(id)?.state || 'OFFLINE');
        const health = Math.floor(Math.random() * 20 + 80); // Placeholder for logic
        this.updateDeviceMetadata(id, state, health);
    }

    updateDeviceMetadata(id, state, health) {
        // Update State Badge
        const stateEl = this._getDomElement(`metric-${id}-state`);
        if (stateEl) {
            const stateUpper = String(state).toUpperCase();
            if (stateEl.textContent !== stateUpper) {
                stateEl.textContent = stateUpper;
                const container = stateEl.closest('.state-badge-container');
                if (container) {
                    const color = state.toLowerCase() === 'running' ? 'var(--success)' : 
                                 (['fault', 'error', 'stopped'].includes(state.toLowerCase()) ? 'var(--danger)' : 'var(--text-dim)');
                    container.style.background = `${color}22`;
                    container.style.borderColor = `${color}44`;
                    container.style.color = color;
                }
            }
        }

        // Update Health Score
        const healthEl = this._getDomElement(`metric-${id}-health-score`);
        if (healthEl) {
            const healthText = `${health}%`;
            if (healthEl.textContent !== healthText) healthEl.textContent = healthText;
        }

        const healthBar = this._getDomElement(`bar-${id}-health`);
        if (healthBar) {
            const width = `${health}%`;
            if (healthBar.style.width !== width) healthBar.style.width = width;
        }

        // [USER] Update Diagnostic elements (Damped Health/RUL)
        if (this.app.healthStates && this.app.healthStates.has(id)) {
            const hState = this.app.healthStates.get(id);
            const healthScore = Math.round(hState.health);
            const rul = Math.floor(hState.rul);
            
            const diagHealth = this._getDomElement(`diag-${id}-health`);
            if (diagHealth && diagHealth.textContent !== `${healthScore}%`) {
                diagHealth.textContent = `${healthScore}%`;
                const diagBar = this._getDomElement(`diag-bar-${id}-health`);
                if (diagBar) diagBar.style.width = `${healthScore}%`;
            }
            
            const diagRul = this._getDomElement(`diag-${id}-rul`);
            if (diagRul && diagRul.textContent !== rul.toLocaleString()) {
                diagRul.textContent = rul.toLocaleString();
            }
        }
    }

    updateGemba(hierarchy) {
        if (!this.app.gembaTimer) return;
        const currentIds = this.app.gembaActiveIds || [];
        
        // 1. Progress Step info
        const stepEl = this._getDomElement('gemba-step-info');
        if (stepEl) {
            const text = `Step ${this.app.gembaIndex + 1} of ${this.app.gembaWaypoints.length}`;
            if (stepEl.textContent !== text) stepEl.textContent = text;
        }

        // 2. Waypoint name
        const nameEl = this._getDomElement('gemba-waypoint-name');
        if (nameEl) {
            const text = this.app.gembaWaypoints[this.app.gembaIndex].label;
            if (nameEl.textContent !== text) nameEl.textContent = text;
        }

        // 3. Current active machine telemetry in the Gemba Panel
        currentIds.forEach(id => {
            const state = this.stateManager.getDeviceState(id);
            if (state?.data) this.updateLiveSidebar(id, state.data);
        });
    }

    updateAlarmChip() {
        const chip = this._getDomElement('alarm-chip');
        if (!chip) return;
        let alarmCount = 0;
        this.stateManager.deviceStates.forEach(s => {
            if (['fault', 'error', 'stopped'].includes((s.state || '').toLowerCase())) alarmCount++;
        });
        chip.textContent = alarmCount === 0 ? 'Clear' : `${alarmCount} Alarm${alarmCount > 1 ? 's' : ''}`;
        chip.classList.toggle('has-alarms', alarmCount > 0);
    }

    _getDomElement(id) {
        if (this.domCache.has(id)) return this.domCache.get(id);
        const el = document.getElementById(id);
        if (el) this.domCache.set(id, el);
        return el;
    }
}

export default UIUpdater;
