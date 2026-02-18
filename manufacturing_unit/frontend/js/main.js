/**
 * Main Application logic for Digital Twin
 * Hands-off discovery and precision mapping
 */

import SceneManager from './scene.js';
import WebSocketHandler from './websocket.js';
import StateManager from './stateManager.js';

class DigitalTwinApp {
    constructor() {
        this.scene = null;
        this.stateManager = null;
        this.websocket = null;
        this.activeDetailsId = null;
        this.activeMode = 'telemetry'; // 'telemetry' | 'meta'
        this.assetData = {}; // device_id -> asset info
        // Unified telemetry store (deviceId -> Map(key -> value))
        this.telemetryStore = new Map(); 
        
        // Sticky layouts for Sidebars
        // 3D Overlay Preferred Schemas
        this.overlaySchemas = {
            'FURNACE': ['Temperature', 'TargetTemp', 'Progress', 'ProcessedCount', 'PowerKW', 'FurnaceMaxTemp'],
            'LPDC': ['PressurePSI', 'Progress', 'ProcessedCount', 'PowerKW'],
            'CNC': ['SpindleRPM', 'Progress', 'ProcessedCount', 'PowerKW'],
            'INSPECTION': ['RejectCount', 'Progress', 'ProcessedCount', 'PowerKW', 'Fail_rate'],
            'PLANT': ['KPI_yield_percent', 'KPI_throughput_wheels_hr', 'KPI_total_wheels_produced']
        };

        // Meta KPIs (Static Data)
        // Meta KPIs (Initial Placeholders - Updated dynamically)
        this.metaKPIs = {
            'FURNACE': { uptime: '0 hrs', energy: '0 kWh' },
            'LPDC': { uptime: '0 hrs', energy: '0 kWh' },
            'CNC': { uptime: '0 hrs', energy: '0 kWh' },
            'INSPECTION': { uptime: '0 hrs', energy: '0 kWh' },
            'DEGASSER': { uptime: '0 hrs', energy: '0 kWh' },
            'PLANT': { uptime: '0 hrs', energy: '0 MWh' }
        };

        // Tour Manager State
        this.tourActive = true;
        this.tourIndex = 0;
        this.tourView = 'telemetry'; // 'telemetry' or 'meta'
        this.tourInterval = 5000; // 5 seconds for faster turn-over in demo, adjust as needed
        this.inactivityTimeout = 10000; // 10 seconds of no mouse move before auto-reveal
        this.lastInteraction = Date.now();

        // Strictly Appropriate Sidebar Telemetry Schemas
        this.sidebarSchemas = {
            'FURNACE': ['Temperature', 'TargetTemp', 'FurnaceMaxTemp', 'Progress', 'ProcessedCount', 'PowerKW', 'RuntimeTotalHrs', 'State'],
            'LPDC': ['PressurePSI', 'Progress', 'ProcessedCount', 'PowerKW', 'RuntimeTotalHrs', 'State', 'PourRequest'],
            'CNC': ['SpindleRPM', 'Progress', 'ProcessedCount', 'PowerKW', 'RuntimeTotalHrs', 'State', 'Trigger'],
            'INSPECTION': ['RejectCount', 'Fail_rate', 'Progress', 'ProcessedCount', 'PowerKW', 'RuntimeTotalHrs', 'State'],
            'DEGASSER': ['VacuumLevel', 'Temp', 'Progress', 'State', 'PowerKW', 'RuntimeTotalHrs'],
            'PLANT': ['YieldPercent', 'ThroughputWheelsHr', 'TotalWheelsProduced', 'TotalScrap', 'BatchesCompleted']
        };

        // Strictly Appropriate Sidebar KPI Schemas
        this.sidebarMetaSchemas = {
            'FURNACE': ['uptime', 'energy'],
            'LPDC': ['uptime', 'energy'],
            'CNC': ['uptime', 'energy'],
            'INSPECTION': ['uptime', 'energy'],
            'DEGASSER': ['uptime', 'energy'],
            'PLANT': ['uptime', 'energy']
        };

        this.sidebarLayouts = new Map();
        
        this.init();
        this.setupListeners();
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

        this.stateManager.onStateChange((deviceId, color) => {
            if (this.scene && typeof this.scene.updateMeshColor === 'function') {
                this.scene.updateMeshColor(deviceId, color);
            }
            this.updateCounter();
        });

        this.websocket = new WebSocketHandler(
            'ws://localhost:8000/ws',
            (deviceId, state, fullData) => this.handleData(deviceId, state, fullData),
            (status) => this.updateStatus(status)
        );

        this.websocket.connect();
        await this.scene.loadModel('assets/models/plant.glb');
        this.scene.start();
        
        // Start the Cyclic Tour
        this.initTour();
    }

