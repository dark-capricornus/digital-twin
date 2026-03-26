/**
 * Main Application logic for Digital Twin
 * Hands-off discovery and precision mapping
 */

import Renderer from './renderer.js';
import WebSocketHandler from './websocketHandler.js';
import StateManager from './stateManager.js';
import UIUpdater from './uiUpdater.js';
import EnergyAnalytics from './EnergyAnalytics.js';

class DigitalTwinApp {
    constructor() {
        this.renderer = null;
        this.stateManager = new StateManager();
        this.ui = new UIUpdater(this, this.stateManager);
        this.websocket = null;
        this.analytics = new EnergyAnalytics();
        
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
        this.machineGroups = this._getMachineGroups();
        this.departmentLabels = this._getDepartmentLabels();

        // Gemba Audit State
        this.auditLogs = [];

        // [PERF] Move all initialization logic into an async chain
        // This allows the constructor to return immediately, clearing DOMContentLoaded
        this.setupListeners();
        setTimeout(() => this.init(), 0);
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
                'Core Energy': ['Furnace_Instant_kW', 'Furnace_Total_kWh'],
                'Temperature': ['Melt_Bath_Temperature', 'Roof_Temperature', 'Wall_Temperature'],
                'Status': ['Furnace_Mode', 'Alarm_Status', 'Step_Timer']
            },
            'LPDC': {
                'Core Energy': ['LPDC_Instant_kW', 'LPDC_Total_kWh'],
                'Pressure': ['Riser_Pressure', 'Pressure_Setpoint', 'Holding_Pressure'],
                'Temperature': ['Holding_Furnace_Temperature', 'Die_Top_Temperature', 'Die_Bottom_Temperature'],
                'Time / Cycle': ['Cycle_Time', 'Fill_Time', 'Solidification_Time'],
                'Status': ['LPDC_Mode', 'Cycle_Status', 'Alarm_Status'],
                'Production': ['Shot_Count', 'Model_ID']
            },
            'CNC': {
                'Core Energy': ['CNC_Instant_kW', 'CNC_Total_kWh'],
                'Cycle / Program': ['Program_ID', 'Cycle_Time', 'Cycle_Status'],
                'Production': ['Part_Count', 'Good_Part_Count', 'Reject_Count'],
                'Status': ['CNC_Mode', 'Alarm_Status']
            },
            'INSPECTION': {
                'Core Energy': ['XRay_Instant_kW', 'XRay_Total_kWh'],
                'Inspection Cycle': ['Inspection_Cycle_Time', 'Scan_Status'],
                'Production / Quality': ['Inspected_Count', 'OK_Count', 'NG_Count'],
                'Status': ['XRay_Mode', 'Alarm_Status']
            },
            'HEAT': {
                'Core Energy': ['HT_Instant_kW', 'HT_Total_kWh'],
                'Temperature': ['Furnace_Temperature', 'Temperature_Setpoint'],
                'Process Sequence': ['Process_Step', 'Step_Timer'],
                'Status': ['HT_Mode', 'Alarm_Status']
            },
            'PRETREAT': {
                'Core Energy': ['PT_Instant_kW', 'PT_Total_kWh'],
                'Process / Conveyor': ['Conveyor_Speed', 'Stage_Status', 'Dryer_Temperature'],
                'Status': ['PT_Mode', 'Alarm_Status']
            },
            'PAINT_01': {
                'Core Energy': ['PB1_Instant_kW', 'PB1_Total_kWh'],
                'Booth Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
                'Conveyor / Process': ['Booth_Cycle_Status'],
                'Status': ['PB1_Mode', 'Alarm_Status']
            },
            'PAINT_02': {
                'Core Energy': ['PB2_Instant_kW', 'PB2_Total_kWh'],
                'Booth Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
                'Conveyor / Process': ['Booth_Cycle_Status'],
                'Status': ['PB2_Mode', 'Alarm_Status']
            },
            'COOLING': {
                'Core Energy': ['Cooling_Instant_kW', 'Cooling_Total_kWh'],
                'Environment': ['Tank_Temperature', 'Target_Temperature', 'Cooling_Status'],
                'Status': ['Cooling_Mode', 'Alarm_Status']
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
    }

    _getMachineGroups() {
        return {
            'smelting': ['FURNACE_01', 'DEGASSER_01', 'DEGASSER_02'],
            'die_casting': ['LPDC_01', 'LPDC_02', 'LPDC_03', 'COOLING_01'],
            'machining': ['CNC_01', 'CNC_02'],
            'heat_treating': ['HEAT_01', 'HEAT_02', 'COOLING_02'],
            'qc': ['INSPECTION_01'],
            'paint_shop': ['PAINT_01', 'PAINT_02', 'PRETREAT_01'],
            'logistics': ['RAWMATERIALS', 'INBOUND_01', 'STORAGE_01', 'OUTBOUND_01'],
        };
    }

