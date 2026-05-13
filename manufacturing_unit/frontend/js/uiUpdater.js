/**
 * UI Updater (Decoupled)
 * Purely handles DOM updates.
 * Batches logic into throttled cycles to avoid layout thrashing.
 */
import { normalizeLabel } from './config/TagFormatting.js';

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

            // Status indicators run unconditionally — the navbar and the 3D
            // zone chips must keep reflecting WS/PLC state even when there are
            // no buffered updates (e.g. WS is up but no MQTT payload arrived).
            if (typeof this.app._updateNavbarPlcState === 'function') {
                this.app._updateNavbarPlcState();
            }
            
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
                const color = state === 'RUNNING' || state === 'NORMAL' ? '#00E676' : 
                             (['FAULT', 'ALARM', 'ERROR', 'STOPPED'].includes(state) ? '#FF3030' : '#888888');
                statusEl.style.background = color;
                statusEl.style.boxShadow = (color === '#00E676') ? '0 0 6px #00E67666' : 'none';
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
            const tags = ['instant_power', 'total_energy_consumed', 'production_count', 'shot_count', 'part_count', 'inspected_count', 'temperature'];
            tags.forEach(tagRef => {
                // Handle different possible tag name variations
                const possibleTags = [tagRef, `${mid}_${tagRef}`, `pb1_${tagRef}`, `pb2_${tagRef}`, `pt_${tagRef}`, `lpdc_${tagRef}`, `cnc_${tagRef}`, `xray_${tagRef}`, `furnace_${tagRef}`, `ht_${tagRef}`, `cooling_${tagRef}`];
                possibleTags.forEach(tag => {
                    const el = this._getDomElement(`metric-${mid}-${tag}`);
                    if (el) {
                        const tl = tag.toLowerCase();
                        const val = tl.includes('energy') ? m.totalKWh :
                                   tl.includes('power') ? m.instantKW :
                                   (tl.includes('temp') ? m.data?.[tag] : m.production);
                        const valNode = el.querySelector('.val-text') || el;
                        const formatted = typeof val === 'number' ? (tl.includes('power') || tl.includes('energy') ? val.toFixed(2) : Math.round(val).toLocaleString()) : (val || '0.0');
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
                deptStatusEl.style.background = isActive ? '#00E676' : '#888888';
                deptStatusEl.style.boxShadow = isActive ? '0 0 8px #00E67666' : 'none';
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
            alarmLabelEl.style.color = alarms > 0 ? '#FF3030' : '#888888';
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
     * Build structured data for V1.2 Sidebar — 7 PDF-compliant sections
     */
    _buildSidebarData(hierarchy, plant) {
        const sidebar = this.app.sidebar;
        const assetId = sidebar.currentAssetId;
        if (!assetId) return {};

        const deviceState = this.stateManager.getDeviceState(assetId);
        const raw = deviceState?.data || {};
        const machineData = this.app._findMachineData(assetId);
        const machineConfig = this.app.siteManifest?.machines?.[assetId];
        const deviceType = machineConfig ? machineConfig.type : this.app.getDeviceType(assetId);
        
        // Dictionary-driven grouping (from telemetry_dictionary.json)
        const dict = this.app.sidebarDictionary?.device_types?.[deviceType];

        const segments = [];

        // [PDF-ALIGNED] Bucket telemetry tags into the 4 sections from tag_report.pdf:
        //   Machine Metrics, Energy Consumption, Production Data, Status & Run Info.
        // The dictionary's `Telemetry` group is flat — classify by tag name pattern.
        const isEnergyTag = (t) => /(^|_)(power_kw|energy_kwh|instant_power|total_energy)/i.test(t);
        // Tags filtered out of the sidebar sections:
        //   - Header-bound (RUN + OPERATION): run_status, is_running, state,
        //     cycle_status, stage_status, scan_status, booth_cycle_status,
        //     furnace_mode, process_step, mode.
        //   - Already covered by Asset Info (assets.json): model_id.
        const isStatusTag = (t) => /^(run_status|is_running|state|cycle_status|stage_status|scan_status|booth_cycle_status|furnace_mode|process_step|mode|model_id)$/i.test(t);
        const isProductionTag = (t) => /(^|_)(count|cycle_time|fill_time|solidification_time|shot_count|part_count|progress|processed|inspected|good_part|reject|degassed_metal|capacity|accumulating|queue_in|queue_out)/i.test(t) && !/_status$|_mode$/i.test(t);
        const isAlarmTag = (t) => /^(alarm_status|fault)$/i.test(t);

        if (dict) {
            const buckets = { metrics: [], energy: [], production: [] };
            const seen = new Set();

            Object.entries(dict).forEach(([groupName, tags]) => {
                if (!Array.isArray(tags)) return;
                const lowerGroup = groupName.toLowerCase();
                if (['inputs', 'asset', 'alarms', 'maintenance'].includes(lowerGroup)) return;

                tags.forEach(t => {
                    if (seen.has(t)) return;
                    seen.add(t);
                    if (isAlarmTag(t)) return;
                    // Status/Run tags are surfaced in the header (RUN / UPTIME / OPERATION),
                    // not as their own section.
                    if (isStatusTag(t)) return;
                    if (isEnergyTag(t)) buckets.energy.push(t);
                    else if (isProductionTag(t)) buckets.production.push(t);
                    else buckets.metrics.push(t);
                });
            });

            const sectionDefs = [
                { key: 'metrics',    title: 'MACHINE METRICS',    accent: '#06B6D4', layout: 'list'  },
                { key: 'energy',     title: 'ENERGY CONSUMPTION', accent: '#F97316', layout: 'split' },
                { key: 'production', title: 'PRODUCTION DATA',    accent: '#22C55E', layout: 'list'  },
            ];

            sectionDefs.forEach(def => {
                const tagList = buckets[def.key];
                if (!tagList.length) return;
                const items = tagList.map(t => this._buildStructuredItem(t, raw, machineData));
                segments.push({
                    id: def.key,
                    title: def.title,
                    accent: def.accent,
                    layout: def.layout,
                    items: (def.layout === 'split') ? this._padSplit(items) : items
                });
            });
        }

        // [USER] Alarms & Maintenance are global sections but filtered for the active asset
        const assetAlarms = this._buildAlarms(assetId, raw, hierarchy).filter(a => a.title === assetId || a.title === 'ALL CLEAR');
        segments.push({
            id: 'alarms',
            title: 'ALARMS',
            accent: '#EF4444',
            layout: 'list',
            items: assetAlarms
        });

        const assetMaintenance = this._buildMaintenance(assetId);
        segments.push({
            id: 'maintenance',
            title: 'MAINTENANCE',
            accent: '#F59E0B',
            layout: 'list',
            items: assetMaintenance
        });

        // [USER] Asset Info (Static metadata from assets.json) - LAST
        const assetInfo = this._buildAssetInfo(assetId);
        segments.push({
            id: 'asset',
            title: 'ASSET INFO',
            accent: '#94A3B8',
            layout: 'list',
            items: assetInfo
        });

        // [HEADER] Pull run + operation status straight from the WS payload so the
        // header slots below the machine name carry the live values.
        const runStatusRaw =
            this.app.getValue(raw, 'run_status') ??
            this.app.getValue(raw, 'state') ??
            machineData?.state ??
            (machineData?.isRunning ? 'RUNNING' : 'OFFLINE');

        // Operation = "what is it doing right now" — type-specific resolver if the
        // dictionary names one, else first hit among the common cycle/mode tags.
        const opCandidates = [
            'cycle_status', 'stage_status', 'scan_status', 'booth_cycle_status',
            'furnace_mode', 'process_step', 'mode'
        ];
        // Operation = "what is it doing right now" — distinct from runStatus.
        // The dictionary's state_resolver typically points to State/run_status
        // (already used for the RUN slot), so prefer the cycle/mode candidates
        // and fall back to state_resolver only if none of them carry a value.
        let opStatus;
        for (const k of opCandidates) {
            const v = this.app.getValue(raw, k);
            if (v != null && v !== '') { opStatus = v; break; }
        }
        if (opStatus == null && dict?.state_resolver &&
            !/^(state|run_status)$/i.test(dict.state_resolver)) {
            opStatus = this.app.getValue(raw, dict.state_resolver);
        }
        if (opStatus == null) opStatus = 'NORMAL';

        return {
            uptime: machineData?.runtime != null ? Math.round(machineData.runtime * 60) : 0,
            runStatus: String(runStatusRaw),
            opStatus: String(opStatus).toUpperCase(),
            segments
        };
    }

    _buildAssetInfo(assetId) {
        const metadata = (this.app.assetData && this.app.assetData[assetId]) ? this.app.assetData[assetId] : null;
        if (!metadata) return [{ label: 'METADATA', value: 'NOT FOUND', unit: '' }];

        return [
            { label: 'LAST SERVICE', value: metadata.last_service_date || '---', unit: '' },
            { label: 'NEXT SERVICE', value: metadata.next_service_date || '---', unit: '' },
            { label: 'SERIAL NO', value: metadata.serial_number || '---', unit: '' },
            { label: 'MODEL', value: metadata.model || '---', unit: '' },
            { label: 'VENDOR', value: metadata.vendor || '---', unit: '' },
            { label: 'INSTALL DATE', value: metadata.install_date || '---', unit: '' },
            { label: 'PURCHASE DATE', value: metadata.purchase_date || '---', unit: '' }
        ];
    }

    _getSegmentStyle(groupName) {
        const lower = groupName.toLowerCase();
        if (lower === 'metrics' || lower === 'status') return { title: 'MACHINE METRICS', accent: '#06B6D4', layout: 'list' };
        if (lower === 'energy') return { title: 'ENERGY CONSUMPTION', accent: '#F97316', layout: 'split' };
        if (lower === 'production') return { title: 'PRODUCTION DATA', accent: '#22C55E', layout: 'split' };
        if (lower === 'inventory') return { title: 'INVENTORY METRICS', accent: '#A855F7', layout: 'list' };
        if (lower === 'plant_wip') return { title: 'WIP INVENTORY', accent: '#EC4899', layout: 'list' };
        if (lower === 'maintenance') return { title: 'MAINTENANCE', accent: '#F59E0B', layout: 'list' };
        if (lower === 'asset') return { title: 'ASSET INFO', accent: '#94A3B8', layout: 'list' };
        
        return { 
            title: groupName.replace(/_/g, ' ').toUpperCase(), 
            accent: '#94A3B8', 
            layout: 'list' 
        };
    }

    _padSplit(arr) {
        if (arr.length === 0) return [{label: '---', value: '---'}, {label: '---', value: '---'}];
        if (arr.length === 1) return [arr[0], {label: '---', value: '---'}];
        return [arr[0], arr[1]];
    }

    _discoverTags(assetId) {
        if (!this.app.tagMetadata) return [];
        const tags = [];

        const normAssetId = assetId.toLowerCase().replace(/[^a-z0-9]/g, '');

        // RAWMATERIALS has no dedicated folder in tags.json — it's an aggregate of
        // INBOUND_01. Pull tags and dedupe.
        const targetNames = [normAssetId];

        const findFolderRecursive = (folder, target) => {
            if (!folder || !folder.name) return null;
            const normFolderName = folder.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normFolderName === target) return folder;
            if (folder.tags) {
                for (const child of folder.tags) {
                    if (child.tagType === 'Folder') {
                        const found = findFolderRecursive(child, target);
                        if (found) return found;
                    }
                }
            }
            return null;
        };

        const seen = new Set();
        targetNames.forEach(target => {
            const folder = findFolderRecursive(this.app.tagMetadata, target);
            if (!folder) return;
            const folderTags = [];
            this._extractAllTagsRecursive(folder, folderTags);
            folderTags.forEach(t => {
                if (!seen.has(t)) { seen.add(t); tags.push(t); }
            });
        });

        return tags;
    }

    _extractAllTagsRecursive(folder, results) {
        if (!folder.tags) return;
        folder.tags.forEach(t => {
            if (t.tagType === 'AtomicTag') {
                results.push(t.name);
            } else if (t.tagType === 'Folder') {
                // Flatten sub-folders (e.g., Status, Inputs) into the main device list
                this._extractAllTagsRecursive(t, results);
            }
        });
    }

    // Map raw tags.json names → PDF display labels (unit-free, title case).
    _normalizeLabel(tag) {
        return normalizeLabel(tag);
    }

    _buildStructuredItem(tag, raw, machineData, overrideLabel = null) {
        const val = this._resolveTagValue(tag, raw, machineData);
        const label = overrideLabel || this._normalizeLabel(tag);
        const unit = this.app._getUnit(tag);
        
        return {
            tag,
            label,
            value: this._fv(val),
            unit: unit,
            status: this._resolveStatus(val, tag)
        };
    }

    _resolveStatus(val, tag) {
        if (val === undefined || val === null || typeof val !== 'number') return 'GREEN';
        
        // Define some thresholds
        const thresholds = {
            'Temperature': 750,
            'kW': 50,
            'Load': 90,
            'Pressure': 100
        };

        let t = 100; // Default
        const lowerTag = tag.toLowerCase();
        if (lowerTag.includes('temp')) t = thresholds['Temperature'];
        else if (lowerTag.includes('kw')) t = thresholds['kW'];
        else if (lowerTag.includes('load')) t = thresholds['Load'];
        else if (lowerTag.includes('pressure')) t = thresholds['Pressure'];

        if (val >= t) return 'RED';
        if (val >= t * 0.8) return 'AMBER';
        return 'GREEN';
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

    // ─── Helper: resolve tag value from raw data ──────────────
    _resolveTagValue(tag, raw, machineData) {
        let val = this.app.getValue(raw, tag);
        if (machineData) {
            const tl = tag.toLowerCase();
            if (tl.includes('kw') && !tl.includes('kwh')) val = machineData.instantKW ?? val;
            else if (tl.includes('kwh')) val = machineData.totalKWh ?? val;
        }
        // Fallback removed as Plant_ tags are now mapped to specific machine states
        return val;
        return val;
    }

    _buildTagItem(tag, raw, machineData) {
        const val = this._resolveTagValue(tag, raw, machineData);
        return {
            icon: this._getIcon(tag),
            label: tag.replace(/^[A-Z]+_/, '').replace(/_/g, ' '),
            value: this._fv(val),
            unit: this.app._getUnit(tag),
            color: 'var(--text-dim)',
        };
    }

    // ─── 2. Plant Data (device-specific: energy, temp, process) ──
    _buildPlantData(assetId, raw, schema, machineData) {
        const allItems = [];
        const plantGroups = ['Core Energy', 'Temperature', 'Process', 'Environment', 'Pressure', 'Storage Status', 'Inventory'];

        if (schema) {
            for (const [groupName, tags] of Object.entries(schema)) {
                if (!plantGroups.some(g => groupName.toUpperCase().includes(g.toUpperCase()))) continue;
                for (const tag of tags) {
                    allItems.push(this._buildTagItem(tag, raw, machineData));
                }
            }
        }

        // Fallback
        if (allItems.length === 0 && machineData) {
            if (machineData.instantKW !== undefined) allItems.push({ icon: 'bolt', label: 'Power', value: this._fv(machineData.instantKW), unit: 'kW', color: 'var(--warning)' });
            if (machineData.totalKWh !== undefined) allItems.push({ icon: 'battery_charging_full', label: 'Energy', value: this._fv(machineData.totalKWh), unit: 'kWh', color: 'var(--text-dim)' });
        }

        // Dedup: keep first item per icon, rest go to detail
        const seen = new Set();
        const summary = [];
        const detail = [];
        for (const item of allItems) {
            if (!seen.has(item.icon)) {
                seen.add(item.icon);
                summary.push(item);
            } else {
                detail.push(item);
            }
        }
        return { summary, detail, all: allItems };
    }

    // ─── 3. Production Data (output counts only) ──────────────────
    _buildProductionData(assetId, raw, schema, machineData) {
        const allItems = [];
        const prodGroups = ['Production', 'Output'];

        if (schema) {
            for (const [groupName, tags] of Object.entries(schema)) {
                if (!prodGroups.some(g => groupName.toUpperCase().includes(g.toUpperCase()))) continue;
                for (const tag of tags) {
                    allItems.push(this._buildTagItem(tag, raw, machineData));
                }
            }
        }

        // Fallback
        if (allItems.length === 0 && machineData) {
            if (machineData.production !== undefined) allItems.push({ icon: 'inventory_2', label: 'Production', value: this._fv(machineData.production), unit: 'units', color: 'var(--text-dim)' });
        }

        // Dedup: keep first item per icon, rest go to detail
        const seen = new Set();
        const summary = [];
        const detail = [];
        for (const item of allItems) {
            if (!seen.has(item.icon)) {
                seen.add(item.icon);
                summary.push(item);
            } else {
                detail.push(item);
            }
        }
        return { summary, detail, all: allItems };
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
                    label: id,
                    value: state,
                    status: 'RED'
                });
            }
        }

        if (items.length === 0) {
            items.push({
                label: 'STATUS',
                value: 'ALL CLEAR',
                status: 'GREEN'
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
                        label: id,
                        value: `${health}% Health`,
                        status: health < 75 ? 'RED' : 'AMBER'
                    });
                }
            }
        }

        if (items.length === 0) {
            items.push({
                label: 'STATUS',
                value: 'NOMINAL',
                status: 'GREEN'
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
