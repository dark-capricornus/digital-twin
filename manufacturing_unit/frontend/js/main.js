/**
 * Main Application logic for Digital Twin
 * Hands-off discovery and precision mapping
 */

import SceneManager from './scene.js';
import WebSocketHandler from './websocket.js';
import StateManager from './stateManager.js';
import EnergyAnalytics from './EnergyAnalytics.js';

class DigitalTwinApp {
    constructor() {
        this.scene = null;
        this.stateManager = null;
        this.websocket = null;
        this.analytics = new EnergyAnalytics();
        this.activeContext = { type: 'plant', id: null };
        this.assetData = {};
        this.telemetryStore = new Map();

        // 3D Overlay Preferred Schemas (Extremely Minimalist)
        this.overlaySchemas = {
            'FURNACE': ['Temperature', 'Instant_kW'],
            'LPDC': ['Pressure_PSI', 'Instant_kW'],
            'CNC': ['Cycle_Status', 'Instant_kW'],
            'INSPECTION': ['Scan_Status', 'Instant_kW'],
            'PAINT': ['Cycle_Status', 'Instant_kW'],
            'OUTBOUND': ['Pallet_Count', 'Shipping_Status'],
            'PLANT': ['TotalWheelsProduced', 'TotalScrap']
        };

        // Strictly Appropriate Sidebar Telemetry Schemas (Grouped)
        // Aligned with tags_required.txt per device type
        this.sidebarSchemas = {
            'FURNACE': {
                'Core Energy': ['Furnace_Instant_kW', 'Furnace_Total_kWh'],
                'Temperature': ['Melt_Bath_Temperature', 'Roof_Temperature', 'Wall_Temperature'],
                'Status': ['Furnace_Mode', 'Furnace_Run_Status', 'Alarm_Status', 'Step_Timer']
            },
            'LPDC': {
                'Core Energy': ['LPDC_Instant_kW', 'LPDC_Total_kWh'],
                'Pressure': ['Riser_Pressure', 'Pressure_Setpoint', 'Holding_Pressure'],
                'Temperature': ['Holding_Furnace_Temperature', 'Die_Top_Temperature', 'Die_Bottom_Temperature'],
                'Time / Cycle': ['Cycle_Time', 'Fill_Time', 'Solidification_Time'],
                'Status': ['LPDC_Run_Status', 'Cycle_Status', 'Alarm_Status'],
                'Production': ['Shot_Count', 'Model_ID']
            },
            'CNC': {
                'Core Energy': ['CNC_Instant_kW', 'CNC_Total_kWh'],
                'Cycle / Program': ['Program_ID', 'Cycle_Time', 'Cycle_Status'],
                'Production': ['Part_Count', 'Good_Part_Count', 'Reject_Count'],
                'Status': ['CNC_Run_Status', 'Alarm_Status']
            },
            'INSPECTION': {
                'Core Energy': ['XRay_Instant_kW', 'XRay_Total_kWh'],
                'Inspection Cycle': ['Inspection_Cycle_Time', 'Scan_Status'],
                'Production / Quality': ['Inspected_Count', 'OK_Count', 'NG_Count'],
                'Status': ['XRay_Run_Status', 'Alarm_Status']
            },
            'HEAT': {
                'Core Energy': ['HT_Instant_kW', 'HT_Total_kWh'],
                'Temperature': ['Furnace_Temperature', 'Temperature_Setpoint'],
                'Process Sequence': ['Process_Step', 'Step_Timer'],
                'Status': ['HT_Run_Status', 'Alarm_Status']
            },
            'PRETREAT': {
                'Core Energy': ['PT_Instant_kW', 'PT_Total_kWh'],
                'Process / Conveyor': ['Conveyor_Speed', 'Stage_Status', 'Dryer_Temperature'],
                'Status': ['PT_Run_Status', 'Alarm_Status']
            },
            'PAINT_01': {
                'Core Energy': ['PB1_Instant_kW', 'PB1_Total_kWh'],
                'Booth Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
                'Conveyor / Process': ['Booth_Cycle_Status'],
                'Status': ['PB1_Run_Status', 'Alarm_Status']
            },
            'PAINT_02': {
                'Core Energy': ['PB2_Instant_kW', 'PB2_Total_kWh'],
                'Booth Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
                'Conveyor / Process': ['Booth_Cycle_Status'],
                'Status': ['PB2_Run_Status', 'Alarm_Status']
            },
            'COOLING': {
                'Core Energy': ['Cooling_Instant_kW', 'Cooling_Total_kWh'],
                'Environment': ['Tank_Temperature', 'Target_Temperature', 'Cooling_Status'],
                'Status': ['Circulation_Rate', 'Alarm_Status']
            },
            'DEGASSER': {
                'Core Energy': ['Degasser_Instant_kW', 'Degasser_Total_kWh'],
                'Environment': ['Vacuum_Level', 'Melt_Temp', 'Treatment_Status'],
                'Status': ['Argon_Flow', 'Alarm_Status']
            },
            'OUTBOUND': {
                'Core Energy': ['Outbound_Instant_kW', 'Outbound_Total_kWh'],
                'Logistics': ['Pallet_Count', 'Shipping_Status', 'Queue_Depth'],
                'Status': ['System_Idle', 'Alarm_Status']
            }
        };

        // Unit map for automatic unit annotation in sidebar rows
        this.tagUnits = {
            '_kW': 'kW', '_kWh': 'kWh',
            'Temperature': '°C', 'Temp': '°C',
            'Pressure': 'psi', '_PSI': 'psi',
            'Speed': 'm/min', 'Humidity': '%',
            '_Time': 's', 'Timer': 's',
            '_RPM': 'RPM', '_Pct': '%'
        };

        // Strictly Appropriate Sidebar KPI Schemas
        this.sidebarMetaSchemas = {
            'FURNACE': ['uptime', 'energy'],
            'LPDC': ['uptime', 'energy'],
            'CNC': ['uptime', 'energy'],
            'INSPECTION': ['uptime', 'energy'],
            'DEGASSER': ['uptime', 'energy'],
            'HEAT': ['uptime', 'energy'],
            'PRETREAT': ['uptime', 'energy'],
            'PAINT': ['uptime', 'energy'],
            'COOLING': ['uptime', 'energy'],
            'OUTBOUND': ['uptime', 'energy'],
            'PLANT': ['uptime', 'energy']
        };

        // Meta KPIs (Initial Placeholders - Updated dynamically)
        this.metaKPIs = {
            'FURNACE': { uptime: '0 hrs', energy: '0 kWh' },
            'LPDC': { uptime: '0 hrs', energy: '0 kWh' },
            'CNC': { uptime: '0 hrs', energy: '0 kWh' },
            'INSPECTION': { uptime: '0 hrs', energy: '0 kWh' },
            'DEGASSER': { uptime: '0 hrs', energy: '0 kWh' },
            'HEAT': { uptime: '0 hrs', energy: '0 kWh' },
            'PRETREAT': { uptime: '0 hrs', energy: '0 kWh' },
            'PAINT': { uptime: '0 hrs', energy: '0 kWh' },
            'COOLING': { uptime: '0 hrs', energy: '0 kWh' },
            'OUTBOUND': { uptime: '0 hrs', energy: '0 kWh' },
            'PLANT': { uptime: '0 hrs', energy: '0 MWh' }
        };

        // Zone / Group Definitions (Department-based)
        this.machineGroups = {
            'smelting': ['FURNACE01', 'DEGASSER01', 'DEGASSER02'],
            'die_casting': ['LPDC01', 'LPDC02', 'LPDC03'],
            'machining': ['CNC01', 'CNC02'],
            'heat_treating': ['HEAT01', 'HEAT02', 'COOLING01', 'COOLING02'],
            'qc': ['INSPECTION01'],
            'paint_shop': ['PRETREAT01', 'PAINT01', 'PAINT02'],
            'shipping': ['OUTBOUND01', 'PACK01'],
        };

        // Human-readable department labels
        this.departmentLabels = {
            'smelting': 'Smelting Department',
            'die_casting': 'Die Casting Department',
            'machining': 'Machining Zone',
            'heat_treating': 'Heat Treating Department',
            'qc': 'QC Department',
            'paint_shop': 'Paint Shop',
            'shipping': 'Shipping Department',
        };

        this.sidebarLayouts = new Map();
        this.setupListeners();
        this.init();
    }

