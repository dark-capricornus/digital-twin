/**
 * Main Application logic for Digital Twin
 * Hands-off discovery and precision mapping
 */

import Renderer from './renderer.js';
import WebSocketHandler from './websocket.js';
import StateManager from './stateManager.js';
import UIUpdater from './uiUpdater.js';
import EnergyAnalytics from './EnergyAnalytics.js';
import SidebarController from './sidebarController.js';
import LoadingScreen from './loader.js';

class DigitalTwinApp {
    constructor() {
        this.renderer = null;
        this.stateManager = new StateManager();
        this.sidebar = new SidebarController();
        this.ui = new UIUpdater(this, this.stateManager);
        this.websocket = null;
        this.analytics = new EnergyAnalytics();
        this.loader = new LoadingScreen({ color: '#ec5b13' });

        this.activeContext = { type: 'plant', id: null };
        this.primaryMode = 'plant';
        this.assetData = {};
        this.forceRefresh = false;

        // Energy View State
        this.energyViewSettings = {
            parameter: 'status',
            viewType: 'all',
            selectedMachineId: null
        };
        this.lastChipMode = 'status';

        this.sidebarSchemas = this._getSidebarSchemas();
        
        // [USER] Machine-specific Primary Tags for high-density Summary View
        this.primaryTags = {
            'FURNACE': ['Temperature', 'Furnace_Instant_kW', 'Processed_Count'],
            'DEGASSER': ['Temperature', 'Degasser_Instant_kW', 'Processed_Count', 'Vibration_mm_s'],
            'LPDC': ['Riser_Pressure', 'Cycle_Time', 'Shot_Count', 'Internal_Temp'],
            'COOLING': ['Internal_Temp', 'Cooling_Instant_kW', 'Cooling_Run_Status'],
            'CNC': ['Spindle_RPM', 'Part_Count', 'Cycle_Time', 'Motor_Load_Pct'],
            'HEAT': ['Furnace_Temperature', 'Step_Timer', 'Internal_Temp', 'Process_Step'],
            'INSPECTION': ['Inspected_Count', 'OK_Count', 'Inspection_Cycle_Time'],
            'PAINT': ['Booth_Temperature', 'Booth_Humidity', 'Booth_Cycle_Status']
        };
        this.machineGroups = this._getMachineGroups();
        this.departmentLabels = this._getDepartmentLabels();

        // Gemba Audit State
        this.auditLogs = [];

        // [PERF] Move all initialization logic into an async chain
        // This allows the constructor to return immediately, clearing DOMContentLoaded
        this.setupListeners();
        
        // Add a global error listener for unhandled module errors
        window.onerror = (msg, url, lineNo, columnNo, error) => {
            if (this.loader) {
                this.loader.update(undefined, `ERROR: ${msg.split('\n')[0]}`);
                // Highlight error color
                this.loader.statusText.style.color = '#ff3300';
            }
            return false;
        };

        setTimeout(() => this.init(), 100);
    }

    resetInteraction() {
        this.setContext('plant');
        if (this.renderer) this.renderer.resetToDefaultView();
    }

