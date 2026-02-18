import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.model = null;
        
        this.meshRegistry = new Map();
        this.labelRegistry = new Map();
        // Manual mapping overrides for known discrepancies (Lowercased Keys -> Lowercased Meshes)
        this.manualMap = {
            'cnc_01': 'vertical_holder_01',      
            'inspection_01': 'cube005',          
            'furnace_01': 'smelting_machine',
            'cooling_01': 'cooling_tank',
            'pack_01': 'wraping_machine',      
            'degasser_01': 'degasing_machine_01', 
            'lpdc_01': 'lpdc_01_machine',
            'heat_01': 'heat_treated_machine',
            'plant': null,
            'buffer_01': 'storage_rack001'
        };

        this.overlayLayouts = new Map();
        this.persistentValues = new Map(); 
        
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        
        this.init();
        this.setupInteraction();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505);
        
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(30, 30, 30);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);
        
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(20, 40, 20);
        this.scene.add(dirLight);

        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupInteraction() {
        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    }

    onPointerDown(event) {
        // Only trigger selection on actual canvas click
        if (event.target !== this.renderer.domElement) return;

        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(Array.from(this.meshRegistry.values()), true);

        if (intersects.length > 0) {
            let mesh = intersects[0].object;
            let deviceId = null;
            // Search up the tree to find a registered device
            while (mesh) {
                const foundId = Array.from(this.labelRegistry.keys()).find(id => this.findMesh(id) === mesh);
                if (foundId) { deviceId = foundId; break; }
                mesh = mesh.parent;
            }
            
            // If still no ID, try fuzzy match against manual map
            if (!deviceId) {
                let current = intersects[0].object;
                while (current) {
                    const match = Object.keys(this.manualMap).find(id => this.manualMap[id] === current.name);
                    if (match) { deviceId = match; break; }
                    current = current.parent;
                }
            }

            this.selectDevice(deviceId);
            
            // Sync Sidebar
            if (deviceId) {
                window.dispatchEvent(new CustomEvent('open-device-details', { 
                    detail: { deviceId: deviceId } 
                }));
            }
        } else {
            this.selectDevice(null);
            window.dispatchEvent(new CustomEvent('scene-background-click'));
        }
    }

    onPointerMove(event) {
        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(Array.from(this.meshRegistry.values()), true);
        this.renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
    }

    selectDevice(id) {
        // 1. Hide old
        if (this.activeDeviceId) {
            const old = this.labelRegistry.get(this.activeDeviceId);
            if (old) old.element.classList.remove('active', 'expanded');
        }
        
        // 2. Set new
        this.activeDeviceId = id;
        
        // 3. Show new
        if (id) {
            const l = this.labelRegistry.get(id);
            if (l) {
                l.element.classList.add('active');
                l.element.classList.remove('expanded'); // Always reset to compact on new selection
            }
        }
    }

    resetInteraction() {
        this.selectDevice(null);
    }

    async loadModel(path) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(path);
        this.model = gltf.scene;
        this.scene.add(this.model);
        this.model.traverse(c => {
            if (c.isMesh) {
                const normName = c.name.toLowerCase();
                console.log(`[Scene] MESH_DISCOVERY: ${c.name} -> ${normName}`);
                this.meshRegistry.set(normName, c);
                if (c.material) c.material = c.material.clone();
            }
        });
        console.log('[Scene] Model loaded. Normalized Meshes:', this.meshRegistry.size);
        return gltf;
    }

    /**
     * Aggressive Mesh Discovery
     */
    findMesh(rawId) {
        if (!rawId) return null;
        const id = rawId.toLowerCase();
        
        // 1. Manual map check (High priority)
        if (id in this.manualMap) {
            const target = this.manualMap[id];
            if (target === null) return null; // Explicitly no mesh for this ID
            const mesh = this.meshRegistry.get(target);
            if (mesh) return mesh;
        }

        // 2. Direct name match (on normalized registry)
        if (this.meshRegistry.has(id)) return this.meshRegistry.get(id);

        // 3. Normalized fuzzy search with priority
        const normId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
        let bestMatch = null;
        let bestPriority = -1;

        for (const [name, mesh] of this.meshRegistry.entries()) {
            const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            if (normName === normId || normName.includes(normId) || normId.includes(normName)) {
                let priority = 0;
                // Favor names that explicitly mention machine-like qualities
                if (normName.includes('machine') || normName.includes('smelting') || 
                    normName.includes('tank') || normName.includes('cnc') || 
                    normName.includes('lpdc') || normName.includes('xray') || 
                    normName.includes('inspection') || normName.includes('oven')) {
                    priority = 2;
                } else if (normName.includes('unit') || normName.includes('cell') || normName.includes('holder')) {
                    priority = 1;
                }

                if (priority > bestPriority) {
                    bestPriority = priority;
                    bestMatch = mesh;
                }
            }
        }

        if (bestMatch) {
            console.log(`[Scene] Fuzzy Match Found: ${id} -> ${bestMatch.name} (Priority: ${bestPriority})`);
            this.manualMap[id] = bestMatch.name;
            return bestMatch;
        }
        
        // 4. Last resort: scan model for ANY mesh related to ID
        if (!this.model) {
            console.warn(`[Scene] Cannot deep scan for ${id}: Model not loaded yet.`);
            return null;
        }

        console.warn(`[Scene] No mesh found for ${id} in registry. Attempting deep scan...`);
        let deepMatch = null;
        this.model.traverse(c => {
            if (c.isMesh && c.name.toLowerCase().includes(normId)) deepMatch = c;
        });
        if (deepMatch) {
            console.log(`[Scene] Deep Scan Match: ${id} -> ${deepMatch.name}`);
            this.meshRegistry.set(deepMatch.name.toLowerCase(), deepMatch);
            this.manualMap[id] = deepMatch.name.toLowerCase();
        }
        
        return deepMatch;
    }

    updateMeshColor(id, hex) {
        const m = this.findMesh(id);
        if (m) {
            m.traverse(c => { 
                if (c.isMesh && c.material) {
                    c.material.color.setHex(hex); 
                }
            });
        }
    }

    /**
     * Case-Insensitive Prefix-Aware Matcher
     */
    getValue(data, key) {
        if (!data || !key) return undefined;
        const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // 1. Precise match
        if (data[key] !== undefined) return data[key];
        if (data[key.toUpperCase()] !== undefined) return data[key.toUpperCase()];
        
        // 2. State Alias (Always prefer CalculatedState if looking for State)
        if (lowerKey === 'state') {
            if (data['CalculatedState'] !== undefined) return data['CalculatedState'];
            if (data['Status/State'] !== undefined) return data['Status/State'];
            if (data['state'] !== undefined) return data['state'];
            if (data['Status'] !== undefined) return data['Status'];
        }

        // 3. Aggressive suffix match
        for (const [k, v] of Object.entries(data)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normK === lowerKey || normK.endsWith(lowerKey)) {
                return v;
            }
        }
        return undefined;
    }

    updateDeviceLabel(id, data, preferred = null) {
        let mesh = this.findMesh(id);
        if (!mesh) return;

        let label = this.labelRegistry.get(id);

        // 1. Creation Phase
        if (!label) {
            const div = document.createElement('div');
            div.className = 'machine-label';
            div.innerHTML = `
                <div class="label-content">
                    <div class="machine-header">
                        <div class="machine-name">${id}</div>
                        <div class="view-toggles">
                            <button class="toggle-btn pc-btn" data-mode="telemetry">PROCESS DATA</button>
                            <button class="toggle-btn kpi-btn" data-mode="meta">KPI'S</button>
                        </div>
                    </div>
                    
                    <!-- View 1: Live Telemetry -->
                    <div class="telemetry-view">
                        <div class="machine-metrics"></div>
                    </div>

                    <!-- View 2: Meta KPIs -->
                    <div class="meta-view">
                        <div class="meta-metrics"></div>
                    </div>

                    <div class="details-trigger">TECH DETAILS &rarr;</div>
                    <div class="label-arrow"></div>
                </div>
            `;
            
            const metricsContainer = div.querySelector('.machine-metrics');
            const keys = preferred || Object.keys(data).filter(k => 
                !['id', 'topic', 'type', 'source', 'bridge', 'plc', 'timestamp', 'state', 'status'].includes(k.toLowerCase())
            ).slice(0, 3);
            
            this.overlayLayouts.set(id, keys);

            keys.forEach(k => {
                const row = document.createElement('div');
                row.className = 'metric-row';
                row.innerHTML = `<span class="metric-label">${k}</span><span class="metric-value" data-key="${k}">---</span>`;
                metricsContainer.appendChild(row);
            });

            // View Toggles
            div.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const mode = btn.dataset.mode;
                    if (mode === 'meta') div.classList.add('meta-mode');
                    else div.classList.remove('meta-mode');
                    
                    div.classList.add('expanded'); // Expand card on button click
                    
                    // Toggle active state on buttons
                    div.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active-toggle'));
                    btn.classList.add('active-toggle');
                    
                    // Universal Mode Sync Event
                    window.dispatchEvent(new CustomEvent('global-view-mode-change', { 
                        detail: { mode: mode, deviceId: id } 
                    }));
                    
                    window.dispatchEvent(new CustomEvent('manual-view-change'));
                };
            });

            div.querySelector('.details-trigger').onclick = (e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('open-device-details', { detail: { deviceId: id } }));
            };

            label = new CSS2DObject(div);
            
            // Positioning - PIN TO CENTER OF VOLUME
            const box = new THREE.Box3().setFromObject(mesh);
            const center = new THREE.Vector3();
            box.getCenter(center);
            
            // Create a local coordinate relative to the mesh origin that corresponds to the top-center
            const localPos = mesh.worldToLocal(center.clone());
            const height = box.max.y - box.min.y;
            
            console.log(`[Scene] Pinning label for ${id} to mesh: ${mesh.name}`);
            
            label.position.set(localPos.x, localPos.y + (height/2) + 0.5, localPos.z); 
            mesh.add(label);
            this.labelRegistry.set(id, label);
        }

        // 2. Continuous Update Phase
        const element = label.element;
        const keys = this.overlayLayouts.get(id);
        let cache = this.persistentValues.get(id) || new Map();

        keys.forEach(k => {
            const slot = element.querySelector(`.metric-value[data-key="${k}"]`);
            if (slot) {
                let val = this.getValue(data, k);
                if (val !== undefined) {
                    // Log path resolution for CNC audit
                    if (id.includes('cnc')) {
                        console.log(`[DataAudit] ${id} resolving ${k} -> ${val}`);
                    }
                    cache.set(k, val);
                }
                
                const display = cache.get(k);
                if (display !== undefined) {
                    slot.textContent = typeof display === 'number' ? display.toFixed(1) : display;
                }
            }
        });
        this.persistentValues.set(id, cache);

        const state = (this.getValue(data, 'State') || this.getValue(data, 'status') || "").toString().toLowerCase();
        
        // Define State Groups
        const runningStates = ['running', 'active', 'heating', 'melting', 'pouring', 'processing', 'enabled'];
        const idleStates = ['idle', 'waiting', 'starved', 'blocked', 'ready'];
        const stoppedStates = ['stop', 'fault', 'error', 'offline', 'disabled'];

        let stateClass = '';
        if (runningStates.some(s => state.includes(s))) stateClass = 'running';
        else if (idleStates.some(s => state.includes(s))) stateClass = 'idle';
        else if (stoppedStates.some(s => state.includes(s))) stateClass = 'stopped';
        
        element.querySelector('.label-content').className = 'label-content ' + stateClass;

        // Strictly visibility
        if (this.activeDeviceId === id) element.classList.add('active');
        else element.classList.remove('active');
    }

    setLabelMode(id, mode) {
        const label = this.labelRegistry.get(id);
        if (!label) return;

        if (mode === 'meta') label.element.classList.add('meta-mode');
        else label.element.classList.remove('meta-mode');

        // Sync button active states
        label.element.querySelectorAll('.toggle-btn').forEach(btn => {
            if (btn.dataset.mode === mode) btn.classList.add('active-toggle');
            else btn.classList.remove('active-toggle');
        });
    }

    setLabelExpanded(id, expanded) {
        const label = this.labelRegistry.get(id);
        if (label) {
            if (expanded) label.element.classList.add('expanded');
            else label.element.classList.remove('expanded');
        }
    }

    updateMetaKPIs(id, metaData) {
        const label = this.labelRegistry.get(id);
        if (!label) return;
        
        const container = label.element.querySelector('.meta-metrics');
        if (!container) return;
        
        Object.entries(metaData).forEach(([key, val]) => {
            let slot = container.querySelector(`[data-meta="${key}"]`);
            if (!slot) {
                const row = document.createElement('div');
                row.className = 'meta-row';
                // Convert key to Title Case for display
                const labelText = key.charAt(0).toUpperCase() + key.slice(1);
                row.innerHTML = `<span class="meta-label">${labelText}</span><span class="meta-value" data-meta="${key}">---</span>`;
                container.appendChild(row);
                slot = row.querySelector('.meta-value');
            }
            
            if (slot) {
                slot.textContent = val;
                slot.classList.add('value-updated');
                setTimeout(() => slot.classList.remove('value-updated'), 500);
            }
        });
    }

    checkZoom() {
        if (!this.camera) return;
        const dist = this.camera.position.distanceTo(new THREE.Vector3(0,0,0));
        const isMini = dist > 60; // Threshold for mini labels
        
        this.labelRegistry.forEach((label, id) => {
            // Active device label is NEVER mini
            if (isMini && id !== this.activeDeviceId) {
                label.element.classList.add('mini');
            } else {
                label.element.classList.remove('mini');
            }
        });
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    start() {
        const loop = () => {
            requestAnimationFrame(loop);
            this.controls.update();
            this.checkZoom();
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        };
        loop();
    }
}

export default SceneManager;