    /**
     * Determine schema key from device ID.
     * e.g., 'FURNACE01' → 'FURNACE', 'PAINT_01' → 'PAINT_01', 'LPDC02' → 'LPDC'
     */
    getDeviceType(deviceId) {
        const id = deviceId.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        // Explicit PAINT booth matching (PAINT_01, PAINT01, etc.)
        if (/PAINT.?01/.test(id)) return 'PAINT_01';
        if (/PAINT.?02/.test(id)) return 'PAINT_02';
        // Prefix-based matching
        const prefixes = ['FURNACE', 'LPDC', 'CNC', 'INSPECTION', 'HEAT', 'PRETREAT', 'COOLING', 'DEGASSER', 'OUTBOUND', 'PAINT'];
        for (const p of prefixes) {
            if (id.includes(p)) return p;
        }
        return null;
    }

    /**
     * Derive a human-readable label from a tag key.
     * e.g., 'Furnace_Instant_kW' → 'Instant kW', 'Melt_Bath_Temperature' → 'Melt Bath Temperature'
     */
    _formatTagLabel(tag) {
        return tag.replace(/_/g, ' ');
    }

    /**
     * Derive unit suffix for a tag based on tagUnits map.
     */
    _getUnit(tag) {
        for (const [suffix, unit] of Object.entries(this.tagUnits)) {
            if (tag.includes(suffix)) return unit;
        }
        return '';
    }

    /**
     * Fuzzy telemetryStore lookup.
     * Bridges differences like FURNACE_01 vs FURNACE01 by normalizing keys.
     * @returns {{ cache: Map|null, storeKey: string|null }}
     */
    _findTelemetry(id) {
        const key = id.toUpperCase();
        // 1. Exact match
        if (this.telemetryStore.has(key)) {
            return { cache: this.telemetryStore.get(key), storeKey: key };
        }
        // 2. Normalized match (strip non-alphanumeric)
        const normId = key.replace(/[^A-Z0-9]/g, '');
        for (const [storeKey, val] of this.telemetryStore.entries()) {
            const normStoreKey = storeKey.replace(/[^A-Z0-9]/g, '');
            if (normStoreKey === normId) {
                return { cache: val, storeKey };
            }
        }
        return { cache: null, storeKey: null };
    }

    /**
     * Fuzzy analytics machine lookup.
     * @returns {Object|null}
     */
    _findMachineData(id) {
        const key = id.toUpperCase();
        const machines = this.analytics.data.machines;
        if (machines[key]) return machines[key];
        // Normalized match
        const normId = key.replace(/[^A-Z0-9]/g, '');
        for (const [mk, mv] of Object.entries(machines)) {
            if (mk.replace(/[^A-Z0-9]/g, '') === normId) return mv;
        }
        return null;
    }

