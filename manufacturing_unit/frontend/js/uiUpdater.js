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
        // [ARCHITECTURE] setInterval handler must be zero-work.
        // consumeBuffer() spread-merges all device payloads (20+ devices × 50+ tags) which can
        // exceed 50ms on batch WebSocket updates. Moving everything into rAF guarantees the
        // interval tick always returns in <1ms regardless of payload size.
        requestAnimationFrame(() => {
            const updatedIds = this.stateManager.consumeBuffer();

            if (updatedIds.size > 0 && this.app.renderer) {
                this.app.renderer.applyUpdatedIds(updatedIds);
            }

            // Analytics MUST run before the early-exit gate — virtual kWh/production
            // accumulation is time-based and must tick every cycle regardless of WebSocket activity.
            const hierarchy = this.app.analytics.update(this.stateManager.deviceStates, this.app.machineGroups);
            const plant = hierarchy.plant;

            // Early exit: skip DOM work if nothing changed and not in energy mode.
            if (updatedIds.size === 0 && !this.app.forceRefresh && this.app.primaryMode !== 'energy') {
                return;
            }
            this.app.forceRefresh = false;

            // 2. V1.2 Unified Sidebar — Build section data from active asset
            if (this.app.sidebar?.isInitialized) {
                const sidebarData = this._buildSidebarData(hierarchy, plant);
                this.app.sidebar.update(sidebarData);

                // Update asset pill status dots
                this.app.sidebar.updateAssetStatuses((id) => {
                    return (this.app._getMachineState(id) || 'OFFLINE').toLowerCase();
                });
            }

            // 4. Left Sidebar (Targeted Structural Check)
            const leftSidebar = this._getDomElement('left-sidebar');
            if (leftSidebar && leftSidebar.classList.contains('open')) {
                const leftNavList = this._getDomElement('left-nav-list');
                const activeType = leftNavList?.getAttribute('data-active-type');
                const activeId = leftNavList?.getAttribute('data-active-id');

                const targetCtx = this.app.getLeftSidebarContext();
                if (activeType !== targetCtx.type || (activeId || null) !== (targetCtx.id || null)) {
                    this.app.renderLeftSidebar(hierarchy);
                } else {
                    this.updateAllDeviceLists(hierarchy);
                    if (activeType === 'zones_scope' || activeType === 'zone') {
                        this.updateZones(hierarchy);
                    } else if (activeType === 'gemba') {
                        this.updateGemba(hierarchy);
                    }
                }
            }

            // 5. Alarm Chip
            this.updateAlarmChip();
        });
    }

    updateAllDeviceLists(hierarchy) {
        // [STRICT RENDER] Updates status and telemetry in the sidebar lists without rebuilding the DOM.
        
        // 1. Update Machine Status across all lists
        Object.keys(hierarchy.machines).forEach(mid => {
            const m = hierarchy.machines[mid];
            const statusEl = this._getDomElement(`status-${mid}`);
            if (statusEl) {
                const state = (m.state || (m.isRunning ? 'running' : '') || 'OFFLINE').toUpperCase();
                const color = state === 'RUNNING' || state === 'NORMAL' ? 'var(--success)' : 
                             (['FAULT', 'ALARM', 'ERROR', 'STOPPED'].includes(state) ? 'var(--danger)' : 'var(--text-dim)');
                statusEl.style.background = color;
                statusEl.style.boxShadow = (color === 'var(--success)') ? '0 0 6px var(--success)66' : 'none';
            }
            
            // 2. Targeted Spent Update for Sidebar List — use analytics engine (same source as right sidebar)
            const spentEl = this._getDomElement(`list-spent-${mid}`);
            if (spentEl) {
                const analyticsM = this.app.analytics.data.machines[mid.toUpperCase()];
                const kwh = (analyticsM?.totalKWh || 0).toFixed(2);
                if (spentEl.textContent !== `${kwh} kWh`) spentEl.textContent = `${kwh} kWh`;
            }

            // 3. [USER] Targeted Production Update for Sidebar List (Zone details)
            const prodEl = this._getDomElement(`metric-${mid}-production`);
            if (prodEl) {
                const prod = Math.round(m.production || 0).toLocaleString();
                if (prodEl.textContent !== prod) prodEl.textContent = prod;
            }

            // 4. [USER] Generic Tag-based Metric updates (Department cards)
            // Scans for any metric-${mid}-TAG elements and updates them from the analytics engine
            const tags = ['Instant_kW', 'Total_kWh', 'Production_Count', 'Shot_Count', 'Part_Count', 'Inspected_Count', 'Temperature'];
            tags.forEach(tagRef => {
                // Handle different possible tag name variations
                const possibleTags = [tagRef, `${mid}_${tagRef}`, `PB1_${tagRef}`, `PB2_${tagRef}`, `PT_${tagRef}`, `LPDC_${tagRef}`, `CNC_${tagRef}`, `XRay_${tagRef}`, `Furnace_${tagRef}`, `HT_${tagRef}`, `Cooling_${tagRef}`];
                possibleTags.forEach(tag => {
                    const el = this._getDomElement(`metric-${mid}-${tag}`);
                    if (el) {
                        const tl = tag.toLowerCase();
                        const val = tl.includes('kwh') ? m.totalKWh :
                                   tl.includes('kw') ? m.instantKW :
                                   (tl.includes('temp') ? m.data?.[tag] : m.production);
                        const valNode = el.querySelector('.val-text') || el;
                        const formatted = typeof val === 'number' ? (tl.includes('kw') || tl.includes('kwh') ? val.toFixed(2) : Math.round(val).toLocaleString()) : (val || '0.0');
                        if (valNode.textContent !== formatted) valNode.textContent = formatted;
                    }
                });
            });
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
            if (val === undefined || val === null) return;
            const el = this._getDomElement(id);
            if (!el) return;
            const formatted = typeof val === 'number' ?
                (id === 'plant-kw' || id === 'plant-epu' ? val.toFixed(2) : Math.round(val).toLocaleString()) :
                (val || '---');
            if (el.textContent !== formatted) el.textContent = formatted;
        });

        // Plant Running / Alarm counts — scoped to machineGroups
        // Running = machine is powered on (IsRunning / Enabled flag from payload)
        // Alarm   = machine in fault/error/stopped state
        const plantIds = Object.values(this.app.machineGroups || {}).flat();
        let running = 0, alarms = 0;
        plantIds.forEach(id => {
            const s = this.stateManager.getDeviceState(id);
            if (!s) return;
            const d = s.data || {};
            const isRunning = d.IsRunning ?? d.is_running ?? d.Enabled ?? d.enabled;
            if (isRunning === true) running++;
            const st = (s.state || '').toLowerCase();
            if (['fault', 'error', 'stopped', 'alarm'].includes(st)) alarms++;
        });
        const total = plantIds.length;
        const runEl = this._getDomElement('plant-running');
        if (runEl) {
            const txt = `${running} / ${total}`;
            if (runEl.textContent !== txt) runEl.textContent = txt;
        }
        const alarmEl = this._getDomElement('plant-alarm-count');
        if (alarmEl) {
            const txt = String(alarms);
            if (alarmEl.textContent !== txt) alarmEl.textContent = txt;
        }
        const alarmLabelEl = this._getDomElement('plant-alarm-label');
        if (alarmLabelEl) {
            const label = alarms === 0 ? 'clear' : (alarms === 1 ? 'alarm' : 'alarms');
            if (alarmLabelEl.textContent !== label) alarmLabelEl.textContent = label;
            alarmLabelEl.style.color = alarms > 0 ? 'var(--danger)' : 'var(--text-dim)';
        }
        const alarmCard = this._getDomElement('kpi-alarm-card');
        if (alarmCard) alarmCard.classList.toggle('has-alarms', alarms > 0);
    }

    updateZones(hierarchy) {
        Object.keys(hierarchy.zones).forEach(zoneId => {
            const data = hierarchy.zones[zoneId];
            if (!data) return;
            
            // 1. Sidebar List Item updates
            const prodListEl = this._getDomElement(`metric-${zoneId}-production`);
            if (prodListEl) {
                const text = `${Math.round(data.production || 0).toLocaleString()}`;
                if (prodListEl.textContent !== text) prodListEl.textContent = text;
            }

            const utilBarEl = this._getDomElement(`bar-${zoneId}-utilization`);
            if (utilBarEl) {
                const width = `${(data.utilization || 0).toFixed(1)}%`;
                if (utilBarEl.style.width !== width) utilBarEl.style.width = width;
            }

            // 2. Zone Detail Panel updates (if in detail view)
            const kpis = {
                'instantKW': (v) => `${(v || 0).toFixed(1)}`,
                'production': (v) => `${Math.round(v || 0).toLocaleString()}`,
                'inProcess': (v) => `${Math.round(v || 0).toLocaleString()}`,
                'energyPerUnit': (v) => `${(v || 0).toFixed(2)}`,
                'scrapRate': (v) => `${(v || 0).toFixed(2)}`,
                'efficiency': (v) => `${(v || 94.2).toFixed(1)}`,
                'utilization': (v) => `${(v || 0).toFixed(1)}`
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
        const state = this.app._getMachineState(id);
        // Use damped health from healthStates to avoid random fluctuation
        const health = (this.app.healthStates && this.app.healthStates.has(id))
            ? Math.round(this.app.healthStates.get(id).health)
            : 85;
        this.updateDeviceMetadata(id, state, health);
    }

    updateDeviceMetadata(id, state, health) {
        // Update State Badge
        const stateEl = this._getDomElement(`metric-${id}-state`);
        if (stateEl) {
            const stateUpper = String(state).toUpperCase();
            const valNode = stateEl.querySelector('.val-text') || stateEl;
            if (valNode.textContent !== stateUpper) {
                valNode.textContent = stateUpper;
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

    updateMachineProductionPanel(id) {
        // Update production schema tags from WebSocket data (device + plant)
        const deviceData = this.stateManager.getDeviceState(id)?.data || {};
        const plantData = this.stateManager.getDeviceState('PLANT')?.data || {};
        const deviceType = this.app.getDeviceType(id);
        const schema = deviceType ? this.app.sidebarSchemas[deviceType] : null;
        if (!schema) return;

        for (const [groupName, tags] of Object.entries(schema)) {
            const gn = groupName.toUpperCase();
            if (!(gn.includes('PRODUCTION') || gn.includes('OUTPUT') || gn.includes('INVENTORY'))) continue;
            for (const tag of tags) {
                const el = this._getDomElement(`metric-${id}-${tag}`);
                if (!el) continue;
                let val = this.app.getValue(deviceData, tag);
                if ((val === undefined || val === null) && tag.startsWith('Plant_')) {
                    val = this.app.getValue(plantData, tag);
                }
                if (val !== undefined && val !== null) {
                    const valNode = el.querySelector('.val-text') || el;
                    const formatted = typeof val === 'number' ?
                        (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2)) : String(val);
                    if (valNode.textContent !== formatted) valNode.textContent = formatted;
                }
            }
        }
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

    /**
     * Build structured data for V1.2 Sidebar — 5 sections
     * 1. Asset Details, 2. Plant Data, 3. Production, 4. Alarms, 5. Maintenance
     */
    _buildSidebarData(hierarchy, plant) {
        const sidebar = this.app.sidebar;
        const assetId = sidebar.currentAssetId;
        const deviceState = assetId ? this.stateManager.getDeviceState(assetId) : null;
        const raw = deviceState?.data || {};
        const deviceType = assetId ? this.app.getDeviceType(assetId) : null;
        const schema = deviceType ? this.app.sidebarSchemas[deviceType] : null;
        const machineData = assetId ? this.app._findMachineData(assetId) : null;

        return {
            asset: this._buildAssetDetails(assetId, raw, schema, machineData),
            plant: this._buildPlantData(plant, hierarchy),
            production: this._buildProductionData(assetId, raw, schema, machineData, plant),
            alarms: this._buildAlarms(assetId, raw, hierarchy),
            maintenance: this._buildMaintenance(assetId),
        };
    }

    // ─── Icon resolver ─────────────────────────────────────
    _getIcon(tag) {
        const lower = tag.toLowerCase();
        const map = {
            'temperature': 'thermostat', 'temp': 'thermostat',
            'pressure': 'speed', 'psi': 'speed', 'bar': 'speed', 'riser': 'speed', 'holding': 'speed',
            'kw': 'bolt', 'power': 'bolt',
            'kwh': 'battery_charging_full', 'energy': 'battery_charging_full',
            'production': 'inventory_2', 'count': 'inventory_2', 'output': 'inventory_2', 'part': 'precision_manufacturing',
            'speed': 'shutter_speed', 'rpm': 'shutter_speed', 'spindle': 'shutter_speed',
            'flow': 'water_drop', 'humidity': 'humidity_percentage', 'water': 'water_drop',
            'time': 'timer', 'timer': 'timer', 'cycle': 'refresh',
            'running': 'power_settings_new', 'status': 'info', 'mode': 'tune',
            'capacity': 'warehouse', 'ingot': 'inventory_2',
            'metal': 'science', 'molten': 'local_fire_department',
            'air': 'air', 'booth': 'meeting_room', 'conveyor': 'conveyor_belt',
            'rotor': 'rotate_right', 'gas': 'propane',
            'scan': 'qr_code_scanner', 'inspection': 'search',
            'reject': 'cancel', 'ok': 'check_circle', 'ng': 'cancel', 'good': 'check_circle',
            'die': 'thermostat', 'fill': 'water_drop', 'solidification': 'ac_unit',
            'cooling': 'ac_unit', 'dryer': 'air', 'step': 'format_list_numbered',
        };
        for (const [key, icon] of Object.entries(map)) {
            if (lower.includes(key)) return icon;
        }
        return 'analytics';
    }

    _fv(v) {
        if (v === undefined || v === null) return '---';
        if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
        if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
        return String(v);
    }

    // ─── 1. Asset Details (static metadata from assets.json) ───
    _buildAssetDetails(assetId, raw, schema, machineData) {
        if (!assetId) return [{ icon: 'info', value: 'Select an asset', unit: '', color: 'var(--text-dim)' }];

        const items = [];
        const asset = this.app._findAsset(assetId);

        if (asset) {
            if (asset.model) items.push({ icon: 'precision_manufacturing', value: asset.model, unit: '', color: 'var(--text-dim)' });
            if (asset.serial_number) items.push({ icon: 'tag', value: asset.serial_number, unit: '', color: 'var(--text-dim)' });
            if (asset.vendor) items.push({ icon: 'storefront', value: asset.vendor, unit: '', color: 'var(--text-dim)' });
            if (asset.department) items.push({ icon: 'domain', value: asset.department, unit: '', color: 'var(--text-dim)' });
            if (asset.install_date) items.push({ icon: 'event', value: asset.install_date, unit: '', color: 'var(--text-dim)' });
            if (asset.icon) items.push({ icon: asset.icon, value: assetId, unit: '', color: 'var(--primary)' });
        } else {
            items.push({ icon: 'help', value: 'No metadata', unit: '', color: 'var(--text-dim)' });
        }

        return items;
    }

    // ─── 2. Plant Data (plant-level KPIs) ──────────────────────
    _buildPlantData(plant, hierarchy) {
        const items = [];
        const p = plant || {};

        items.push({ icon: 'bolt', value: this._fv(p.instantKW), unit: 'kW', color: 'var(--warning)' });
        items.push({ icon: 'battery_charging_full', value: this._fv(p.totalKWh), unit: 'kWh', color: 'var(--text-dim)' });
        items.push({ icon: 'inventory_2', value: this._fv(p.production), unit: 'units', color: 'var(--success)' });
        items.push({ icon: 'speed', value: this._fv(p.utilization), unit: '%', color: 'var(--text-dim)' });
        items.push({ icon: 'monitoring', value: this._fv(p.oee || p.totalOEE), unit: '%', color: 'var(--primary)' });

        const allIds = Object.values(this.app.machineGroups || {}).flat();
        let running = 0;
        allIds.forEach(id => {
            const s = this.stateManager.getDeviceState(id);
            if (s?.data?.IsRunning === true || s?.data?.is_running === true) running++;
        });
        items.push({ icon: 'precision_manufacturing', value: `${running}/${allIds.length}`, unit: '', color: 'var(--success)' });

        return items;
    }

    // ─── 3. Production Data (live telemetry + production tags) ──
    _buildProductionData(assetId, raw, schema, machineData, plant) {
        const items = [];

        // All schema tags (except Status) as live telemetry
        if (schema) {
            for (const [groupName, tags] of Object.entries(schema)) {
                if (groupName.toUpperCase().includes('STATUS')) continue;
                for (const tag of tags) {
                    let val = this.app.getValue(raw, tag);
                    // Sync with analytics for kW/production
                    if (machineData) {
                        const tl = tag.toLowerCase();
                        if (tl.includes('kw') && !tl.includes('kwh')) val = machineData.instantKW ?? val;
                        else if (tl.includes('kwh')) val = machineData.totalKWh ?? val;
                    }
                    // Fallback to plant data for Plant_ prefixed tags
                    if ((val === undefined || val === null) && tag.startsWith('Plant_')) {
                        const plantData = this.stateManager.getDeviceState('PLANT')?.data || {};
                        val = this.app.getValue(plantData, tag);
                    }
                    items.push({
                        icon: this._getIcon(tag),
                        value: this._fv(val),
                        unit: this.app._getUnit(tag),
                        color: 'var(--text-dim)',
                    });
                }
            }
        }

        // Fallback if no schema
        if (items.length === 0 && machineData) {
            if (machineData.instantKW !== undefined) items.push({ icon: 'bolt', value: this._fv(machineData.instantKW), unit: 'kW', color: 'var(--text-dim)' });
            if (machineData.totalKWh !== undefined) items.push({ icon: 'battery_charging_full', value: this._fv(machineData.totalKWh), unit: 'kWh', color: 'var(--text-dim)' });
            if (machineData.production !== undefined) items.push({ icon: 'inventory_2', value: this._fv(machineData.production), unit: 'units', color: 'var(--text-dim)' });
        }

        return items;
    }

    // ─── 4. Alarms ─────────────────────────────────────────────
    _buildAlarms(assetId, raw, hierarchy) {
        const items = [];

        // Check all machines for alarm state
        const allIds = Object.values(this.app.machineGroups || {}).flat();
        for (const id of allIds) {
            const state = this.app._getMachineState(id);
            const stateLower = state.toLowerCase();
            const deviceRaw = this.stateManager.getDeviceState(id)?.data || {};
            const alarmTag = this.app.getValue(deviceRaw, 'Alarm_Status');
            const isFault = ['fault', 'error', 'alarm'].includes(stateLower);
            const hasAlarm = alarmTag === true || alarmTag === 'true' || alarmTag === 1 || isFault;

            if (hasAlarm) {
                items.push({
                    icon: 'error',
                    iconColor: 'var(--danger)',
                    title: id,
                    desc: `State: ${state}${alarmTag ? ' | Alarm active' : ''}`,
                    time: new Date().toTimeString().slice(0, 8),
                });
            }
        }

        if (items.length === 0) {
            items.push({
                icon: 'check_circle',
                iconColor: 'var(--success)',
                title: 'ALL CLEAR',
                desc: 'No active alarms across plant.',
                time: new Date().toTimeString().slice(0, 8),
            });
        }

        return items;
    }

    // ─── 5. Maintenance ────────────────────────────────────────
    _buildMaintenance(assetId) {
        // Pull from health states if available
        const items = [];
        const healthStates = this.app.healthStates;

        if (healthStates && healthStates.size > 0) {
            for (const [id, hState] of healthStates) {
                const rul = Math.floor(hState.rul);
                const health = Math.round(hState.health);
                if (health < 85 || rul < 1000) {
                    items.push({
                        icon: 'build',
                        iconColor: health < 75 ? 'var(--danger)' : 'var(--warning)',
                        title: id,
                        desc: `Health: ${health}% | RUL: ${rul.toLocaleString()}h`,
                        time: health < 75 ? 'URGENT' : 'SCHEDULED',
                    });
                }
            }
        }

        if (items.length === 0) {
            items.push({
                icon: 'check_circle',
                iconColor: 'var(--success)',
                title: 'ALL SYSTEMS NOMINAL',
                desc: 'No maintenance tasks pending.',
                time: '',
            });
        }

        return items;
    }

    clearCache() {
        this.domCache.clear();
    }

    _getDomElement(id) {
        if (this.domCache.has(id)) return this.domCache.get(id);
        const el = document.getElementById(id);
        // [PERF] Cache even null results to avoid redundant, expensive ID lookups for missing components
        this.domCache.set(id, el);
        return el;
    }
}

export default UIUpdater;