    updateStatus(status) {
        console.log(`[App] Connection status: ${status}`);
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            statusEl.textContent = status.toUpperCase();
            statusEl.className = `status-badge ${status}`;
        }
    }

    updateCounter() {
        // [PERF] Optimized out of high-frequency events
    }

    startUpdateLoop() {
        if (this.ui) {
            this.ui.startUpdateLoop();
        }
    }

    async initialRenderChips() {
        const chipContainer = document.getElementById('status-chips-container');
        if (!chipContainer) return;

        // Clear Existing
        chipContainer.innerHTML = '';

        // Define key assets to show
        const assetsToShow = ['FURNACE_01', 'LPDC_01', 'CNC_01', 'CNC_02', 'INSPECTION_01', 'HEAT_01'];
        const BATCH_SIZE = 3;

        // [PERF] Stagger chip creation over multiple animation frames
        // This prevents the 180ms blockage by splitting DOM work into ~16ms chunks
        for (let i = 0; i < assetsToShow.length; i += BATCH_SIZE) {
            const batch = assetsToShow.slice(i, i + BATCH_SIZE);
            batch.forEach(id => {
                const chip = document.createElement('div');
                chip.className = 'status-chip offline';
                chip.id = `nav-chip-${id}`;
                chip.innerHTML = `
                    <span class="chip-label">${id.replace('_01', '')}</span>
                    <span class="chip-indicator"></span>
                `;
                chip.addEventListener('click', () => {
                    this.renderer.focusOnDevice(id);
                    this.setContext('asset', id);
                });
                chipContainer.appendChild(chip);
            });
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    _getSidebarSchemas() {
        return {
            'FURNACE': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Temperature': ['Temperature', 'TargetTemp', 'FurnaceMaxTemp'],
                'Process': ['Progress', 'State'],
                'Status': ['IsRunning', 'StateCode', 'FaultCode']
            },
            'DEGASSER': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Process': ['VacuumLevel', 'Temp', 'Progress', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'LPDC': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Production': ['ProcessedCount', 'State', 'Progress'],
                'Pressure': ['PressurePSI'],
                'Status': ['IsRunning', 'StateCode']
            },
            'COOLING': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Temperature': ['Temperature', 'TargetTemp'],
                'Status': ['IsRunning', 'StateCode']
            },
            'CNC': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Production': ['ProcessedCount', 'Progress', 'State'],
                'Process': ['SpindleRPM'],
                'Status': ['IsRunning', 'StateCode']
            },
            'HEAT': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Temperature': ['FurnaceTemperature', 'TemperatureSetpoint'],
                'Process': ['ProcessStep', 'StepTimer', 'Progress', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'INSPECTION': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Production': ['RejectCount', 'ProcessedCount', 'Progress', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'PRETREAT': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Process': ['Stage_Status', 'Conveyor_Speed', 'Dryer_Temperature', 'Progress', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'PAINT_01': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
                'Process': ['Booth_Cycle_Status', 'Progress', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'PAINT_02': {
                'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
                'Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
                'Process': ['Booth_Cycle_Status', 'Progress', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'OUTBOUND': {
                'Production': ['PartCount', 'State'],
                'Status': ['IsRunning', 'StateCode']
            },
            'RAWMATERIALS': {
                'Storage Status': ['IsRunning', 'Capacity'],
                'Inventory': ['PartCount']
            },
            'SHIPPING': {
                'Status': ['State']
            },
            'PLANT': {
                'PLC Status': ['State', 'ScanTime_ms'],
                'WIP Metrics': ['Molten_Metal_Kg', 'Degassed_Metal_Kg', 'Ingots_Kg', 'Cast_Parts', 'Cooled_Parts_1', 'Cooled_Parts_2', 'Heat_Treated_Parts', 'Machined_Parts', 'Pretreated_Parts', 'Painted_Parts'],
                'Quality': ['Xray_Passed', 'Qc_Passed', 'Scrap_Parts']
            },
            'PRODUCTION': {
                'KPI Overview': ['Production_Target', 'Yield_Pct', 'OEE_Target', 'Uptime_Target', 'Hourly_Throughput', 'Energy_Efficiency_Pct'],
                'Global Output': ['Batches_Completed']
            }
        };
    }

    _getMachineGroups() {
        return {
            'logistics': ['RAWMATERIALS'],
            'smelting': ['FURNACE_01', 'DEGASSER_01', 'DEGASSER_02'],
            'die_casting': ['LPDC_01', 'LPDC_02', 'LPDC_03', 'COOLING_01'],
            'qc': ['INSPECTION_01'],
            'heat_treating': ['HEAT_01'],
            'machining': ['CNC_01', 'CNC_02'],
            'paint_shop': ['PRETREAT_01', 'PAINT_01', 'PAINT_02'],
            'shipping': ['OUTBOUND_01', 'OUTBOUND_02'],
        };
    }

    _getDepartmentLabels() {
        return {
            'logistics': 'Raw Materials',
            'smelting': 'Smelting',
            'die_casting': 'Die Casting',
            'qc': 'Quality Control',
            'heat_treating': 'Heat Treatment',
            'machining': 'Machining',
            'paint_shop': 'Finishing',
            'shipping': 'Shipping',
        };
    }

    setupSidebarToggles() {
        const trigger = document.getElementById('sidebar-trigger');
        if (trigger) {
            trigger.onclick = () => {
                // Plant and Gemba views have NO left sidebar feature
                if (this.primaryMode === 'plant' || this.primaryMode === 'gemba') return;
                const leftSidebar = document.getElementById('left-sidebar');
                const isOpen = leftSidebar?.classList.contains('open');
                this.toggleLeftSidebar(!isOpen);
            };
        }
    }

    toggleLeftSidebar(expand) {
        const leftPanel = document.getElementById('left-sidebar');
        const triggerIcon = document.getElementById('trigger-icon');
        if (!leftPanel) return;

        // Plant and Gemba views have NO left sidebar — block completely
        if (this.primaryMode === 'plant' || this.primaryMode === 'gemba') {
            leftPanel.classList.remove('open');
            const triggerBtn = document.getElementById('sidebar-trigger');
            if (triggerBtn) triggerBtn.style.display = 'none';
            this.clearSidebarGuards('left');
            return;
        }

        if (expand) {
            leftPanel.classList.add('open');
            if (triggerIcon) triggerIcon.textContent = 'close';

            // Render content ONLY when expanding or while open
            if (this.analytics) {
                const hierarchy = this.analytics.update(this.stateManager.deviceStates, this.machineGroups);
                if (this.ui) this.ui.clearCache(); // [FIX] Invalidate cache on structural change
                this.renderLeftSidebar(hierarchy);
            }
        } else {
            leftPanel.classList.remove('open');
            // Revert icon to current mode
            this.updateTriggerIcon();
            // Optional: Clear content to reduce DOM weight / avoid flicker on next open
            const contentEl = document.getElementById('left-nav-list');
            if (contentEl) {
                contentEl.innerHTML = '';
                this.clearSidebarGuards('left');
            }
        }
    }

    updateTriggerIcon() {
        const triggerIcon = this._getDomElement('trigger-icon');
        const triggerBtn = this._getDomElement('sidebar-trigger');
        if (!triggerIcon) return;

        // [USER] Strictly remove sidebar trigger for Plant and Gemba views
        if (this.primaryMode === 'plant' || this.primaryMode === 'gemba') {
            if (triggerBtn) triggerBtn.style.display = 'none';
            return;
        } else if (triggerBtn) {
            triggerBtn.style.display = 'flex';
        }

        const viewIcons = {
            'zones_scope': 'map',
            'zone': 'map',
            'energy_analytics': 'bolt',
            'machines_list': 'inventory',
            'asset': 'inventory',
            'machine': 'inventory',
            'maintenance': 'build',
            'maintenance_machine': 'build',
            'alarms': 'notifications',
            'alarm_machine': 'notifications',
            'alarm': 'notifications',
            'isolation': 'security',
            'plant': 'dashboard'
        };

        // Fallback: use primaryMode if context type doesn't have a specific icon
        const primaryModeIcons = {
            'zones': 'map',
            'machines': 'inventory',
            'energy': 'bolt',
            'maintenance': 'build',
            'alarm': 'notifications',
            'alarms': 'notifications',
        };

        const type = this.activeContext.type;
        triggerIcon.textContent = viewIcons[type] || primaryModeIcons[this.primaryMode] || 'dashboard';

        // Hide trigger in plant and gemba views, show in all others
        if (triggerBtn) {
            triggerBtn.style.display = (type === 'plant' || type === 'gemba') ? 'none' : '';
        }
    }

    /**
     * Determine schema key from device ID.
     * e.g., 'FURNACE01' → 'FURNACE', 'PAINT_01' → 'PAINT_01', 'LPDC02' → 'LPDC'
     */
    getDeviceType(deviceId) {
        if (!deviceId) return null;
        let id = deviceId.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        
        // [FIX] Explicit matching for RAWMATERIALS variants from scene/assets
        if (id.includes('RAWMATERIALS') || id.includes('INBOUND') || id.includes('RAW')) {
            return 'RAWMATERIALS';
        }

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
        if (!tag) return '';
        // Map specific Ground Truth labels for premium naming
        const labelMap = {
            'Plant_WIP_Molten_Metal': 'Molten Metal Produced',
            'Plant_WIP_Degassed_Metal': 'Molten Metal Degassed',
            'Plant_WIP_Ingots_Available': 'Ingots Available',
            'Plant_KPI_Ingots_Consumed': 'Ingots Consumed',
            'Plant_WIP_Cast_Parts': 'Casting Output',
            'Plant_WIP_Cooled_Parts_1': 'Cooled Parts (DC)',
            'Plant_WIP_Machined_Parts': 'Processed Total',
            'Plant_WIP_Cooled_Parts_2': 'Heat Treat Output',
            'Plant_WIP_Painted_Parts': 'Painted Total',
            'Plant_KPI_Total_Produced': 'Total Wheels Produced',
            'Plant_KPI_Throughput': 'Plant Throughput',
            'Plant_KPI_Yield': 'First Pass Yield',
            'IsRunning': 'Operational',
            'capacity': 'Storage Capacity',
            'PLC_State': 'PLC Power State',
            'PLC_ScanTime': 'PLC Scan Time'
        };
        if (labelMap[tag]) return labelMap[tag];
        return tag.replace(/_/g, ' ');
    }

    /**
     * Derive unit suffix for a tag based on tagUnits map.
     */
    _getUnit(tag) {
        if (!tag) return '';
        const upperTag = tag.toUpperCase();

        if (upperTag.includes('KWH')) return 'kWh';
        if (upperTag.includes('KW')) return 'kW';
        if (upperTag.includes('MOLTEN') || upperTag.includes('METAL') || upperTag.includes('KG')) return 'kg';
        if (upperTag.includes('TEMPERATURE') || upperTag.includes('TEMP')) return '°C';
        if (upperTag.includes('PRESSURE') || upperTag.includes('PSI') || upperTag.includes('BAR')) return 'bar';
        if (upperTag.includes('RPM')) return 'RPM';
        if (upperTag.includes('SPEED')) return 'm/min';
        if (upperTag.includes('HUMIDITY') || upperTag.includes('PCT') || upperTag.includes('%')) return '%';
        if (upperTag.includes('TIME') || upperTag.includes('TIMER')) {
            if (upperTag.includes('SCAN')) return 'ms';
            return 's';
        }
        if (upperTag === 'CAPACITY') return 'units';

        return '';
    }

    _hasChanged(type, id, data, keys) {
        if (!this._changeCache) this._changeCache = new Map();
        const cacheKey = `${type}-${id}`;
        let hash = '';
        for (let i = 0; i < keys.length; i++) {
            const v = data[keys[i]];
            hash += (v === undefined || v === null) ? '~' : (typeof v === 'number' ? v.toFixed(2) : v);
            hash += '|';
        }
        if (this._changeCache.get(cacheKey) === hash) return false;
        this._changeCache.set(cacheKey, hash);
        return true;
    }

    _getDomElement(id) {
        return document.getElementById(id);
    }

    /**
     * Fuzzy liveState lookup.
     * Bridges differences like FURNACE_01 vs FURNACE01 by normalizing keys.
     * @returns {{ cache: Map|null, storeKey: string|null }}
     */
    _findTelemetry(id) {
        const state = this.stateManager.getDeviceState(id);
        return {
            state: state?.state,
            color: state?.color,
            cache: state?.data,
            storeKey: id
        };
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

    /**
     * Unified state resolution from WebSocket tags.
     * Priority: raw WS tag 'State' > 'CalculatedState' > device-specific Run_Status > analytics engine state
     * This ensures left sidebar, right sidebar, and zone view all show the same value.
     */
    _getMachineState(id) {
        const raw = this.stateManager?.getDeviceState(id)?.data || {};
        
        // 1. Prioritize standard PLC status tags for ground truth
        if (raw['IsRunning'] === true) return 'RUNNING';
        if (raw['IsRunning'] === false) return 'STOPPED';

        // 2. Direct tag match (exact key)
        let state = raw['State'] || '';
        if (state) return String(state).toUpperCase();

        // 3. StateCode Fallback (PackML)
        const code = raw['StateCode'];
        if (code !== undefined) {
            const mapping = { 0: 'STOPPED', 1: 'IDLE', 2: 'RUNNING', 3: 'FAULTED' };
            return mapping[code] || 'UNKNOWN';
        }

        return 'OFFLINE';
    }

    _findAsset(id) {
        if (!this.assetData) return null;
        const key = id.toUpperCase();

        // 1. [BRANDING] Standardization for Raw Materials
        if (key.includes('INBOUND') || key === 'RAWMATERIALS') {
            const base = this.assetData['RAWMATERIALS'] || this.assetData['INBOUND_01'] || {};
            return {
                ...base,
                name: 'Raw Materials',
                id: 'RAWMATERIALS' // Standardize internal ID for mapping
            };
        }

        if (this.assetData[key]) return this.assetData[key];
        const normId = key.replace(/[^A-Z0-9]/g, '');
        for (const [ak, av] of Object.entries(this.assetData)) {
            if (ak.replace(/[^A-Z0-9]/g, '') === normId) return av;
        }
        return null;
    }

    /**
     * Intelligent WebSocket URL discovery for Production Readiness.
     * Supports:
     * 1. Localhost/IP-based development.
     * 2. Port Forwarding (VS Code/Codespaces) subdomain mapping (8000 -> 8001).
     * 3. Custom production domains.
     */
    _getWebSocketUrl() {
        if (window.location.protocol === "file:") {
            return "ws://localhost:8000/ws";
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        // [UNIVERSAL] Reconnect to the same host that served the page
        // This handles localhost, tunnels, IPs, and QR codes automatically.
        return `${protocol}//${window.location.host}/ws`;
    }

    async init() {
        const updateLoading = (msg, percent) => {
            console.log(`[Loading] ${msg}`);
            if (this.loader) {
                this.loader.update(percent, msg);
            }
        };

        try {
            updateLoading('Initializing Digital Twin...');
            console.log('[App] Initializing application...');
            const container = document.getElementById('container');
            if (!container) throw new Error('Root container #container not found');

            this.renderer = new Renderer(container, this.stateManager, this);

            const homeBtn = document.getElementById('home-btn');
            if (homeBtn) homeBtn.onclick = () => {
                this.renderer.resetInteraction();
                this.setContext('plant');
            };

            // [WEBSOCKET] Start Real-time Data Stream (Sidebar Feed Only)
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
            
            if (typeof WebSocketHandler === 'undefined') {
                console.error('[App] CRITICAL: WebSocketHandler is missing/undefined!');
                updateLoading('JS ERROR: WebSocketHandler missing');
                return;
            }

            this.websocket = new WebSocketHandler(
                wsUrl,
                this.stateManager,
                (status) => this.updateStatus(status)
            );
            this.websocket.connect();

            // [USER] Listen for Section toggles from Sidebar
            document.addEventListener('toggleSidebarSection', (e) => {
                const sectionId = e.detail;
                if (this.sidebar.expandedSections.has(sectionId)) {
                    this.sidebar.expandedSections.delete(sectionId);
                } else {
                    this.sidebar.expandedSections.add(sectionId);
                }
                this.forceRefresh = true;
            });

            updateLoading('Fetching assets metadata...');
            const assetPromise = fetch('./assets.json').then(r => {
                if (!r.ok) throw new Error(`assets.json: ${r.status} ${r.statusText}`);
                return r.json();
            }).then(json => {
                this.assetData = (json && json.assets) ? json.assets : json;
                this.assets = this.assetData;
                
                // [USER] Pass to sidebar for detail headers
                if (this.sidebar) this.sidebar.assetData = this.assetData;

                this.renderer?.refreshAllLabels(); // [FIX] Force update icons once metadata is ready
                return json;
            }).catch(e => {
                console.warn('[App] Assets metadata load failed (non-critical):', e);
                return {};
            });

            updateLoading('Indexing tag metadata...');
            const tagPromise = fetch('tags.json').then(r => {
                if (!r.ok) throw new Error(`tags.json: ${r.status} ${r.statusText}`);
                return r.json();
            }).then(json => {
                this.tagMetadata = json;
                return json;
            }).catch(e => {
                console.warn('[App] Tag metadata load failed:', e);
                return {};
            });

            if (this.renderer) {
                updateLoading('Loading Plant Model (GLB)...');
                
                // Track progress
                const modelPromise = this.renderer.loadModel('assets/models/plant.glb', (progress) => {
                    const percent = Math.round((progress.loaded / progress.total) * 100);
                    updateLoading(`Loading Model: ${percent}%`, percent);
                });

                await Promise.all([modelPromise, assetPromise, tagPromise]);

                if (this.renderer.renderer.compileAsync) {
                    updateLoading('Pre-compiling shaders...');
                    await this.renderer.renderer.compileAsync(this.renderer.scene, this.renderer.camera);
                }

                await new Promise(resolve => setTimeout(resolve, 0));
                this.renderer.start();
                
                // [USER] Initialize high-level zone icons once model is ready
                this.renderer._createZoneIcons(this.machineGroups);
            }

            updateLoading('Finalizing UI...');
            this.startUpdateLoop();
            this.initialRenderChips();

            // Initialize V1.2 Unified Sidebar (initial view = plant)
            this.sidebar.init(this.machineGroups, this.departmentLabels, {
                assetData: this.assetData,
                onAssetSelect: (id) => {
                    this.setContext('machine', id);
                },
                onZoneChange: (zoneId) => {
                    // Route through setContext so the zone view also gets the
                    // zone outline highlight + sidebar/state sync, instead of
                    // just panning the camera.
                    this.setContext('zone', zoneId);
                },
                onCollapse: () => {
                    // [USER] Strict Reset: Restore textures and return to plant overview
                    if (this.renderer) {
                        this.renderer.resetInteraction();
                    }
                    this.activeContext = { type: 'plant', id: null };
                }
            });

            const infoBtn = document.getElementById('branding-info-btn');
            const kpiSummaryRow = document.getElementById('kpi-summary-row');
            if (infoBtn && kpiSummaryRow) {
                infoBtn.addEventListener('click', () => {
                    kpiSummaryRow.classList.toggle('hidden-kpi');
                    infoBtn.classList.toggle('open');
                });
            }

            // Success! Hide loader
            if (this.loader) this.loader.hide();

        } catch (err) {
            console.error('[App] CRITICAL INIT ERROR:', err);
            if (this.loader) {
                this.loader.update(undefined, `CRITICAL ERROR: ${err.message}`);
                this.loader.statusText.style.color = '#ff3300';
                this.loader.percentText.innerHTML = '❌';
            }
        }

        // [USER] Ensure sidebar is strictly removed if starting in Plant/Gemba
        // We'll call setContext to ensure initial state consistency
        this.updateTriggerIcon();
        this.initFlowControls(); // Restore interactivity
        this.setContext(this.primaryMode || 'plant');
    }


    setupListeners() {
        window.addEventListener('scene-background-click', () => {
            this.setContext('plant');
        });

        // ESC key to return to overview
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.setContext('plant');
                if (this.renderer) this.renderer.resetToDefaultView();
            }
        });
    }

    initFlowControls() {
        this.setupSidebarToggles();
        // Bottom Bar Icons (nav-item)
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;

                // [PERF] Immediate UI Feedback (Instant Active State)
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // [PERF] Defer heavy business logic to yield to the paint thread
                // This significantly improves INP (Interaction to Next Paint)
                if (window.requestIdleCallback) {
                    window.requestIdleCallback(() => this.handleAction(action), { timeout: 1000 });
                } else {
                    setTimeout(() => this.handleAction(action), 500);
                }
            });
        });

        // Close Sidebars - Universal "Reset to Initial View" Rule
        document.getElementById('close-left-panel')?.addEventListener('click', () => {
            // In zones mode viewing a specific zone, reset context so reopening shows zone selection
            if (this.primaryMode === 'zones' && this.activeContext.type === 'zone') {
                this.activeContext = { type: 'zones_scope', id: null };
            }
            // Close left sidebar and reset camera to initial position in ALL views
            this.toggleLeftSidebar(false);
            if (this.renderer) {
                this.renderer.resetToDefaultView();
                this.renderer.isolateGroup([]);
            }
        });

        document.getElementById('close-right-panel')?.addEventListener('click', () => {
            // Close the right sidebar and reset camera in ALL views
            const rightPanel = document.getElementById('right-sidebar');
            if (rightPanel) {
                this.isRightPanelManuallyClosed = true;
                rightPanel.classList.remove('open');
            }

            // [FIX] Ensure camera resets to plant overview when closing machine details
            this.setContext('plant');
            if (this.renderer) {
                this.renderer.resetInteraction();
            }
        });

        // Gemba Start Mode Button
        document.getElementById('gemba-start-mode-btn')?.addEventListener('click', () => {
            this.startGembaWalk();
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
        const isReSelection = (this.primaryMode === action);

        // Close right sidebar if switching to a new primary mode (but keep if re-selecting)
        const rightPanel = document.getElementById('right-sidebar');
        if (!isReSelection && rightPanel) {
            rightPanel.classList.remove('open');
            this.isRightPanelManuallyClosed = false;
            this.clearSidebarGuards('right');
        }

        if (this.renderer) {
            this.renderer.resetToDefaultView();
            this.renderer.isolateGroup([]);
        }

        this.primaryMode = action;
        this.updateTriggerIcon();

        // [USER] Toggle Energy-specific KPI cards in the global summary row
        const kpiRow = document.getElementById('kpi-summary-row');
        if (kpiRow) {
            kpiRow.querySelectorAll('.energy-only').forEach(card => {
                card.style.display = (action === 'energy') ? '' : 'none';
            });
        }

        // [USER] Toggle 3D energy chips based on view
        if (this.renderer) {
            if (action === 'energy') {
                this.renderer.setChipDisplayMode('energy');
            } else {
                this.renderer.setChipDisplayMode('status');
            }
        }

        if (action !== 'gemba' && this.gembaTimer) {
            this.stopGembaWalk();
        }

        // Map nav action names to the context types renderLeftSidebar expects
        const contextTypeMap = {
            'zones': 'zones_scope',
            'machines': 'machines_list',
            'energy': 'energy_analytics',
            'alarm': 'alarms',
        };
        this.setContext(contextTypeMap[action] || action);

        // [USER] Automatically switch 3D chip mode when enters Energy mode
        if (this.renderer) {
            const chipMode = action === 'energy' ? 'energy' : 'status';
            this.renderer.setChipDisplayMode(chipMode);
        }

        // Auto-open left sidebar for all modes that have a left panel
        if (action === 'plant' || action === 'gemba') {
            this.toggleLeftSidebar(false);
        } else {
            this.toggleLeftSidebar(true);
        }

        // [USER] Explicitly close right sidebar when entering Zones mode
        if (action === 'zones' && rightPanel) {
            // No longer forcing close — if user were inspecting a machine, let them stay, 
            // but for a clean mode-switch, it's safer to stay in overview if needed.
            // Actually, let's keep it closed until a machine is clicked.
            rightPanel.classList.remove('open');
            this.isRightPanelManuallyClosed = false;
        }
    }

    _isAlarmMode(mode) {
        return ['alarm', 'alarms', 'isolation'].includes(mode) && !this.gembaTimer;
    }

    setContext(type, id = null) {
        // [FIX] Normalize storage/inbound/buffer mesh IDs to RAWMATERIALS
        if (id) {
            const normId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normId.startsWith('storage') || normId.startsWith('inbound') || normId.startsWith('buffer') || normId === 'rawmaterials' || normId === 'rawmaterial') {
                id = 'RAWMATERIALS';
            }
        }

        console.log(`[App] Transition: ${this.activeContext.type}->${type}${id ? ':' + id : ''}`);

        // [Routing Interception] If clicking a generic machine while in Maintenance mode, route it to Maintenance Machine.
        if ((type === 'machine' || type === 'asset') && this.primaryMode === 'maintenance') {
            type = 'maintenance_machine';
        }
        if ((type === 'machine' || type === 'asset') && (this.primaryMode === 'alarm' || this.primaryMode === 'alarms')) {
            type = 'alarm_machine';
        }

        // [PERF] Redundancy Guard: skip expensive 3D/DOM updates if context is identical
        // Exception: Always allow re-selection of top-level modes to restore sidebar, 
        // OR if the respective sidebar is currently closed (manual restoration).
        const isTopLevel = ['plant', 'zones_scope', 'machines_list', 'energy_analytics', 'alarms', 'maintenance'].includes(type);
        const leftOpen = document.getElementById('left-sidebar')?.classList.contains('open');
        const rightOpen = document.getElementById('hud-right-sidebar')?.classList.contains('open');
        const isMachine = ['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(type);

        if (this.activeContext.type === type && this.activeContext.id === id) {
            if (isTopLevel && !leftOpen) { /* Proceed to open left */ }
            else if (isMachine && !rightOpen) { /* Proceed to open right */ }
            else return;
        }

        // Only reset 3D camera/isolation when returning to a top-level overview
        if (type === 'plant' || type === 'zones_scope') {
            this.renderer?.resetInteraction();
        }

        this.activeContext = { type, id };

        // ─── Sync V1.2 Sidebar ─────────────────────────────────────────
        if (['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(type) && id && this.sidebar?.isInitialized) {
            this.sidebar.setAsset(id);
            this.sidebar.expand(); // Reopen sidebar on 3D click
        }

        // ─── Direct Interaction Dispatch ────────────────────────────────
        const rightPanel = document.getElementById('hud-right-sidebar');

        if (type === 'zone' && id) {
            // [USER] Dept Overview: Move camera towards zone (far) and update sidebar to 1st child
            const machines = this.machineGroups[id];
            if (this.sidebar?.isInitialized) {
                this.sidebar.setZoneById(id);
                if (machines && machines.length > 0) {
                    this.sidebar.setAsset(machines[0]);
                }
                this.sidebar.expand();
            }

            // Restore textures: zone view should never look ghosted, even if
            // we just left a single-machine isolation.
            this.renderer?.isolateGroup(null);
            // Frame the zone with a margin-based fit (same logic as machine
            // focus) so wide zones like Smelting actually fill the view.
            this.renderer?.focusOnZone(id);
            // Highlight ONLY the selected zone + its member machines — not
            // every zone in the plant.
            this.renderer?.pinZoneHighlights(id);
            this.toggleLeftSidebar(true);

            // [USER] Track for toggle-back logic
            this.lastZoneId = id;

            // [USER] Ensure right sidebar is open
            if (rightPanel) {
                rightPanel.classList.add('open');
                this.isRightPanelManuallyClosed = false;
            }

            const hierarchy = this.analytics.update(this.stateManager.deviceStates, this.machineGroups);
            this.renderRightSidebar(hierarchy);
        } else if (['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(type) && id) {
            // [ASSET] Explicit Camera Focus for Devices
            this.renderer?.focusOnDevice(id);

            // [GHOST] Ghost all non-selected meshes
            if (type === 'alarm_machine') {
                this.renderer?.setAllGrey([id]);
            } else if (this.primaryMode !== 'gemba') {
                this.renderer?.isolateGroup([id]);
            }

            // Show ONLY this machine's highlight (drops the all-zones outlines
            // that may have been pinned during the preceding zone navigation).
            this.renderer?.showSelectionBoxes(id);

            // [USER] STRICT OPEN: Open right panel for explicit machine interactions
            if (rightPanel) {
                rightPanel.classList.add('open');
                this.isRightPanelManuallyClosed = false; // Reset guard on explicit machine click
            }

            const hierarchy = this.analytics.update(this.stateManager.deviceStates, this.machineGroups);
            this.renderRightSidebar(hierarchy);
        } else if (type === 'gemba' && rightPanel) {
            // [GEMBA] Ensure right sidebar is CLOSED for immersive tour
            rightPanel.classList.remove('open');

            // Show Floating Tour Bar
            const tourBar = document.getElementById('gemba-tour-bar');
            if (tourBar) tourBar.style.display = 'flex';
        } else if (isTopLevel && rightPanel) {
            // [GEMBA] Hide controls when leaving
            const gtBar = document.getElementById('gemba-tour-bar');
            if (gtBar) gtBar.style.display = 'none';

            rightPanel.classList.remove('open');
            this.isRightPanelManuallyClosed = false;
            this.clearSidebarGuards('right');
        }

        this.forceRefresh = true;
        this.ui?.cycle();
    }

    setChipMode(mode) {
        if (this.renderer) {
            this.renderer.setChipDisplayMode(mode);
            this.refreshUI(); // Re-render sidebar to update active state
        }
    }

    /**
     * [USER] Resolve machine operational state for UI coloring
     */
    _getMachineState(deviceId) {
        const state = this.stateManager.getDeviceState(deviceId);
        if (!state || !state.data) return 'UNKNOWN';
        
        // Standard machine state logic
        const data = state.data;
        if (data.alarm || data.fault) return 'FAULT';
        if (data.warning) return 'WARNING';
        if (data.running || data.state === 'RUNNING' || data.status === 'ONLINE') return 'RUNNING';
        return 'STOPPED';
    }

    /**
     * [USER] Aggregate zone state based on its member machines
     */
    _getZoneState(zoneId) {
        if (!this.machineGroups || !this.machineGroups[zoneId]) return 'RUNNING';
        const machines = this.machineGroups[zoneId];
        
        let hasFault = false;
        let hasWarning = false;
        
        for (const mid of machines) {
            const mState = this._getMachineState(mid);
            if (mState === 'FAULT') hasFault = true;
            if (mState === 'WARNING') hasWarning = true;
        }
        
        if (hasFault) return 'FAULT';
        if (hasWarning) return 'WARNING';
        return 'RUNNING';
    }

    handleHeaderBack() {
        // 1. Navigate UI back to the zones overview list
        this.setContext('zones_scope');
        // 2. Restore all ghosted meshes (undo zone isolation)
        if (this.renderer) {
            this.renderer.isolateGroup([]); // Restores all materials
            this.renderer.resetToDefaultView(); // Reset camera to initial plant overview
        }
    }

    onHoverChange(hoveredId) {
        // Event-driven hover hook. Replaces per-frame UI polling.
        // Can be expanded to drive specific UI element previews without full layout re-renders.
        // hover change handled here if needed
        void hoveredId;
    }

    refreshUI(force = false) {
        const hierarchy = this.analytics.update(this.stateManager.deviceStates, this.machineGroups);

        this.updateTopStrip(hierarchy.plant);
        this.updateKPIRow(hierarchy.plant);

        // Sidebar re-rendering is now EXPLICIT to prevent flickering on WebSocket updates
        if (force) {
            // [USER] Sync Asset Status Colors (running/fault)
            if (this.sidebar) {
                this.sidebar.updateAssetStatuses((id) => this._getMachineState(id));
            }

            const leftSidebar = document.getElementById('left-sidebar');
            if (leftSidebar && leftSidebar.classList.contains('open')) {
                this.renderLeftSidebar(hierarchy);
            }
            // Only render right sidebar if it's actually open
            const rightSidebar = document.getElementById('right-sidebar');
            if (rightSidebar && rightSidebar.classList.contains('open')) {
                this.renderRightSidebar(hierarchy);
            }
        }

        // Sidebar updates are now handled entirely by uiUpdater._buildSidebarData
    }

    /**
     * [USER] Helper to get appropriate icon for a tag
     */
    _getTagIcon(tag) {
        const t = tag.toLowerCase();
        if (t.includes('temp')) return 'thermometer';
        if (t.includes('pressure')) return 'compress';
        if (t.includes('flow')) return 'airwave';
        if (t.includes('speed') || t.includes('rpm')) return 'speed';
        if (t.includes('count')) return 'calculate';
        if (t.includes('time')) return 'timer';
        if (t.includes('kw')) return 'bolt';
        if (t.includes('humidity')) return 'humidity_mid';
        if (t.includes('vibration')) return 'vibration';
        if (t.includes('level')) return 'bar_chart';
        return 'analytics';
    }

    updateTopStrip(plant) {
        if (!this._hasChanged('plant', 'top-strip', plant, ['instantKW', 'totalKWh', 'production'])) return;

        const kwEl = this._getDomElement('plant-kw');
        const kwhEl = this._getDomElement('plant-kwh');
        const prodEl = this._getDomElement('plant-production');

        if (kwEl) kwEl.textContent = `${this.formatValue(plant.instantKW)} kW`;
        if (kwhEl) kwhEl.textContent = `${this.formatValue(plant.totalKWh)} kWh`;
        if (prodEl) prodEl.textContent = this.formatValue(plant.production);
    }

    updateKPIRow(plant) {
        if (!this._hasChanged('plant', 'kpi-row', plant, ['runningMachines', 'totalMachines', 'utilization', 'scrapRate'])) return;

        const activeEl = this._getDomElement('total-active-machines');
        const utilEl = this._getDomElement('utilization-badge');
        const scrapEl = this._getDomElement('scrap-rate-badge');

        if (activeEl) activeEl.textContent = `${plant.runningMachines} / ${plant.totalMachines}`;
        if (utilEl) utilEl.textContent = `${this.formatValue(plant.utilization)}%`;
        if (scrapEl) scrapEl.textContent = `${this.formatValue(plant.scrapRate)}%`;
    }

    getLeftSidebarContext() {
        let targetContext = this.activeContext;
        const isDetails = ['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(this.activeContext.type);
        const isPlantContext = this.activeContext.type === 'plant';
        const isNotPlantMode = this.primaryMode !== 'plant' && this.primaryMode !== 'gemba';

        if (isDetails || (isPlantContext && isNotPlantMode)) {
            const mode = this.primaryMode;
            if (mode === 'maintenance') {
                return { type: 'maintenance', id: null };
            } else if (mode === 'alarm' || mode === 'alarms' || mode === 'isolation') {
                return { type: 'alarms', id: null };
            } else if (mode === 'machines' || mode === 'assets') {
                return { type: 'machines_list', id: null };
            } else if (mode === 'energy') {
                // [USER] Persist the machine list in the left sidebar for Energy mode
                return { type: 'energy_analytics', id: null };
            } else if (mode === 'zones') {
                // [USER] If in Zones mode and viewing machine details, keep the zone context in the left sidebar
                if (isDetails && this.lastLeftContext?.type === 'zone') {
                    return this.lastLeftContext;
                }
                return { type: 'zones_scope', id: null };
            } else if (isDetails) {
                return this.lastLeftContext || { type: 'plant', id: null };
            }
        }
        // [LOGIC FIX] Normalize ID to null for consistent structural comparisons
        return { type: targetContext.type, id: targetContext.id || null };
    }

    renderLeftSidebar(hierarchy) {
        const leftPanel = document.getElementById('left-sidebar');
        const titleEl = document.getElementById('left-panel-title');
        const navEl = document.getElementById('left-header-nav');
        const contentEl = document.getElementById('left-nav-list');
        const closeBtn = document.getElementById('close-left-panel');
        const header = document.querySelector('#left-sidebar .sidebar-header');

        if (!leftPanel || !titleEl || !contentEl || !navEl || !closeBtn || !header) return;

        // [LOGIC FIX] Use the centralized context helper to prevent structural flickering
        const { type, id } = this.getLeftSidebarContext();

        // [ARCHITECTURE] Targeted Update Guard: Do not clear content if ID and Type match
        const activeId = contentEl.getAttribute('data-active-id');
        const activeType = contentEl.getAttribute('data-active-type');

        if (activeId === id && activeType === type) {
            return; // Structure is already stable
        }

        // Record new context to prevent future re-renders
        contentEl.setAttribute('data-active-id', id || '');
        contentEl.setAttribute('data-active-type', type || '');

        // Flush stale DOM cache entries — sidebar innerHTML is about to be replaced,
        // so any cached element refs (including cached nulls) for sidebar children are invalid.
        if (this.ui) this.ui.clearCache();

        // Reset nav header and shared layout classes
        navEl.innerHTML = '';
        header.classList.remove('same-row', 'compact');
        closeBtn.style.order = ''; // Reset order

        // type and id were declared above 

        if (type === 'plant' || !type) {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'DASHBOARD';
            navEl.prepend(titleEl);
            this.renderPlantOverview(contentEl);
        } else if (type === 'zones_scope') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'ZONES';
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
            this.renderEnergyMachinesList(contentEl);
        } else if (type === 'machines_list') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'ASSET INVENTORY';
            navEl.prepend(titleEl);
            this.renderMachinesListPanel(contentEl);
        } else if (type === 'maintenance' || type === 'maintenance_machine') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'Maintenance Control';
            navEl.prepend(titleEl);
            this.renderMaintenanceListPanel(contentEl);
        } else if (type === 'alarm' || type === 'alarms' || type === 'alarm_machine' || type === 'isolation') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'ALARM & ISOLATION';
            navEl.prepend(titleEl);
            this.renderAlarmListPanel(contentEl);
        } else if (type === 'gemba') {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'GEMBA WALK';
            navEl.prepend(titleEl);
            this.renderGembaPanel(contentEl);
        } else if (type === 'asset' || type === 'machine') {
            if (this.primaryMode === 'energy') {
                header.classList.add('same-row', 'compact');
                titleEl.textContent = 'ENERGY';
                navEl.prepend(titleEl);
                this.renderDeviceEnergyPanel(id, contentEl);
            }
        } else if (type === 'zone' && id) {
            header.classList.add('same-row', 'compact');
            titleEl.textContent = 'ZONE PERFORMANCE';
            navEl.prepend(titleEl);
            const zoneData = hierarchy.zones[id] || hierarchy.zones[id.toLowerCase()];
            this.renderZoneKPIs(id, zoneData, contentEl);
        }

        // 3. PERSISTENCE: Save the last primary navigation mode for this sidebar
        if (this.activeContext.type !== 'machine' && this.activeContext.type !== 'asset' &&
            this.activeContext.type !== 'maintenance_machine' && this.activeContext.type !== 'alarm_machine') {
            this.lastLeftContext = { ...this.activeContext };
        }
    }

    renderZonesScope(hierarchy, container) {
        let html = `
            <div class="sidebar-nav-list" data-active-type="zones_scope">
        `;
        Object.keys(this.machineGroups).forEach(zoneId => {
            const isActive = this.activeContext.id === zoneId;
            html += `
                <a href="#" class="sidebar-nav-item ${isActive ? 'active' : ''}" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;"
                   onclick="event.preventDefault(); window.app.setContext('zone', '${zoneId}')">
                    <span class="material-symbols-outlined" style="font-size: 18px; color: var(--text-dim);">map</span>
                    <div style="flex: 1">
                        <span style="font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.departmentLabels[zoneId] || zoneId.toUpperCase()}</span>
                    </div>
                </a>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    renderRightSidebar(hierarchy) {
        // [USER] Decoupling: Target the new dynamic content area to preserve the V1.2 Header
        const dynamicContent = document.getElementById('sidebar-dynamic-content');
        const contentEl = dynamicContent || document.getElementById('right-panel-content');
        const titleEl = document.getElementById('right-panel-title');
        const navEl = document.getElementById('right-header-nav');
        const header = document.querySelector('#hud-right-sidebar .sidebar-header');

        // [USER] Disable right sidebar for gemba mode
        if (this.primaryMode === 'gemba' || this.activeContext.type === 'gemba') {
            const rightPanel = document.getElementById('hud-right-sidebar');
            if (rightPanel) rightPanel.classList.remove('open');
            return;
        }

        // Use active context if it's a machine or zone, otherwise use last known right context
        const isCurrentlyRightTarget = ['alarm_machine', 'maintenance_machine', 'machine', 'asset', 'zone'].includes(this.activeContext.type);
        const targetContext = isCurrentlyRightTarget ? this.activeContext : (this.lastRightContext || null);
        if (!targetContext) return;
        const { type, id } = targetContext;

        if (!titleEl || !contentEl || !navEl) return;

        // [ARCHITECTURE] Targeted Update Guard: Do not clear content if ID and Type match
        const activeId = contentEl.getAttribute('data-active-id');
        const activeType = contentEl.getAttribute('data-active-type');
        const activeMode = contentEl.getAttribute('data-active-mode');

        if (activeId === id && activeType === type && activeMode === this.primaryMode) {
            // Structure is already stable — let UIUpdater handle the live values via textContent
            return;
        }

        // PRESERVE TITLE: If title is inside nav, move it back to header before clearing nav
        if (navEl.contains(titleEl)) {
            header.appendChild(titleEl);
        }

        header.classList.add('same-row', 'compact');
        navEl.innerHTML = '';
        contentEl.innerHTML = '';

        // Record new context to prevent future re-renders
        contentEl.setAttribute('data-active-id', id || '');
        contentEl.setAttribute('data-active-type', type || '');
        contentEl.setAttribute('data-active-mode', this.primaryMode || '');

        // [USER] Right Sidebar Title based on active view mode
        let titleText = 'MACHINE DIAGNOSTICS'; // default for plant view
        if (type === 'zone' || this.primaryMode === 'zones') {
            titleText = 'MACHINE PRODUCTION';
        } else if (type === 'asset' || this.primaryMode === 'machines') {
            titleText = 'ASSET DETAILS';
        } else if (this.primaryMode === 'energy') {
            titleText = 'ENERGY UTILIZATION';
        } else if (type === 'alarm_machine' || this.primaryMode === 'alarm' || this.primaryMode === 'alarms') {
            titleText = 'LOGS & DIAGNOSTICS';
        } else if (type === 'maintenance_machine' || this.primaryMode === 'maintenance') {
            titleText = 'UPCOMING MAINTENANCE';
        }

        titleEl.textContent = titleText;
        navEl.prepend(titleEl);

        // Unified Dispatch: PRIORITIZE MACHINE-SPECIFIC VIEWS
        const isDetailsMode = ['alarm_machine', 'maintenance_machine', 'machine', 'asset'].includes(type);

        if (isDetailsMode && id) {
            if (type === 'maintenance_machine' || (this.primaryMode === 'maintenance' && type !== 'asset')) {
                this.renderMaintenanceMachinePanel(id, contentEl);
            } else if (type === 'alarm_machine' || this.primaryMode === 'alarm' || this.primaryMode === 'alarms') {
                this.renderMachineAlarmPanel(id, contentEl);
            } else if (this.primaryMode === 'energy') {
                // [USER] Dedicated Energy Details for Right Sidebar
                this.renderDeviceEnergyPanel(id, contentEl);
            } else if (this.primaryMode === 'zones') {
                // [USER] Zone view: show production KPIs only, no diagnostics
                this.renderMachineProductionPanel(id, contentEl);
            } else {
                // Assets mode shows metadata; others show diagnostics
                const modeToRender = (type === 'asset' || this.primaryMode === 'machines') ? 'metadata' : 'diagnostics';
                this.renderMachinePanel(id, contentEl, modeToRender);
            }
        } else if (type === 'zone' && id) {
            const zoneData = hierarchy.zones[id] || hierarchy.zones[id.toLowerCase()];
            this.renderZoneKPIs(id, zoneData, contentEl);
        } else if (type === 'alarm' || type === 'alarms') {
            // Summary view / placeholder if needed (currently empty as requested to hide details initially)
            contentEl.innerHTML = '';
        }
    }

    renderZonePanel(zoneId, data, container) {
        const d = data || { instantKW: 0, production: 0, efficiency: 94.2, scrapRate: 2.1 };
        const isSmelting = zoneId === 'smelting' || zoneId === 'melting' || zoneId === 'logistics';
        const unit = isSmelting ? 'kg' : 'units';

        let html = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0 4px 16px 4px;">
                <!-- Card 1: Load -->
                <div class="kpi-mini" style="border-left: 3px solid var(--accent-blue); background: rgba(59,130,246,0.05);">
                    <div class="label">ZONE LOAD</div>
                    <div class="value" id="metric-${zoneId}-instantKW"><span class="val-text">${d.instantKW.toFixed(1)}</span><small>kW</small></div>
                </div>
                <!-- Card 2: Output -->
                <div class="kpi-mini" style="border-left: 3px solid var(--success); background: rgba(34,197,94,0.05);">
                    <div class="label">TOTAL OUTPUT</div>
                    <div class="value" id="metric-${zoneId}-production"><span class="val-text">${Math.round(d.production || 0).toLocaleString()}</span><small>${unit}</small></div>
                </div>
                <!-- Card 3: Efficiency -->
                <div class="kpi-mini" style="border-left: 3px solid var(--primary); background: rgba(236,91,19,0.05);">
                    <div class="label">EFFICIENCY</div>
                    <div class="value" id="metric-${zoneId}-efficiency"><span class="val-text">${(d.efficiency || 94.2).toFixed(1)}</span><small>%</small></div>
                </div>
                <!-- Card 4: Scrap -->
                <div class="kpi-mini" style="border-left: 3px solid var(--danger); background: rgba(239,68,68,0.05);">
                    <div class="label">SCRAP RATE</div>
                    <div class="value" id="metric-${zoneId}-scrapRate"><span class="val-text">${(d.scrapRate || 2.1).toFixed(1)}</span><small>%</small></div>
                </div>
            </div>

            <div class="sidebar-section-title">MACHINES & ASSETS</div>
            <div class="sidebar-nav-list" data-active-id="${zoneId}" data-active-type="zone-panel">
        `;

        const members = this.machineGroups[zoneId] || [];
        members.forEach(mid => {
            const m = this.analytics.data.machines[mid.toUpperCase()] || this.analytics.data.machines[mid] || this._findMachineData(mid);
            if (!m) return;
            const asset = this._findAsset(mid);
            const displayName = (asset && asset.name) ? asset.name : mid;
            const prod = Math.round(m.production || 0).toLocaleString();
            const machState = this._getMachineState(mid);
            const machStateLower = machState.toLowerCase();
            const machStateColor = machStateLower === 'running' ? 'var(--success)' : (machStateLower === 'stopped' ? 'var(--text-dim)' : 'var(--danger)');

            html += `
                <a href="#" class="sidebar-nav-item" onclick="event.preventDefault(); window.app.setContext('machine', '${mid}')" style="padding: 12px 16px;">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center">
                            <span style="font-weight: 700; color: white;">${displayName}</span>
                            <span style="font-size: 10px; color: ${machStateColor}; font-weight: 800; border: 1px solid ${machStateColor}44; padding: 2px 6px; border-radius: 4px; background: ${machStateColor}11;" id="zone-state-${mid}">${machState}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span id="metric-${mid}-production" style="font-size: 14px; font-weight: 900; font-family: 'Public Sans', sans-serif; color: var(--success);">${prod}</span>
                            <span style="font-size: 12px; font-weight: 700; color: var(--text-dim); text-transform: uppercase;">${isSmelting ? 'kg' : 'units'}</span>
                        </div>
                    </div>
                </a>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    renderZoneKPIs(zoneId, data, container) {
        const d = data || { inProcess: 0 };
        const isSmelting = zoneId === 'smelting' || zoneId === 'melting' || zoneId === 'logistics';
        const unit = isSmelting ? 'kg' : 'units';

        container.innerHTML = `
            <div class="sidebar-section-title">IN-PROCESS TELEMETRY</div>
            <div style="padding: 4px;">
                <div class="kpi-mini" style="border-left: 3px solid var(--warning); background: rgba(245,158,11,0.05); width: 100%; box-sizing: border-box;">
                    <div class="label">IN-PROCESS WIP</div>
                    <div class="value" id="metric-${zoneId}-inprocess"><span class="val-text">${Math.round(d.inProcess || 0).toLocaleString()}</span><small>${unit}</small></div>
                </div>
            </div>
            <div style="padding: 16px; font-size: 11px; color: var(--text-dim); line-height: 1.5;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 16px; color: var(--primary);">info</span>
                    <span style="font-weight: 700; color: var(--text-dim); text-transform: uppercase; font-size: 10px;">Flow Calculation</span>
                </div>
                ${isSmelting ? 'WIP represents molten metal exiting the Furnace but not yet processed by the Degasser.' : 'WIP represents items currently held within machine buffers or in transition.'}
            </div>
        `;
    }

    renderMachinePanel(id, container, mode = 'metadata') {
        try {
            const asset = this._findAsset(id);
            const { cache } = this._findTelemetry(id);
            const raw = cache instanceof Map ? Object.fromEntries(cache) : (cache || {});

            const displayName = asset ? (asset.name || id.replace(/_/g, ' ')) : id.toUpperCase();
            const dept = asset ? (this.departmentLabels[asset.department.toLowerCase()] || asset.department) : '—';

            const modelNum = asset ? (asset.model || '---') : '---';
            const serialNum = asset ? (asset.serial_number || '---') : '---';
            const installDate = asset ? (asset.install_date || '---') : '---';
            const purchaseDate = asset ? (asset.purchase_date || '---') : '---';
            
            // Render the shared header with metadata
            let html = `
                <div style="padding: 4px 8px;">
                    
                    <!-- Asset Profile: PREMIUM VIBRANT UI -->
                    <div style="margin-bottom: 24px;">
                        <div class="sidebar-section-title" style="color: var(--primary); font-size: 13px; font-weight: 900; letter-spacing: 2px;">ASSET PROFILE</div>
                        <div style="background: rgba(236,91,19,0.05); border-left: 3px solid var(--primary); border-radius: 4px; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                <span style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Machine Model</span>
                                <span style="font-size: 13px; font-weight: 800; color: var(--text-dim);">${modelNum}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                <span style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Purchase Date</span>
                                <span style="font-size: 13px; font-weight: 800; color: white; font-family: 'Public Sans', sans-serif;">${purchaseDate}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                <span style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Next Service</span>
                                <span style="font-size: 13px; font-weight: 800; color: var(--warning); font-family: 'Public Sans', sans-serif;">2024-12-15</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(59,130,246,0.1); margin: 4px -16px -16px -16px; padding: 12px 16px; border-radius: 0 0 4px 4px;">
                                <span style="font-size: 11px; color: var(--accent-blue); text-transform: uppercase; font-weight: 900;">Operational Status</span>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="status-dot running" style="width: 8px; height: 8px;"></span>
                                    <span style="font-size: 12px; font-weight: 900; color: white;">NOMINAL</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Telemetry Sections: Targeted by SidebarController -->
                    <div id="plant-data-list"></div>
                    <div id="production-list"></div>
                    
                    <!-- Asset Integrity -->
                    <div style="margin-top: 24px;">
                        <div class="sidebar-section-title" style="color: var(--accent-blue); font-size: 13px; font-weight: 900; margin-bottom: 12px;">ASSET INTEGRITY</div>
                        ${this._renderMaintenanceAnalytics(id, { showHealth: false })}
                    </div>

                </div>
            `;

            container.innerHTML = html;
            
            // Force a refresh cycle to populate the newly rendered containers
            setTimeout(() => this.refreshUI(false), 0);

        } catch (err) {
            console.error('[UI] Panel Crash:', err);
            container.innerHTML = `<div style="padding: 20px; color: var(--danger)">Sidebar Error: ${err.message}</div>`;
        }
    }

    renderMachineProductionPanel(id, container) {
        // [USER] Refactored to use SidebarController for 5-item truncation and drill-down
        container.innerHTML = `
            <div style="padding: 4px 8px;">
                <div id="plant-data-list"></div>
                <div id="production-list"></div>
            </div>
        `;
        setTimeout(() => this.refreshUI(false), 0);
    }

    _renderTelemetryGrid(id, raw) {
        // [USER] Logic moved to refreshUI + SidebarController
        return `
            <div id="plant-data-list"></div>
            <div id="production-list"></div>
        `;
    }

    _renderMaintenanceAnalytics(id, { showHealth = true } = {}) {
        // [USER] Refactored for smooth, dynamic machine health and RUL
        const machineData = this._findMachineData(id);
        const state = (machineData?.state || '').toLowerCase();

        // Damping: Initialise if not exists
        if (!this.healthStates) this.healthStates = new Map();
        if (!this.healthStates.has(id)) {
            this.healthStates.set(id, { health: 95.0, rul: 2400 });
        }

        const hState = this.healthStates.get(id);

        // [AUTHENTICITY] Derive health from genuine diagnostic tags (vibration, temp, oil, state)
        // Base health starts at 98%
        let calcHealth = 98.0;
        if (state === 'fault') calcHealth -= 25;
        if (state === 'stopped') calcHealth -= 5;

        // Sensor-based penalties (Machine level)
        if (machineData?.vibration > 1.8) calcHealth -= 10;
        if (machineData?.temp > 65) calcHealth -= 10;
        if (machineData?.oil > 0 && machineData?.oil < 92) calcHealth -= 5;

        // Damping/Smoothing without Math.random()
        hState.health = (hState.health * 0.95) + (Math.max(0, calcHealth) * 0.05);

        // RUL based on actual runtime (Hours)
        const maxLife = 5000;
        hState.rul = Math.max(0, maxLife - (machineData?.runtime || 0));

        const healthScore = Math.round(hState.health);
        const rul = Math.floor(hState.rul);
        const healthColor = healthScore > 90 ? '#10b981' : (healthScore > 75 ? '#f59e0b' : '#ef4444');
        const healthText = healthScore > 90 ? 'OPTIMAL' : (healthScore > 75 ? 'FAIR' : 'CRITICAL');

        const healthHtml = showHealth ? `
            <div style="background: rgba(0,0,0,0.2); border: 1px solid #362e2a; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <span style="font-size: 12px; font-weight: 900; text-transform: uppercase; color: #64748b;">Health Score</span>
                    <span style="font-size: 9px; font-weight: 900; color: ${healthColor}; background: ${healthColor}11; padding: 3px 10px; border-radius: 999px; border: 1px solid ${healthColor}22;">${healthText}</span>
                </div>
                <div style="display: flex; align-items: baseline; gap: 6px;">
                    <span style="font-size: 32px; font-family: 'Public Sans', sans-serif; font-weight: 900; color: white; line-height: 1;" id="diag-${id}-health">${healthScore}%</span>
                    <span style="font-size: 12px; color: #64748b; font-weight: 700;">/ 100</span>
                </div>
                <div style="margin-top: 16px; height: 4px; width: 100%; background: #1e293b; border-radius: 999px; overflow: hidden; border: 1px solid #362e2a;">
                    <div id="diag-bar-${id}-health" style="height: 100%; background: ${healthColor}; border-radius: 999px; width: ${healthScore}%; box-shadow: 0 0 8px ${healthColor}55;"></div>
                </div>
            </div>` : '';

        return `
            ${healthHtml}
            <div style="background: rgba(0,0,0,0.2); border: 1px solid #362e2a; padding: 20px; border-radius: 12px; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 12px; font-weight: 900; text-transform: uppercase; color: #64748b;">Remaining Useful Life</span>
                    <span class="material-symbols-outlined" style="color: #ec5b13; background: rgba(236,91,19,0.1); padding: 4px; border-radius: 4px; font-size: 16px;">precision_manufacturing</span>
                </div>
                <div style="display: flex; align-items: baseline; gap: 6px;">
                    <span style="font-size: 24px; font-family: 'Public Sans', sans-serif; font-weight: 900; color: white; line-height: 1;" id="diag-${id}-rul">${rul.toLocaleString()}</span>
                    <span style="font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase;">Hours</span>
                </div>
            </div>
        `;
    }

    renderAlarmListPanel(contentEl) {
        let html = '';
        for (const [deptId, members] of Object.entries(this.machineGroups)) {
            const label = this.departmentLabels[deptId] || deptId.toUpperCase();
            html += `<div class="sidebar-section-title" style="margin-top:12px">${label}</div>`;
            html += '<div class="sidebar-nav-list">';
            for (const mid of members) {
                const asset = this._findAsset(mid);
                const displayName = (asset && asset.name) ? asset.name : mid;
                // Read alarm data from WebSocket tags
                const raw = this.stateManager?.getDeviceState(mid)?.data || {};
                const alarmTag = this.getValue(raw, 'Alarm_Status');
                const stateVal = this._getMachineState(mid);
                const stateLower = stateVal.toLowerCase();
                const isFault = ['fault', 'error'].includes(stateLower);
                // Alarm is active if Alarm_Status tag is truthy OR machine is in fault state
                const hasAlarm = alarmTag === true || alarmTag === 'true' || alarmTag === 1 || isFault;
                const color = hasAlarm ? 'var(--danger)' : 'var(--success)';
                const alarmLabel = hasAlarm ? 'ALARM' : 'NORMAL';
                const icon = hasAlarm ? 'warning' : 'check_circle';
                html += `
                    <a href="#" class="sidebar-nav-item" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;" onclick="event.preventDefault(); window.app.setContext('alarm_machine', '${mid}')">
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span style="font-size: 10px; color: ${color}; font-weight: 900; background: ${color}11; padding: 2px 8px; border-radius: 4px; border: 1px solid ${color}22; display: flex; align-items: center; gap: 4px;" id="alarm-state-${mid}">
                                <span class="material-symbols-outlined" style="font-size: 12px;">${icon}</span>
                                ${alarmLabel}
                            </span>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }
        contentEl.innerHTML = html;
    }

    renderMachineAlarmPanel(id, container) {
        try {
            const asset = this._findAsset(id);
            const displayName = (asset && asset.name) ? asset.name : id;
            const raw = this.stateManager?.getDeviceState(id)?.data || {};
            const stateVal = this._getMachineState(id);
            const stateLower = stateVal.toLowerCase();
            const isFault = ['fault', 'error'].includes(stateLower);
            const stateColor = isFault ? 'var(--danger)' : (stateLower === 'running' ? 'var(--success)' : 'var(--text-dim)');

            // [SYNC] Use EXACT same alarm logic as renderAlarmListPanel (left sidebar)
            const alarmTag = this.getValue(raw, 'Alarm_Status');
            const hasAlarm = alarmTag === true || alarmTag === 'true' || alarmTag === 1 || isFault;
            const alarmBadgeColor = hasAlarm ? 'var(--danger)' : 'var(--success)';
            const alarmBadgeText = hasAlarm ? 'ALARM' : 'NORMAL';
            const alarmIcon = hasAlarm ? 'warning' : 'check_circle';

            let html = `
                <div style="font-size: 14px; font-weight: 900; color: white; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 18px; color: var(--primary);">precision_manufacturing</span>
                    ${displayName}
                </div>

                <div class="state-badge-container" style="display: flex; align-items: center; justify-content: space-between; background: ${alarmBadgeColor}22; padding: 10px 12px; border-radius: 8px; margin-bottom: 10px; border: 1px solid ${alarmBadgeColor}44; color: ${alarmBadgeColor}; transition: all 0.5s ease;">
                    <div style="font-size: 12px; color: var(--text-dim); text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Security Status</div>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800;">
                        <span class="material-symbols-outlined" style="font-size: 14px">${alarmIcon}</span>
                        <span id="metric-${id}-Alarm_Status">${alarmBadgeText}</span>
                    </div>
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.2); padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 800;">Operational State</div>
                    <div style="font-size: 11px; color: ${stateColor}; font-weight: 800;" id="metric-${id}-state">${stateVal}</div>
                </div>

                <!-- Alarm Log -->
                <div class="sidebar-section-title" style="color: var(--primary); margin-bottom: 12px; margin-top: 4px;">ALARM LOG</div>
            `;

            // Generate alarm entries based on state
            const alarmEntries = [];
            if (isFault) {
                alarmEntries.push({ severity: 'CRITICAL', msg: `${stateVal.toUpperCase()} state detected`, time: '2 min ago', color: '#ef4444' });
                alarmEntries.push({ severity: 'WARNING', msg: 'Abnormal vibration levels', time: '15 min ago', color: '#f59e0b' });
                alarmEntries.push({ severity: 'INFO', msg: 'Maintenance ticket auto-generated', time: '15 min ago', color: '#3b82f6' });
            }
            alarmEntries.push({ severity: 'INFO', msg: 'Routine health check passed', time: '1 hr ago', color: '#3b82f6' });
            alarmEntries.push({ severity: 'INFO', msg: 'System startup completed', time: '4 hrs ago', color: '#3b82f6' });

            for (const entry of alarmEntries) {
                html += `
                    <div style="background: rgba(255,255,255,0.02); border-left: 3px solid ${entry.color}; padding: 12px 16px; border-radius: 4px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 11px; font-weight: 900; color: ${entry.color}; letter-spacing: 1px;">${entry.severity}</span>
                            <span style="font-size: 11px; color: var(--text-dim);">${entry.time}</span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-main); font-weight: 600;">${entry.msg}</div>
                    </div>
                `;
            }

            container.innerHTML = html;

            if (this.renderer) {
                this.renderer.setChipDisplayMode('none');
            }
        } catch (err) {
            console.error('[UI] Alarm Panel Crash:', err);
            container.innerHTML = `<div style="padding: 20px; color: var(--danger)">Alarm Panel Error: ${err.message}</div>`;
        }
    }

    renderMaintenanceListPanel(contentEl) {
        let html = '';
        for (const [deptId, members] of Object.entries(this.machineGroups)) {
            const label = this.departmentLabels[deptId] || deptId.toUpperCase();
            html += `<div class="sidebar-section-title" style="margin-top:12px">${label}</div>`;
            html += '<div class="sidebar-nav-list">';
            for (const mid of members) {
                const asset = this._findAsset(mid);
                const isXRay = mid.toUpperCase().includes('INSPECTION');
                const displayName = (asset && asset.name) ? asset.name : (isXRay ? mid.replace(/INSPECTION/i, 'X-RAY') : mid);

                // Logic for machine dues: Icons colored orange/red
                const isDue = (mid.length % 3 === 0);
                const isCriticalDue = (mid.length % 5 === 0);
                const color = isCriticalDue ? 'var(--danger)' : (isDue ? 'var(--warning)' : 'var(--success)');
                const labelText = isCriticalDue ? 'CRITICAL' : (isDue ? 'FIX NEEDED' : 'READY');

                html += `
                    <a href="#" class="sidebar-nav-item" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;" onclick="event.preventDefault(); window.app.setContext('maintenance_machine', '${mid}')">
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span style="font-size: 10px; color: ${color}; font-weight: 900; background: ${color}11; padding: 2px 8px; border-radius: 4px; border: 1px solid ${color}22;">${labelText}</span>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }
        contentEl.innerHTML = html;
    }

    renderMaintenanceMachinePanel(id, container) {
        const machineData = this._findMachineData(id);
        const healthScore = 92;

        let html = `
            <div style="padding: 8px 4px;">
                
                <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 3px; color: #ec5b13; margin-bottom: 20px; margin-top: 0;">Maintenance</h3>

                <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: rgba(0,0,0,0.2); border: 1px solid #362e2a; border-radius: 12px;">
                        <div style="height: 40px; width: 40px; flex-shrink: 0; background: rgba(236,91,19,0.1); border: 1px solid rgba(236,91,19,0.2); display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                            <span class="material-symbols-outlined" style="color: #ec5b13; font-weight: 900; font-size: 18px;">filter_alt</span>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <p style="font-size: 13px; font-weight: 900; color: white; margin: 0 0 4px 0;">Filter Change</p>
                            <p style="font-size: 11px; color: #64748b; font-weight: 900; text-transform: uppercase; margin: 0;">System Hydraulics</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="font-size: 13px; font-family: 'Public Sans', sans-serif; font-weight: 900; color: #ec5b13; margin: 0 0 4px 0;">12h</p>
                            <p style="font-size: 10px; color: #64748b; font-weight: 900; text-transform: uppercase; margin: 0;">Due</p>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: rgba(0,0,0,0.2); border: 1px solid #362e2a; border-radius: 12px;">
                        <div style="height: 40px; width: 40px; flex-shrink: 0; background: #1e293b; border: 1px solid #362e2a; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                            <span class="material-symbols-outlined" style="color: #94a3b8; font-weight: bold; font-size: 18px;">opacity</span>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <p style="font-size: 13px; font-weight: 900; color: white; margin: 0 0 4px 0;">Bearing Lubrication</p>
                            <p style="font-size: 11px; color: #64748b; font-weight: 900; text-transform: uppercase; margin: 0;">Spindle Unit 04</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="font-size: 13px; font-family: 'Public Sans', sans-serif; font-weight: 900; color: #94a3b8; margin: 0 0 4px 0;">48h</p>
                            <p style="font-size: 10px; color: #64748b; font-weight: 900; text-transform: uppercase;">Sched</p>
                        </div>
                    </div>
                </div>

                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #362e2a;">
                    <button class="maintenance-report-btn" style="width: 100%; background: #ec5b13; color: white; font-weight: 900; padding: 16px; border-radius: 8px; text-transform: uppercase; font-size: 11px; letter-spacing: 2px; display: flex; align-items: center; justify-content: center; gap: 10px; border: none; cursor: pointer; transition: background 0.2s;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">assignment_turned_in</span>
                        Generate Maintenance Report
                    </button>
                </div>
            </div>
        `;
        container.innerHTML = html;

        // Frame the machine in the renderer
        if (this.renderer) {
            this.renderer.isolateGroup([id]);
            this.renderer.setChipDisplayMode('none');
        }
    }

    _row(label, val, unit = '') {
        return `<div class="data-row"><span>${label}</span> <strong>${val || '---'} ${unit}</strong></div>`;
    }

    renderEnergyPanel(hierarchy, container) {
        let html = '';

        // Energy view message
        html += `
            <div class="panel-section" style="padding: 16px; color: var(--text-dim); text-align: center; font-size: 11px; border-bottom: 1px solid #362e2a;">
                Operational energy telemetry active.<br>Smooth spatial data mapped in 3D.
            </div>
        `;

        container.innerHTML = html;
    }

    renderPlantOverview(container) {
        let html = `
            <div class="sidebar-section-header">PLANT OVERVIEW</div>
            <div style="display: flex; flex-direction: column; gap: 16px; padding: 0 4px;">
        `;

        const groups = [
            { id: 'melting', label: 'MELTING & HOLDING', icon: 'heat', tags: ['Furnace_Instant_kW', 'Melt_Bath_Temperature'] },
            { id: 'die_casting', label: 'DIE CASTING (LPDC)', icon: 'precision_manufacturing', tags: ['LPDC_Instant_kW', 'Shot_Count'] },
            { id: 'machining', label: 'CNC MACHINING', icon: 'settings_slow_motion', tags: ['CNC_Instant_kW', 'Part_Count'] },
            { id: 'heat_treating', label: 'HEAT TREATMENT', icon: 'temp_preferences_custom', tags: ['HT_Instant_kW', 'Furnace_Temperature'] },
            { id: 'qc', label: 'QUALITY CONTROL (X-RAY)', icon: 'biotech', tags: ['XRay_Instant_kW', 'Inspected_Count'] },
            { id: 'paint_shop', label: 'PAINT SHOP', icon: 'format_paint', tags: ['PB1_Instant_kW', 'PB1_Production_Count'] }
        ];

        groups.forEach(group => {
            const zoneId = group.id;
            const zone = this.analytics.data.zones[zoneId] || { instantKW: 0, production: 0, utilization: 0 };
            const machineIds = this.machineGroups[zoneId] || [];
            if (machineIds.length === 0) return;

            // Health determination from aggregate status
            const isActive = zone.instantKW > 0;

            html += `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s;"
                     onclick="window.app.setContext('zone', '${zoneId}')">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="material-symbols-outlined" style="font-size: 18px; color: ${isActive ? 'var(--primary)' : 'var(--text-dim)'}">${group.icon}</span>
                            <span style="font-size: 11px; font-weight: 900; letter-spacing: 1px;">${group.label}</span>
                        </div>
                        <span id="dept-status-${zoneId}" style="width: 10px; height: 10px; border-radius: 50%; background: ${isActive ? 'var(--success)' : 'var(--text-dim)'}; box-shadow: 0 0 8px ${isActive ? 'var(--success)66' : 'transparent'};"></span>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;
    }

    renderEnergyMachinesList(container) {
        let html = '';

        for (const [deptId, members] of Object.entries(this.machineGroups)) {
            const label = this.departmentLabels[deptId] || deptId.toUpperCase();
            html += `<div class="sidebar-section-title" style="margin-top:12px">${label}</div>`;
            html += '<div class="sidebar-nav-list">';
            for (const mid of members) {
                const asset = this._findAsset(mid);
                const displayName = (asset && asset.name) ? asset.name : mid;
                const machineData = this._findMachineData(mid);
                const state = (machineData?.state || '').toLowerCase();
                const analyticsM = this.analytics.data.machines[mid.toUpperCase()];
                const kwh = (analyticsM?.totalKWh || 0).toFixed(2);
                const isActive = (this.activeContext.id === mid);
                const color = state === 'running' ? 'var(--primary)' : (state === '' ? 'var(--text-dim)' : 'var(--text-dim)');
                html += `
                    <a href="#" class="sidebar-nav-item ${isActive ? 'active' : ''}" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;" onclick="event.preventDefault(); window.app.setContext('asset', '${mid}')">
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span style="font-size: 10px; color: ${color}; font-weight: 900; font-family: 'Public Sans', sans-serif;" id="list-spent-${mid}">${kwh} kWh</span>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    renderDeviceEnergyPanel(id, container) {
        const asset = this._findAsset(id);
        const name = asset?.name || id;
        const machineAnalytics = this.analytics.data.machines[id.toUpperCase()] || { instantKW: 0, totalKWh: 0, energyPerUnit: 0, scrapRate: 0 };
        const kw = (machineAnalytics.instantKW || 0).toFixed(2);
        const totalKwh = (machineAnalytics?.totalKWh || 0).toFixed(2);

        if (this.ui) this.ui.clearCache(); // [FIX] Invalidate cache before re-rendering detailed panels
        container.innerHTML = `
            <div style="padding: 0;">
                <div style="margin-bottom: 24px;"></div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 9px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Instant Load</div>
                        <div style="font-size: 24px; font-weight: 900; color: var(--primary); font-family: 'Public Sans', sans-serif;">
                            <span id="metric-${id}-Instant_kW">${kw}</span><span style="font-size: 12px; margin-left: 4px;">kW</span>
                        </div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 9px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Total Spent</div>
                        <div style="font-size: 24px; font-weight: 900; color: white; font-family: 'Public Sans', sans-serif;">
                            <span id="metric-${id}-Total_kWh">${totalKwh}</span><span style="font-size: 12px; margin-left: 4px;">kWh</span>
                        </div>
                    </div>
                </div>

                <div class="sidebar-section-title">VOLTAGE PHASES</div>
                <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 4px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 11px; color: var(--text-dim);">Phase A</span>
                        <span id="metric-${id}-voltage-a" style="font-size: 11px; color: white; font-weight: 700; font-family: 'Public Sans', monospace;">415.2V</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 11px; color: var(--text-dim);">Phase B</span>
                        <span id="metric-${id}-voltage-b" style="font-size: 11px; color: white; font-weight: 700; font-family: 'Public Sans', monospace;">415.8V</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px;">
                        <span style="font-size: 11px; color: var(--text-dim);">Phase C</span>
                        <span id="metric-${id}-voltage-c" style="font-size: 11px; color: white; font-weight: 700; font-family: 'Public Sans', monospace;">414.9V</span>
                    </div>
                </div>

                <div class="sidebar-section-title" style="margin-top: 32px;">POWER QUALITY</div>
                <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px;">
                    <span style="font-size: 11px; color: var(--text-dim);">Power Factor:</span>
                    <span id="metric-${id}-power-factor" style="font-size: 16px; color: var(--success); font-weight: 900; font-family: 'Public Sans', sans-serif;">0.98 cos φ</span>
                </div>
            </div>
        `;
    }

    updateDeviceEnergyPanel(id, data) {
        const all = (suffix) => document.querySelectorAll(`[id="metric-${id}-${suffix}"]`);
        const setText = (suffix, text) => all(suffix).forEach(el => { if (el.textContent !== text) el.textContent = text; });

        const m = this.analytics.data.machines[id.toUpperCase()];
        if (m) {
            setText('Instant_kW', (m.instantKW || 0).toFixed(2));
            setText('Total_kWh', (m.totalKWh || 0).toFixed(2));

            // [SECURITY/PLC] Run Status 
            const runStatus = data['Furnace_Run_Status'] || data['LPDC_Run_Status'] || data['CNC_Run_Status'] || data['XRay_Run_Status'] || data['HT_Run_Status'] || data['PT_Run_Status'] || data['PB1_Run_Status'] || data['PB2_Run_Status'] || 'OFFLINE';
            setText('state', String(runStatus).toUpperCase());

            // [AUTHENTICITY] Connection-Aware Derivations
            const isConnected = this.websocket && this.websocket.ws && this.websocket.ws.readyState === 1; // 1 = OPEN
            
            let vA = this.getValue(data, 'Voltage_A');
            let vB = this.getValue(data, 'Voltage_B');
            let vC = this.getValue(data, 'Voltage_C');
            let pf = this.getValue(data, 'Power_Factor') || this.getValue(data, 'PF');
            let freq = this.getValue(data, 'Frequency') || this.getValue(data, 'Freq');

            if (isConnected) {
                const kw = m.instantKW || 0;
                // [DERIVATION] Formula-based electrical properties from Load (kW)
                if (vA === undefined) {
                    const baseV = 415.2 - (kw / 75.0); // Load-dependent drop
                    vA = baseV + (Math.sin(Date.now() / 5000) * 0.2);
                    vB = baseV + 0.4 + (Math.cos(Date.now() / 4500) * 0.2);
                    vC = baseV - 0.3 + (Math.sin(Date.now() / 6000) * 0.1);
                }
                if (pf === undefined) {
                    pf = Math.max(0.88, Math.min(0.99, 0.96 - (kw / 3500.0)));
                }
                if (freq === undefined) {
                    freq = 50.0 + (Math.sin(Date.now() / 15000) * 0.02);
                }
            }

            all('voltage-a').forEach(el => { el.textContent = vA !== undefined ? `${vA.toFixed(1)} V` : '---'; });
            all('voltage-b').forEach(el => { el.textContent = vB !== undefined ? `${vB.toFixed(1)} V` : '---'; });
            all('voltage-c').forEach(el => { el.textContent = vC !== undefined ? `${vC.toFixed(1)} V` : '---'; });
            all('power-factor').forEach(el => { el.textContent = pf !== undefined ? `${pf.toFixed(2)} cos φ` : '---'; });
            all('frequency').forEach(el => { el.textContent = freq !== undefined ? `${freq.toFixed(1)} Hz` : '---'; });
        }
    }

    setEnergyViewType(type) {
        this.energyViewSettings.viewType = type;
        const leftPanel = document.getElementById('left-sidebar');

        if (type === 'all' && this.renderer) {
            this.renderer.resetToDefaultView(); // BACK TO INITIAL VIEW
            if (leftPanel) leftPanel.classList.remove('open');
        } else {
            this.energyViewSettings.selectedMachineId = null;
            if (leftPanel) leftPanel.classList.add('open');
        }
        this.refreshUI(true);
    }

    setSelectedMachine(id) {
        this.energyViewSettings.selectedMachineId = id;
        if (id && this.renderer) {
            this.renderer.isolateGroup([id]);
        }
        this.refreshUI(true);
    }

    setEnergyParameter(param) {
        this.energyViewSettings.parameter = param;
        // Map param to chip mode
        const modeMap = { 'energy': 'energy', 'cycle': 'cycle', 'status': 'status' };
        if (this.renderer) {
            this.renderer.setChipDisplayMode(modeMap[param]);
        }
        this.refreshUI(true);
    }

    renderSafetyPanel(container) {
        let html = '';
        const hierarchy = this.analytics.data;

        for (const [deptId, members] of Object.entries(this.machineGroups)) {
            const label = this.departmentLabels[deptId] || deptId.toUpperCase();
            html += `<div class="sidebar-section-title" style="margin-top:12px">${label}</div>`;
            html += '<div class="sidebar-nav-list">';

            for (const mid of members) {
                const entry = this.stateManager.getDeviceState(mid) || {};
                const m = hierarchy.machines[mid.toUpperCase()] || this._findMachineData(mid);
                const asset = this._findAsset(mid);
                const isXRay = mid.toUpperCase().includes('INSPECTION');
                const displayName = asset && asset.name ? asset.name : (isXRay ? mid.replace(/INSPECTION/i, 'X-RAY') : mid);

                const state = (entry.state || m?.state || 'OFFLINE').toLowerCase();
                const isFault = ['stopped', 'fault', 'error'].includes(state);
                const isLOTO = (entry.data?.Enabled === false);

                let statusText = 'SECURE';
                let color = 'var(--success)';
                let icon = 'shield_check';

                if (isFault) {
                    statusText = 'ALARM';
                    color = 'var(--danger)';
                    icon = 'report';
                } else if (isLOTO) {
                    statusText = 'LOTO';
                    color = 'var(--primary)';
                    icon = 'lock_reset';
                }

                html += `
                    <div class="sidebar-nav-item" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px; cursor: pointer" 
                        onclick="window.app.setContext('alarm_machine', '${mid}')">
                        <span class="material-symbols-outlined" style="color: ${color}">${asset?.icon || icon}</span>
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span id="status-${mid}" style="font-size: 11px; color: ${color}; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">
                                ${statusText}
                            </span>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    renderMachinesListPanel(contentEl) {
        let html = '';
        for (const [deptId, members] of Object.entries(this.machineGroups)) {
            const label = this.departmentLabels[deptId] || deptId.toUpperCase();
            html += `<div class="sidebar-section-title" style="margin-top:12px">${label}</div>`;
            html += '<div class="sidebar-nav-list">';
            for (const mid of members) {
                const asset = this._findAsset(mid);
                const displayName = (asset && asset.name) ? asset.name : mid;
                const machineData = this._findMachineData(mid);
                const state = (machineData?.state || '').toLowerCase();
                const isOnline = state === 'running' || state === 'idle' || state === 'normal';
                const color = isOnline ? 'var(--success)' : (state === '' ? 'var(--text-dim)' : 'var(--danger)');
                const badge = state === 'running' ? 'RUNNING' : (state === '' || state === 'offline' ? 'OFFLINE' : state.toUpperCase());
                html += `
                    <a href="#" class="sidebar-nav-item" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;" onclick="event.preventDefault(); window.app.setContext('asset', '${mid}')">
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span style="font-size: 10px; color: ${color}; font-weight: 900; background: ${color}11; padding: 2px 8px; border-radius: 4px; border: 1px solid ${color}22;">${badge}</span>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }
        contentEl.innerHTML = html;
    }

    renderSafetyPanel(container, id = null) {
        let html = '';
        if (!id) {
            // Global Alarms List
            html = `
                <div class="sidebar-section-title">ACTIVE FAULTS & WARNINGS</div>
                <div class="sidebar-nav-list">
            `;
            let hasAlerts = false;
            this.stateManager.deviceStates.forEach((entry, mid) => {
                const state = (entry.state || '').toLowerCase();
                const isFault = ['stopped', 'fault', 'error'].includes(state);
                if (isFault) {
                    hasAlerts = true;
                    html += `
                        <a href="#" class="sidebar-nav-item" style="border-left: 3px solid var(--danger); background: rgba(220,38,38,0.05);"
                           onclick="event.preventDefault(); window.app.setContext('alarm_machine', '${mid}')">
                             <span class="material-symbols-outlined" style="color: var(--danger)">report</span>
                             <div style="flex: 1">
                                 <div style="font-weight: 700;">${mid}</div>
                                 <div style="font-size: 10px; color: var(--danger); text-transform: uppercase;">Critical Fault Registered</div>
                             </div>
                        </a>
                    `;
                }
            });
            if (!hasAlerts) {
                html += '<div style="padding: 24px; color: var(--text-dim); text-align: center;">All systems nominal.<br>No active maintenance interrupts.</div>';
            }
            html += '</div>';
            container.innerHTML = html;
            return;
        }

        const entry = this.stateManager.getDeviceState(id) || {};
        const state = (entry.state || 'OFFLINE').toLowerCase();
        const isFault = ['stopped', 'fault', 'error'].includes(state);
        const stateColor = isFault ? 'var(--danger)' : 'var(--success)';

        html = `
            <div class="sidebar-section-title">DEVICE ALARM LOG</div>
            <div class="sidebar-nav-list">
        `;
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
            const icon = log.type === 'crit' ? 'report' : (log.type === 'warn' ? 'warning' : 'info');

            html += `
                <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: rgba(0,0,0,0.2); border: 1px solid #362e2a; border-radius: 12px; margin-bottom: 12px;">
                    <div style="height: 40px; width: 40px; flex-shrink: 0; background: ${dotColor}11; border: 1px solid ${dotColor}22; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                        <span class="material-symbols-outlined" style="color: ${dotColor}; font-size: 20px;">${icon}</span>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 13px; font-weight: 700; color: white; margin-bottom: 4px;">${log.msg}</div>
                        <div style="font-size: 11px; color: #64748b; font-weight: 600;">ALARM SOURCE: ${id.toUpperCase()}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 12px; font-weight: 800; color: white; font-family: 'Public Sans', monospace;">${log.time}</div>
                        <div style="font-size: 9px; color: #64748b; font-weight: 900; text-transform: uppercase; margin-top: 4px;">LOGGED</div>
                    </div>
                </div>
            `;
        });

        html += `
            </div>
            <div style="margin-top: 32px;">
                <button class="primary-action-btn" style="width: 100%; padding: 16px; background: #ec5b13; color: white; border: none; border-radius: 12px; font-weight: 900; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; display: flex; align-items: center; justify-content: center; gap: 12px; cursor: pointer; box-shadow: 0 4px 12px rgba(236,91,19,0.2);">
                    <span class="material-symbols-outlined" style="font-size: 20px;">notifications_off</span>
                    SILENCE ACTIVE ALARMS
                </button>
            </div>
        `;
        container.innerHTML = html;
    }


    // ─── Gemba Walk Mode ─────────────────────────────────────────────
    startGembaWalk() {
        if (this.primaryMode !== 'gemba') return;
        this.gembaWaypoints = [
            { dept: null, ids: ['RAWMATERIALS'], label: 'Raw Materials' },
            { dept: null, ids: ['FURNACE_01'], label: 'Furnace 01' },
            { dept: null, ids: ['DEGASSER_01', 'DEGASSER_02'], label: 'Degassers' },
            { dept: null, ids: ['LPDC_01', 'LPDC_02', 'LPDC_03'], label: 'Die Castings' },
            { dept: null, ids: ['COOLING_01'], label: 'Cooling Tank — LPDC' },
            { dept: null, ids: ['INSPECTION_01'], label: 'X-Ray Inspection' },
            { dept: null, ids: ['HEAT_01'], label: 'Heat Treatment' },
            { dept: null, ids: ['CNC_01', 'CNC_02'], label: 'Machining' },
            { dept: null, ids: ['PRETREAT_01'], label: 'Pretreatment' },
            { dept: null, ids: ['PAINT_01'], label: 'Paint Booth 01' },
            { dept: null, ids: ['PAINT_02'], label: 'Paint Booth 02 — Ceramic Coat' },
            { dept: null, ids: ['OUTBOUND_01', 'OUTBOUND_02'], label: 'Outbound' },
        ];
        this.gembaIndex = 0;
        this.gembaPaused = false;

        // Hide start button and show tour control buttons
        document.getElementById('gemba-start-mode-btn').style.display = 'none';
        let navControls = document.getElementById('gemba-nav-controls');
        if (navControls) {
            navControls.style.display = 'flex';

            // [TWINZO] Populate Timeline
            const timeline = document.getElementById('gemba-timeline');
            if (timeline) {
                timeline.innerHTML = this.gembaWaypoints.map((wp, i) => `
                    <div class="gemba-dot ${i === 0 ? 'active' : ''}" 
                         onclick="window.app.gembaIndex = ${i}; window.app.gembaNavigate(0)" 
                         title="${wp.label}">
                    </div>
                `).join('');
            }

            if (!navControls.dataset.initialized) {
                document.getElementById('gemba-prev').onclick = () => this.gembaNavigate(-1);
                document.getElementById('gemba-next').onclick = () => this.gembaNavigate(1);
                document.getElementById('gemba-pause').onclick = () => {
                    this.gembaPaused = !this.gembaPaused;
                    const pauseBtn = document.getElementById('gemba-pause');
                    pauseBtn.querySelector('span').textContent = this.gembaPaused ? 'play_arrow' : 'pause';
                    pauseBtn.classList.toggle('gemba-paused', this.gembaPaused);
                };
                document.getElementById('gemba-stop').onclick = () => this.stopGembaWalk();
                navControls.dataset.initialized = "true";
            }
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

        // Update bar center label
        const barStep = document.getElementById('gemba-bar-step');
        if (barStep) barStep.textContent = `${this.gembaIndex + 1} / ${this.gembaWaypoints.length}`;
        const barName = document.getElementById('gemba-bar-name');
        if (barName) barName.textContent = wp.label || 'OVERVIEW';

        // Update info overlay (top-left)
        const machineEl = document.getElementById('gemba-machine-name');
        if (machineEl) machineEl.textContent = wp.label || 'SYSTEM OVERVIEW';

        // Frame and focus the waypoint's machines in 3D
        const deviceIds = wp.dept ? this.machineGroups[wp.dept] : wp.ids;
        this.gembaActiveIds = deviceIds;
        if (deviceIds && this.renderer) {
            this.renderer.isolateGroup(deviceIds);
            this.renderer.focusOnGroup(deviceIds);
        }

        // Sync timeline dots
        const dots = document.querySelectorAll('.gemba-dot');
        dots.forEach((dot, i) => {
            if (i === this.gembaIndex) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }

    stopGembaWalk() {
        if (this.gembaTimer) clearInterval(this.gembaTimer);
        this.gembaTimer = null;
        this.gembaPaused = false;

        // Hide navigation controls, show START button — stay in gemba mode
        const navControls = document.getElementById('gemba-nav-controls');
        if (navControls) navControls.style.display = 'none';

        const startBtn = document.getElementById('gemba-start-mode-btn');
        if (startBtn) startBtn.style.display = 'flex';

        const infoOverlay = document.getElementById('gemba-info-overlay');
        if (infoOverlay) infoOverlay.style.display = 'none';

        // Reset 3D view to plant overview without leaving gemba mode
        this.renderer?.resetToDefaultView();
        this.renderer?.isolateGroup([]);
    }

    logAudit(status, label = null) {
        const wp = this.gembaWaypoints[this.gembaIndex];
        const entry = {
            id: Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            waypoint: wp.label,
            status: status.toUpperCase(),
            label: label || wp.label
        };
        this.auditLogs.unshift(entry);
        if (this.auditLogs.length > 20) this.auditLogs.pop();
    }

    sendMachineCommand(id, cmd) {
        if (this.websocket) {
            this.websocket.sendCommand(id, cmd);
            this.logAudit('COMMAND', `${id}: ${cmd}`);
        }
    }

    renderGembaPanel(container) {
        if (!this.gembaTimer) {
            container.innerHTML = `
                <div style="padding: 32px; text-align: center;">
                    <span class="material-symbols-outlined" style="font-size: 48px; color: var(--primary); margin-bottom: 24px;">visibility</span>
                    <div style="font-size: 14px; color: white; font-weight: 700; margin-bottom: 12px;">Gemba Walk Ready</div>
                    <div style="font-size: 12px; color: var(--text-dim); line-height: 1.6; margin-bottom: 32px;">
                        Start the automated audit to inspect all plant waypoints and active operational status.
                    </div>
                    <button onclick="window.app.startGembaWalk()" class="primary-action-btn" style="width: 100%; border-radius: 12px; padding: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 800; text-transform: uppercase; background: var(--primary); color: white; border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(236,91,19,0.3);">
                        <span class="material-symbols-outlined">play_circle</span>
                        START GEMBA WALK
                    </button>
                </div>
            `;
            return;
        }

        const wp = this.gembaWaypoints[this.gembaIndex];
        const deviceIds = this.gembaActiveIds || [];

        let telemetryHtml = '';
        deviceIds.forEach(id => {
            telemetryHtml += `
                <div class="sidebar-section-title" style="color: var(--primary); margin-top: 24px;">${id.toUpperCase()} TELEMETRY</div>
                ${this._renderTelemetryGrid(id, this._findMachineData(id)?.data || {})}
            `;
        });

        container.innerHTML = `
            <div class="sidebar-section-title" style="display: flex; justify-content: space-between; align-items: center;">
                <span>TOUR PROGRESS</span>
                <span style="font-size: 9px; color: var(--primary); font-weight: 800; border: 1px solid var(--primary)33; padding: 2px 8px; border-radius: 4px;">AUTOMATED</span>
            </div>
            
            <div style="padding: 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <span id="gemba-step-info" style="font-size: 10px; color: var(--text-dim); font-weight: 900; text-transform: uppercase; letter-spacing: 1px;">Step ${this.gembaIndex + 1} of ${this.gembaWaypoints.length}</span>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="window.app.gembaNavigate(-1)" class="gemba-mini-btn" title="Previous"><span class="material-symbols-outlined">chevron_left</span></button>
                        <button id="gemba-pause-inline" onclick="window.app.gembaPaused = !window.app.gembaPaused; window.app.renderGembaPanel(document.getElementById('right-panel-content'))" class="gemba-mini-btn" title="Pause/Play">
                            <span class="material-symbols-outlined">${this.gembaPaused ? 'play_arrow' : 'pause'}</span>
                        </button>
                        <button onclick="window.app.gembaNavigate(1)" class="gemba-mini-btn" title="Next"><span class="material-symbols-outlined">chevron_right</span></button>
                    </div>
                </div>
                <div id="gemba-waypoint-name" style="font-size: 16px; font-weight: 900; color: white; margin-bottom: 4px; letter-spacing: -0.5px;">${wp.label}</div>
                <div style="font-size: 11px; color: var(--text-dim);">Visual inspection in progress...</div>
                
                <div style="margin-top: 16px; height: 4px; width: 100%; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                    <div style="width: ${((this.gembaIndex + 1) / this.gembaWaypoints.length) * 100}%; height: 100%; background: var(--primary); transition: width 0.5s ease;"></div>
                </div>
            </div>

            <!-- MACHINE CONTROLS -->
            ${deviceIds.length > 0 ? `
                <div class="sidebar-section-title" style="color: var(--primary); margin-top: 24px;">REMOTE COMMAND CENTRE</div>
                <div style="display: flex; gap: 10px; margin-bottom: 24px;">
                    <button onclick="window.app.sendMachineCommand('${deviceIds[0]}', 'START')" style="flex: 1; height: 44px; background: rgba(16, 185, 129, 0.1); border: 1px solid #10b98144; border-radius: 8px; color: #10b981; font-weight: 900; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(16, 185, 129, 0.2)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.1)'">
                        <span class="material-symbols-outlined" style="font-size: 18px;">play_circle</span> START
                    </button>
                    <button onclick="window.app.sendMachineCommand('${deviceIds[0]}', 'STOP')" style="flex: 1; height: 44px; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef444444; border-radius: 8px; color: #ef4444; font-weight: 900; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">
                        <span class="material-symbols-outlined" style="font-size: 18px;">stop_circle</span> STOP
                    </button>
                </div>
            ` : ''}

            <!-- AUDIT ACTIONS -->
            <div class="sidebar-section-title" style="color: var(--primary); margin-top: 24px;">OBSERVATIONAL AUDIT</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px;">
                <button onclick="window.app.logAudit('STABLE')" style="background: #FFFFFF08; border: 1px solid #FFFFFF0D; padding: 12px; border-radius: 8px; color: #10B981; font-size: 10px; font-weight: 900; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">check_circle</span> STABLE
                </button>
                <button onclick="window.app.logAudit('ISSUE')" style="background: #FFFFFF08; border: 1px solid #FFFFFF0D; padding: 12px; border-radius: 8px; color: #F59E0B; font-size: 10px; font-weight: 900; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">warning</span> FLAG ISSUE
                </button>
                <button onclick="window.app.logAudit('CRITICAL')" style="grid-column: span 2; background: #EF44440D; border: 1px solid #EF444422; padding: 12px; border-radius: 8px; color: #EF4444; font-size: 10px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">report</span> LOG CRITICAL INCIDENT
                </button>
            </div>

            ${telemetryHtml}

            <div class="sidebar-section-title" style="margin-top: 24px;">SESSION AUDIT LOG</div>
            <div class="sidebar-nav-list" style="display: flex; flex-direction: column; gap: 8px;">
                ${this.auditLogs.length === 0 ? `
                    <div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px;">No observations recorded yet.</div>
                ` : this.auditLogs.map(log => `
                    <div style="background: #FFFFFF05; padding: 10px; border-radius: 8px; border-left: 3px solid ${log.status === 'STABLE' ? '#10B981' : (log.status === 'ISSUE' ? '#F59E0B' : '#EF4444')};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 9px; font-weight: 900; color: ${log.status === 'STABLE' ? '#10B981' : (log.status === 'ISSUE' ? '#F59E0B' : '#EF4444')}">${log.status}</span>
                            <span style="font-size: 9px; color: var(--text-dim);">${log.timestamp}</span>
                        </div>
                        <div style="font-size: 11px; color: #FFFFFF; font-weight: 700;">${log.waypoint}</div>
                        ${log.label !== log.waypoint ? `<div style="font-size: 10px; color: var(--text-dim); margin-top: 2px;">${log.label}</div>` : ''}
                    </div>
                `).join('')}
            </div>

            <div style="margin-bottom: 40px;"></div>
        `;
    }

    // ─── Precision Telemetry Helpers ────────────────────────────────────

    parseValue(val) {
        if (val === undefined || val === null) return 0;
        const n = Number(val);
        return isNaN(n) ? val : n;
    }

    formatValue(val, tag = '') {
        if (typeof val === 'boolean') return val ? 'ACTIVE' : 'INACTIVE';
        const n = this.parseValue(val);
        if (typeof n !== 'number') return String(n);
        // [PRECISION] Integers display cleanly, floats get 2 decimal places
        return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
    }

    getValue(data, key) {
        if (!data || !key) return undefined;
        const lowerTarget = key.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. [ROBUSTNESS] Fallback to global PLANT data for WIP/KPI tags if missing in machine context
        const plantData = this.stateManager?.getDeviceState('PLANT')?.data || {};
        
        // 2. Exact or Case-Insensitive direct match
        if (data[key] !== undefined) return data[key];
        if (data[key.toUpperCase()] !== undefined) return data[key.toUpperCase()];
        if (data[key.toLowerCase()] !== undefined) return data[key.toLowerCase()];

        // 3. [VIRTUAL MAPPING] Fallback for devices without direct simulation (e.g. RAWMATERIALS)
        if (lowerTarget.includes('wip') || lowerTarget.includes('ingot') || lowerTarget.includes('kpi') || lowerTarget.includes('material')) {
            // Check plant data fallback
            const plantVal = plantData[key] || plantData[key.toUpperCase()] || plantData[key.toLowerCase()];
            if (plantVal !== undefined) return plantVal;
            
            // Fuzzy plant search
            for (const [pk, pv] of Object.entries(plantData)) {
                if (pk.toLowerCase().replace(/[^a-z0-9]/g, '').includes(lowerTarget)) return pv;
            }
        }

        // 4. [ROBUSTNESS] Special Handling for State/Mode
        if (lowerTarget === 'state') {
            if (data['CalculatedState'] !== undefined) return data['CalculatedState'];
            if (data['state'] !== undefined) return data['state'];
        }
        if (lowerTarget === 'mode' || lowerTarget.includes('mode')) {
            if (data[key] !== undefined && data[key] !== '---') return data[key];
            for (const [k, v] of Object.entries(data)) {
                const nk = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (nk.includes('runstatus') || nk.includes('runstatus') || nk.includes('mode')) return v;
            }
        }

        // 5. [ROBUSTNESS] Special Handling for Energy Load
        const isRequestingInstantPower = lowerTarget.includes('kw') && !lowerTarget.includes('kwh');
        const isRequestingLoad = (lowerTarget.includes('load') || lowerTarget.includes('power')) && !lowerTarget.includes('factor');
        
        if (isRequestingInstantPower || isRequestingLoad) {
            for (const [k, v] of Object.entries(data)) {
                const nk = k.toLowerCase();
                if (isRequestingInstantPower) {
                    if (nk.includes('kw') && !nk.includes('kwh')) return v;
                } else if (isRequestingLoad) {
                    if ((nk.includes('power') || nk.includes('load')) && !nk.includes('factor') && !nk.includes('kwh')) return v;
                }
            }
        }

        // 6. [FUZZY MATCH] Deep recursive/prefix-aware search
        // Normalized match: strip all formatting and compare
        for (const [k, v] of Object.entries(data)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normK === lowerTarget || normK.includes(lowerTarget) || lowerTarget.includes(normK)) return v;
        }

        // 7. Last Ditch: check Plant data for ANY tag that might be there
        const lastDitchPlant = plantData[key];
        if (lastDitchPlant !== undefined) return lastDitchPlant;

        return undefined;
    }

    sendDeviceCommand(id, cmd) {
        if (!this.websocket || !this.websocket.ws) return;
        this.websocket.ws.send(JSON.stringify({
            type: "write",
            node_id: `VirtualPLC.Devices.${id.toUpperCase()}.Inputs.${cmd}`,
            value: true
        }));
    }


    clearSidebarGuards(side = 'both') {
        if (side === 'left' || side === 'both') {
            const el = document.getElementById('left-nav-list');
            if (el) {
                el.removeAttribute('data-active-id');
                el.removeAttribute('data-active-type');
            }
        }
        if (side === 'right' || side === 'both') {
            const el = document.getElementById('right-panel-content');
            if (el) {
                el.removeAttribute('data-active-id');
                el.removeAttribute('data-active-type');
                el.removeAttribute('data-active-mode');
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new DigitalTwinApp(); });