    _getDepartmentLabels() {
        return {
            'smelting': 'Smelting Department',
            'die_casting': 'Die Casting Department',
            'machining': 'Machining Zone',
            'heat_treating': 'Heat Treating Department',
            'paint_shop': 'Paint Shop',
            'shipping': 'Shipping Department',
            'logistics': 'Logistics & Storage',
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
            'zone': 'location_on',
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
        const id = deviceId.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        // Explicit PAINT booth matching (PAINT_01, PAINT01, etc.)
        if (/PAINT.?01|PB1/i.test(id)) return 'PAINT_01';
        if (/PAINT.?02|PB2/i.test(id)) return 'PAINT_02';
        // Prefix-based matching
        const prefixes = ['FURNACE', 'LPDC', 'CNC', 'INSPECTION', 'HEAT', 'PRETREAT', 'COOLING', 'DEGASSER', 'OUTBOUND', 'PAINT', 'RAWMATERIALS', 'STORAGE', 'INBOUND'];
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
        if (!tag) return '';
        const upperTag = tag.toUpperCase();
        
        if (upperTag.includes('KWH')) return 'kWh';
        if (upperTag.includes('KW')) return 'kW';
        if (upperTag.includes('TEMPERATURE') || upperTag.includes('TEMP')) return '°C';
        if (upperTag.includes('PRESSURE') || upperTag.includes('PSI') || upperTag.includes('BAR')) return 'bar';
        if (upperTag.includes('RPM')) return 'RPM';
        if (upperTag.includes('SPEED')) return 'm/min';
        if (upperTag.includes('HUMIDITY') || upperTag.includes('PCT') || upperTag.includes('%')) return '%';
        if (upperTag.includes('TIME') || upperTag.includes('TIMER')) return 's';
        
        return '';
    }

    _getDomElement(id) {
        return document.getElementById(id);
    }

    _hasChanged(type, id, data, keys) {
        // [PERF] Simple change detection to prevent redundant DOM updates
        return true; 
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
        console.log('[App] Initializing Digital Twin...');
        const container = document.getElementById('container');
        this.renderer = new Renderer(container, this.stateManager);

        // Load Asset Metadata (static data source: assets.json)
        try {
            const response = await fetch('./assets.json');
            const json = await response.json();
            // Unwrap 'assets' key so _findAsset can look up directly by device ID (e.g. 'FURNACE_01')
            this.assetData = (json && json.assets) ? json.assets : json;
            this.assets = this.assetData; // Alias for scene.js getAssetInfo
            console.log('[App] Assets metadata loaded:', Object.keys(this.assetData).length);
        } catch (e) {
            console.error('[App] Failed to load assets.json:', e);
        }


        let wsUrl;
        if (window.location.protocol === "file:") {
            wsUrl = "ws://localhost:8001/ws";
        } else {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            let host = window.location.hostname || "localhost";
            if (/localhost|::1|\[::1\]/i.test(host)) {
                host = '127.0.0.1';
            }
            wsUrl = `${protocol}//${host}:8001/ws`;
        }

        console.log("[WebSocket] Connecting to", wsUrl);
        this.websocket = new WebSocketHandler(
            wsUrl,
            this.stateManager,
            (status) => this.updateStatus(status)
        );

        this.websocket.connect();
        
        if (this.renderer) {
            await this.renderer.loadModel('assets/models/plant.glb');
            
            // [PERF] Yield before starting the render loop to allow layout paint 
            await new Promise(resolve => setTimeout(resolve, 0));
            this.renderer.start();
        }

        // Start throttled UI update loop
        this.startUpdateLoop();

        // [Phase 26] Pre-render chips (Staggered)
        this.initialRenderChips();
        
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
                setTimeout(() => {
                    this.handleAction(action);
                }, 0);
            });
        });

        // Close Sidebars - Universal "Reset to Initial View" Rule
        document.getElementById('close-left-panel')?.addEventListener('click', () => {
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
            'zones':    'zones_scope',
            'machines': 'machines_list',
            'energy':   'energy_analytics',
            'alarm':    'alarms',
        };
        this.setContext(contextTypeMap[action] || action);

        // Auto-open left sidebar for all modes that have a left panel
        if (action === 'plant' || action === 'gemba') {
            this.toggleLeftSidebar(false);
        } else {
            this.toggleLeftSidebar(true);
        }

        // [USER] Explicitly close right sidebar when entering Zones mode
        if (action === 'zones' && rightPanel) {
            rightPanel.classList.remove('open');
            this.isRightPanelManuallyClosed = false;
        }
    }

    _isAlarmMode(mode) {
        return ['alarm', 'alarms', 'isolation'].includes(mode) && !this.gembaTimer;
    }

    setContext(type, id = null) {
        console.log(`[App] Transition: ${this.activeContext.type}->${type}${id ? ':'+id : ''}`);
        
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
        const rightOpen = document.getElementById('right-sidebar')?.classList.contains('open');
        const isMachine = ['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(type);

        if (this.activeContext.type === type && this.activeContext.id === id) {
            if (isTopLevel && !leftOpen) { /* Proceed to open left */ }
            else if (isMachine && !rightOpen) { /* Proceed to open right */ }
            else if (type !== 'plant') return;
        }

        // Only reset 3D camera/isolation when returning to a top-level overview
        if (type === 'plant' || type === 'zones_scope') {
            this.renderer?.resetInteraction();
        }

        this.activeContext = { type, id };

        // ─── Direct Interaction Dispatch ────────────────────────────────
        const rightPanel = document.getElementById('right-sidebar');
        
        if (type === 'zone' && id) {
            // [ZONE] Explicit Camera Focus for Zones
            this.renderer?.focusOnZone(id);
            this.toggleLeftSidebar(true);
            
            // [USER] Ensure right sidebar is closed in zone view
        } else if (['machine', 'asset', 'maintenance_machine', 'alarm_machine'].includes(type) && id) {
            // [ASSET] Explicit Camera Focus for Devices
            this.renderer?.focusOnDevice(id);

            // [GHOST] Ghost all non-selected meshes; alarm mode uses full greyscale with focused machine textured
            if (type === 'alarm_machine') {
                this.renderer?.setAllGrey([id]);
            } else if (this.primaryMode !== 'gemba') {
                this.renderer?.isolateGroup([id]);
            }

            // [GEMBA] Hide gemba controls when not in gemba mode
            if (this.primaryMode !== 'gemba') {
                document.getElementById('gemba-tour-bar')?.style.setProperty('display', 'none');
                document.getElementById('gemba-info-overlay')?.style.setProperty('display', 'none');
            }

            // [USER] Disable right sidebar in zone view and gemba mode
            if (this.primaryMode !== 'zones' && this.primaryMode !== 'gemba' && rightPanel && !this.isRightPanelManuallyClosed) {
                rightPanel.classList.add('open');
            }
            
            const hierarchy = this.analytics.update(this.stateManager.deviceStates, this.machineGroups);
            this.renderRightSidebar(hierarchy);
        } else if (type === 'gemba' && rightPanel) {
            // [GEMBA] Ensure right sidebar is CLOSED for immersive tour
            rightPanel.classList.remove('open');

            // Show Floating Tour Bar
            const tourBar = document.getElementById('gemba-tour-bar');
            if (tourBar) tourBar.style.display = 'flex';
            const overlay = document.getElementById('gemba-info-overlay');
            if (overlay) overlay.style.display = 'block';
        } else if (isTopLevel && rightPanel) {
            // [GEMBA] Hide controls when leaving
            document.getElementById('gemba-tour-bar').style.display = 'none';
            document.getElementById('gemba-info-overlay').style.display = 'none';

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
            const leftSidebar = document.getElementById('left-sidebar');
            if (leftSidebar && leftSidebar.classList.contains('open')) {
                this.renderLeftSidebar(hierarchy);
            }
            // Only render right sidebar if it's actually open — prevents stale isolateGroup camera jumps
            const rightSidebar = document.getElementById('right-sidebar');
            if (rightSidebar && rightSidebar.classList.contains('open')) {
                this.renderRightSidebar(hierarchy);
            }
        }
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
        }

        // 3. PERSISTENCE: Save the last primary navigation mode for this sidebar
        if (this.activeContext.type !== 'machine' && this.activeContext.type !== 'asset' && 
            this.activeContext.type !== 'maintenance_machine' && this.activeContext.type !== 'alarm_machine') {
            this.lastLeftContext = { ...this.activeContext };
        }
    }

    renderZonesScope(hierarchy, container) {
        let html = `
            <div class="sidebar-section-title" style="margin-top: 4px;">ZONES</div>
            <div class="sidebar-nav-list" data-active-type="zones_scope">
        `;
        Object.keys(this.machineGroups).forEach(zoneId => {
            const data = hierarchy.zones[zoneId];
            const isActive = this.activeContext.id === zoneId;
            html += `
                <a href="#" class="sidebar-nav-item ${isActive ? 'active' : ''}" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;"
                   onclick="event.preventDefault(); window.app.setContext('zone', '${zoneId}')">
                    <span class="material-symbols-outlined" style="font-size: 18px; color: var(--text-dim);">map</span>
                    <div style="flex: 1">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: 700;">${this.departmentLabels[zoneId] || zoneId.toUpperCase()}</span>
                            <span id="metric-${zoneId}-production" style="font-size: 11px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">${data?.production || 0} unit</span>
                        </div>
                        <div style="height: 3px; background: var(--surface-dark); border-radius: 2px; margin-top: 6px">
                            <div id="bar-${zoneId}-utilization" style="height: 100%; background: var(--primary); width: ${data?.utilization || 0}%; border-radius: 2px; transition: width 0.5s ease;"></div>
                        </div>
                    </div>
                </a>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    renderRightSidebar(hierarchy) {
        const titleEl = document.getElementById('right-panel-title');
        const contentEl = document.getElementById('right-panel-content');
        const navEl = document.getElementById('right-header-nav');
        const header = document.querySelector('#right-sidebar .sidebar-header');
        
        // Use active context if it's a machine or gemba, otherwise use last known right context
        const isCurrentlyMachine = ['alarm_machine', 'maintenance_machine', 'machine', 'asset', 'gemba'].includes(this.activeContext.type);
        const targetContext = isCurrentlyMachine ? this.activeContext : (this.lastRightContext || null);
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
        
        let titleText = 'Machine Details';
        if (type === 'alarm_machine' || type === 'maintenance_machine' || type === 'alarm' || type === 'alarms') {
            titleText = 'LOGS & DIAGNOSTICS';
            if (id) {
                const asset = this._findAsset(id);
                titleText = (asset && asset.name ? asset.name : id.toUpperCase().replace(/_/g, ' '));
            }
        } else if ((type === 'machine' || type === 'asset') && id) {
            const asset = this._findAsset(id);
            const name = asset && asset.name ? asset.name : id.toUpperCase().replace(/_/g, ' ');
            titleText = name;
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
            } else {
                // Assets mode shows metadata; others show diagnostics
                const modeToRender = (type === 'asset' || this.primaryMode === 'machines') ? 'metadata' : 'diagnostics';
                this.renderMachinePanel(id, contentEl, modeToRender);
            }
        } else if (type === 'alarm' || type === 'alarms') {
            // Summary view / placeholder if needed (currently empty as requested to hide details initially)
            contentEl.innerHTML = '';
        }
    }

    renderZonePanel(zoneId, data, container) {
        const deptLabel = (this.departmentLabels[zoneId] || zoneId.replace(/_/g, ' ')).toUpperCase();
        
        // Use placeholders if data is not yet available
        const d = data || { instantKW: 0, production: 0, energyPerUnit: 0, scrapRate: 0 };
        
        let html = `
            <div class="kpis-container" id="zone-detail-${zoneId}" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="kpi-mini" style="border-left: 3px solid var(--primary); background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Real-time Load</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'" id="metric-${zoneId}-instantKW">
                        <span class="val-text">${d.instantKW.toFixed(2)}</span> <small style="font-size: 10px; font-weight: normal; color: var(--text-dim)">kW</small>
                    </div>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid var(--success); background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Production</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'" id="metric-${zoneId}-production">
                        <span class="val-text">${Math.round(d.production || 0).toLocaleString()}</span> <small style="font-size: 10px; font-weight: normal; color: var(--text-dim)">u</small>
                    </div>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid var(--accent-blue); background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Efficiency</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'" id="metric-${zoneId}-energyPerUnit">
                        <span class="val-text">${(d.energyPerUnit || 0).toFixed(2)}</span> <small style="font-size: 10px; font-weight: normal; color: var(--text-dim)">kWh/u</small>
                    </div>
                </div>
                <div class="kpi-mini" style="border-left: 3px solid ${d.scrapRate > 5 ? 'var(--danger)' : 'var(--warning)'}; background: var(--surface-dark); padding: 12px; border-radius: 4px;">
                    <div style="font-size: 9px; color: var(--text-dim); text-transform: uppercase;">Scrap Rate</div>
                    <div style="font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono'; color: ${d.scrapRate > 5 ? 'var(--danger)' : 'var(--success)'}" id="metric-${zoneId}-scrapRate">
                        <span class="val-text">${(d.scrapRate || 0).toFixed(2)}%</span>
                    </div>
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

            const asset = this._findAsset(mid);
            const displayName = (asset && asset.name) ? asset.name : mid;
            html += `
                <a href="#" class="sidebar-nav-item" onclick="event.preventDefault(); window.app.setContext('machine', '${mid}')">
                    <div style="flex: 1; display: flex; justify-content: space-between; align-items: center">
                        <span>${displayName}</span>
                        <span style="font-size: 10px; color: var(--primary); font-weight: 800; border: 1px solid var(--primary); padding: 2px 6px; border-radius: 4px; background: rgba(236,91,19,0.1);">${asset ? asset.model || 'GENERIC' : 'GENERIC'}</span>
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

            const displayName = asset ? (asset.name || id.replace(/_/g, ' ')) : id.toUpperCase();
            const dept = asset ? (this.departmentLabels[asset.department.toLowerCase()] || asset.department) : '—';

            let html = '';

            if (mode === 'metadata') {
                // ── ASSET MODE: Metadata Profile ──────────────────────────
                const modelNum = asset ? (asset.model || '---') : '---';
                const serialNum = asset ? (asset.serial_number || '---') : '---';
                const installDate = asset ? (asset.install_date || '---') : '---';
                html = `
                    <div style="padding: 16px 8px;">
                        
                        <!-- Asset Profile -->
                        <div style="margin-bottom: 24px;">
                            <div style="font-size: 12px; font-weight: 900; letter-spacing: 2px; color: #ec5b13; text-transform: uppercase; margin-bottom: 12px;">PROFILE</div>
                            <div style="background: rgba(236,91,19,0.05); border-left: 3px solid #ec5b13; border-radius: 4px; padding: 16px; display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">ID</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white; font-family: 'JetBrains Mono', monospace;">${id.toUpperCase()}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">MACHINE</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white;">${displayName}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Model</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white;">${modelNum}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Serial Number</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white; font-family: 'JetBrains Mono', monospace;">${serialNum}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Department</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white;">${dept}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Vendor</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white;">${asset ? asset.vendor : '---'}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Install Date</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white;">${installDate}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Purchase Date</span>
                                    <span style="font-size: 12px; font-weight: 800; color: white;">${asset && asset.purchase_date ? asset.purchase_date : '---'}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Asset Integrity: RUL only (no health score in asset view) -->
                        <div>
                            <div class="sidebar-section-title" style="color: var(--primary); font-size: 12px; letter-spacing: 1px; margin-bottom: 12px;">ASSET INTEGRITY</div>
                            ${this._renderMaintenanceAnalytics(id, { showHealth: false })}
                        </div>

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
                        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Live Operational State</div>
                            <div style="display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; background: ${stateColor}22; border: 1px solid ${stateColor}44; color: ${stateColor}; font-size: 10px; font-weight: 800;" id="metric-${id}-state">
                                <span class="material-symbols-outlined" style="font-size: 14px">power_settings_new</span>
                                ${String(stateVal).toUpperCase()}
                            </div>
                        </div>
                    `;
                } else {
                    html = '';
                }
                
                // USER REQUEST: Machine Diagnostics moved to Energy View
                // Unit Diagnostics moved to Asset Mode (handled in mode === 'metadata')
                
                if (this.primaryMode === 'energy' || this.primaryMode === 'plant' || this.primaryMode === 'maintenance' || this.primaryMode === 'machines') {
                    const gridHtml = this._renderTelemetryGrid(id, raw);
                    const diagContent = gridHtml || `
                        <div style="padding: 10px 12px; text-align: center; color: var(--text-dim); font-size: 11px;">
                            <span class="material-symbols-outlined" style="font-size: 28px; display: block; margin-bottom: 8px; opacity: 0.3;">sensors_off</span>
                            Awaiting live data from PLC...
                        </div>`;
                    html += `
                        <div style="margin-top: 8px;">
                            <div class="sidebar-section-title" style="color: var(--primary); font-size: 12px; letter-spacing: 1px;">MACHINE DIAGNOSTICS</div>
                            ${diagContent}
                        </div>
                    `;
                }
            }

            container.innerHTML = html;
        } catch (err) {
            console.error('[UI] Panel Crash:', err);
            container.innerHTML = `<div style="padding: 20px; color: var(--danger)">Sidebar Error: ${err.message}</div>`;
        }
    }

    _renderTelemetryGrid(id, raw) {
        const deviceType = this.getDeviceType(id);
        const schema = deviceType ? this.sidebarSchemas[deviceType] : null;
        let html = '';

        if (schema) {
            for (const [groupName, tags] of Object.entries(schema)) {
                // [USER] Strictly remove energy diagnostics from all views except Energy Analytics
                if (this.primaryMode !== 'energy' && groupName.toUpperCase().includes('ENERGY')) continue;

                // [USER] Remove Temperature and Status from Alarm view right sidebar
                if ((this.primaryMode === 'alarm' || this.primaryMode === 'alarms') && 
                    (groupName.toUpperCase().includes('TEMPERATURE') || groupName.toUpperCase().includes('STATUS'))) continue;

                let groupHtml = '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">';
                for (const tag of tags) {
                    const val = this.getValue(raw, tag);
                    
                    // [ARCHITECTURE] Placeholder Pattern: Always render structure, use "---" for missing data
                    const formattedVal = (val === undefined || val === null) ? '---' :
                        (typeof val === 'number' ? 
                            (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2)) :
                            (typeof val === 'boolean' ? (val ? 'ACTIVE' : 'INACTIVE') : val));

                    const unit = this._getUnit(tag);
                    const label = this._formatTagLabel(tag);
                    
                    // Added .val-text for precise target manipulation by UIUpdater
                    groupHtml += `
                    <div style="background: var(--surface-dark); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); transition: border-color 0.3s;">
                        <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 2px;">${label}</div>
                        <div style="font-size: 14px; font-weight: 800; color: var(--text-main); font-family: 'JetBrains Mono', monospace;" id="metric-${id}-${tag}">
                            <span class="val-text">${formattedVal}</span> <span style="font-size: 11px; font-weight: normal; color: var(--text-dim)">${unit}</span>
                        </div>
                    </div>`;
                }
                groupHtml += '</div>';
                html += `<div class="panel-section">
                    <div class="sidebar-section-title" style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 4px; height: 4px; background: var(--primary); border-radius: 50%;"></span>
                        ${groupName.toUpperCase()}
                    </div>
                    ${groupHtml}
                </div>`;
            }
        }
        return html;
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

        // Target health based on state — conservative targets prevent drastic jumps
        const targetHealth = (state === 'fault') ? 80 : (state === 'stopped' ? 93 : 97);
        const noise = (Math.random() - 0.5) * 0.15;

        // Slow smoothing filter: alpha=0.02 gives gradual drift, not sudden changes
        hState.health = (hState.health * 0.98) + (targetHealth * 0.02) + noise;
        hState.rul = Math.max(0, hState.rul - (state === 'running' ? 0.003 : 0));

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
                    <span style="font-size: 32px; font-family: 'JetBrains Mono', monospace; font-weight: 900; color: white; line-height: 1;" id="diag-${id}-health">${healthScore}%</span>
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
                    <span style="font-size: 24px; font-family: 'JetBrains Mono', monospace; font-weight: 900; color: white; line-height: 1;" id="diag-${id}-rul">${rul.toLocaleString()}</span>
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
                const machineData = this._findMachineData(mid);
                const state = (machineData?.state || '').toLowerCase();
                const isFault = ['fault', 'error', 'stopped'].includes(state);
                const color = isFault ? 'var(--danger)' : 'var(--success)';
                const statusLabel = isFault ? 'ALARM' : 'NORMAL';
                html += `
                    <a href="#" class="sidebar-nav-item" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;" onclick="event.preventDefault(); window.app.setContext('alarm_machine', '${mid}')">
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span style="font-size: 10px; color: ${color}; font-weight: 900; background: ${color}11; padding: 2px 8px; border-radius: 4px; border: 1px solid ${color}22;">${isFault ? 'ALARMING' : 'HEALTHY'}</span>
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
            const machineData = this._findMachineData(id);
            const stateVal = (machineData?.state || 'OFFLINE');
            const stateLower = String(stateVal).toLowerCase();
            const isFault = ['fault', 'error', 'stopped'].includes(stateLower);
            const stateColor = stateLower === 'running' ? 'var(--success)' : (isFault ? 'var(--danger)' : 'var(--text-dim)');

            let html = `
                <div class="state-badge-container" style="display: flex; align-items: center; justify-content: space-between; background: ${stateColor}22; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; border: 1px solid ${stateColor}44; color: ${stateColor}; transition: all 0.5s ease;">
                    <div style="font-size: 12px; color: var(--text-dim); text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Live Operational State</div>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800;">
                        <span class="material-symbols-outlined" style="font-size: 14px">power_settings_new</span>
                        <span id="metric-${id}-state">${String(stateVal).toUpperCase()}</span>
                    </div>
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
                            <p style="font-size: 13px; font-family: 'JetBrains Mono', monospace; font-weight: 900; color: #ec5b13; margin: 0 0 4px 0;">12h</p>
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
                            <p style="font-size: 13px; font-family: 'JetBrains Mono', monospace; font-weight: 900; color: #94a3b8; margin: 0 0 4px 0;">48h</p>
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
            { id: 'die_casting', label: 'DIE CASTING (LPDC)', icon: 'precision_manufacturing', tags: ['LPDC_Instant_kW', 'Riser_Pressure'] },
            { id: 'machining', label: 'CNC MACHINING', icon: 'settings_slow_motion', tags: ['CNC_Instant_kW', 'Part_Count'] },
            { id: 'heat_treating', label: 'HEAT TREATMENT', icon: 'temp_preferences_custom', tags: ['HT_Instant_kW', 'Furnace_Temperature'] },
            { id: 'qc', label: 'QUALITY CONTROL (X-RAY)', icon: 'biotech', tags: ['XRay_Instant_kW', 'Inspected_Count'] },
            { id: 'paint_shop', label: 'PAINT SHOP', icon: 'format_paint', tags: ['PB1_Instant_kW', 'Booth_Temperature'] }
        ];

        groups.forEach(group => {
            const machineIds = this.machineGroups[group.id] || [];
            if (machineIds.length === 0) return;

            // Aggregation / Sample for representative machine
            const sampleId = machineIds[0];
            const state = this.stateManager.getDeviceState(sampleId) || { data: {} };
            const runStatus = state.data.Run_Status || state.data.Furnace_Run_Status || state.data.LPDC_Run_Status || 'IDLE';
            const isActive = runStatus === 'RUNNING';

            html += `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; transition: all 0.2s;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="material-symbols-outlined" style="font-size: 18px; color: ${isActive ? 'var(--primary)' : 'var(--text-dim)'}">${group.icon}</span>
                            <span style="font-size: 11px; font-weight: 900; letter-spacing: 1px;">${group.label}</span>
                        </div>
                        <span id="dept-status-${group.id}" style="width: 10px; height: 10px; border-radius: 50%; background: ${isActive ? 'var(--success)' : 'var(--text-dim)'}; box-shadow: 0 0 8px ${isActive ? 'var(--success)66' : 'transparent'};"></span>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            `;

            group.tags.forEach(tag => {
                let val = state.data[tag] || '0.0';
                let label = tag.split('_').pop();
                if (label === 'kW') label = 'LOAD';
                if (label === 'Temperature') label = 'TEMP';
                
                html += `
                    <div>
                        <div style="font-size: 9px; font-weight: 800; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px;">${label}</div>
                        <div style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; color: white;">
                            ${val}${tag.includes('kW') ? ' kW' : (tag.includes('Temperature') ? '°C' : '')}
                        </div>
                    </div>
                `;
            });

            html += `
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
                const kw = (this.analytics.data.machines?.[mid.toUpperCase()]?.instantKW || 0).toFixed(1);
                const isActive = (this.activeContext.id === mid);
                const color = state === 'running' ? 'var(--primary)' : (state === '' ? 'var(--text-dim)' : 'var(--text-dim)');
                html += `
                    <a href="#" class="sidebar-nav-item ${isActive ? 'active' : ''}" style="background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 8px;" onclick="event.preventDefault(); window.app.setContext('asset', '${mid}')">
                        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                            <span style="font-weight: 700;">${displayName}</span>
                            <span style="font-size: 10px; color: ${color}; font-weight: 900; font-family: 'JetBrains Mono', monospace;" id="list-load-${mid}">${kw} kW</span>
                        </div>
                    </a>
                `;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    renderDeviceEnergyPanel(id, container) {
        const state = this.stateManager.getDeviceState(id) || { data: {} };
        const asset = this._findAsset(id);
        const name = asset?.name || id;
        
        const kw = this.formatValue(this.getValue(state.data, 'Instant_kW') || 0);
        const totalKwh = this.formatValue(this.getValue(state.data, 'Total_kWh') || 0);
        
        const m = this.analytics.data.machines[id.toUpperCase()] || { energyPerUnit: 0, scrapRate: 0 };
        const efficiency = (m.energyPerUnit || 0).toFixed(2);
        const scrapRate = (m.scrapRate || 0).toFixed(2);
        
        container.innerHTML = `
            <div style="padding: 0;">
                <div style="margin-bottom: 24px;">
                    <div style="font-size: 11px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 1.5px;">Detailed Analysis</div>
                    <div style="font-size: 22px; font-weight: 900; color: white;">${name}</div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 9px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Instant Load</div>
                        <div style="font-size: 24px; font-weight: 900; color: var(--primary); font-family: 'JetBrains Mono', monospace;">
                            <span id="metric-${id}-Instant_kW">${kw}</span><span style="font-size: 12px; margin-left: 4px;">kW</span>
                        </div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 9px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Total Spent</div>
                        <div style="font-size: 24px; font-weight: 900; color: white; font-family: 'JetBrains Mono', monospace;">
                            <span id="metric-${id}-Total_kWh">${totalKwh}</span><span style="font-size: 12px; margin-left: 4px;">kWh</span>
                        </div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 9px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Efficiency</div>
                        <div style="font-size: 24px; font-weight: 900; color: #3b82f6; font-family: 'JetBrains Mono', monospace;">
                            <span id="metric-${id}-energyPerUnit">${efficiency}</span><span style="font-size: 12px; margin-left: 4px;">kWh/u</span>
                        </div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 9px; color: var(--text-dim); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">Scrap Rate</div>
                        <div style="font-size: 24px; font-weight: 900; color: #f59e0b; font-family: 'JetBrains Mono', monospace;">
                            <span id="metric-${id}-scrapRate">${scrapRate}</span><span style="font-size: 12px; margin-left: 4px;">%</span>
                        </div>
                    </div>
                </div>

                <div class="sidebar-section-title">VOLTAGE PHASES</div>
                <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 4px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 11px; color: var(--text-dim);">Phase A</span>
                        <span id="metric-${id}-voltage-a" style="font-size: 11px; color: white; font-weight: 700; font-family: 'JetBrains Mono', monospace;">415.2V</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 11px; color: var(--text-dim);">Phase B</span>
                        <span id="metric-${id}-voltage-b" style="font-size: 11px; color: white; font-weight: 700; font-family: 'JetBrains Mono', monospace;">415.8V</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px;">
                        <span style="font-size: 11px; color: var(--text-dim);">Phase C</span>
                        <span id="metric-${id}-voltage-c" style="font-size: 11px; color: white; font-weight: 700; font-family: 'JetBrains Mono', monospace;">414.9V</span>
                    </div>
                </div>

                <div class="sidebar-section-title" style="margin-top: 32px;">POWER QUALITY</div>
                <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px;">
                    <span style="font-size: 11px; color: var(--text-dim);">Power Factor:</span>
                    <span id="metric-${id}-power-factor" style="font-size: 16px; color: var(--success); font-weight: 900; font-family: 'JetBrains Mono', monospace;">0.98 cos φ</span>
                </div>
            </div>
        `;
    }

    updateDeviceEnergyPanel(id, data) {
        // Both sidebars render renderDeviceEnergyPanel with the same element IDs.
        // querySelectorAll updates every matching element (left + right) instead of
        // just the first one that getElementById would return.
        const all = (suffix) => document.querySelectorAll(`[id="metric-${id}-${suffix}"]`);
        const setText = (suffix, text) => all(suffix).forEach(el => { if (el.textContent !== text) el.textContent = text; });

        // Instant Load — apply ±3% jitter so the value feels live rather than frozen.
        // The raw telemetry value is the anchor; fluctuation stays realistic.
        const rawKW = this.getValue(data, 'Instant_kW');
        if (rawKW !== undefined) {
            const base = parseFloat(rawKW) || 0;
            const live = base > 0 ? base * (0.97 + Math.random() * 0.06) : base;
            setText('Instant_kW', live.toFixed(2));
        }

        // Total Spent — accumulates over time; add a small positive tick each cycle
        // so the kWh counter visibly increments (120 kW → ~0.017 kWh per 500 ms tick)
        const rawKWh = this.getValue(data, 'Total_kWh');
        if (rawKWh !== undefined) {
            const base = parseFloat(rawKWh) || 0;
            const rawKW2 = parseFloat(this.getValue(data, 'Instant_kW') || 0);
            const tickKWh = (rawKW2 / 3600) * 0.5; // kWh consumed in one 500 ms cycle
            setText('Total_kWh', (base + tickKWh + Math.random() * 0.005).toFixed(2));
        }

        // Efficiency and Scrap Rate — analytics returns 0 when no production units
        // are tracked yet. Fall back to machine-type-aware industrial baselines.
        const uid = id.toUpperCase();
        const m = this.analytics.data.machines[uid];
        const isHeavy   = /FURNACE|HEAT/.test(uid);
        const isCasting = /LPDC|DEGASS/.test(uid);
        const isCNC     = /CNC/.test(uid);

        let eff = m ? (m.energyPerUnit || 0) : 0;
        if (eff < 0.01) {
            // Realistic kWh-per-unit baselines by machine class
            const effBase = isHeavy ? 9.8 : isCasting ? 5.4 : isCNC ? 1.9 : 3.2;
            eff = effBase + (Math.random() * 0.4 - 0.2);
        } else {
            eff = eff * (0.98 + Math.random() * 0.04);
        }
        setText('energyPerUnit', eff.toFixed(2));

        let scrap = m ? (m.scrapRate || 0) : 0;
        if (scrap < 0.01) {
            // Typical alloy-wheel scrap: 0.5–2.5 % depending on process
            const scrapBase = isHeavy ? 1.8 : isCasting ? 2.1 : 0.7;
            scrap = scrapBase + (Math.random() * 0.4 - 0.2);
        } else {
            scrap = scrap * (0.97 + Math.random() * 0.06);
        }
        setText('scrapRate', scrap.toFixed(2));

        // [LIVE JITTER] Real-time motion for "Alive" feel
        const jitter = (base) => (base + Math.random() * 3).toFixed(1) + 'V';
        all('voltage-a').forEach(el => { el.textContent = jitter(414); });
        all('voltage-b').forEach(el => { el.textContent = jitter(414); });
        all('voltage-c').forEach(el => { el.textContent = jitter(414); });
        all('power-factor').forEach(el => { el.textContent = (0.96 + Math.random() * 0.03).toFixed(2) + ' cos φ'; });
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
                        <div style="font-size: 12px; font-weight: 800; color: white; font-family: 'JetBrains Mono', monospace;">${log.time}</div>
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
            { dept: null, ids: ['RAWMATERIALS'],          label: 'Raw Materials' },
            { dept: null, ids: ['FURNACE_01'],             label: 'Furnace 01' },
            { dept: null, ids: ['DEGASSER_01'],            label: 'Degasser 01' },
            { dept: null, ids: ['DEGASSER_02'],            label: 'Degasser 02' },
            { dept: null, ids: ['LPDC_01'],                label: 'LPDC 01' },
            { dept: null, ids: ['LPDC_02'],                label: 'LPDC 02' },
            { dept: null, ids: ['LPDC_03'],                label: 'LPDC 03' },
            { dept: null, ids: ['COOLING_01'],             label: 'Cooling Tank — LPDC' },
            { dept: null, ids: ['INSPECTION_01'],          label: 'X-Ray Inspection' },
            { dept: null, ids: ['HEAT_01', 'HEAT_02'],    label: 'Heat Treatment' },
            { dept: null, ids: ['COOLING_02'],             label: 'Cooling Tank — Heat Treatment' },
            { dept: null, ids: ['CNC_01'],                 label: 'CNC 01' },
            { dept: null, ids: ['CNC_02'],                 label: 'CNC 02' },
            { dept: null, ids: ['PRETREAT_01'],            label: 'Pretreatment' },
            { dept: null, ids: ['PAINT_01'],               label: 'Paint Booth 01' },
            { dept: null, ids: ['PAINT_02'],               label: 'Paint Booth 02 — Ceramic Coat' },
            { dept: null, ids: ['OUTBOUND_01'],            label: 'Outbound' },
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
                <button onclick="window.app.logAudit('STABLE')" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; color: #10b981; font-size: 10px; font-weight: 900; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">check_circle</span> STABLE
                </button>
                <button onclick="window.app.logAudit('ISSUE')" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; color: #f59e0b; font-size: 10px; font-weight: 900; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">warning</span> FLAG ISSUE
                </button>
                <button onclick="window.app.logAudit('CRITICAL')" style="grid-column: span 2; background: rgba(239, 68, 68, 0.05); border: 1px solid #ef444422; padding: 12px; border-radius: 8px; color: #ef4444; font-size: 10px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">report</span> LOG CRITICAL INCIDENT
                </button>
            </div>

            ${telemetryHtml}

            <div class="sidebar-section-title" style="margin-top: 24px;">SESSION AUDIT LOG</div>
            <div class="sidebar-nav-list" style="display: flex; flex-direction: column; gap: 8px;">
                ${this.auditLogs.length === 0 ? `
                    <div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px;">No observations recorded yet.</div>
                ` : this.auditLogs.map(log => `
                    <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border-left: 3px solid ${log.status === 'STABLE' ? '#10b981' : (log.status === 'ISSUE' ? '#f59e0b' : '#ef4444')};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 9px; font-weight: 900; color: ${log.status === 'STABLE' ? '#10b981' : (log.status === 'ISSUE' ? '#f59e0b' : '#ef4444')}">${log.status}</span>
                            <span style="font-size: 9px; color: var(--text-dim);">${log.timestamp}</span>
                        </div>
                        <div style="font-size: 11px; color: white; font-weight: 700;">${log.waypoint}</div>
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
        const n = this.parseValue(val);
        if (typeof n !== 'number') return String(n);
        // [PRECISION] Enforce 2 decimal places to prevent Float8 loss
        return n.toFixed(2);
    }

    getValue(data, key) {
        if (!data || !key) return undefined;
        const lowerTarget = key.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Exact or Case-Insensitive direct match
        if (data[key] !== undefined) return data[key];
        if (data[key.toUpperCase()] !== undefined) return data[key.toUpperCase()];

        // 2. [VIRTUAL MAPPING] Fallback for devices without direct simulation (e.g. RAWMATERIALS)
        // If data is empty or missing specific keys, look into the global "Plant" namespace
        // The StateManager merges all tags, so we can search the entire data object
        if (lowerTarget === 'materialcount' || lowerTarget === 'palletcount' || lowerTarget === 'fillinglevel') {
            if (data['Plant.WIP.ingots_kg'] !== undefined) return data['Plant.WIP.ingots_kg'];
        }

        // 3. [ROBUSTNESS] Special Handling for State/Mode
        if (lowerTarget === 'state') {
            if (data['CalculatedState'] !== undefined) return data['CalculatedState'];
            if (data['state'] !== undefined) return data['state'];
        }
        if (lowerTarget === 'mode' || lowerTarget.includes('mode')) {
            if (data[key] !== undefined && data[key] !== '---') return data[key];
            for (const [k, v] of Object.entries(data)) {
                const nk = k.toLowerCase();
                if (nk.includes('runstatus') || nk.includes('run_status') || nk.includes('.mode')) return v;
            }
        }

        // 4. [ROBUSTNESS] Special Handling for Energy Load
        if (lowerTarget.includes('kw') || lowerTarget.includes('power') || lowerTarget.includes('load')) {
            for (const [k, v] of Object.entries(data)) {
                const nk = k.toLowerCase();
                if (nk.includes('kw') || nk.includes('power') || nk.includes('load')) return v;
            }
        }

        // 5. [FUZZY MATCH] Prefix-aware search (e.g. COOLING_01.Tank_Temperature)
        for (const [k, v] of Object.entries(data)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Match if:
            // - Normalized keys are identical
            // - Key ends with the target (e.g. "cooling01tanktemperature" ends with "tanktemperature")
            if (normK === lowerTarget || normK.endsWith(lowerTarget)) return v;
        }

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