    initTour() {
        console.log('[Tour] Starting Staged Sequence Manager');
        this.runTourCycle();
    }

    async runTourCycle() {
        while (true) {
            if (!this.tourActive) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const devices = Array.from(this.telemetryStore.keys());
            if (devices.length === 0) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const currentId = devices[this.tourIndex];
            
            // --- Phase 1: Show Telemetry (5s) ---
            if (this.tourActive) await this.showTourPhase(currentId, 'telemetry', 5000);
            
            // --- Phase 2: Hide / Visual Break (2s) ---
            if (this.tourActive) await this.hideTourPhase(2000);

            // --- Phase 3: Show Meta KPIs (5s) ---
            if (this.tourActive) await this.showTourPhase(currentId, 'meta', 5000);

            // --- Phase 4: Hide & Move to Next (2s) ---
            if (this.tourActive) {
                await this.hideTourPhase(2000);
                this.tourIndex = (this.tourIndex + 1) % devices.length;
            }
        }
    }

    async showTourPhase(id, mode, duration) {
        if (!this.tourActive) return;
        
        console.log(`[Tour] Phase: ${mode.toUpperCase()} for ${id}`);
        this.scene.selectDevice(id);
        
        // Expansion delay for smooth reveal
        await new Promise(r => setTimeout(r, 800));
        if (!this.tourActive) return;

        this.scene.setLabelExpanded(id, true);
        this.scene.setLabelMode(id, mode);
        this.renderSidebar(id, null);
        this.activeMode = mode;

        // Populate Meta Data if in meta mode
        if (mode === 'meta') {
            const schemaKey = Object.keys(this.metaKPIs).find(k => id.toLowerCase().includes(k));
            if (schemaKey) {
                this.scene.updateMetaKPIs(id, this.metaKPIs[schemaKey]);
            }
        }

        await new Promise(r => setTimeout(r, duration - 800));
    }

    async hideTourPhase(duration) {
        if (!this.tourActive) return;
        
        console.log(`[Tour] Phase: HIDE`);
        this.scene.resetInteraction();
        this.closeSidebar();
        await new Promise(r => setTimeout(r, duration));
    }

    setupListeners() {
        document.getElementById('close-details')?.addEventListener('click', () => this.closeSidebar());
        window.addEventListener('open-device-details', (e) => {
            const { deviceId } = e.detail;
            this.tourActive = false; 
            this.activeMode = 'telemetry'; // Start in telemetry view by default
            this.openSidebar(deviceId);
            
            // Sync Meta Data immediately
            const metaKey = Object.keys(this.metaKPIs).find(k => deviceId.toLowerCase().includes(k));
            if (metaKey) {
                this.scene.updateMetaKPIs(deviceId, this.metaKPIs[metaKey]);
            }
        });

        window.addEventListener('scene-background-click', () => {
            this.tourActive = true; 
            this.closeSidebar();
        });

        window.addEventListener('manual-view-change', () => {
            this.tourActive = false; 
            this.lastInteraction = Date.now();
        });

        const resetInteraction = () => {
            this.lastInteraction = Date.now();
            if (!this.tourActive && !this.activeDetailsId) {
                console.log('[Interaction] User inactive, resuming tour');
                this.tourActive = true;
            }
        };

        window.addEventListener('mousemove', resetInteraction);
        window.addEventListener('mousedown', resetInteraction);

        window.addEventListener('global-view-mode-change', (e) => {
            const { mode, deviceId } = e.detail;
            const normId = deviceId.toLowerCase();
            console.log(`[Sync] Global Mode Change: ${mode} for ${normId}`);
            this.activeMode = mode;
            
            // Sync sidebar if it's open for this device
            if (this.activeDetailsId === normId) {
                this.renderSidebar(normId);
            }
        });
    }