    async init() {
        console.log('[App] Initializing IndustrialDigital Twin...');
        const container = document.getElementById('container');
        this.scene = new SceneManager(container);
        this.stateManager = new StateManager();

        // Load Asset Metadata
        try {
            const response = await fetch('./assets.json');
            const data = await response.json();
            this.assetData = data.assets || {};
            console.log('[App] Asset metadata loaded');
        } catch (err) {
            console.error('[App] Failed to load assets.json', err);
        }

        this.stateManager.onStateChange((deviceId, color, state) => {
            // UPDATED: No more state-driven mesh colors (Retain original textures)
            this.updateCounter();
        });

        this.websocket = new WebSocketHandler(
            'ws://localhost:8001/ws',
            (deviceId, state, fullData) => this.handleData(deviceId, state, fullData),
            (status) => this.updateStatus(status)
        );

        this.websocket.connect();
        await this.scene.loadModel('assets/models/plant.glb');
        this.scene.start();

        // Initialize Twinzo Flow Controls
        this.initFlowControls();

        // KPI Row Toggle Logic (Navbar Chevron)
        const kpiChevron = document.getElementById('kpi-chevron');
        const kpiSummaryRow = document.getElementById('kpi-summary-row');
        if (kpiChevron && kpiSummaryRow) {
            // Start open
            kpiChevron.classList.add('open');
            kpiChevron.addEventListener('click', () => {
                kpiSummaryRow.classList.toggle('hidden-kpi');
                kpiChevron.classList.toggle('open');
            });
        }

        // Hide Loading Screen
        const loader = document.getElementById('loading-screen');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 500);
        }
    }
    setupListeners() {
        window.addEventListener('scene-background-click', () => {
            this.setContext('plant');
        });
    }

    initFlowControls() {
        // Bottom Bar Icons (nav-item)
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.handleAction(action);

                // Active state
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Close Sidebars
        document.getElementById('close-left-panel')?.addEventListener('click', () => {
            if (this.activeContext.type === 'zone') {
                this.setContext('plant');
            } else {
                document.getElementById('left-sidebar').classList.remove('open');
            }
        });

        document.getElementById('close-right-panel')?.addEventListener('click', () => {
            document.getElementById('right-sidebar').classList.remove('open');
            if (this.activeContext.type === 'machine' || this.activeContext.type === 'safety') {
                this.setContext('plant');
            }
        });

        // Initialize Clock
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
        const utcEl = document.getElementById('utc-time');
        if (utcEl) {
            const now = new Date();
            utcEl.textContent = now.toISOString().split('T')[1].split('.')[0] + ' UTC';
        }
    }

    handleAction(action) {
        console.log(`[UI] Action: ${action}`);
        switch (action) {
            case 'plant':
                this.setContext('plant');
                break;
            case 'zones':
                this.setContext('zones_scope');
                break;
            case 'machines':
                this.setContext('machines_list');
                break;
            case 'energy':
                this.setContext('energy_analytics');
                break;
            case 'alarms':
            case 'isolation':
            case 'safety':
                this.setContext('safety');
                break;
            case 'gemba':
                this.setContext('gemba');
                break;
        }
    }

    setContext(type, id = null) {
        console.log(`[UI] Setting Context Mode: ${type} ${id ? '(' + id + ')' : ''}`);

        // Update active context
        this.activeContext = { type, id };

        // Toggle energy chips in 3D view
        if (this.scene && typeof this.scene.updateEnergyChips === 'function') {
            this.scene.updateEnergyChips(type === 'energy_analytics');
        }

        const leftPanel = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-sidebar');
        const kpiRow = document.getElementById('kpi-summary-row');

        // Manage Visibility & Scene based on Mode
        switch (type) {
            case 'plant':
                leftPanel.classList.remove('open');
                rightPanel.classList.remove('open');
                kpiRow.style.display = 'flex';
                this.scene.resetInteraction();
                break;

            case 'zones_scope':
                leftPanel.classList.add('open');
                rightPanel.classList.remove('open');
                kpiRow.style.display = 'flex';
                break;

            case 'zone':
                leftPanel.classList.add('open');
                rightPanel.classList.remove('open');
                kpiRow.style.display = 'none'; // Clear space for zone focus
                if (id) {
                    const deviceIds = this.machineGroups[id];
                    if (deviceIds) this.scene.isolateGroup(deviceIds);
                }
                break;

            case 'machine':
                rightPanel.classList.add('open');
                // Don't close left panel if we're in a zone context
                if (id) this.scene.isolateGroup([id]);
                break;

            case 'safety':
                rightPanel.classList.add('open');
                leftPanel.classList.remove('open');
                this.scene.highlightAlarms();
                break;

            case 'energy_analytics':
                leftPanel.classList.add('open');
                rightPanel.classList.remove('open');
                kpiRow.style.display = 'flex';
                break;

            case 'machines_list':
                leftPanel.classList.add('open');
                rightPanel.classList.remove('open');
                break;

            case 'gemba':
                leftPanel.classList.remove('open');
                rightPanel.classList.remove('open');
                this.startGembaWalk();
                break;

            default:
                leftPanel.classList.add('open');
                break;
        }

        this.refreshUI();
    }

    refreshUI() {
        const hierarchy = this.analytics.update(this.telemetryStore, this.machineGroups);

        this.updateTopStrip(hierarchy.plant);
        this.updateKPIRow(hierarchy.plant);

        this.renderLeftSidebar(hierarchy);
        this.renderRightSidebar(hierarchy);
    }

    updateTopStrip(data) {
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            statusEl.textContent = this.websocket.isConnected ? 'System Online' : 'System Offline';
            const dot = statusEl.previousElementSibling;
            if (dot) dot.className = `status-dot ${this.websocket.isConnected ? 'online' : 'offline'}`;
        }

        const latencyEl = document.getElementById('gateway-latency');
        if (latencyEl) {
            latencyEl.textContent = `Node ${this.websocket.isConnected ? '12ms' : '--'}`;
        }
    }

    updateKPIRow(data) {
        if (!data) return;
        // IDs: plant-kw, plant-prod, plant-oee, plant-epu, plant-util
        const kw = document.getElementById('plant-kw');
        if (kw) kw.textContent = (data.instantKW / 1000).toFixed(2); // Convert kW to MW

        const prod = document.getElementById('plant-prod');
        if (prod) prod.textContent = data.production.toLocaleString();

        const epu = document.getElementById('plant-epu');
        if (epu) epu.textContent = data.energyPerUnit.toFixed(1);

        const util = document.getElementById('plant-util');
        if (util) util.textContent = data.utilization.toFixed(0);

        // OEE Calculation (Placeholder proxy via utilization)
        const oee = document.getElementById('plant-oee');
        if (oee) oee.textContent = (data.utilization * 0.92).toFixed(1);
    }

    renderLeftSidebar(hierarchy) {
        const titleEl = document.getElementById('left-panel-title');
        const contentEl = document.getElementById('left-nav-list');
        const { type, id } = this.activeContext;

        if (!titleEl || !contentEl) return;

        if (type === 'zones_scope') {
            titleEl.textContent = 'Operational Zones';
            this.renderZonesScope(hierarchy, contentEl);
        } else if (type === 'zone' && id) {
            titleEl.textContent = this.departmentLabels[id] || `${id.toUpperCase()} Operations`;
            const zoneData = hierarchy.zones[id] || hierarchy.zones[id.toLowerCase()];
            this.renderZonePanel(id, zoneData, contentEl);
        } else if (type === 'energy_analytics') {
            titleEl.textContent = 'Energy Dynamics';
            this.renderEnergyPanel(hierarchy, contentEl);
        } else if (type === 'safety') {
            titleEl.textContent = 'Safety & Alarms';
            this.renderSafetyPanel(contentEl);
        } else if (type === 'machines_list') {
            titleEl.textContent = 'All Machines';
            this.renderMachinesListPanel(contentEl);
        }
    }

    renderZonesScope(hierarchy, container) {
        let html = '';
        Object.keys(this.machineGroups).forEach(zoneId => {
            const data = hierarchy.zones[zoneId];
            const isActive = this.activeContext.id === zoneId;
            html += `
                <a href="#" class="sidebar-nav-item ${isActive ? 'active' : ''}" 
                   onclick="event.preventDefault(); window.app.setContext('zone', '${zoneId}')">
                    <span class="material-symbols-outlined">map</span>
                    <div style="flex: 1">
                        <div style="display: flex; justify-content: space-between">
                            <span>${this.departmentLabels[zoneId] || zoneId.toUpperCase()}</span>
                            <span style="font-size: 10px; color: var(--text-dim)">${data?.production || 0} unit</span>
                        </div>
                        <div style="height: 4px; background: var(--surface-dark); border-radius: 2px; margin-top: 6px">
                            <div style="height: 100%; background: var(--primary); width: ${data?.utilization || 0}%; border-radius: 2px"></div>
                        </div>
                    </div>
                </a>
            `;
        });
        container.innerHTML = html;
    }

    renderRightSidebar(hierarchy) {
        const titleEl = document.getElementById('right-panel-title');
        const contentEl = document.getElementById('right-panel-content');
        const { type, id } = this.activeContext;

        if (type === 'machine' && id) {
            // Display name mapping: storage/inbound → RAW MATERIALS
            const normId = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const isRM = normId.includes('STORAGE') || normId.includes('INBOUND') || normId.includes('RAWMATERIALS');
            const isXRay = normId.includes('INSPECTION');
            let displayName = isRM ? 'RAW MATERIALS' : (isXRay ? 'X RAY' : id.toUpperCase().replace(/_/g, ' '));
            titleEl.textContent = `DEVICE: ${displayName}`;
            const machineData = hierarchy.machines[id] || this._findMachineData(id);
            this.renderMachinePanel(id, machineData, contentEl);
        } else if (type === 'safety') {
            titleEl.textContent = 'Safety & Alarms';
            this.renderSafetyPanel(contentEl);
        }
    }

    renderZonePanel(zoneId, data, container) {
        if (!data) return;
        let html = `
            <div class="kpi-group">
                <div class="kpi-mini" style="border-left: 3px solid var(--primary)">
                    <span>Real-time Load</span>
                    <strong>${data.instantKW.toFixed(1)} kW</strong>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid var(--success)">
                    <span>Production</span>
                    <strong>${data.production}</strong>
                </div>
                <div class="kpi-mini">
                    <span>Efficiency</span>
                    <strong>${data.energyPerUnit.toFixed(2)} <small>kWh/u</small></strong>
                </div>
                <div class="kpi-mini">
                    <span>Scrap Rate</span>
                    <strong style="color: ${data.scrapRate > 5 ? 'var(--danger)' : 'var(--success)'}">${data.scrapRate.toFixed(1)}%</strong>
                </div>
            </div>
            <div class="sidebar-section-title">EQUIPMENT IN ${this.departmentLabels[zoneId] || zoneId.toUpperCase()}</div>
            <div class="sidebar-nav-list">
        `;

        const members = this.machineGroups[zoneId] || [];
        members.forEach(mid => {
            const m = this.analytics.data.machines[mid.toUpperCase()] || this.analytics.data.machines[mid];
            if (!m) return;
            const state = (m.state || '').toLowerCase();
            const icon = state === 'running' ? 'play_circle' : 'stop_circle';
            const color = state === 'running' ? 'var(--success)' : (state === 'fault' ? 'var(--danger)' : 'var(--text-dim)');

            html += `
                <a href="#" class="sidebar-nav-item" onclick="event.preventDefault(); window.app.setContext('machine', '${mid}')">
                    <span class="material-symbols-outlined" style="color: ${color}">${icon}</span>
                    <div style="flex: 1; display: flex; justify-content: space-between; align-items: center">
                        <span>${mid}</span>
                        <strong style="font-family: 'JetBrains Mono'">${m.instantKW.toFixed(1)} kW</strong>
                    </div>
                </a>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    renderMachinePanel(id, data, container) {
        try {
            const machineKey = id.toUpperCase();
            const machineData = data || this._findMachineData(id);
            const { cache } = this._findTelemetry(id);
            const raw = cache instanceof Map ? Object.fromEntries(cache) : (cache || {});

            if (!machineData && Object.keys(raw).length === 0) {
                container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-dim)">
                    Telemetry stream not active for ${machineKey}<br>
                    <small>Check PLC Gateway Connection</small>
                </div>`;
                return;
            }

            const stateVal = (machineData?.state || raw['CalculatedState'] || raw['State'] || 'OFFLINE');
            const stateLower = String(stateVal).toLowerCase();
            const stateColor = stateLower === 'running' ? 'var(--success)' : (stateLower === 'stopped' ? 'var(--text-dim)' : 'var(--danger)');
            const stateIcon = stateLower === 'running' ? 'check_circle' : (stateLower === 'fault' ? 'error' : 'warning');
            const isXRay = machineKey.includes('INSPECTION');
            const displayName = isXRay ? machineKey.replace(/INSPECTION/i, 'X-RAY') : machineKey.replace(/_/g, ' ');

            // Find department
            let dept = '—';
            for (const [dId, members] of Object.entries(this.machineGroups)) {
                if (members.includes(machineKey) || members.includes(id)) {
                    dept = this.departmentLabels[dId] || dId;
                    break;
                }
            }

            // ── Stitch-Style Header Card ──
            let html = `
                <div style="background: var(--surface-dark); border-radius: var(--radius); padding: 16px; margin-bottom: 16px">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px">
                        <div style="width: 44px; height: 44px; border-radius: 10px; background: ${stateColor}22; display: flex; align-items: center; justify-content: center">
                            <span class="material-symbols-outlined" style="font-size: 28px; color: ${stateColor}">${stateIcon}</span>
                        </div>
                        <div style="flex: 1">
                            <div style="font-size: 16px; font-weight: 800; color: var(--text-main)">${displayName}</div>
                            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px">${dept}</div>
                        </div>
                        <div style="padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; background: ${stateColor}22; color: ${stateColor}">
                            ${String(stateVal).toUpperCase()}
                        </div>
                    </div>
                </div>
            `;

            // ── Asset Info Section ──
            html += `
                <div class="panel-section">
                    <div class="sidebar-section-title">ASSET INFORMATION</div>
                    <div class="sidebar-data-group">
                        ${this._row('Asset ID', machineKey)}
                        ${this._row('Department', dept)}
                        ${this._row('Model', raw['Model_ID'] || raw['Program_ID'] || '—')}
                    </div>
                </div>
            `;

            // ── Dynamic Schema-Driven Sections ──
            const deviceType = this.getDeviceType(machineKey);
            const schema = deviceType ? this.sidebarSchemas[deviceType] : null;

            if (schema) {
                for (const [groupName, tags] of Object.entries(schema)) {
                    let groupHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">';
                    let hasData = false;
                    for (const tag of tags) {
                        let val = this.getValue(raw, tag);
                        if (val === undefined || val === null) continue;
                        hasData = true;

                        // Format numeric values
                        if (typeof val === 'number') {
                            val = Number.isInteger(val) ? val : val.toFixed(2);
                        } else if (typeof val === 'boolean') {
                            val = val ? 'YES' : 'NO';
                        }

                        const unit = this._getUnit(tag);
                        const label = this._formatTagLabel(tag);

                        // Special coloring for energy tags
                        const isEnergy = tag.includes('Instant_kW');
                        const valStyle = isEnergy ? 'color: var(--primary)' : 'color: var(--text-main)';

                        groupHtml += `
                        <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">${label}</div>
                            <div style="font-size: 16px; font-weight: 700; ${valStyle}">${val} <span style="font-size: 11px; font-weight: normal; color: var(--text-dim)">${unit}</span></div>
                        </div>`;
                    }
                    groupHtml += '</div>';

                    // Only render the group if at least one tag had data
                    if (hasData) {
                        const displayGroup = groupName === 'Telemetry' ? 'MACHINE DIAGNOSTICS' : groupName.toUpperCase();
                        html += `<div class="panel-section">
                            <div class="sidebar-section-title">${displayGroup}</div>
                            ${groupHtml}
                        </div>`;
                    }
                }
            } else {
                // Fallback: dump all raw telemetry keys if no schema matched
                html += `<div class="panel-section"><div class="sidebar-section-title">Telemetry Data</div><div class="sidebar-data-group">`;
                const skipKeys = ['CalculatedState', 'Start', 'Stop', 'IsRunning', 'Enabled', 'State'];
                for (const [k, v] of Object.entries(raw)) {
                    if (skipKeys.includes(k)) continue;
                    let displayVal = v;
                    if (typeof v === 'number') displayVal = Number.isInteger(v) ? v : v.toFixed(2);
                    if (typeof v === 'boolean') displayVal = v ? 'YES' : 'NO';
                    html += this._row(this._formatTagLabel(k), displayVal, this._getUnit(k));
                }
                html += `</div></div>`;
            }

            // ── Alarm Log Section ──
            if (stateLower === 'fault' || stateLower === 'error' || stateLower === 'stopped') {
                 html += `
                <div class="panel-section" style="margin-top: 24px;">
                    <div class="sidebar-section-title">ALARM LOG</div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger); padding: 12px 14px; border-radius: 4px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="font-weight: 700; font-size: 12px; color: var(--danger);">Critical State Detected</span>
                                <span style="font-size: 10px; font-family: 'JetBrains Mono'; color: var(--text-dim)">${new Date().toLocaleTimeString('en-US', {hour12: false})}</span>
                            </div>
                            <div style="font-size: 11px; color: var(--text-light); line-height: 1.4;">Device reported ${stateVal} state. Requires immediate maintenance intervention.</div>
                        </div>
                    </div>
                </div>`;
            } else {
                html += `
                <div class="panel-section" style="margin-top: 24px;">
                    <div class="sidebar-section-title">ALARM LOG</div>
                    <div style="padding: 16px; text-align: center; border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px; background: rgba(255,255,255,0.02)">
                        <span class="material-symbols-outlined" style="font-size: 24px; color: var(--success); margin-bottom: 8px;">check_circle</span>
                        <div style="font-size: 11px; color: var(--text-dim);">No active alarms. System operating normally.</div>
                    </div>
                </div>`;
            }

            container.innerHTML = html;
        } catch (err) {
            console.error('[UI] Panel Crash:', err);
            container.innerHTML = `<div style="padding: 20px; color: var(--danger)">Sidebar Error: ${err.message}</div>`;
        }
    }

    _row(label, val, unit = '') {
        return `<div class="data-row"><span>${label}</span> <strong>${val || '---'} ${unit}</strong></div>`;
    }

    renderEnergyPanel(hierarchy, container) {
        let html = '<div class="panel-section"><div class="sidebar-section-title">DEPARTMENT ENERGY</div><div class="sidebar-data-group">';
        Object.entries(hierarchy.zones).forEach(([name, data]) => {
            const label = this.departmentLabels[name] || name.toUpperCase();
            html += `<div class="data-row"><span>${label}</span> <strong>${data.instantKW.toFixed(1)} kW</strong></div>`;
        });
        html += '</div></div>';

        // Per-device energy chips
        html += '<div class="panel-section"><div class="sidebar-section-title">DEVICE ENERGY BREAKDOWN</div><div class="sidebar-nav-list">';
        const allDevices = Object.values(this.machineGroups).flat();
        let maxKW = 1;
        const deviceEnergy = [];
        allDevices.forEach(mid => {
            const cache = this.telemetryStore.get(mid) || this.telemetryStore.get(mid.replace(/0/g, '_0'));
            const kw = cache ? (parseFloat(cache.get('Instant_kW') || cache.get('Furnace_Instant_kW') || cache.get('LPDC_Instant_kW') || cache.get('CNC_Instant_kW') || cache.get('HT_Instant_kW') || cache.get('Cooling_Instant_kW') || cache.get('Degasser_Instant_kW') || cache.get('PT_Instant_kW') || cache.get('PB1_Instant_kW') || cache.get('PB2_Instant_kW') || cache.get('XRay_Instant_kW') || cache.get('Outbound_Instant_kW') || 0)) : 0;
            if (kw > maxKW) maxKW = kw;
            deviceEnergy.push({ id: mid, kw });
        });

        deviceEnergy.forEach(({ id, kw }) => {
            const pct = Math.min((kw / maxKW) * 100, 100);
            const isXRay = id.toUpperCase().includes('INSPECTION');
            const displayName = isXRay ? id.replace(/INSPECTION/i, 'X-RAY') : id;
            html += `
                <div class="sidebar-nav-item" style="flex-direction: column; align-items: stretch; gap: 4px; padding: 8px 12px">
                    <div style="display: flex; justify-content: space-between; align-items: center">
                        <span style="font-size: 11px; font-weight: 700">${displayName}</span>
                        <strong style="font-family: 'JetBrains Mono'; font-size: 11px; color: var(--primary)">${kw.toFixed(1)} kW</strong>
                    </div>
                    <div style="height: 4px; background: var(--surface-dark); border-radius: 2px">
                        <div style="height: 100%; background: var(--primary); width: ${pct}%; border-radius: 2px; transition: width 0.3s"></div>
                    </div>
                </div>`;
        });
        html += '</div></div>';
        container.innerHTML = html;
    }

    renderSafetyPanel(container) {
        let html = '';

        // ── Active Alarms Section ──
        html += '<div class="sidebar-section-title" style="display:flex;align-items:center;gap:6px"><span class="material-symbols-outlined" style="font-size:16px;color:var(--danger)">warning</span>ACTIVE ALARMS</div>';
        html += '<div class="sidebar-nav-list">';
        let alarmCount = 0;
        this.telemetryStore.forEach((cache, id) => {
            const state = (cache.get('CalculatedState') || '').toLowerCase();
            if (['stopped', 'fault', 'error'].includes(state)) {
                alarmCount++;
                html += `
                    <div class="sidebar-nav-item" style="border-left: 2px solid var(--danger); background: rgba(211, 47, 47, 0.05)">
                        <span class="material-symbols-outlined" style="color: var(--danger)">warning</span>
                        <div style="flex: 1">
                            <div style="display: flex; justify-content: space-between">
                                <span style="font-weight: 700">${id}</span>
                                <span style="font-size: 10px; color: var(--danger)">${state.toUpperCase()}</span>
                            </div>
                            <div style="font-size: 10px; color: var(--text-dim); margin-top: 4px">Critical Fault: Check PLC Tags</div>
                        </div>
                    </div>
                `;
            }
        });
        if (alarmCount === 0) {
            html += '<div style="padding: 16px; text-align: center; color: var(--text-dim)">No active alarms</div>';
        }
        html += '</div>';

        // ── Isolated Units Section ──
        html += '<div class="sidebar-section-title" style="display:flex;align-items:center;gap:6px;margin-top:16px"><span class="material-symbols-outlined" style="font-size:16px;color:var(--primary)">lock</span>ISOLATED UNITS</div>';
        html += '<div class="sidebar-nav-list">';
        let isolationCount = 0;
        this.telemetryStore.forEach((cache, id) => {
            const state = (cache.get('CalculatedState') || '').toLowerCase();
            if (state === 'stopped' || cache.get('Enabled') === false) {
                isolationCount++;
                html += `
                    <div class="sidebar-nav-item" style="border-left: 2px solid var(--primary); background: rgba(236,91,19,0.05)">
                        <span class="material-symbols-outlined" style="color: var(--primary)">lock</span>
                        <div style="flex: 1">
                            <div style="display: flex; justify-content: space-between">
                                <span>${id}</span>
                                <span style="font-size: 10px; color: var(--primary)">ISOLATED</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        });
        if (isolationCount === 0) {
            html += '<div style="padding: 16px; text-align: center; color: var(--text-dim)">No units currently isolated</div>';
        }
        html += '</div>';
        container.innerHTML = html;
    }

    renderMachinesListPanel(contentEl) {
        let html = '';
        for (const [deptId, members] of Object.entries(this.machineGroups)) {
            const label = this.departmentLabels[deptId] || deptId.toUpperCase();
            html += `<div class="sidebar-section-title" style="margin-top:12px">${label}</div>`;
            html += '<div class="sidebar-nav-list">';
            for (const mid of members) {
                const m = this.analytics.data.machines[mid] || this._findMachineData(mid);
                const stateRaw = m ? (m.state || '').toLowerCase() : 'offline';
                const color = stateRaw === 'running' ? 'var(--success)' : (stateRaw === 'fault' ? 'var(--danger)' : 'var(--text-dim)');
                const icon = stateRaw === 'running' ? 'play_circle' : 'stop_circle';
                const isXRay = mid.toUpperCase().includes('INSPECTION');
                const displayName = isXRay ? mid.replace(/INSPECTION/i, 'X-RAY') : mid;
                html += `
                    <a href="#" class="sidebar-nav-item" onclick="event.preventDefault(); window.app.setContext('machine', '${mid}')">
                        <span class="material-symbols-outlined" style="color: ${color}">${icon}</span>
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center">
                            <span>${displayName}</span>
                            <strong style="font-family: 'JetBrains Mono'; font-size: 11px">${m ? m.instantKW.toFixed(1) + ' kW' : '---'}</strong>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }
        contentEl.innerHTML = html;
    }

    // ─── Gemba Walk Mode ─────────────────────────────────────────────
    startGembaWalk() {
        this.gembaWaypoints = [
            { dept: null, ids: ['RAWMATERIALS'], label: 'Raw Materials' },
            { dept: null, ids: ['FURNACE01'], label: 'Furnace' },
            { dept: null, ids: ['DEGASSER01', 'DEGASSER02'], label: 'Degasser' },
            { dept: 'die_casting', label: 'Die Casting (LPDC)' },
            { dept: 'heat_treating', label: 'Heat Treating' },
            { dept: 'machining', label: 'CNC Machining' },
            { dept: null, ids: ['PRETREAT01'], label: 'Pre-Treatment' },
            { dept: null, ids: ['PAINT01', 'PAINT02'], label: 'Paint Shop' },
            { dept: null, ids: ['OUTBOUND01'], label: 'Outbound' },
        ];
        this.gembaIndex = 0;
        this.gembaPaused = false;

        // Show tour control bar
        let bar = document.getElementById('gemba-tour-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'gemba-tour-bar';
            bar.innerHTML = `
                <button id="gemba-prev" class="gemba-btn" title="Previous"><span class="material-symbols-outlined">skip_previous</span></button>
                <button id="gemba-pause" class="gemba-btn" title="Pause"><span class="material-symbols-outlined">pause</span></button>
                <button id="gemba-next" class="gemba-btn" title="Next"><span class="material-symbols-outlined">skip_next</span></button>
                <span id="gemba-label" class="gemba-label"></span>
                <button id="gemba-stop" class="gemba-btn gemba-stop" title="End Tour"><span class="material-symbols-outlined">close</span></button>
            `;
            document.body.appendChild(bar);

            document.getElementById('gemba-prev').addEventListener('click', () => this.gembaNavigate(-1));
            document.getElementById('gemba-next').addEventListener('click', () => this.gembaNavigate(1));
            document.getElementById('gemba-pause').addEventListener('click', () => {
                this.gembaPaused = !this.gembaPaused;
                document.getElementById('gemba-pause').querySelector('span').textContent = this.gembaPaused ? 'play_arrow' : 'pause';
            });
            document.getElementById('gemba-stop').addEventListener('click', () => this.stopGembaWalk());
        }
        bar.style.display = 'flex';

        this.gembaNavigate(0); // Go to first waypoint
        this.gembaTimer = setInterval(() => {
            if (!this.gembaPaused) this.gembaNavigate(1);
        }, 8000);
    }

    gembaNavigate(delta) {
        if (!this.gembaWaypoints) return;
        this.gembaIndex = (this.gembaIndex + delta + this.gembaWaypoints.length) % this.gembaWaypoints.length;
        const wp = this.gembaWaypoints[this.gembaIndex];

        // Update label
        const labelEl = document.getElementById('gemba-label');
        if (labelEl) labelEl.textContent = `${this.gembaIndex + 1}/${this.gembaWaypoints.length} — ${wp.label}`;

        // Frame the department's machines
        const deviceIds = wp.dept ? this.machineGroups[wp.dept] : wp.ids;
        if (deviceIds) this.scene.isolateGroup(deviceIds);
    }

    stopGembaWalk() {
        if (this.gembaTimer) clearInterval(this.gembaTimer);
        this.gembaTimer = null;
        const bar = document.getElementById('gemba-tour-bar');
        if (bar) bar.style.display = 'none';
        this.scene.resetInteraction();
    }



    // ─── Standard Telemetry Handling ────────────────────────────────────

    handleData(rawId, state, fullData) {
        if (!rawId) return;
        const deviceId = rawId.toUpperCase();
        console.log(`[Data] Received: ${deviceId} (State: ${state})`);

        if (deviceId === 'OUTBOUND_01' || deviceId === 'OUTBOUND_02') {
            const secondaryId = deviceId === 'OUTBOUND_01' ? 'OUTBOUND_02' : 'OUTBOUND_01';
            this.stateManager.updateDeviceState(secondaryId, state, fullData);
            this.stateManager.updateDeviceState(deviceId, state, fullData);

            // Mirror data for correct store population
            this._populateStore(secondaryId, fullData, state);
            console.log(`[Data] Mirrored: ${secondaryId} from ${deviceId}`);
        }

        // Bridge storage data
        const isRM = deviceId.includes('STORAGE') || deviceId.includes('INBOUND') || deviceId.includes('RAW_MATERIALS');
        const finalId = isRM ? 'RAW_MATERIALS' : deviceId;

        // Pass fullData so stateManager can check IsRunning/Enabled flags
        this.stateManager.updateDeviceState(finalId, state, fullData);

        if (fullData) {
            // 1. Sync Overlays (3D)
            if (this.overlaySchemas) {
                const schemaKey = Object.keys(this.overlaySchemas).find(k => finalId.includes(k));
                this.scene.updateDeviceLabel(finalId, fullData, this.overlaySchemas[schemaKey] || null);
            }

            // Mirror labels for outbound piles
            if (deviceId === 'OUTBOUND_01' || deviceId === 'OUTBOUND_02') {
                const secondaryId = deviceId === 'OUTBOUND_01' ? 'OUTBOUND_02' : 'OUTBOUND_01';
                const secondarySchemaKey = Object.keys(this.overlaySchemas).find(k => secondaryId.includes(k));
                this.scene.updateDeviceLabel(secondaryId, fullData, this.overlaySchemas[secondarySchemaKey] || null);
            }

            // Restore warning mesh support (sync status colors/warning meshes)
            this._populateStore(finalId, fullData, state);

            // 2. Sync Meta Data for expanded card/sidebar
            // 2. Sync Meta Data for expanded card/sidebar
            if (this.metaKPIs) {
                const metaKey = Object.keys(this.metaKPIs).find(k => finalId.includes(k.toUpperCase()));
                if (metaKey) {
                    // Dynamic KPI Updates
                    if (fullData.RuntimeTotalHrs !== undefined) {
                        const hrs = fullData.RuntimeTotalHrs;
                        this.metaKPIs[metaKey].uptime = hrs < 1 ? '< 1 hr' : `${Math.floor(hrs).toLocaleString()} hrs`;

                        // Approximate Energy Calc: PowerKW * Hours
                        if (fullData.PowerKW !== undefined) {
                            const kwh = fullData.PowerKW * hrs;
                            this.metaKPIs[metaKey].energy = kwh > 1000 ?
                                `${(kwh / 1000).toFixed(1)} MWh` :
                                `${Math.floor(kwh).toLocaleString()} kWh`;
                        }
                    }
                    this.scene.updateMetaKPIs(finalId, this.metaKPIs[metaKey]);
                }
            }

            // 4. Final Refresh
            this.refreshUI();
        }
    }

    _populateStore(id, data, state) {
        let cache = this.telemetryStore.get(id) || new Map();
        Object.entries(data).forEach(([k, v]) => cache.set(k, v));
        if (state !== null) {
            cache.set('CalculatedState', state);
        }
        this.telemetryStore.set(id, cache);
    }




    getValue(data, key) {
        if (!data || !key) return undefined;
        const lowerTarget = key.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Precise match
        if (data[key] !== undefined) return data[key];
        if (data[key.toUpperCase()] !== undefined) return data[key.toUpperCase()];

        // 2. State Alias (Always prefer CalculatedState if looking for State)
        if (lowerTarget === 'state') {
            if (data['CalculatedState'] !== undefined) return data['CalculatedState'];
            if (data['Status/State'] !== undefined) return data['Status/State'];
            if (data['state'] !== undefined) return data['state'];
            if (data['Status'] !== undefined) return data['Status'];
        }

        // 3. Normalized fuzzy match (Strip non-alpha for robust prefix matching)
        if (!data) return undefined;
        const targetAlpha = lowerTarget.replace(/[0-9]/g, '');

        for (const [k, v] of Object.entries(data)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normAlpha = normK.replace(/[0-9]/g, '');

            if (normK === lowerTarget || normAlpha === targetAlpha || normAlpha.includes(targetAlpha)) {
                return v;
            }
        }
        return undefined;
    }

    updateStatus(s) {
        const el = document.getElementById('connection-status');
        if (el) {
            el.className = s;
            el.textContent = s === 'connected' ? 'GATEWAY: ONLINE' : 'GATEWAY: OFFLINE';
        }
    }

    updateCounter() {
        const el = document.getElementById('device-count');
        if (el) el.textContent = `${this.stateManager.getDeviceCount()} units active`;
        // Note: _updateAlarmChip() is NOT called here — it is called at the end
        // of handleData() AFTER telemetryStore is updated, to ensure fresh data.
    }

    _updateAlarmChip() {
        const chip = document.getElementById('alarm-chip');
        if (!chip) return;
        // Count devices in a fault/stopped/idle-disabled state
        let alarmCount = 0;
        this.telemetryStore.forEach((cache) => {
            const state = (cache.get('CalculatedState') || '').toLowerCase();
            const isRunning = cache.get('IsRunning');
            const enabled = cache.get('Enabled');
            if (state === 'stopped' || state === 'fault' || state === 'error' ||
                isRunning === false || enabled === false) {
                alarmCount++;
            }
        });
        chip.textContent = alarmCount === 0 ? 'Clear' : `${alarmCount} Alarm${alarmCount > 1 ? 's' : ''}`;
        chip.classList.toggle('has-alarms', alarmCount > 0);
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new DigitalTwinApp(); });
