import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.model = null;

        this.meshRegistry = new Map(); // Used only for raycasting
        this.nodeRegistry = new Map(); // Used for device lookup (Groups + Meshes)
        this.labelRegistry = new Map();
        this.warningMeshes = new Map(); // Map of deviceId -> warning mesh instance

        // Manual mapping overrides for known discrepancies where fuzzy search fails
        this.manualMap = {
            'cnc_01': 'vertical_holder_01',
            'cnc_02': 'vertical_holder_01', // Fallback if no second CNC mesh exists natively
            'inspection_01': 'cube005',
            'inspection_02': 'cube005',
            'furnace_01': 'smelting_machine',
            'cooling_01': 'cooling_tank',
            'cooling_02': 'cooling_tank',
            'pack_01': 'wraping_machine',
            'degasser_01': 'degasing_machine_01',
            'lpdc_01': 'lpdc_01_machine',
            'lpdc_02': 'lpdc_01_machine',
            'heat_01': 'heat_treated_machine',
            'paint_01': 'painting_machine001', // Guessed closest painting machine
            'paint_02': 'painting_machine001',
            'storage_01': 'storage_rack001',
            'inbound_01': 'pallet',
            'outbound_01': 'pallet',
            'pretreat_01': 'washsystem',
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
        this.scene.background = new THREE.Color(0xffffff);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50000);
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
        this.controls.dampingFactor = 0.05; // Smooth camera deceleration
        this.controls.zoomSpeed = 0.8;      // Smoother, slightly slower zoom

        // HDRI & Natural Metallic Reflections (SSR-like glossiness)
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

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
            let clickedObject = intersects[0].object;
            let deviceId = null;

            // Search up the hierarchy to find a registered device's root node
            // A device's root node is the one to which its label is attached.
            // We check if any of the clicked object's ancestors (including itself)
            // is the parent of a registered label.
            let current = clickedObject;
            while (current) {
                const foundId = Array.from(this.labelRegistry.keys()).find(id => {
                    const labelObject = this.labelRegistry.get(id);
                    return labelObject && labelObject.parent === current;
                });
                if (foundId) {
                    deviceId = foundId;
                    break;
                }
                current = current.parent;
            }

            // If still no ID found by label hierarchy, try fuzzy name matching against ancestors
            if (!deviceId) {
                current = clickedObject;
                while (current) {
                    // Check against manualMap values
                    const match = Object.keys(this.manualMap).find(id => this.manualMap[id] === current.name.toLowerCase());
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

        let baseWarningMesh = null;

        this.model.traverse(c => {
            if (c.name) {
                const normName = c.name.toLowerCase();

                // Explicitly intercept the warning mesh so it doesn't get treated as a normal static model
                if (normName.includes('warning') || normName.includes('alert') || normName.includes('Triangle')) {
                    if (c.isMesh && !baseWarningMesh) {
                        baseWarningMesh = c;
                        baseWarningMesh.visible = false; // Hide the template
                    }
                }

                // Track all nodes (groups and meshes) for ID resolution
                if (!this.nodeRegistry.has(normName) || c.isMesh) {
                    this.nodeRegistry.set(normName, c);
                }

                // Track meshes explicitly for raycasting and visual updates
                if (c.isMesh) {
                    this.meshRegistry.set(normName, c);
                    if (c.material) c.material = c.material.clone();
                }
            }
        });

        this.baseWarningMesh = baseWarningMesh;
        if (this.baseWarningMesh) {
            console.log('[Scene] Base Warning Mesh found:', this.baseWarningMesh.name);
        } else {
            console.warn('[Scene] No warning mesh found in GLB. Animation will be skipped.');
        }

        console.log('[Scene] Model loaded. Nodes registered:', this.nodeRegistry.size, 'Meshes:', this.meshRegistry.size);
        return gltf;
    }

    /**
     * Node Discovery (Groups & Meshes)
     */
    findMesh(rawId) { // Renamed from findMesh to findNode conceptually, but kept name for compatibility
        if (!rawId) return null;
        const id = rawId.toLowerCase();

        // 1. Manual map check (High priority)
        if (id in this.manualMap) {
            const target = this.manualMap[id];
            if (target === null) return null; // Explicitly no mesh for this ID
            // target could be mapped to a mesh or a group
            if (this.nodeRegistry.has(target)) return this.nodeRegistry.get(target);
            if (this.meshRegistry.has(target)) return this.meshRegistry.get(target);
        }

        // 2. Direct exact match in node registry
        if (this.nodeRegistry.has(id)) return this.nodeRegistry.get(id);

        // 2. Normalized fuzzy search with priority
        const normId = id.replace(/[^a-z0-9]/g, '');
        let bestMatch = null;
        let bestPriority = -1;

        for (const [name, node] of this.nodeRegistry.entries()) {
            const normName = name.replace(/[^a-z0-9]/g, '');

            if (normName === normId || normName.includes(normId) || normId.includes(normName)) {
                let priority = 0;
                // Perfect alpha-numeric match
                if (normName === normId) priority = 5;
                // Prefer objects that actually have geometry (children or are meshes)
                else if (node.isMesh) priority = 3;
                else if (node.children.length > 0) priority = 2;
                else priority = 1;

                if (priority > bestPriority) {
                    bestPriority = priority;
                    bestMatch = node;
                }
            }
        }

        if (bestMatch) {
            console.log(`[Scene] Fuzzy Node Match: ${id} -> ${bestMatch.name} (Priority: ${bestPriority})`);
            this.nodeRegistry.set(id, bestMatch); // Cache the result for future lookups
            this.manualMap[id] = bestMatch.name.toLowerCase(); // Cache the result into manualMap
            return bestMatch;
        }

        // 4. Fallback: traverse everything manually to catch unnamed sub-groups just in case
        console.warn(`[Scene] No node found for ${id} in registry. Attempting deep scan...`);
        let deepMatch = null;
        this.model.traverse(c => {
            if (c.name && c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normId)) {
                deepMatch = c;
            }
        });

        if (deepMatch) {
            console.log(`[Scene] Deep Scan Match: ${id} -> ${deepMatch.name}`);
            this.nodeRegistry.set(deepMatch.name.toLowerCase(), deepMatch);
            this.manualMap[id] = deepMatch.name.toLowerCase();
            return deepMatch;
        }

        return null;
    }

    updateMeshColor(id, hex) {
        const m = this.findMesh(id); // findMesh now returns a Node (Group or Mesh)
        if (m) {
            // If it's a Group, traverse its children to find meshes
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
        if (!mesh) {
            console.warn(`[Scene] Cannot display data: No 3D model found for ${id}`);
            return;
        }

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

            label.position.set(localPos.x, localPos.y + (height / 2) + 0.5, localPos.z);
            mesh.add(label);
            this.labelRegistry.set(id, label);

            // ---- Attach Warning Mesh ----
            if (this.baseWarningMesh) {
                const warningClone = this.baseWarningMesh.clone();
                // Position it slightly above the UI label
                warningClone.position.set(localPos.x, localPos.y + (height / 2) + 3.0, localPos.z);
                warningClone.visible = false;

                // Keep original scale for basis
                warningClone.userData.baseScale = warningClone.scale.clone();

                // Add emissive red glow to the warning material if possible
                if (warningClone.material) {
                    warningClone.material = warningClone.material.clone();
                    warningClone.material.emissive = new THREE.Color(0xff0000);
                    warningClone.material.emissiveIntensity = 0.5;
                }

                mesh.add(warningClone);
                this.warningMeshes.set(id, warningClone);
            }
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

        // Toggle Warning Mesh Visibility
        const wMesh = this.warningMeshes.get(id);
        if (wMesh) {
            wMesh.visible = (stateClass === 'stopped');
        }

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
        const dist = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
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
        // Animation Clock for Warning Meshes
        const clock = new THREE.Clock();

        const loop = () => {
            requestAnimationFrame(loop);
            const elapsedTime = clock.getElapsedTime();

            this.controls.update();
            this.checkZoom();

            // Animate Warning Meshes (Scale pulsing + slight rotation)
            this.warningMeshes.forEach(wMesh => {
                if (wMesh.visible) {
                    const scalePulse = 1.0 + Math.sin(elapsedTime * 5.0) * 0.2; // Pulse between 0.8x and 1.2x
                    wMesh.scale.copy(wMesh.userData.baseScale).multiplyScalar(scalePulse);
                    wMesh.rotation.y += 0.05; // Spin slowly
                }
            });

            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        };
        loop();
    }
}

export default SceneManager;