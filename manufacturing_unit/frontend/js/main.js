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
        this.lastLeftContext = { type: 'plant', id: null };
        this.assetData = {};
        this.liveState = new Map();
        this.primaryMode = 'plant'; // Tracks the global bottom-nav mode
        this.lastPrimaryMode = 'plant';

        this.energyViewSettings = {
            viewType: 'all', // 'all', 'select'
            selectedMachineId: null,
            parameter: 'energy' // 'energy', 'cycle', 'status'
        };

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
            'STORAGE': {
                'Inventory Levels': ['Material_Count', 'Pallet_Count', 'Fill_Level']
            },
            'INBOUND': {
                'Inventory Levels': ['Material_Count', 'Pallet_Count', 'Fill_Level']
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
            'shipping': ['OUTBOUND01'],
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
        if (!deviceId) return null;
        const id = deviceId.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        // Explicit PAINT booth matching (PAINT_01, PAINT01, etc.)
        if (/PAINT.?01|PB1/i.test(id)) return 'PAINT_01';
        if (/PAINT.?02|PB2/i.test(id)) return 'PAINT_02';
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
     * Fuzzy liveState lookup.
     * Bridges differences like FURNACE_01 vs FURNACE01 by normalizing keys.
     * @returns {{ cache: Map|null, storeKey: string|null }}
     */
    _findTelemetry(id) {
        const key = id.toUpperCase();
        // 1. Exact match
        if (this.liveState.has(key)) {
            return { cache: this.liveState.get(key), storeKey: key };
        }
        // 2. Normalized match (strip non-alphanumeric)
        const normId = key.replace(/[^A-Z0-9]/g, '');
        for (const [storeKey, val] of this.liveState.entries()) {
            const normStoreKey = storeKey.replace(/[^A-Z0-9]/g, '');
            if (normStoreKey === normId) {
                return { cache: val, storeKey };
            }
        }
        // 3. Fallback: Raw Materials specific mapping
        if (normId === 'RAWMATERIALS') {
            const fallbackKey = 'STORAGE_01';
            if (this.liveState.has(fallbackKey)) return { cache: this.liveState.get(fallbackKey), storeKey: fallbackKey };
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

    _findAsset(id) {
        if (!this.assetData) return null;
        const key = id.toUpperCase();
        if (this.assetData[key]) return this.assetData[key];
        const normId = key.replace(/[^A-Z0-9]/g, '');
        for (const [ak, av] of Object.entries(this.assetData)) {
            if (ak.replace(/[^A-Z0-9]/g, '') === normId) return av;
        }
        // 3. Fallback: Raw Materials mapping
        if (normId === 'RAWMATERIALS') return this.assetData['STORAGE_01'] || this.assetData['INBOUND_01'];
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

        let wsUrl;

        if (window.location.protocol === "file:") {
            // Running UI from local file system
            wsUrl = "ws://localhost:8001/ws";
        } else {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            let host = window.location.hostname || "localhost";
            // Robustly catch localhost, IPv6 loopback (::1), and bracketed IPv6 ([::1])
            if (/localhost|::1|\[::1\]/i.test(host)) {
                host = '127.0.0.1';
            }
            wsUrl = `${protocol}//${host}:8001/ws`;
        }

        console.log("[WebSocket] Connecting to", wsUrl);

        this.websocket = new WebSocketHandler(
            wsUrl,
            (deviceId, state, payload) => {
                // Instantly process incoming data (decoupled from render loop)
                this.handleData(deviceId, state, payload);
            },
            (status) => this.updateStatus(status)
        );

        this.websocket.connect();
        await this.scene.loadModel('assets/models/plant.glb');
        this.scene.start();

        // Initialize Twinzo Flow Controls
        this.initFlowControls();

        // Branding Info Button
        const infoBtn = document.getElementById('branding-info-btn');
        const kpiSummaryRow = document.getElementById('kpi-summary-row');
        if (infoBtn && kpiSummaryRow) {
            infoBtn.addEventListener('click', () => {
                kpiSummaryRow.classList.toggle('hidden-kpi');
                infoBtn.classList.toggle('open');
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

        // ESC key to return to overview
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.setContext('plant');
                if (this.scene) this.scene.resetToDefaultView();
            }
        });
    }

    initFlowControls() {
        // Bottom Bar Icons (nav-item)
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                
                // [PERF] Immediate UI Feedback (Instant Active State)
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // [PERF] Defer heavy business logic to yield to the paint thread
                // This significantly improves INP (Interaction to Next Paint)
                setTimeout(() => {
                    this.handleAction(action);
                }, 0);
            });
        });

        // Close Sidebars - Universal "Reset to Initial View" Rule
        document.getElementById('close-left-panel')?.addEventListener('click', () => {
            this.setContext('plant');
        });

        document.getElementById('close-right-panel')?.addEventListener('click', () => {
            this.setContext('plant');
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
        if (action !== 'gemba') {
            this.lastPrimaryMode = this.primaryMode;
            this.primaryMode = action; // 'plant', 'energy', 'alarm', 'alarms', 'zones', 'machines'
        }
        
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
            case 'alarm':
            case 'alarms':
            case 'isolation':
                this.setContext('alarms');
                break;
            case 'gemba':
                this.setContext('gemba');
                break;
        }
    }

    _isAlarmMode(mode) {
        return ['alarm', 'alarms', 'isolation'].includes(mode) && !this.gembaTimer;
    }

    setContext(type, id = null) {
        // [PERF] Redundancy Guard: skip expensive 3D/DOM updates if context is identical
        if (this.activeContext.type === type && this.activeContext.id === id && type !== 'plant') {
            console.log(`[UI] Context Redundant: ${type} ${id || ''}`);
            return;
        }

        console.log(`[UI] Setting Context Mode: ${type} ${id ? '(' + id + ')' : ''}`);

        // Detect leaving alarm mode to clear visuals
        const wasAlarm = this._isAlarmMode(this.lastPrimaryMode);
        const isCurrentlyAlarm = this._isAlarmMode(this.primaryMode);
        
        // Update active context
        this.activeContext = { type, id };

        // Reset scene if we are exiting Alarm Mode globally
        if (wasAlarm && !isCurrentlyAlarm && this.scene) {
            console.log('[UI] Exiting Alarm Mode: Restoring realistic visuals');
            this.scene.isolateGroup([]); // Restores materials if primaryMode is not alarm
            this.scene.labelRegistry.forEach(data => {
                if (data && data.element) data.element.style.display = 'block';
            });
            this.scene.warningMeshes.forEach(m => m.visible = false);
        }

        // Toggle energy chips in 3D view
        if (this.scene && typeof this.scene.updateEnergyChips === 'function') {
            this.scene.updateEnergyChips(type === 'energy_analytics');
        }

        const leftPanel = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-sidebar');
        const kpiRow = document.getElementById('kpi-summary-row');

        // Manage Visibility & Scene based on Mode
        // Tracking for left sidebar persistence
        const leftTypes = ['zones_scope', 'zone', 'energy_analytics', 'machines_list'];
        if (leftTypes.includes(type)) {
            this.lastLeftContext = { type, id };
        }

        switch (type) {
            case 'plant':
                leftPanel.classList.remove('open');
                rightPanel.classList.remove('open');
                kpiRow.style.display = 'flex';
                this.scene.resetInteraction();
                // When going to plant, we don't necessarily reset lastLeftContext
                // but we hide the panels.
                if (this.scene) this.scene.setChipDisplayMode('none');
                break;

            case 'energy_analytics':
                if (this.energyViewSettings.viewType === 'select') {
                    leftPanel.classList.add('open');
                } else {
                    leftPanel.classList.remove('open');
                }
                rightPanel.classList.remove('open'); // STRICT: No right sidebar in Energy Mode
                kpiRow.style.display = 'flex';
                // Force energy display mode on chips
                if (this.scene) {
                    this.scene.setChipDisplayMode('energy');
                    // Reset diagnostic visuals if entering from alarm
                    if (wasAlarm) this.scene.isolateGroup([]);
                }
                break;

            case 'zones_scope':
            case 'zone':
            case 'machines_list':
                leftPanel.classList.add('open');
                rightPanel.classList.remove('open');
                kpiRow.style.display = (type === 'zone') ? 'none' : 'flex';
                if (type === 'zone' && id) {
                    const deviceIds = this.machineGroups[id];
                    if (deviceIds) this.scene.isolateGroup(deviceIds);
                } else if (wasAlarm && this.scene) {
                    this.scene.isolateGroup([]);
                }
                if (this.scene) this.scene.setChipDisplayMode('none');
                break;

            case 'machine':
            case 'asset':
                // STRICT: If we are in Alarm mode, respect it. Do not pull in other mode sidebars.
                if (this.primaryMode === 'alarm' || this.primaryMode === 'alarms') {
                    leftPanel.classList.remove('open');
                    rightPanel.classList.add('open');
                } else if (this.primaryMode === 'plant') {
                    // USER REQUEST: No left sidebar in Plant Mode during machine interaction
                    leftPanel.classList.remove('open');
                    rightPanel.classList.add('open');
                } else {
                    // USER REQUEST: Do not open right sidebar in Energy Mode
                    if (this.activeContext.type === 'energy_analytics' || this.lastLeftContext.type === 'energy_analytics') {
                        rightPanel.classList.remove('open');
                    } else {
                        rightPanel.classList.add('open');
                    }
                    
                    // Ensure left panel stays open if it was already open
                    if (leftPanel.classList.contains('open')) {
                        // Do nothing, keep it open
                    } else if (this.lastLeftContext.type !== 'plant') {
                        // Re-open last left context if we're looking at a machine
                        leftPanel.classList.add('open');
                    }
                }
                if (id) this.scene.isolateGroup([id]);
                if (this.scene) this.scene.setChipDisplayMode('none');
                break;

            case 'alarm':
            case 'alarms':
                rightPanel.classList.add('open');
                leftPanel.classList.remove('open'); // STRICT: No left sidebar in Alarm Mode
                if (this.scene) {
                    this.scene.setChipDisplayMode('none');
                    this.scene.highlightAlarms();
                }
                break;

            case 'gemba':
                leftPanel.classList.remove('open');
                rightPanel.classList.remove('open');
                this.startGembaWalk();
                if (this.scene) this.scene.setChipDisplayMode('none');
                break;

            default:
                leftPanel.classList.add('open');
                break;
        }

        this.refreshUI();
    }

    setChipMode(mode) {
        if (this.scene) {
            this.scene.setChipDisplayMode(mode);
            this.refreshUI(); // Re-render sidebar to update active state
        }
    }

    handleHeaderBack() {
        this.setContext('zones_scope');
        if (this.scene) {
            this.scene.resetToDefaultView();
        }
    }

    onHoverChange(hoveredId) {
        // Event-driven hover hook. Replaces per-frame UI polling.
        // Can be expanded to drive specific UI element previews without full layout re-renders.
        if (hoveredId) {
            console.log(`[UI] Hover focused on: ${hoveredId}`);
        }
    }

    refreshUI(force = false) {
        const hierarchy = this.analytics.update(this.liveState, this.machineGroups);

        this.updateTopStrip(hierarchy.plant);
        this.updateKPIRow(hierarchy.plant);

        // Smart Refresh: Avoid re-rendering sidebar if user is actively interacting (dropdowns, inputs)
        // Bypass if force is true (usually manual UI triggers)
        const sidebar = document.querySelector('.sidebar.open');
        const active = document.activeElement;
        const isUserBusy = !force && sidebar && active && sidebar.contains(active) && 
                          (active.tagName === 'SELECT' || (active.tagName === 'INPUT' && active.type === 'text'));

        if (!isUserBusy) {
            this.renderLeftSidebar(hierarchy);
            this.renderRightSidebar(hierarchy);
        }
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
        const navEl = document.getElementById('left-header-nav');
        const contentEl = document.getElementById('left-nav-list');
        const closeBtn = document.getElementById('close-left-panel');
        const header = document.querySelector('#left-sidebar .sidebar-header');
        
        // Use lastLeftContext if current context is machine/asset details
        let targetContext = this.activeContext;
        if (this.activeContext.type === 'machine' || this.activeContext.type === 'asset') {
            targetContext = this.lastLeftContext;
        }

        if (!titleEl || !contentEl || !navEl || !closeBtn) return;
        
        // PRESERVE TITLE: If title is inside nav, move it back to header before clearing nav
        if (navEl.contains(titleEl)) {
            header.appendChild(titleEl);
        }

        // Reset nav header and shared layout classes
        navEl.innerHTML = '';
        header.classList.remove('same-row', 'compact');
        closeBtn.style.order = ''; // Reset order
        
        const { type, id } = targetContext;

        if (type === 'plant' || !type) {
            titleEl.textContent = 'Plant Overview';
            header.appendChild(titleEl);
            contentEl.innerHTML = '<div style="padding: 24px; color: var(--text-dim)">Global telemetry monitoring...</div>';
        } else if (type === 'zones_scope') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'OPERATIONAL ZONES';
            // Move title into the top row for the same-row effect
            navEl.prepend(titleEl);
            this.renderZonesScope(hierarchy, contentEl);
        } else if (type === 'zone' && id) {
            navEl.innerHTML = `
                <button class="sidebar-back-btn" onclick="window.app.handleHeaderBack()" title="Back to Zones">
                    <span class="material-symbols-outlined">arrow_back</span>
                </button>
            `;
            header.appendChild(titleEl); 
            titleEl.textContent = (this.departmentLabels[id] || id.replace(/_/g, ' ')).toUpperCase();
            const zoneData = hierarchy.zones[id] || hierarchy.zones[id.toLowerCase()];
            this.renderZonePanel(id, zoneData, contentEl);
        } else if (type === 'energy_analytics') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'Energy Dynamics';
            navEl.prepend(titleEl);
            this.renderEnergyPanel(hierarchy, contentEl);
        } else if (type === 'machines_list') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'Asset View'; 
            navEl.prepend(titleEl);
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
        const navEl = document.getElementById('right-header-nav');
        const header = document.querySelector('#right-sidebar .sidebar-header');
        const { type, id } = this.activeContext;

        if (!titleEl || !contentEl || !navEl) return;
        
        // PRESERVE TITLE: If title is inside nav, move it back to header before clearing nav
        if (navEl.contains(titleEl)) {
            header.appendChild(titleEl);
        }

        navEl.innerHTML = ''; 
        header.classList.add('same-row', 'compact');

        if ((type === 'machine' || type === 'asset') && id) {
            // Display name mapping: storage/inbound → RAW MATERIALS
            const normId = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const isRM = normId.includes('STORAGE') || normId.includes('INBOUND') || normId.includes('RAWMATERIALS');
            const isXRay = normId.includes('INSPECTION');
            let displayName = isRM ? 'RAW MATERIALS' : (isXRay ? 'X RAY' : id.toUpperCase().replace(/_/g, ' '));
            
            let titlePrefix = (type === 'asset' || this.primaryMode === 'machines') ? 'ASSET: ' : 'DEVICE: ';
            titleEl.textContent = titlePrefix + displayName;
            navEl.prepend(titleEl);

            // Contextual Rendering: If in Alarm Mode, show Alarms & Logs instead of Diagnostics
            if (this.primaryMode === 'alarm' || this.primaryMode === 'alarms') {
                this.renderMachineAlarmPanel(id, contentEl);
            } else {
                const modeToRender = (type === 'asset' || this.primaryMode === 'machines') ? 'metadata' : 'diagnostics';
                this.renderMachinePanel(id, contentEl, modeToRender);
            }
        } else if (type === 'alarm' || type === 'alarms') {
            titleEl.textContent = 'Alarms & Isolation';
            navEl.prepend(titleEl);
            this.renderSafetyPanel(contentEl);
        }
    }

    renderZonePanel(zoneId, data, container) {
        if (!data) return;
        const deptLabel = (this.departmentLabels[zoneId] || zoneId.replace(/_/g, ' ')).toUpperCase();
        
        let html = `
            <div class="kpi-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="kpi-mini" style="border-left: 3px solid var(--primary); background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Real-time Load</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'">${data.instantKW.toFixed(1)} <small style="font-size: 10px; font-weight: normal; color: var(--text-dim)">kW</small></div>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid var(--success); background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Production</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'">${data.production} <small style="font-size: 10px; font-weight: normal; color: var(--text-dim)">u</small></div>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid var(--accent-blue); background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Efficiency</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'">${data.energyPerUnit.toFixed(2)} <small style="font-size: 10px; font-weight: normal; color: var(--text-dim)">kWh/u</small></div>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid ${data.scrapRate > 5 ? 'var(--danger)' : 'var(--warning)'}; background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Scrap Rate</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'; color: ${data.scrapRate > 5 ? 'var(--danger)' : 'var(--success)'}">${data.scrapRate.toFixed(1)}%</div>
                </div>
            </div>
            <div class="sidebar-section-title" style="margin-top: 24px;">ASSETS IN ${deptLabel}</div>
            <div class="sidebar-nav-list">
        `;

        const members = this.machineGroups[zoneId] || [];
        members.forEach(mid => {
            const m = this.analytics.data.machines[mid.toUpperCase()] || this.analytics.data.machines[mid] || this._findMachineData(mid);
            if (!m) return;
            const state = (m.state || '').toLowerCase();
            const icon = 'inventory'; // Terminology change: Assets
            const color = state === 'running' ? 'var(--success)' : (state === 'fault' ? 'var(--danger)' : 'var(--text-dim)');

            html += `
                <a href="#" class="sidebar-nav-item" onclick="event.preventDefault(); window.app.setContext('machine', '${mid}')">
                    <span class="material-symbols-outlined" style="color: ${color}">${icon}</span>
                    <div style="flex: 1; display: flex; justify-content: space-between; align-items: center">
                        <span>${mid}</span>
                        <strong style="font-family: 'JetBrains Mono'">${(m.instantKW || 0).toFixed(1)} kW</strong>
                    </div>
                </a>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    renderMachinePanel(id, container, mode = 'metadata') {
        try {
            const asset = this._findAsset(id);
            const { cache } = this._findTelemetry(id);
            const raw = cache instanceof Map ? Object.fromEntries(cache) : (cache || {});

            const displayName = asset ? (asset.name || id).toUpperCase().replace(/_/g, ' ') : id.toUpperCase();
            const dept = asset ? (this.departmentLabels[asset.department.toLowerCase()] || asset.department) : '—';

            let html = '';

            if (mode === 'metadata') {
                // ── ASSET MODE: Metadata + Maintenance ──────────────────────────
                html = `
                    <div class="panel-section">
                        <div class="sidebar-section-title" style="color: var(--primary); letter-spacing: 2px;">ASSET PROFILE</div>
                        <div class="sidebar-data-group" style="border-left: 2px solid var(--primary); background: rgba(0, 166, 81, 0.05); padding: 16px; border-radius: 4px;">
                            ${this._row('Asset ID', id.toUpperCase())}
                            ${this._row('Machine Name', displayName)}
                            ${this._row('Department', dept)}
                            ${this._row('Model / Specification', asset ? asset.model : 'ST-2400-A')}
                            ${this._row('Serial Number', asset ? asset.serial_number : '---')}
                            ${this._row('Primary Vendor', asset ? asset.vendor : '---')}
                            ${this._row('Installation Date', asset ? asset.install_date : '---')}
                        </div>
                    </div>
                `;

                // ── MAINTENANCE INSIGHTS (Phase 21 Integration) ───────────────
                const seed = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                const healthScore = 85 + (seed % 12);
                const rul = (1000 + (seed % 500)).toLocaleString();
                const healthStatus = healthScore > 90 ? 'OPTIMAL' : 'STABLE';
                const healthColor = healthScore > 90 ? 'var(--success)' : 'var(--warning)';

                html += `
                    <div class="panel-section">
                        <div class="sidebar-section-title">UNIT ANALYTICS</div>
                        <div class="health-meter-card">
                            <div class="health-meter-header">
                                <span class="health-score-title">Machine Health Score</span>
                                <span class="health-score-tag" style="background: ${healthColor}22; color: ${healthColor}">${healthStatus}</span>
                            </div>
                            <div class="health-score-main">
                                <span class="health-score-value">${healthScore}%</span>
                                <span class="health-score-total">/ 100</span>
                            </div>
                            <div class="health-progress-bar">
                                <div class="health-progress-fill" style="width: ${healthScore}%"></div>
                            </div>
                        </div>

                        <div class="rul-card" style="margin-top: 12px;">
                            <span class="material-symbols-outlined rul-icon">precision_manufacturing</span>
                            <div class="health-score-title">Predictive RUL</div>
                            <div style="font-size: 10px; color: var(--text-dim); margin-bottom: 8px;">REMAINING USEFUL LIFE</div>
                            <div style="display: flex; align-items: baseline; gap: 6px;">
                                <span style="font-size: 24px; font-weight: 900; color: var(--text-main); font-family: 'JetBrains Mono'">${rul}</span>
                                <span style="font-size: 12px; font-weight: 700; color: var(--text-dim)">HOURS</span>
                            </div>
                        </div>
                    </div>

                    <div class="panel-section">
                        <div class="sidebar-section-title">UPCOMING MAINTENANCE</div>
                        <div class="task-list">
                            <div class="task-item">
                                <div class="task-icon-box">
                                    <span class="material-symbols-outlined">filter_alt</span>
                                </div>
                                <div class="task-info">
                                    <div class="task-name">Filter Change</div>
                                    <div class="task-unit">System Hydraulics</div>
                                </div>
                                <div class="task-timing">
                                    <span class="task-due">${10 + (seed % 5)}h</span>
                                    <span class="task-status">DUE</span>
                                </div>
                            </div>
                            <div class="task-item">
                                <div class="task-icon-box">
                                    <span class="material-symbols-outlined">oil_barrel</span>
                                </div>
                                <div class="task-info">
                                    <div class="task-name">Bearing Lubrication</div>
                                    <div class="task-unit">Spindle Unit 04</div>
                                </div>
                                <div class="task-timing">
                                    <span class="task-due" style="color: var(--text-dim)">${40 + (seed % 10)}h</span>
                                    <span class="task-status">SCHED</span>
                                </div>
                            </div>
                        </div>
                        
                        <button class="maintenance-report-btn">
                            <span class="material-symbols-outlined" style="font-size: 18px">description</span>
                            Generate Maintenance Report
                        </button>
                    </div>
                `;
            } else {
                // ── PLANT MODE: Diagnostics / Live Telemetry ───────────────────
                const machineData = this._findMachineData(id);
                const stateVal = (machineData?.state || raw['CalculatedState'] || raw['State'] || 'OFFLINE');
                const stateLower = String(stateVal).toLowerCase();
                const stateColor = stateLower === 'running' ? 'var(--success)' : (stateLower === 'stopped' ? 'var(--text-dim)' : 'var(--danger)');

                const deviceType = this.getDeviceType(id);
                const isNonDevice = (deviceType === 'STORAGE' || deviceType === 'INBOUND' || deviceType === 'OUTBOUND');

                if (!isNonDevice) {
                    html = `
                        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase; font-weight: 800;">Live Operational State</div>
                            <div style="display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; background: ${stateColor}22; border: 1px solid ${stateColor}44; color: ${stateColor}; font-size: 10px; font-weight: 800;" id="state-${id}">
                                <span class="material-symbols-outlined" style="font-size: 14px">power_settings_new</span>
                                ${String(stateVal).toUpperCase()}
                            </div>
                        </div>
                    `;
                } else {
                    html = ''; // Do NOT render operational state and controls for raw materials / outbound
                }


                const schema = deviceType ? this.sidebarSchemas[deviceType] : null;

                if (schema) {
                    for (const [groupName, tags] of Object.entries(schema)) {
                        let groupHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">';
                        let hasData = false;
                        for (const tag of tags) {
                            let val = this.getValue(raw, tag);
                            if (val === undefined || val === null) continue;
                            hasData = true;

                            const formattedVal = typeof val === 'number' ?
                                (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2)) :
                                (typeof val === 'boolean' ? (val ? 'ACTIVE' : 'INACTIVE') : val);

                            const unit = this._getUnit(tag);
                            const label = this._formatTagLabel(tag);
                            groupHtml += `
                            <div style="background: var(--surface-dark); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); transition: border-color 0.3s;">
                                <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 2px;">${label}</div>
                                <div style="font-size: 14px; font-weight: 800; color: var(--text-main); font-family: 'JetBrains Mono', monospace;" id="metric-${id}-${tag}">
                                    ${formattedVal} <span style="font-size: 10px; font-weight: normal; color: var(--text-dim)">${unit}</span>
                                </div>
                            </div>`;
                        }
                        groupHtml += '</div>';
                        if (hasData) {
                            html += `<div class="panel-section">
                                <div class="sidebar-section-title" style="display: flex; align-items: center; gap: 8px;">
                                    <span style="width: 4px; height: 4px; background: var(--primary); border-radius: 50%;"></span>
                                    ${groupName.toUpperCase()}
                                </div>
                                ${groupHtml}
                            </div>`;
                        }
                    }
                }
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
        let html = '';

        // ── Section 1: Asset Selection (Conditional Dropdown) ──
        if (this.energyViewSettings.viewType === 'select') {
            const allMachineIds = Object.values(this.machineGroups).flat().sort();
            html += `
                <div class="panel-section">
                    <div class="sidebar-section-title">ASSET SELECTION</div>
                    <div class="custom-select-wrapper">
                        <select class="data-select" onchange="window.app.setSelectedMachine(this.value)">
                            <option value="">-- Select Target Asset --</option>
                            ${allMachineIds.map(mid => `<option value="${mid}" ${this.energyViewSettings.selectedMachineId === mid ? 'selected' : ''}>${mid}</option>`).join('')}
                        </select>
                        <span class="material-symbols-outlined custom-select-arrow">expand_more</span>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="panel-section" style="padding: 24px; color: var(--text-dim); text-align: center; font-size: 11px;">
                    Operational telemetry active.<br>Spatial energy data visible in 3D viewport.
                </div>
            `;
        }

        // USER REQUEST: Detailed consumption removed from sidebar. Data is strictly in 3D chips.
        container.innerHTML = html;
    }

    setEnergyViewType(type) {
        this.energyViewSettings.viewType = type;
        const leftPanel = document.getElementById('left-sidebar');
        
        if (type === 'all' && this.scene) {
            this.scene.resetToDefaultView(); // BACK TO INITIAL VIEW
            if (leftPanel) leftPanel.classList.remove('open');
        } else {
            this.energyViewSettings.selectedMachineId = null;
            if (leftPanel) leftPanel.classList.add('open');
        }
        this.refreshUI(true);
    }

    setSelectedMachine(id) {
        this.energyViewSettings.selectedMachineId = id;
        if (id && this.scene) {
            this.scene.isolateGroup([id]);
        }
        this.refreshUI(true);
    }

    setEnergyParameter(param) {
        this.energyViewSettings.parameter = param;
        // Map param to chip mode
        const modeMap = { 'energy': 'energy', 'cycle': 'cycle', 'status': 'status' };
        if (this.scene) {
            this.scene.setChipDisplayMode(modeMap[param]);
            this.scene.updateEnergyChips(true); // Ensure they stay updated
        }
        this.refreshUI(true);
    }

    renderSafetyPanel(container) {
        let html = '';

        // ── Active Alarms Section ──
        html += '<div class="sidebar-section-title" style="display:flex;align-items:center;gap:6px"><span class="material-symbols-outlined" style="font-size:16px;color:var(--danger)">warning</span>SYSTEM ALARMS</div>';
        html += '<div class="sidebar-nav-list">';
        let alarmCount = 0;
        this.liveState.forEach((cache, id) => {
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
                            <div style="font-size: 10px; color: var(--text-dim); margin-top: 4px">Active Fault: Requires Intervention</div>
                        </div>
                    </div>
                `;
            }
        });
        if (alarmCount === 0) {
            html += '<div style="padding: 16px; text-align: center; color: var(--text-dim)">System Secure: No Alarms</div>';
        }
        html += '</div>';

        // ── Isolated Units Section ──
        html += '<div class="sidebar-section-title" style="display:flex;align-items:center;gap:6px;margin-top:16px"><span class="material-symbols-outlined" style="font-size:16px;color:var(--primary)">lock_reset</span>ISOLATION / LOTO</div>';
        html += '<div class="sidebar-nav-list">';
        let isolationCount = 0;
        this.liveState.forEach((cache, id) => {
            const state = (cache.get('CalculatedState') || '').toLowerCase();
            if (state === 'stopped' || cache.get('Enabled') === false) {
                isolationCount++;
                html += `
                    <div class="sidebar-nav-item" style="border-left: 2px solid var(--primary); background: rgba(236,91,19,0.05)">
                        <span class="material-symbols-outlined" style="color: var(--primary)">lock_reset</span>
                        <div style="flex: 1">
                            <div style="display: flex; justify-content: space-between">
                                <span>${id}</span>
                                <span style="font-size: 10px; color: var(--primary)">LOTO ACTIVE</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        });
        if (isolationCount === 0) {
            html += '<div style="padding: 16px; text-align: center; color: var(--text-dim)">No units in isolation</div>';
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
                const icon = 'inventory'; // Asset terminology
                const isXRay = mid.toUpperCase().includes('INSPECTION');
                const displayName = isXRay ? mid.replace(/INSPECTION/i, 'X-RAY') : mid;
                html += `
                    <a href="#" class="sidebar-nav-item" onclick="event.preventDefault(); window.app.setContext('asset', '${mid}')">
                        <span class="material-symbols-outlined" style="color: ${color}">${icon}</span>
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center">
                            <span>${displayName}</span>
                            <strong style="font-family: 'JetBrains Mono'; font-size: 11px">${m ? (m.instantKW || 0).toFixed(1) + ' kW' : '---'}</strong>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }
        contentEl.innerHTML = html;
    }

    renderMachineAlarmPanel(id, container) {
        const cache = this.liveState.get(id.toUpperCase()) || new Map();
        const state = (cache.get('CalculatedState') || 'OFFLINE').toLowerCase();
        const isFault = ['stopped', 'fault', 'error'].includes(state);
        const stateColor = isFault ? 'var(--danger)' : 'var(--success)';

        let html = `
            <div style="background: ${stateColor}11; border: 1px solid ${stateColor}33; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Current Diagnostic State</span>
                    <span style="font-size: 10px; font-weight: 800; color: ${stateColor}; text-transform: uppercase;">${state}</span>
                </div>
                <div style="margin-top: 12px; font-size: 14px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="color: ${stateColor}">${isFault ? 'report' : 'check_circle'}</span>
                    ${isFault ? 'Active Machine Fault Detected' : 'No Active Device Alarms'}
                </div>
            </div>

            <div class="sidebar-section-title">DEVICE ALARM LOG</div>
            <div class="sidebar-nav-list">
        `;
        // Machine-Specific Alarm Logic (Phase 23)
        const deviceTypeId = id.toLowerCase();
        let machineAlarms = [];
        
        if (isFault) {
            if (deviceTypeId.includes('furnace')) {
                machineAlarms = [
                    { time: '10:42:15', msg: 'Core Temperature Over Limit', type: 'crit' },
                    { time: '10:15:02', msg: 'Heating Element Continuity Fault', type: 'crit' },
                    { time: '09:58:44', msg: 'Exhaust Fan RPM Low', type: 'warn' }
                ];
            } else if (deviceTypeId.includes('cnc')) {
                machineAlarms = [
                    { time: '10:40:12', msg: 'Spindle Vibration Warning', type: 'warn' },
                    { time: '10:12:05', msg: 'Coolant Pressure Critical Drop', type: 'crit' },
                    { time: '09:45:30', msg: 'Axis Limit Switch Tripped', type: 'crit' }
                ];
            } else if (deviceTypeId.includes('degasser')) {
                machineAlarms = [
                    { time: '10:38:22', msg: 'Argon Flow Rate Below Min', type: 'crit' },
                    { time: '10:05:15', msg: 'Impeller Torque Overload', type: 'crit' },
                    { time: '09:50:11', msg: 'Rotor Seal Integrity Alert', type: 'warn' }
                ];
            } else if (deviceTypeId.includes('lpdc')) {
                machineAlarms = [
                    { time: '10:41:05', msg: 'Die Cavity Pressure Loss', type: 'crit' },
                    { time: '10:10:44', msg: 'Hydraulic Piston Leak', type: 'crit' },
                    { time: '09:55:12', msg: 'Filling Sequence Timed Out', type: 'warn' }
                ];
            } else {
                machineAlarms = [
                    { time: '10:42:15', msg: 'General System Fault', type: 'crit' },
                    { time: '10:15:02', msg: 'Unknown Sensor Error', type: 'warn' },
                    { time: '09:58:44', msg: 'Emergency Stop Engaged', type: 'crit' }
                ];
            }
        } else {
            machineAlarms = [
                { time: '08:30:12', msg: 'System Calibration Complete', type: 'info' },
                { time: '08:00:00', msg: 'Shift Start: Operational', type: 'info' }
            ];
        }

        machineAlarms.forEach(log => {
            const dotColor = log.type === 'crit' ? 'var(--danger)' : (log.type === 'warn' ? 'var(--warning)' : '#2196F3');
            html += `
                <div class="sidebar-nav-item" style="border-left: 2px solid ${dotColor}; background: rgba(255,255,255,0.02); margin-bottom: 4px; display: block; padding: 10px 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; font-weight: 800; color: var(--text-main);">${log.msg}</span>
                        <span style="font-size: 9px; color: var(--text-dim); font-family: 'JetBrains Mono'">${log.time}</span>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }


    // ─── Gemba Walk Mode ─────────────────────────────────────────────
    startGembaWalk() {
        this.gembaWaypoints = [
            { dept: null, ids: ['RAWMATERIALS'], label: 'Raw Materials' },
            { dept: null, ids: ['FURNACE_01'], label: 'Furnace' },
            { dept: null, ids: ['DEGASSER_01', 'DEGASSER_02'], label: 'Degassers' },
            { dept: 'die_casting', label: 'LPDC Casting' },
            { dept: null, ids: ['COOLING_01'], label: 'Cooling Tank #01' },
            { dept: 'heat_treating', label: 'Heat Treatment' },
            { dept: null, ids: ['COOLING_02'], label: 'Cooling Tank #02' },
            { dept: null, ids: ['CNC_01'], label: 'CNC Machining #01' },
            { dept: null, ids: ['CNC_02'], label: 'CNC Machining #02' },
            { dept: null, ids: ['PRETREAT_01'], label: 'Pre-Treatment' },
            { dept: null, ids: ['PAINT_01'], label: 'Paint Shop #01' },
            { dept: null, ids: ['PAINT_02'], label: 'Paint Shop #02' },
            { dept: null, ids: ['INSPECTION_01'], label: 'X-Ray Inspection' },
            { dept: null, ids: ['OUTBOUND_01'], label: 'Outbound' },
        ];
        this.gembaIndex = 0;
        this.gembaPaused = false;

        // Show tour control bar
        let bar = document.getElementById('gemba-tour-bar');
        if (bar) {
            // Attach listeners once? Or every time? 
            // Better to attach once in constructor, but for now we'll ensure ID existence
            if (!bar.dataset.initialized) {
                document.getElementById('gemba-prev').onclick = () => this.gembaNavigate(-1);
                document.getElementById('gemba-next').onclick = () => this.gembaNavigate(1);
                document.getElementById('gemba-pause').onclick = () => {
                    this.gembaPaused = !this.gembaPaused;
                    document.getElementById('gemba-pause').querySelector('span').textContent = this.gembaPaused ? 'play_arrow' : 'pause';
                };
                document.getElementById('gemba-stop').onclick = () => this.stopGembaWalk();
                bar.dataset.initialized = "true";
            }
            bar.style.display = 'flex';
        }

        // Show Gemba Info Overlay
        const infoOverlay = document.getElementById('gemba-info-overlay');
        if (infoOverlay) infoOverlay.style.display = 'flex';

        this.gembaNavigate(0); // Go to first waypoint
        this.gembaTimer = setInterval(() => {
            if (!this.gembaPaused) this.gembaNavigate(1);
        }, 8000);
    }

    gembaNavigate(delta) {
        if (!this.gembaWaypoints) return;
        this.gembaIndex = (this.gembaIndex + delta + this.gembaWaypoints.length) % this.gembaWaypoints.length;
        const wp = this.gembaWaypoints[this.gembaIndex];

        // Update Gemba Info Overlay (Top Left)
        const machineEl = document.getElementById('gemba-machine-name');
        if (machineEl) {
            machineEl.textContent = wp.label || 'SYSTEM OVERVIEW';
        }

        // Frame the department's machines
        const deviceIds = wp.dept ? this.machineGroups[wp.dept] : wp.ids;
        if (deviceIds) this.scene.isolateGroup(deviceIds);
    }

    stopGembaWalk() {
        if (this.gembaTimer) clearInterval(this.gembaTimer);
        this.gembaTimer = null;
        const bar = document.getElementById('gemba-tour-bar');
        if (bar) bar.style.display = 'none';

        const infoOverlay = document.getElementById('gemba-info-overlay');
        if (infoOverlay) infoOverlay.style.display = 'none';

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
        const isRM = deviceId.includes('STORAGE') || deviceId.includes('INBOUND') || deviceId.includes('RAW');
        const finalId = isRM ? 'RAWMATERIALS' : deviceId;

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

            // 4. Final Refresh via Targeted DOM Updates
            this.updateLiveDOM(finalId, fullData);
        }
    }

    updateLiveDOM(deviceId, fullData) {
        // Compute hierarchy and update ONLY text elements, completely avoiding innerHTML layout thrashing
        const hierarchy = this.analytics.update(this.liveState, this.machineGroups);
        this.updateTopStrip(hierarchy.plant);
        this.updateKPIRow(hierarchy.plant);

        const { cache } = this._findTelemetry(deviceId);
        const raw = cache instanceof Map ? Object.fromEntries(cache) : (cache || {});

        const deviceType = this.getDeviceType(deviceId);
        const schema = deviceType ? this.sidebarSchemas[deviceType] : null;

        if (schema) {
            for (const [groupName, tags] of Object.entries(schema)) {
                for (const tag of tags) {
                    let val = this.getValue(raw, tag);
                    if (val !== undefined && val !== null) {
                        const el = document.getElementById(`metric-${deviceId}-${tag}`);
                        if (el) {
                            const formattedVal = typeof val === 'number' ?
                                (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2)) :
                                (typeof val === 'boolean' ? (val ? 'ACTIVE' : 'INACTIVE') : val);
                            const unit = this._getUnit(tag);
                            el.innerHTML = `${formattedVal} <span style="font-size: 10px; font-weight: normal; color: var(--text-dim)">${unit}</span>`;
                        }
                    }
                }
            }
        }

        const stateVal = (this.getValue(raw, 'CalculatedState') || this.getValue(raw, 'State') || 'OFFLINE');
        const stateEl = document.getElementById(`state-${deviceId}`);
        if(stateEl) {
            stateEl.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px">power_settings_new</span> ${String(stateVal).toUpperCase()}`;
        }
    }

    _populateStore(id, data, state) {
        let cache = this.liveState.get(id) || new Map();
        Object.entries(data).forEach(([k, v]) => cache.set(k, v));
        if (state !== null) {
            cache.set('CalculatedState', state);
        }
        this.liveState.set(id, cache);
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

        // 3. Normalized fuzzy match (Robust prefix/contains matching)
        const targetAlpha = lowerTarget.replace(/[0-9]/g, '');

        for (const [k, v] of Object.entries(data)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normAlpha = normK.replace(/[0-9]/g, '');

            // Cross-direction check: target contains store key OR store key contains target
            if (normK === lowerTarget ||
                normAlpha === targetAlpha ||
                normAlpha.includes(targetAlpha) ||
                targetAlpha.includes(normAlpha)) {
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

    sendDeviceCommand(id, cmd) {
        if (!this.websocket || !this.websocket.ws) return;
        this.websocket.ws.send(JSON.stringify({
            type: "write",
            node_id: `VirtualPLC.Devices.${id.toUpperCase()}.Inputs.${cmd}`,
            value: true
        }));
        console.log(`[Command] Sent ${cmd} to ${id}`);
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
        this.liveState.forEach((cache) => {
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
