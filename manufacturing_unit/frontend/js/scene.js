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
        this.hoveredDeviceId = null;

        // Manual mapping overrides for known discrepancies where fuzzy search fails
        this.manualMap = {
            'cnc_01': 'cnc_01',
            'cnc_02': 'cnc_02',
            'cnc01': 'cnc_01',
            'cnc02': 'cnc_02',
            'inspection_01': 'inspection_01',
            'inspection01': 'inspection_01',
            'furnace_01': 'furnace_01',
            'furnace01': 'furnace_01',
            'cooling_01': 'cooling_01',
            'cooling_02': 'cooling_02',
            'cooling01': 'cooling_01',
            'cooling02': 'cooling_02',
            'degasser_01': 'degasser_01',
            'degasser_02': 'degasser_02',
            'degasser01': 'degasser_01',
            'degasser02': 'degasser_02',
            'lpdc_01': 'lpdc_01',
            'lpdc_02': 'lpdc_02',
            'lpdc_03': 'lpdc_03',
            'lpdc01': 'lpdc_01',
            'lpdc02': 'lpdc_02',
            'lpdc03': 'lpdc_03',
            'heat_01': 'heat_01',
            'heat_02': 'heat_02',
            'heat01': 'heat_01',
            'heat02': 'heat_02',
            'paint_01': 'paint_01',
            'paint_02': 'paint_02',
            'paint01': 'paint_01',
            'paint02': 'paint_02',
            'storage_01': 'storage_01001',
            'storage01': 'storage_01001',
            'inbound_01': 'storage_01001',
            'inbound01': 'storage_01001',
            'buffer_01': 'storage_01001',
            'buffer01': 'storage_01001',
            'raw_materials': 'storage_01001',
            'rawmaterials': 'storage_01001',
            'outbound_01': 'outbound_01',
            'outbound01': 'outbound_01',
            'pretreat_01': 'pretreat_01',
            'pretreat01': 'pretreat_01',
            'pack_01': 'vertical_convey_01', // Fallback to nearest convey
            'pack01': 'vertical_convey_01',
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
        this.scene.background = new THREE.Color(0x0d1117);

        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50000);
        // Default overview: elevated front-left isometric (matches user's factory overview photo)
        this.defaultCameraPos = new THREE.Vector3(35, 55, 50);
        this.defaultTarget = new THREE.Vector3(5, 0, -2);
        this.camera.position.copy(this.defaultCameraPos);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none'; // CRITICAL: Renderer layer must not block WebGL
        this.container.appendChild(this.labelRenderer.domElement);
        console.log('[Scene] CSS2DRenderer initialized and attached.');

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.zoomSpeed = 0.8;
        this.controls.minDistance = 5;   // Max zoom in
        this.controls.maxDistance = 120; // Max zoom out

        // HDRI & Natural Metallic Reflections (SSR-like glossiness)
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 200;
        dirLight.shadow.camera.left = -60;
        dirLight.shadow.camera.right = 60;
        dirLight.shadow.camera.top = 60;
        dirLight.shadow.camera.bottom = -60;
        dirLight.shadow.bias = -0.001;
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

        // Raycast against the whole model to avoid missing sub-meshes with duplicate names
        if (!this.model) return;
        const intersects = this.raycaster.intersectObjects([this.model], true);

        if (intersects.length > 0) {
            let clickedObject = intersects[0].object;
            let deviceId = null;

            let current = clickedObject;
            while (current) {
                // Check for registered label parentage first (High Precision)
                const foundId = Array.from(this.labelRegistry.keys()).find(id => {
                    const labelObject = this.labelRegistry.get(id);
                    return labelObject && labelObject.parent === current;
                });
                if (foundId) {
                    deviceId = foundId;
                    break;
                }

                // SUB-MESH NAME MATCHING
                const normCurrent = current.name.toLowerCase().trim();

                // CRITICAL: Disable Floor/Ground/Warehouse clicks
                if (normCurrent.includes('floor') || normCurrent.includes('ground') || normCurrent.includes('warehouse') || normCurrent.includes('plane') || normCurrent.includes('plant') || normCurrent === 'pack_01' || normCurrent === 'pack01') {
                    deviceId = null;
                    this.resetInteraction();
                    return;
                }

                // HIGH PRECISION: Check if this node is EXPLICITLY null-mapped (e.g. floor)
                const isExplicitlyNull = Object.entries(this.manualMap).some(([id, target]) => {
                    return target === null && normCurrent.includes(id.toLowerCase());
                });
                if (isExplicitlyNull) {
                    deviceId = null;
                    break;
                }

                if (normCurrent.length > 2) {
                    // 1. Direct Manual Map Match (Perfect Hit)
                    const directMatch = Object.keys(this.manualMap).find(id => {
                        const target = this.manualMap[id];
                        return target && normCurrent === target.toLowerCase();
                    });

                    if (directMatch) {
                        deviceId = directMatch;
                        break;
                    }

                    // 2. Direct ID Match
                    const idMatch = Object.keys(this.manualMap).find(id => normCurrent === id.toLowerCase());
                    if (idMatch) {
                        deviceId = idMatch;
                        break;
                    }
                }
                current = current.parent;
            }

            if (deviceId) {
                console.log(`[Interaction] Resolved Device: ${deviceId} from Mesh: ${clickedObject.name}`);
                this.selectDevice(deviceId);
            }
        } else {
            // Background click - doing nothing to prevent bad UX (sudden camera resets)
            console.log('[Interaction] Background click detected, ignoring reset.');
        }
    }

    onPointerMove(event) {
        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        if (!this.model) return;
        const intersects = this.raycaster.intersectObjects([this.model], true);
        this.renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';

        // Hover tracking for label pruning
        if (intersects.length > 0) {
            let current = intersects[0].object;
            let foundId = null;
            while (current) {
                foundId = Array.from(this.labelRegistry.keys()).find(id => {
                    const labelObject = this.labelRegistry.get(id);
                    return labelObject && labelObject.parent === current;
                });
                if (foundId) break;
                current = current.parent;
            }
            this.hoveredDeviceId = foundId;
        } else {
            this.hoveredDeviceId = null;
        }
    }

    selectDevice(id) {
        if (!id) return;

        // Notify main app to set context
        if (window.app) {
            window.app.setContext('machine', id);
        }

        this.activeDeviceId = id;
    }

    /**
     * Show a label temporarily (Visibility Lifecycle)
     */
    showLabel(id, duration = 5000) {
        const label = this.labelRegistry.get(id);
        if (!label) return;

        label.element.classList.add('visible');

        // Clear existing timeout if any
        if (label.userData.hideTimeout) clearTimeout(label.userData.hideTimeout);

        label.userData.hideTimeout = setTimeout(() => {
            // Keep visible if it's the active device
            if (id !== this.activeDeviceId) {
                label.element.classList.remove('visible');
            }
        }, duration);
    }

    // ─── Twinzo-style Group Visualization ────────────────────────────────

    /**
     * Isolates a specific group of machines by fading out the rest of the plant.
     * @param {string[]} deviceIds - Array of machine IDs in the active group (null for All Plant)
     */
    isolateGroup(deviceIds) {
        if (!this.model) return;

        // Reset to original materials if null/all
        if (!deviceIds || deviceIds.length === 0) {
            this.model.traverse((node) => {
                if (node.isMesh && node.userData.originalMaterial) {
                    node.material = node.userData.originalMaterial;
                    node.userData.isGhosted = false;
                }
            });
            return;
        }

        // Get actual Three.js meshes/groups for these IDs
        const activeNodes = deviceIds.map(id => this.findMesh(id)).filter(Boolean);

        this.model.traverse((node) => {
            if (node.isMesh) {
                // Save original material on first pass
                if (!node.userData.originalMaterial) {
                    node.userData.originalMaterial = node.material;
                }

                // Is this node part of the active group?
                const isActive = activeNodes.some(activeNode => node === activeNode || this._isDescendant(node, activeNode));

                // Warning meshes ignore ghosting
                if (node.name.toLowerCase().includes('warning') || node.material.emissiveIntensity > 0) return;

                if (isActive) {
                    // Restore full material
                    node.material = node.userData.originalMaterial;
                    node.userData.isGhosted = false;
                } else {
                    // Industrial Solid Isolation (No Transparency)
                    if (!node.userData.ghostMaterial) {
                        node.userData.ghostMaterial = new THREE.MeshStandardMaterial({
                            color: 0x222222,
                            roughness: 1,
                            metalness: 0,
                            transparent: false,
                            depthWrite: true
                        });
                    }
                    node.material = node.userData.ghostMaterial;
                    node.userData.isGhosted = true;

                    // Disable emissive if any
                    if (node.material.emissive) {
                        node.material.emissive.setHex(0x000000);
                    }
                }
            }
        });

        // Hide ALL labels in Zone/Plant view for Twinzo clean look
        this.labelRegistry.forEach(label => label.element.style.display = 'none');

        // Frame the active group
        this.frameGroup(activeNodes);

        // Dashboard Logic (Level 2)
        window.dispatchEvent(new CustomEvent('ui-level-change', { detail: { level: 2 } }));
    }

    /**
     * Pans and zooms the camera to fit the bounding box of the active group.
     */
    frameGroup(nodes) {
        if (!nodes || nodes.length === 0) return;

        const groupBounds = new THREE.Box3();
        nodes.forEach(node => {
            const nodeBox = new THREE.Box3().setFromObject(node);
            groupBounds.union(nodeBox);
        });

        if (groupBounds.isEmpty()) return;

        const center = new THREE.Vector3();
        groupBounds.getCenter(center);

        const size = new THREE.Vector3();
        groupBounds.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraDistance *= 1.4; // Comfortable framing with slight padding
        cameraDistance = Math.min(cameraDistance, 35); // Cap for very large objects
        cameraDistance = Math.max(cameraDistance, 8);  // Min for very small objects

        // Camera offset: elevated front-right 45° angle for full device view
        const offset = new THREE.Vector3(0.6, 0.7, 0.8).normalize().multiplyScalar(cameraDistance);
        const targetPos = center.clone().add(offset);

        this.camera.position.copy(targetPos);
        this.controls.target.copy(center);
        this.controls.update();
    }

    resetInteraction() {
        this.activeDeviceId = null;
        this.isolateGroup(null);
        // Reset camera to default overview position
        this.camera.position.copy(this.defaultCameraPos);
        this.controls.target.copy(this.defaultTarget);
        this.controls.update();
        
        // Show labels in overview
        this.labelRegistry.forEach(label => label.element.style.display = 'block');
    }

    highlightAlarms() {
        this.model.traverse((node) => {
            if (node.isMesh && node.userData.originalMaterial) {
                const deviceId = Object.keys(this.manualMap).find(id => {
                    const target = this.manualMap[id];
                    return target && node.name.toLowerCase().includes(target.toLowerCase());
                });

                const cache = window.app ? window.app.telemetryStore.get(deviceId?.toUpperCase()) : null;
                const state = cache ? (cache.get('CalculatedState') || '').toLowerCase() : '';
                const isAlarm = ['fault', 'error', 'stopped'].includes(state);

                if (isAlarm) {
                    node.material = node.userData.originalMaterial.clone();
                    node.material.emissive = new THREE.Color(0xef4444);
                    node.material.emissiveIntensity = 0.5;
                } else {
                    this._ghostNode(node);
                }
            }
        });
    }

    updateEnergyChips(show) {
        this.labelRegistry.forEach((data, id) => {
            const div = data.element;
            let energyPill = div.querySelector('.energy-pill');
            const header = div.querySelector('.chip-header');
            
            if (!show) {
                if (energyPill) energyPill.style.display = 'none';
                if (header) header.style.display = 'flex'; // Restore normal label
                return;
            }
            
            const app = window.app;
            if (!app || !app.analytics) return;
            
            // Read from robust analytics store
            const machineData = app.analytics.data.machines[id.toUpperCase()] || app.analytics.data.machines[id.toUpperCase().replace(/_0/g, '0')] || null;
            const kw = machineData ? machineData.instantKW : 0;
            
            if (!energyPill) {
                energyPill = document.createElement('div');
                energyPill.className = 'energy-pill';
                // Stitch-style blue chip styling for metrics
                energyPill.style.cssText = 'background: rgba(19, 146, 236, 0.95); color: white; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; font-family: "Inter", sans-serif; letter-spacing: 0.5px; text-align: center; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.4); backdrop-filter: blur(4px);';
                div.insertBefore(energyPill, div.firstChild);
            }
            
            energyPill.textContent = `${kw.toFixed(1)} kW`;
            energyPill.style.display = 'block';
            if (header) header.style.display = 'none'; // Hide normal label when showing energy
        });
    }

    showIsolationMarkers() {
        this.model.traverse((node) => {
            if (node.isMesh && node.userData.originalMaterial) {
                // In a real app, we'd check an 'IsIsolated' flag
                // For now, we'll ghost everything and highlight a few as 'simulated' isolation
                this._ghostNode(node);
            }
        });
        // We could add sprite markers here if we had isolation data
    }

    _ghostNode(node) {
        if (!node.userData.ghostMaterial) {
            node.userData.ghostMaterial = new THREE.MeshStandardMaterial({
                color: 0x222222,
                roughness: 1,
                metalness: 0,
                transparent: false,
                depthWrite: true
            });
        }
        node.material = node.userData.ghostMaterial;
        node.userData.isGhosted = true;
    }

    async loadModel(path) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(path);
        this.model = gltf.scene;
        this.scene.add(this.model);

        let baseWarningMesh = null;

        this.model.traverse(c => {
            if (!c.name) return;
            const normName = c.name.toLowerCase();

            // Template Detection: The warning mesh 'error' is needed for cloning
            if (normName === 'error' || normName === 'warning' || normName === 'symbol') {
                if (!baseWarningMesh) {
                    baseWarningMesh = c.clone();
                    baseWarningMesh.visible = false;
                }
                c.visible = false;
                if (c.parent) c.parent.remove(c);
                return;
            }

            // Purge embedded dashboards/screens/placards from GLB (Architectural Requirement)
            const uiKeywords = [
                'screen', 'dashboard', 'intelligence', 'monitor', 'kpi', 
                'display', 'panel', 'ui', 'placard', 'sticker', 'board', 
                'info', 'text', 'label', 'data', 'overlay', 'chip'
            ];
            const isEmbeddedUI = uiKeywords.some(kw => normName.includes(kw));
            
            if (isEmbeddedUI) {
                console.log(`[Scene] Pruning embedded internal visual: ${c.name}`);
                c.visible = false;
                c.matrixAutoUpdate = false; // Freeze it
                return;
            }

            // Track all nodes (groups and meshes) for ID resolution
            if (!this.nodeRegistry.has(normName) || c.isMesh) {
                this.nodeRegistry.set(normName, c);
            }

            // Track meshes explicitly for raycasting and visual updates
            if (c.isMesh) {
                // Surgical Material Treatment
                let mat = c.material;
                if (mat) {
                    mat = mat.clone();
                    c.material = mat;
                    const mName = mat.name.toLowerCase();
                    const nName = c.name.toLowerCase();
                    const isMetallic = mName.includes('alum') || mName.includes('steel') || mName.includes('metal') || mName.includes('galv');
                    const isDegasserLadel = nName.includes('aluminium_container') || nName.includes('ladel') || mName.includes('degasser') || nName.includes('degasser');

                    if (isMetallic || isDegasserLadel || mat.map) {
                        // Restoration: Force galvanized look for the Degasser parts that appear white
                        mat.roughness = isDegasserLadel ? 0.3 : 0.4;
                        mat.metalness = isDegasserLadel ? 0.95 : 0.8;
                        if (isDegasserLadel) {
                            mat.color.setHex(0x777777); // Darker steel/grey for galvanized look
                        }
                    } else if (normName.includes('floor') || normName.includes('ground')) {
                        mat.roughness = 1.0;
                        mat.metalness = 0.0;
                    } else {
                        mat.roughness = 0.5;
                        mat.metalness = 0.3;
                    }
                }
                if (c.material && c.material.clearcoat !== undefined) c.material.clearcoat = 0.0;

                this.meshRegistry.set(normName, c);
                c.castShadow = true;
                c.receiveShadow = true;
            }
        });

        this.baseWarningMesh = baseWarningMesh;
        if (this.baseWarningMesh) {
            console.log('[Scene] Base Warning Mesh found:', this.baseWarningMesh.name);
        } else {
            console.warn('[Scene] No warning mesh found in GLB. Animation will be skipped.');
        }

        console.log('[Scene] Model loaded. Nodes registered:', this.nodeRegistry.size, 'Meshes:', this.meshRegistry.size);
        console.log('[Scene] All node names:', [...this.nodeRegistry.keys()].sort().join(', '));

        // Dismiss loading screen once model is ready
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
            setTimeout(() => loadingScreen.remove(), 700);
        }

        this.resetInteraction();
        return gltf;
    }

    /**
     * Check if node is a descendant of parent
     */
    _isDescendant(node, parent) {
        let current = node.parent;
        while (current) {
            if (current === parent) return true;
            current = current.parent;
        }
        return false;
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
            if (target === null) return null;
            if (this.nodeRegistry.has(target)) return this.nodeRegistry.get(target);
            if (this.meshRegistry.has(target)) return this.meshRegistry.get(target);
        }

        // 2. Strict exclusion for 'plant' or 'floor' unless explicitly requested
        const isGeneric = id.includes('plant') || id.includes('floor') || id.includes('ground');

        // 3. Direct exact match in node registry
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
        // OBSOLETE: Retention of original textures requested by user.
        // No longer applying state-driven colors to machine meshes.
        return;
    }

    /**
     * Case-Insensitive Prefix-Aware Matcher
     */
    getValue(data, key) {
        if (!data || !key) return undefined;
        const lowerTarget = key.toLowerCase().replace(/[^a-z0-9]/g, '');
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

    updateDeviceLabel(rawId, data, preferred = null) {
        if (!rawId || !data) return;
        
        // Strict ID Unification: Strip symbols, underscores, and spaces
        let id = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (id === 'plant' || id === 'pack_01' || id === 'pack01') return; // User request: No 'plant' or 'pack_01' machine-chip label

        if (id === 'outbound02' || id === 'outbound_02') {
            console.log(`[Trace] updateDeviceLabel for OUTBOUND_02. Raw: ${rawId}, ID: ${id}`);
        }

        // Strict Unification: Storage and Inbound are RAW MATERIALS
        const isRawMaterials = id.includes('storage') || id.includes('inbound') || id.includes('rawmaterials');
        if (isRawMaterials) {
            id = 'rawmaterials';
        }

        let labelId = id;
        const assetInfo = window.app && window.app.assetData ? window.app.assetData[id] : null;
        let displayName = (assetInfo && assetInfo.name ? assetInfo.name : id).toUpperCase().replace(/_/g, ' ');

        // HIGH PRIORITY MANUAL REFINEMENTS
        if (id.includes('inspection')) displayName = 'X RAY';
        if (id.toLowerCase() === 'raw_materials') displayName = 'RAW MATERIALS';
        if (id.toLowerCase().includes('storage') || id.toLowerCase().includes('inbound')) displayName = 'RAW MATERIALS';

        let mesh = this.findMesh(id);
        if (!mesh) {
            console.warn(`[Scene] No mesh found for device: ${id}`);
            return;
        }

        let positionOverride = null;
        // Shared mesh heuristic removed: OUTBOUND_02 has its own mesh in manualMap now

        let label = this.labelRegistry.get(id);

        // UI Reversion: Header/Dot Style as per user's preference
        if (!label) {
            const div = document.createElement('div');
            div.className = 'machine-chip';
            div.style.pointerEvents = 'none'; // CRITICAL: Stop chips from blocking machine clicks
            div.innerHTML = `
                <div class="chip-header">
                    <span class="chip-status-dot"></span>
                    <span class="chip-name">${displayName}</span>
                    <button class="chip-info-btn"><span class="material-symbols-outlined" style="font-size:14px">info</span></button>
                </div>
            `;

            div.onclick = null; // Clicks pass through to machine

            label = new CSS2DObject(div);

            // Precision World-Space Anchoring (Improved Stability)
            const box = new THREE.Box3().setFromObject(mesh);
            const topY = box.max.y + 0.5;
            const worldTopCenter = new THREE.Vector3(
                (box.max.x + box.min.x) / 2,
                topY,
                (box.max.z + box.min.z) / 2
            );

            // Save world position BEFORE worldToLocal mutates the vector
            const warningWorldPos = worldTopCenter.clone();

            // Convert World Center to Mesh Local Space (MUTATES worldTopCenter)
            const localPos = mesh.worldToLocal(worldTopCenter);
            label.position.copy(localPos);

            mesh.add(label);
            this.labelRegistry.set(id, { element: div, parent: label.parent, object: label });

            // Attach Warning Mesh at WORLD coordinates (scene root)
            // Adding to scene root avoids all parent transform issues
            if (this.baseWarningMesh) {
                const warningClone = this.baseWarningMesh.clone();

                // Direct world-space scale (no parent compensation needed)
                const targetSize = 1.2;
                warningClone.scale.set(targetSize, targetSize, targetSize);

                // Force upright in world space
                warningClone.rotation.set(Math.PI / 2, 0, 0);

                // Position at world-space top center of device + small offset
                warningClone.position.copy(warningWorldPos);
                warningClone.position.y += 0.3;

                warningClone.visible = false;
                warningClone.userData.baseScale = warningClone.scale.clone();
                warningClone.traverse(child => {
                    if (child.isMesh && child.material) {
                        child.material = child.material.clone();
                        child.material.emissive = new THREE.Color(0xff4400);
                        child.material.emissiveIntensity = 0.8;
                    }
                });
                this.scene.add(warningClone);
                this.warningMeshes.set(id, warningClone);
            }
        }

        const labelItem = this.labelRegistry.get(id);
        if (!labelItem || !labelItem.element) return;

        const element = labelItem.element;

        // Update Status Dot (Header/Dot Style) - detect running state from multiple sources
        const dotEl = element.querySelector('.chip-status-dot');
        if (dotEl) {
            const stateStr = (this.getValue(data, 'State') || this.getValue(data, 'CalculatedState') || '').toString().toLowerCase();
            const isRunning = data.IsRunning === true || stateStr === 'running';
            dotEl.className = `chip-status-dot ${isRunning ? 'running' : 'stopped'}`;
        }

        const stateColor = window.app && window.app.stateManager ? window.app.stateManager.getDeviceState(id) : null;
        if (stateColor) {
            const hex = '#' + stateColor.color.toString(16).padStart(6, '0');
            const dotIndicator = element.querySelector('.chip-status-dot');
            if (dotIndicator) {
                dotIndicator.style.backgroundColor = hex;
                dotIndicator.style.boxShadow = `0 0 8px ${hex}`;
            }
        }

        const state = (this.getValue(data, 'State') || "").toString().toLowerCase();
        const wMesh = this.warningMeshes.get(id);
        if (wMesh) {
            // Only show flashing warning triangle for explicitly critical states
            const isAlarmState = ['stopped', 'fault', 'error', 'offline'].some(s => state.includes(s));
            wMesh.visible = isAlarmState;
        }

        const activeCtx = window.app ? window.app.activeContext : null;
        if (activeCtx && activeCtx.type === 'machine' && activeCtx.id === id) {
            element.classList.add('active');
        } else {
            element.classList.remove('active');
        }
    }

    setLabelMode(id, mode) {
        // Obsolete: buttons removed in favour of minimalist chip design
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
        const cameraPos = this.camera.position;

        this.labelRegistry.forEach((data, id) => {
            if (!data) return;
            const label = data.object || data; // unpack label from object or fallback
            if (!label || typeof label.getWorldPosition !== 'function') return;

            const element = data.element || label.element;

            const worldPos = new THREE.Vector3();
            label.getWorldPosition(worldPos);
            const dist = cameraPos.distanceTo(worldPos);

            // Visibility Thresholds & Pruning Logic (Using label.visible for 3D engine)
            const isContextuallyActive = (id === this.activeDeviceId || id === this.hoveredDeviceId);
            const distLimit = isContextuallyActive ? 1500 : 0; 
            const isMini = dist > 120;

            if (dist > distLimit) {
                label.visible = false;
                if (element) element.style.display = 'none'; // Keep DOM element hidden too
            } else {
                label.visible = true;
                if (element) {
                    element.style.display = 'block';
                    element.classList.toggle('mini', isMini && id !== this.activeDeviceId);
                }
            }

            // Always show active device chip
            if (id === this.activeDeviceId) {
                label.visible = true; // Ensure 3D object is visible
                if (element) {
                    element.style.display = 'block';
                    element.classList.remove('mini');
                }
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

            // Animate Warning Meshes (Static Orientation, Pulse Scale)
            this.warningMeshes.forEach(wMesh => {
                if (wMesh.visible) {
                    const scalePulse = 1.0 + Math.sin(elapsedTime * 4.0) * 0.15;
                    wMesh.scale.copy(wMesh.userData.baseScale).multiplyScalar(scalePulse);

                    // No dynamic billboarding logic here as per latest request
                }
            });

            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        };
        loop();
    }
}

export default SceneManager;