    handleData(rawId, state, fullData) {
        const deviceId = rawId.toUpperCase();
        this.stateManager.updateDeviceState(deviceId, state);
        if (fullData) {
            // 1. Sync Overlays (3D)
            const schemaKey = Object.keys(this.overlaySchemas).find(k => deviceId.includes(k));
            this.scene.updateDeviceLabel(deviceId, fullData, this.overlaySchemas[schemaKey] || null);

            // 2. Sync Meta Data for expanded card/sidebar
            // 2. Sync Meta Data for expanded card/sidebar
            const metaKey = Object.keys(this.metaKPIs).find(k => deviceId.includes(k));
            if (metaKey) {
                 // Dynamic KPI Updates
                 if (fullData.RuntimeTotalHrs !== undefined) {
                     const hrs = fullData.RuntimeTotalHrs;
                     this.metaKPIs[metaKey].uptime = hrs < 1 ? '< 1 hr' : `${Math.floor(hrs).toLocaleString()} hrs`;
                     
                     // Approximate Energy Calc: PowerKW * Hours
                     if (fullData.PowerKW !== undefined) {
                         const kwh = fullData.PowerKW * hrs;
                         this.metaKPIs[metaKey].energy = kwh > 1000 ? 
                             `${(kwh/1000).toFixed(1)} MWh` : 
                             `${Math.floor(kwh).toLocaleString()} kWh`;
                     }
                 }
                this.scene.updateMetaKPIs(deviceId, this.metaKPIs[metaKey]);
            }

            // 3. Persistence Sync (Consolidated Store)
            let cache = this.telemetryStore.get(deviceId) || new Map();
            Object.entries(fullData).forEach(([k, v]) => cache.set(k, v));
            cache.set('CalculatedState', state);
            this.telemetryStore.set(deviceId, cache);

            // 4. Guaranteed Sidebar Refresh if active (ALWAYS use consolidated store)
            if (this.activeDetailsId === deviceId) {
                this.renderSidebar(deviceId);
            }
        }
    }

    openSidebar(rawId) {
        const deviceId = rawId.toUpperCase();
        this.activeDetailsId = deviceId;
        const el = document.getElementById('details-sidebar');
        const title = document.getElementById('details-title');
        if (el) el.classList.add('open');
        if (title) title.textContent = deviceId; // Display industrial name

        this.renderSidebar(deviceId);
    }

    closeSidebar() {
        this.activeDetailsId = null;
        document.getElementById('details-sidebar')?.classList.remove('open');
    }

    renderSidebar(deviceId) {
        const content = document.getElementById('details-content');
        if (!content) return;

        const cache = this.telemetryStore.get(deviceId);
        if (!cache) {
            content.innerHTML = '<div class="no-data">Waiting for data...</div>';
            return;
        }
        const currentData = Object.fromEntries(cache);

        // 1. Choose Schema based on Active Mode
        const schemaSource = this.activeMode === 'meta' ? this.sidebarMetaSchemas : this.sidebarSchemas;
        const schemaKey = Object.keys(schemaSource).find(k => deviceId.toLowerCase().includes(k.toLowerCase()));
        const keys = schemaSource[schemaKey] || Object.keys(currentData);

        const assetInfo = this.assetData[deviceId] || {};
        const department = assetInfo.department || 'General Plant';

        let html = `<div class="dept-badge">${department.toUpperCase()}</div>`;
        html += '<table class="data-table">';
        keys.forEach(k => {
            let val, label;
            
            if (this.activeMode === 'meta') {
                // Pull from assets.json if specifically asked, else from legacy metaKPIs
                if (assetInfo[k]) {
                    val = assetInfo[k];
                } else {
                    const metaKey = Object.keys(this.metaKPIs).find(mk => deviceId.toLowerCase().includes(mk.toLowerCase()));
                    val = (metaKey && this.metaKPIs[metaKey]) ? this.metaKPIs[metaKey][k] : '---';
                }
                label = k.replace('_', ' ');
            } else {
                // Pull from telemetry
                val = this.getValue(currentData, k);
                label = k.includes('/') ? k.split('/').pop() : k;
            }

            html += `
                <tr class="data-row">
                    <td class="data-label">${label.toUpperCase()}</td>
                    <td class="data-value">${val !== undefined ? (typeof val === 'number' ? val.toFixed(2) : val) : '---'}</td>
                </tr>
            `;
        });
        html += '</table>';
        content.innerHTML = html;
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
        
        // 3. Normalized fuzzy match
        for (const [k, v] of Object.entries(data)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Match if normalized keys are identical or if the payload key ends with the target
            if (normK === lowerTarget || normK.endsWith(lowerTarget)) {
                return v;
            }
        }
        return undefined;
    }

    updateStatus(s) {
        const el = document.getElementById('connection-status');
        if (el) { el.className = s; el.textContent = 'GATEWAY: ' + s.toUpperCase(); }
    }

    updateCounter() {
        const el = document.getElementById('device-count');
        if (el) el.textContent = `SYSTEM ONLINE | ${this.stateManager.getDeviceCount()} UNITS`;
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new DigitalTwinApp(); });
