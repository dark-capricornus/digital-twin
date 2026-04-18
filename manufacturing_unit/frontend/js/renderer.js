import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';


/**
 * Renderer Class (Restored from SceneManager)
 * Comprehensive Digital Twin Rendering Engine
 */
class Renderer {
    constructor(container, stateManager, app = null) {
        this.container = container;
        this.stateManager = stateManager;
        this.app = app; // Direct reference for asset lookups
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.model = null;

        this.meshRegistry = new Map(); // Used only for raycasting
        this.nodeRegistry = new Map(); // Used for device lookup (Groups + Meshes)
        this.normNodeRegistry = new Map(); // [PERF] Pre-calculated normalized names
        this.labelRegistry = new Map();
        this.zoneLabelRegistry = new Map();
        this.zoneNameRegistry = new Map(); // New: Floor-level text labels
        this.zoneRegistry = new Map();     // New: Zone bounding boxes for hover checks
        this.showMachineLabels = false; // [USER] Toggle-off individual machine icons
        this.originalYMap = new Map();     // New: Storing base Y for elevation resets
        this.mixer = null;  // THREE.AnimationMixer for GLB animations
        this.clock = new THREE.Clock(); // Delta-time clock for animation mixer
        this.hoveredZoneId = null;
        this.elevatedMachineId = null;
        this.warningMeshes = new Map(); // Map of deviceId -> warning mesh instance
        this.hoveredDeviceId = null;
        this.hoverTimeout = null;
        this.pendingHoverId = null;
        this.hitGroup = null;
        this.hitBoxMeshes = [];
        this.highlightState = new Map(); // Source of Truth for highlights
        this.lastHovered = null;         // Debounce guard
        this.elevationAnims = new Map(); // [FIX] Required by hover stabilization logic

        // Manual mapping overrides for known discrepancies
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
            'heattreatment_01': 'heat_01',
            'heattreatment_02': 'heat_02',
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
            'raw_materials': 'storage_01006',
            'rawmaterials': 'storage_01006',
            'outbound_01': 'outbound_01',
            'outbound01': 'outbound_01',
            'pretreat_01': 'pretreat_01',
            'pretreat01': 'pretreat_01',
            'pretreatment_01': 'pretreat_01',
        };

        // Exact extra mesh names that belong to a device but don't share its name prefix
        this.associatedMeshNames = {
            'degasser_01': ['aluminium_container001'],
            'degasser_02': ['aluminium_container003'],
        };

        // Fresnel overlay system has been removed. Hover feedback is handled
        // purely by machine elevation; cross-zone isolation by ghost materials.

        this.persistentValues = new Map();
        this.chipDisplayMode = 'none';
        this._selectedDeviceId = null;

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pointerMoved = false;

        // [PRECISION] Custom Camera Zoom Map
        this.customZooms = {
            'rawmaterials': 6.052,
            'storage_01006': 6.052,
            'furnace_01': 3.91,
            'inspection_01': 11.478,
            'degasser_01': 5.9777,
            'degasser_02': 5.9777,
            'lpdc_02': 5.801,
            'lpdc_03': 5.801,
            'pretreat_01': 9.424
        };

        this.lastCameraZoom = 0;
        this.lastCameraPos = new THREE.Vector3();
        this.frameCounter = 0;
        this.interpolatedValues = new Map();
        this.pendingLabelIds = new Set();

        this.init();
        this.setupInteraction();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0d1117);

        this.viewSize = 40;
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.OrthographicCamera(
            -aspect * this.viewSize / 2,
            aspect * this.viewSize / 2,
            this.viewSize / 2,
            -this.viewSize / 2,
            0.1,
            10000
        );

        this.defaultTarget = new THREE.Vector3(-6.84, -4.58, 10.27);
        this.defaultPosition = new THREE.Vector3(793.43, 594.61, 810.54);
        this.defaultZoom = 1.13;

        this.camera.up.set(0, 1, 0);
        this.camera.position.copy(this.defaultPosition);
        this.camera.lookAt(this.defaultTarget);
        this.camera.zoom = this.defaultZoom;
        this.camera.updateProjectionMatrix();

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0; // [SCADA] Increased to 1.0 to match Blender viewport depth
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
        this.container.appendChild(this.renderer.domElement);



        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(this.defaultTarget);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.zoomSpeed = 1.2;
        this.controls.minZoom = 0.01;
        this.controls.maxZoom = 100;
        this.controls.update();

        window.addEventListener('resize', () => this.onWindowResize());
        this._setupCoordinateTracker();
    }

    _initEnvironment() {
        if (!this.renderer || !this.scene) return;
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        // [SCADA] Boosted RoomEnvironment intensity for richer reflections on metallic components
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.08).texture;
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
        dirLight.position.set(40, 60, 40); // Slightly higher/further for better shadow spread
        dirLight.castShadow = true;
        
        // [PRECISION] Shadow Camera Configuration
        dirLight.shadow.camera.left = -100;
        dirLight.shadow.camera.right = 100;
        dirLight.shadow.camera.top = 100;
        dirLight.shadow.camera.bottom = -100;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 500;
        dirLight.shadow.mapSize.set(2048, 2048);
        dirLight.shadow.bias = -0.0002; // Prevent shadow acne
        dirLight.shadow.normalBias = 0.02; // Fix artifacts on smooth surfaces
        
        this.scene.add(dirLight);

        pmremGenerator.dispose();
    }

    _setupCoordinateTracker() {
        this.coordsOverlay = document.createElement('div');
        this.coordsOverlay.id = 'scene-coords-overlay';
        this.coordsOverlay.style.cssText = `
            position: absolute;
            bottom: 24px;
            left: 24px;
            background: #0A0A0A;
            border: 1px solid #1C1C1C;
            padding: 12px;
            color: #FFFFFF;
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            display: none; 
            z-index: 1000;
            pointer-events: none;
            text-transform: uppercase;
        `;
        this.container.appendChild(this.coordsOverlay);
    }

    _updateCoordinateTracker() {
        if (!this.coordsOverlay || !this.controls || !this.camera) return;
        const mode = window.app ? window.app.primaryMode : '';
        const isEnergyMode = mode === 'energy' || mode === 'energy_analytics';
        this.coordsOverlay.style.display = isEnergyMode ? 'block' : 'none';
        if (!isEnergyMode) return;

        const params = this.identifyCameraParameters();
        const target = this.controls.target;
        this.coordsOverlay.innerHTML = `
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 4px 16px;">
                <div style="border-left: 2px solid var(--primary); padding-left: 8px;">
                    <span style="color:var(--text-dim)">P_X</span> ${target.x.toFixed(2)}<br/>
                    <span style="color:var(--text-dim)">P_Y</span> ${target.y.toFixed(2)}<br/>
                    <span style="color:var(--text-dim)">P_Z</span> ${target.z.toFixed(2)}
                </div>
                <div style="border-left: 2px solid var(--primary); padding-left: 8px;">
                    <span style="color:var(--text-dim)">Z_LVL</span> ${this.camera.zoom.toFixed(2)}<br/>
                    <span style="color:var(--text-dim)">ANG_H</span> ${params.hAngle}°<br/>
                    <span style="color:var(--text-dim)">ANG_V</span> ${params.vAngle}°
                </div>
            </div>
            <div style="margin-top: 8px; font-size: 8px; color: var(--text-dim); border-top: 1px solid #1C1C1C; padding-top: 4px;">
                HUD_RENDER_ENGINE_V1.1 // SYSTEM_CALIBRATED
            </div>
        `;
    }

    setupInteraction() {
        // Track pointer position for raycasting
        window.addEventListener('pointermove', (e) => {
            this._updatePointer(e);
            this.pointerMoved = true;
        });

        // Use native click event — only fires on clean press+release, not drags
        this.renderer.domElement.addEventListener('click', (e) => {
            if (e.button !== 0) return;
            this._updatePointer(e); // Ensure raycaster has fresh coordinates
            this.onPointerClick(e);
        });
    }

    _updatePointer(e) {
        this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    onPointerClick(event) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);

        if (intersects.length > 0) {
            const deviceId = intersects[0].object.userData.deviceId;
            if (deviceId) this.selectDevice(deviceId);
        } else {
            // Clicked empty space — reset if a device is selected
            if (this._selectedDeviceId) {
                this._selectedDeviceId = null;
                if (window.app) window.app.setContext('plant');
            }
        }
    }

    handleHover() {
        if (!this.raycaster || !this.camera || !this.hitBoxMeshes.length) return;
        if (!this.pointerMoved) return;
        this.pointerMoved = false;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);
        let hoveredId = intersects.length > 0 ? intersects[0].object.userData.deviceId : null;

        this.renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'default';

        // 1. [USER] Zone Hover Detection
        const floorPoint = new THREE.Vector3();
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.raycaster.ray.intersectPlane(floorPlane, floorPoint);

        let newHoveredZoneId = null;
        for (const [zoneId, box] of this.zoneRegistry) {
            if (floorPoint.x >= box.min.x && floorPoint.x <= box.max.x &&
                floorPoint.z >= box.min.z && floorPoint.z <= box.max.z) {
                newHoveredZoneId = zoneId;
                break;
            }
        }

        // Also check if hovered over a specific machine within a zone
        if (!newHoveredZoneId && hoveredId && window.app) {
            const upperHoveredId = hoveredId.toUpperCase();
            for (const [zoneId, members] of Object.entries(window.app.machineGroups)) {
                if (members.includes(upperHoveredId) || members.includes(hoveredId)) {
                    newHoveredZoneId = zoneId;
                    break;
                }
            }
        }

        // 2. [SCADA] Selection Debouncing & Highlight Management
        if (this.lastHovered !== hoveredId) {
            this.lastHovered = hoveredId;
            
            // Apply collection-aware highlight state
            if (hoveredId) {
                this.setHighlight(hoveredId, true);
            } else {
                this.clearHighlights();
            }

            // [USER] Machine Elevation
            if (this.elevatedMachineId !== hoveredId) {
                if (this.elevatedMachineId) this._animateMachineElevation(this.elevatedMachineId, false);
                this.elevatedMachineId = hoveredId;
                if (this.elevatedMachineId) this._animateMachineElevation(this.elevatedMachineId, true);
            }
        }

        // 3. [USER] Zone Hover — show zone name only (no elevation)
        if (this.hoveredZoneId !== newHoveredZoneId) {
            if (this.hoveredZoneId) {
                const oldMesh = this.zoneNameRegistry.get(this.hoveredZoneId);
                if (oldMesh) this._fadeMesh(oldMesh, false);
            }
            this.hoveredZoneId = newHoveredZoneId;
            if (this.hoveredZoneId) {
                const newMesh = this.zoneNameRegistry.get(this.hoveredZoneId);
                if (newMesh) this._fadeMesh(newMesh, true);
            }
        }

        // Previous label highlight logic (if used)
        if (this.hoveredDeviceId !== hoveredId) {
            clearTimeout(this.hoverTimeout);
            this.pendingHoverId = hoveredId;
            this.hoverTimeout = setTimeout(() => {
                this.hoveredDeviceId = hoveredId;
                this.pendingHoverId = null;
                this.labelRegistry.forEach((data, id) => {
                    if (data.element) {
                        if (id === hoveredId) data.element.classList.add('hovered');
                        else data.element.classList.remove('hovered');
                    }
                });
            }, hoveredId === null ? 200 : 50);
        }
    }

    /**
     * [USER] Classify selection as single mesh or logical collection
     */
    getSelectionType(deviceId) {
        if (!deviceId) return null;
        const normId = deviceId.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // 1. Prefix-based collections (Storage, Raw Materials)
        if (normId === 'rawmaterials' || normId.startsWith('storage') || normId.startsWith('inbound') || normId.startsWith('buffer')) {
            return 'collection';
        }

        // 2. Check for associated multi-mesh mappings
        const rawId = deviceId.toLowerCase();
        if (this.associatedMeshNames[rawId]) return 'collection';

        // 3. Fallback to registry audit
        const nodes = this._getDeviceNodes(deviceId);
        return nodes.length > 1 ? 'collection' : 'mesh';
    }

    /**
     * Collect all top-level nodes belonging to a device (handles multi-mesh machines like RAWMATERIALS/storage)
     */
    _getDeviceNodes(deviceId) {
        const seen = new Set();
        const nodes = [];
        const rawId = deviceId.toLowerCase();
        
        // Resolve the primary mapped name and its pieces
        const mapped = (this.manualMap[rawId] || rawId).toLowerCase();
        const mappedNorm = mapped.replace(/[^a-z0-9]/g, '');
        const normSearch = rawId.replace(/[^a-z0-9]/g, '');

        // [SCADA] Instance Analysis: Identify base name and index (e.g. furnace and 01)
        // This allows us to catch "furnace_body_01" even if the search is "furnace_01"
        const indexMatch = mapped.match(/_(\d+)$/) || mapped.match(/(\d+)$/);
        const index = indexMatch ? indexMatch[1] : null;
        const basePrefix = index ? mapped.replace(index, '').replace(/_$/, '') : mapped;

        const addNode = (id, node) => {
            if (seen.has(node.uuid)) return;
            seen.add(node.uuid);
            
            // Only add Mesh or Group/Object3D that has actual mesh content
            let hasMesh = false;
            node.traverse(c => { if (c.isMesh) hasMesh = true; });
            if (hasMesh) nodes.push({ id, node });
        };

        // [SCADA] Universal Fuzzy Harvesting
        this.nodeRegistry.forEach((node, name) => {
            const nameLower = name.toLowerCase();
            const nameNorm = nameLower.replace(/[^a-z0-9]/g, '');

            // 1. Literal Prefix Match (covers "finishing_shop")
            let isMatch = nameLower.startsWith(mapped) || 
                          nameNorm.startsWith(mappedNorm) || 
                          nameNorm.startsWith(normSearch);

            // 2. Instance-Aware Match (covers "furnace_body_01" for "furnace_01")
            if (!isMatch && index) {
                const nameHasPrefix = nameLower.includes(basePrefix);
                const nameHasIndex = nameLower.includes(index) || nameNorm.includes(index);
                if (nameHasPrefix && nameHasIndex) isMatch = true;
            }

            if (isMatch) addNode(nameLower, node);
        });

        // Associated mesh names (e.g. aluminium containers for degassers)
        const extraNames = this.associatedMeshNames[rawId] || this.associatedMeshNames[mapped];
        if (extraNames) {
            extraNames.forEach(name => {
                const n = this.nodeRegistry.get(name.toLowerCase());
                if (n) addNode(name.toLowerCase(), n);
            });
        }
        
        // [SCADA] Hierarchical Expansion — Extension, not refactor.
        // For every "seed" node found above, we check its parent. If the parent's
        // name matches the machine's base or index, we harvest all its children.
        // This catches "Aluminium_Container" or "Base_002" even if the names don't match.
        const seeds = [...nodes];
        seeds.forEach(({ node }) => {
            let p = node.parent;
            if (p && p !== this.model && (p.isGroup || p.isObject3D)) {
                const pName = (p.name || '').toLowerCase();
                const pNameNorm = pName.replace(/[^a-z0-9]/g, '');
                
                // If parent owns the machine prefix or the instance index, take all siblings
                if (pName.includes(basePrefix) || (index && (pName.includes(index) || pNameNorm.includes(index)))) {
                    p.traverse(c => {
                        if (c.isMesh) addNode(c.name.toLowerCase(), c);
                    });
                }
            }
        });

        // Final Filter: Prevent double-displacement by only elevating the root-most nodes
        const rootNodes = nodes.filter(({ node }) => {
            let p = node.parent;
            while(p && p !== this.model) {
                if (nodes.some(n => n.node === p)) return false;
                p = p.parent;
            }
            return true;
        });

        return rootNodes;
    }

    /**
     * [USER] Animate machine elevation and highlight on hover
     */
    _animateMachineElevation(deviceId, isActive) {
        const nodes = this._getDeviceNodes(deviceId);
        if (!nodes.length || !this.model) return;
        nodes.forEach(({ id, node }) => this._animateNodeElevation(id, node, isActive));
    }

    /**
     * Zone-level elevation — elevates all meshes of a machine within a zone
     */
    _animateZoneMachineElevation(machineId, isActive) {
        const nodes = this._getDeviceNodes(machineId);
        if (!nodes.length || !this.model) return;
        nodes.forEach(({ id, node }) => this._animateNodeElevation(id, node, isActive, 0.5));
    }

    // Fresnel overlay system removed. Hover feedback is driven purely by
    // machine elevation; selection visibility by ghost materials. The hooks
    // below are kept as minimal state trackers so existing call sites
    // (handleHover, selectDevice, resetInteraction) continue to work.
    clearHighlights() {
        this.highlightState.clear();
    }

    setHighlight(deviceId, isActive = true) {
        if (!isActive) {
            this.clearHighlights();
            return;
        }
        this.highlightState.clear();
        if (deviceId) this.highlightState.set(deviceId, 1.0);
    }

    /**
     * Core animation helper — elevates a single node and manages Fresnel highlight
     */
    _animateNodeElevation(nodeId, node, isActive, height = 0.8) {
        if (!this.originalYMap.has(nodeId)) {
            this.originalYMap.set(nodeId, node.position.y);
        }

        // FIX: Cancel any in-flight elevation animation before starting a new one.
        // Without this, rapid hover on/off can stack competing rAF callbacks that
        // fight over node.position.y, causing visible jitter.
        const cancelKey = `_elevAnim_${nodeId}`;
        if (this[cancelKey]) this[cancelKey] = false; // signal old anim to stop

        const targetY = isActive ? this.originalYMap.get(nodeId) + height : this.originalYMap.get(nodeId);
        const startY = node.position.y;
        const startTime = performance.now();
        const duration = 400;
        const animId = Symbol(); // unique token for this animation run
        this[cancelKey] = animId;

        const animate = (time) => {
            // Bail out if a newer animation replaced us
            if (this[cancelKey] !== animId) return;
            const t = Math.min((time - startTime) / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3);
            node.position.y = THREE.MathUtils.lerp(startY, targetY, ease);
            if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    // setStorageFillLevel was backed by the fresnel uFillLevel uniform. With
    // the fresnel overlay system removed this is a no-op — retained so upstream
    // callers (websocket storage updates) keep running without changes.
    setStorageFillLevel(_deviceId, _level) {}

    /**
     * [USER] Helper for smooth animation of 3D meshes (e.g. floor names)
     */
    _fadeMesh(mesh, fadeIn) {
        const startOpacity = mesh.material.opacity;
        const targetOpacity = fadeIn ? 0.8 : 0;
        const startTime = performance.now();
        const duration = 500;

        const animate = (time) => {
            const t = Math.min((time - startTime) / duration, 1);
            mesh.material.opacity = THREE.MathUtils.lerp(startOpacity, targetOpacity, t);
            if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    /**
     * [USER] As-Is Texture System
     * We no longer override materials or geometry. 
     * We only configure static properties like shadows.
     */
    _setupStaticProperties(root) {
        let count = 0;
        const angle = THREE.MathUtils.degToRad(60); // [USER] Threshold increased to 60° for technical clarity

        root.traverse(node => {
            if (node.isMesh && node.geometry) {
                // [PRECISION] Shadow Configuration
                // Auto-detect floor for shadow reception
                const box = new THREE.Box3().setFromObject(node);
                const isFloor = box.min.y < 0.1 && (box.max.x - box.min.x) > 20;

                if (isFloor) {
                    node.receiveShadow = true;
                    node.userData.isFloor = true;
                } else {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }

                // [SCADA] Texture Fidelity Reinforcement
                // Apply environment map and boost intensity to make the materials "pop"
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    mats.forEach(m => {
                        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
                            m.envMapIntensity = 1.5; // Premium reflection depth
                            m.roughness = Math.max(m.roughness, 0.1); 
                        }
                    });
                }

                // [FIX] Skip toCreasedNormals on animated meshes — vertex splitting
                // breaks skinned/morph rigs AND can cause position-track jitter because
                // the new geometry's bounding sphere differs from the original.
                if (node.userData.isAnimated) { count++; return; }

                // [PRECISION] Smoothing System (Fidelity Priority)
                // toCreasedNormals effectively "bakes" new normals by splitting the geometry
                // at sharp angles and averaging normals on smooth ones.
                node.geometry = BufferGeometryUtils.toCreasedNormals(node.geometry, angle);

                // Preserve original bounding for culling and reflections
                node.geometry.computeBoundingBox();
                node.geometry.computeBoundingSphere();
                count++;
            }
        });
        console.log(`[Renderer] Static properties (45deg smooth) configured for ${count} mesh(es).`);
    }


    async loadModel(path, onProgress) {
        const loader = new GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
            loader.load(path, resolve, (xhr) => { if (onProgress) onProgress(xhr); }, reject);
        });
        this.model = gltf.scene;

        // ─── Animation Discovery (Move up for baking logic) ─────────────
        const animatedNodeNames = new Set();
        if (gltf.animations && gltf.animations.length > 0) {
            const ANIM_PROPS = ['position', 'quaternion', 'scale', 'visible', 'morphTargetInfluences'];
            const propPattern = new RegExp(`\\.(${ANIM_PROPS.join('|')})(\\[.*\\])?$`);
            gltf.animations.forEach(clip => {
                clip.tracks.forEach(track => {
                    // [SCADA] Robust track name parsing: 
                    // Handles "NodeName.property" AND "Path/To/NodeName.property"
                    const parts = track.name.split('.');
                    const path = parts[0];
                    const nodeName = path.includes('/') ? path.split('/').pop() : path;
                    if (nodeName) animatedNodeNames.add(nodeName);
                });
            });
        }

        // [FIX] Tag animated subtrees BEFORE static pre-processing so toCreasedNormals
        // skips them. Running vertex-splitting on an animated mesh produces a geometry
        // whose bounding sphere / vertex count differs from what the AnimationMixer
        // expects — the visible symptom is forklift-style jitter.
        //
        // We tag strictly from the animation clip's track names. A prior heuristic
        // regex (/tailing|sweep|pallet|forklift/i) was mis-tagging static warehouse
        // pallets — they then skipped ghosting, elevation, and fresnel highlights.
        // Children of a tagged parent still inherit via the inner traverse below,
        // so anything parented under the forklift still moves correctly.
        this.model.traverse(node => {
            if (node.name && animatedNodeNames.has(node.name)) {
                // Tag this node and ALL children — these are the actual animated objects
                node.traverse(child => { child.userData.isAnimated = true; });
                // Tag ancestors — these are containers (e.g. storage nodes) that should
                // still get Fresnel/elevation, just not be ghosted
                let p = node.parent;
                while (p && p !== this.model) {
                    p.userData.hasAnimatedDescendant = true;
                    p = p.parent;
                }
            }
        });

        // ─── Pre-processing (Static Logic) ──────────────────────────────
        // Apply shadow settings and compute bounds for static geometry
        this._setupStaticProperties(this.model);

        this.scene.add(this.model);

        // ─── Animation Support ──────────────────────────────────────────
        if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.model);

            // [FIX] The exported GLB contains overlapping actions targeting the
            // same node.property — notably two full transform clips on
            // storage_01.013 (the box on the forklift lifter):
            //   - storage_01.013Action        : scale 0→1 at frame 205, translation
            //     (11.62, -0.62, 0.018) [off the lifter — Blender artifact]
            //   - storage_01.013Action.002    : scale 1→0 at frame 205, translation
            //     (-0.60, -0.62, -0.03) [matches the node's bind pose]
            //
            // The `.002` suffix is Blender's convention for the artist's corrected
            // version. It keeps the box attached to the sweep before the drop
            // (frame < 205) and hides it after (frame ≥ 205), which is the
            // intended "box on lifter, then lowered and left behind" behavior.
            // A first-wins dedup picks the wrong clip; a last-wins dedup picks
            // the corrected one. Iterate clips in reverse so the LAST occurrence
            // of any (node, property) track is the one retained.
            const seenTracks = new Map();
            const playableClips = [];

            // Iterate in reverse to prefer newer (.002) clips by default,
            // but implement a specific "Lifecycle Priority" for visibility tracks.
            for (let i = gltf.animations.length - 1; i >= 0; i--) {
                const clip = gltf.animations[i];
                const tracksToKeep = [];

                clip.tracks.forEach(track => {
                    const existing = seenTracks.get(track.name);
                    const isVisibilityTrack = track.name.toLowerCase().includes('.visible');
                    const isCriticalMesh = track.name.toLowerCase().includes('ladel') || 
                                         track.name.toLowerCase().includes('ladle') || 
                                         track.name.toLowerCase().includes('pallet');

                    if (!existing) {
                        seenTracks.set(track.name, { clip: clip.name, track });
                        tracksToKeep.push(track);
                    } else if (isVisibilityTrack && isCriticalMesh) {
                        // [PRECISION] Visibility Sanitizer
                        // If we have a visibility track for a critical object (ladle/pallet),
                        // prioritize the one that actually contains state changes (0 <-> 1).
                        // This prevents a static "visible: 1" track in a newer clip from 
                        // overriding the "hidden during return" logic in an earlier clip.
                        const newHasTransition = track.values.some(v => v !== track.values[0]);
                        const oldHasTransition = existing.track.values.some(v => v !== existing.track.values[0]);

                        if (newHasTransition && !oldHasTransition) {
                            // The newer track (earlier in loop index, but later in clip order)
                            // is dynamic? No, i goes from length-1 to 0.
                            // i = length-1 is the LAST clip.
                            // So 'track' is from an EARLIER clip if i is smaller.
                            // Wait, the loop is Decending.
                            // i = length-1 (Last clip) -> seenTracks gets its tracks.
                            // i = length-2 (Previous clip) -> if matches, seenTracks keeps existing.
                            
                            // We WANT to prefer the dynamic track regardless of order.
                            console.log(`[Renderer] 🔀 Prioritizing dynamic visibility track for ${track.name} from "${clip.name}" over static track from "${existing.clip}"`);
                            seenTracks.set(track.name, { clip: clip.name, track });
                            // This requires a second pass or complex marking.
                        }
                    }
                });
            }

            // [SCADA] Resolve and bake clips
            // Since we prioritized tracks, we just re-assemble the clips from the map.
            const clipsByTrack = new Map(); // clipName -> [tracks]
            seenTracks.forEach(({ clip, track }) => {
                if (!clipsByTrack.has(clip)) clipsByTrack.set(clip, []);
                clipsByTrack.get(clip).push(track);
            });

            gltf.animations.forEach(originalClip => {
                const tracks = clipsByTrack.get(originalClip.name);
                if (!tracks || tracks.length === 0) {
                    console.log(`[Renderer] ▶ Skipping clip "${originalClip.name}" (all tracks overridden)`);
                    return;
                }

                const playable = new THREE.AnimationClip(originalClip.name, originalClip.duration, tracks);
                const action = this.mixer.clipAction(playable);
                action.setLoop(THREE.LoopRepeat, Infinity);
                action.clampWhenFinished = false;
                action.play();
                console.log(`[Renderer] ▶ Playing "${originalClip.name}" (${tracks.length}/${originalClip.tracks.length} tracks)`);
            });

            console.log(`[Renderer] Animated nodes:`, [...animatedNodeNames]);
        }

        let baseWarningMesh = null;
        this.model.traverse(c => {
            // Store originalMaterial on ALL meshes so isolateGroup can ghost them
            if (c.isMesh && !c.userData.originalMaterial) {
                c.userData.originalMaterial = Array.isArray(c.material)
                    ? c.material.slice() : c.material;
            }

            if (!c.name) return;
            const normName = c.name.toLowerCase();
            if (normName === 'error' || normName === 'warning') {
                if (!baseWarningMesh) baseWarningMesh = c.clone();
                c.visible = false;
                return;
            }

            this.nodeRegistry.set(normName, c);
            this.normNodeRegistry.set(normName.replace(/[^a-z0-9]/g, ''), c);

            if (c.isMesh) {
                this.meshRegistry.set(normName, c);
            }
        });

        this.baseWarningMesh = baseWarningMesh;
        this.model.updateMatrixWorld(true);

        this._updateHitZones();
        this.resetInteraction();
        return gltf;
    }

    _updateHitZones() {
        if (this.hitGroup) this.scene.remove(this.hitGroup);
        this.hitGroup = new THREE.Group();
        this.scene.add(this.hitGroup);
        this.hitBoxMeshes = [];

        const createdIds = new Set();

        for (const [id, targetName] of Object.entries(this.manualMap)) {
            if (!targetName) continue;

            // Deduplicate — multiple manualMap keys resolve to same device
            const normId = id.replace(/[^a-z0-9]/g, '');
            if (createdIds.has(normId)) continue;

            // RAWMATERIALS: combine all storage-prefixed nodes into one hitbox
            if (normId === 'rawmaterials' || normId.startsWith('storage') || normId.startsWith('inbound') || normId.startsWith('buffer')) {
                if (createdIds.has('rawmaterials')) continue;
                createdIds.add('rawmaterials');

                const combinedBox = new THREE.Box3();
                this.nodeRegistry.forEach((node, name) => {
                    if (name.startsWith('storage')) {
                        // FIX: Only include static components in the hitbox.
                        // If a node has animated descendants or is animated itself,
                        // we drill down to its static meshes.
                        const addStatic = (n) => {
                            if (n.userData.isAnimated) return;
                            if (n.userData.hasAnimatedDescendant) {
                                n.children.forEach(addStatic);
                            } else if (n.isMesh) {
                                combinedBox.union(new THREE.Box3().setFromObject(n));
                            }
                        };
                        addStatic(node);
                    }
                });
                if (combinedBox.isEmpty()) continue;
                combinedBox.expandByScalar(0.2);

                const size = new THREE.Vector3();
                combinedBox.getSize(size);
                const center = new THREE.Vector3();
                combinedBox.getCenter(center);

                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(size.x, size.y, size.z),
                    new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 })
                );
                mesh.position.copy(center);
                mesh.userData.deviceId = 'rawmaterials';
                this.hitGroup.add(mesh);
                this.hitBoxMeshes.push(mesh);
                continue;
            }

            createdIds.add(normId);
            const node = this.nodeRegistry.get(targetName.toLowerCase());
            if (!node) continue;

            const box = new THREE.Box3().setFromObject(node);
            if (box.isEmpty()) continue;
            box.expandByScalar(0.2);

            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);

            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(size.x, size.y, size.z),
                new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 })
            );
            mesh.position.copy(center);
            mesh.userData.deviceId = id;
            this.hitGroup.add(mesh);
            this.hitBoxMeshes.push(mesh);
        }
    }

    selectDevice(id) {
        if (!id || !window.app) return;
        const upperId = id.toUpperCase();

        // Toggle: if same device is already selected, deselect
        if (this._selectedDeviceId === upperId) {
            this._selectedDeviceId = null;
            this.clearHighlights();
            window.app.setContext('plant');
        } else {
            this._selectedDeviceId = upperId;
            this.setHighlight(id, true);
            window.app.setContext('machine', upperId);
        }
    }

    focusOnDevice(id) {
        this.focusOnMachine(id);
    }

    focusOnMachine(id) {
        let targetZoom = null;
        if (window.app) {
            const mode = (window.app.primaryMode || '').toLowerCase();
            const noZoomModes = ['zones', 'energy', 'maintenance', 'alarm', 'alarms'];
            if (noZoomModes.includes(mode)) {
                console.log(`[Renderer] Panning only (No Zoom) for mode: ${mode}`);
                targetZoom = this.camera.zoom; // Keep current zoom
                this.isolateGroup([id]); // Keep visual highlight
            }
        }

        const mesh = this.findMesh(id);
        if (!mesh) return;

        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const isometricOffset = new THREE.Vector3().subVectors(this.defaultPosition, this.defaultTarget);
        const cameraTargetPosition = center.clone().add(isometricOffset);

        const customZoom = this.customZooms[id.toLowerCase()] || 3.5;
        const finalZoom = targetZoom !== null ? targetZoom : customZoom;
        this.animateCamera(cameraTargetPosition, center, finalZoom);
    }

    focusOnZone(zoneId) {
        if (!window.app || !window.app.machineGroups) return;
        const machines = window.app.machineGroups[zoneId];
        if (machines && machines.length) {
            const allNodes = [];
            machines.forEach(mid => {
                const devNodes = this._getDeviceNodes(mid);
                devNodes.forEach(({ node }) => allNodes.push(node));
            });
            if (allNodes.length) this.frameGroup(allNodes);
        }
    }

    frameGroup(nodes) {
        if (!nodes || nodes.length === 0) return;
        const bounds = new THREE.Box3();
        nodes.forEach(n => bounds.union(new THREE.Box3().setFromObject(n)));
        
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        const size = new THREE.Vector3();
        bounds.getSize(size);

        const aspect = window.innerWidth / window.innerHeight;
        const maxDim = Math.max(size.x, size.y, size.z);
        let targetZoom = (this.viewSize * aspect) / (maxDim * 1.2);
        targetZoom = Math.max(0.8, Math.min(targetZoom, 2.5));

        const isometricOffset = new THREE.Vector3().subVectors(this.defaultPosition, this.defaultTarget);
        this.animateCamera(center.clone().add(isometricOffset), center, targetZoom);
    }

    animateCamera(targetPos, targetLookAt, targetZoom) {
        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const startZoom = this.camera.zoom;
        const startTime = performance.now();
        const duration = 2000;

        this.controls.enabled = false;

        const animate = (time) => {
            const t = Math.min((time - startTime) / duration, 1);
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

            this.camera.position.lerpVectors(startPos, targetPos, ease);
            this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
            this.camera.zoom = THREE.MathUtils.lerp(startZoom, targetZoom, ease);
            this.camera.updateProjectionMatrix();
            this.controls.update();

            if (t < 1) requestAnimationFrame(animate);
            else this.controls.enabled = true;
        };
        requestAnimationFrame(animate);
    }

    _collectActiveMeshes(deviceIds) {
        const activeMeshesSet = new Set();
        const activePrefixes = new Set();

        deviceIds.forEach(id => {
            const rawId = id.toLowerCase();

            // Resolve through manualMap to get the actual mesh name
            const mapped = (this.manualMap[rawId] || '').toLowerCase();

            // Special case: any storage/raw_materials/inbound/buffer ID → all storage meshes
            if (mapped.startsWith('storage') || rawId === 'rawmaterials' || rawId === 'raw_materials'
                || rawId.startsWith('storage') || rawId.startsWith('inbound') || rawId.startsWith('buffer')) {
                activePrefixes.add('storage');
            } else {
                // Use the resolved mesh name as prefix to catch sibling meshes
                if (mapped) {
                    activePrefixes.add(mapped);
                    activePrefixes.add(mapped.replace(/[^a-z0-9]/g, ''));
                }
                activePrefixes.add(rawId);
                activePrefixes.add(rawId.replace(/[^a-z0-9]/g, ''));
            }

            // Traverse children of the resolved node directly
            const node = this.findMesh(id);
            if (node) {
                node.traverse(n => {
                    if (n.isMesh) activeMeshesSet.add(n);
                });
            }

            // Exact associated mesh names (e.g., aluminium containers for degassers)
            const extraNames = this.associatedMeshNames[rawId];
            if (extraNames) {
                extraNames.forEach(name => {
                    const n = this.nodeRegistry.get(name.toLowerCase());
                    if (n) {
                        n.traverse(c => { if (c.isMesh) activeMeshesSet.add(c); });
                    }
                });
            }
        });

        // Prefix-match pass: catch sibling meshes sharing the resolved name prefix
        this.model.traverse(node => {
            if (node.isMesh && !activeMeshesSet.has(node)) {
                const nodeName = (node.name || '').toLowerCase();
                const nodeNorm = nodeName.replace(/[^a-z0-9]/g, '');
                for (const prefix of activePrefixes) {
                    if (nodeName.startsWith(prefix) || nodeNorm.startsWith(prefix)) {
                        activeMeshesSet.add(node);
                        return;
                    }
                }
            }
        });

        return activeMeshesSet;
    }

    _makeGhost(node) {
        if (!node.userData.ghostMat) {
            // [SCADA] Blueprint Ghosting — high transparency but retains subtle specular sheen
            node.userData.ghostMat = new THREE.MeshStandardMaterial({
                color: 0x4a5568, 
                transparent: true, 
                opacity: 0.1, 
                depthWrite: false,
                metalness: 0.2,
                roughness: 0.3
            });
        }
        const orig = node.userData.originalMaterial;
        if (Array.isArray(orig)) {
            node.material = orig.map(() => node.userData.ghostMat);
        } else {
            node.material = node.userData.ghostMat;
        }
    }

    _restoreOriginal(node) {
        if (!node.userData.originalMaterial) return;
        if (Array.isArray(node.userData.originalMaterial)) {
            node.material = node.userData.originalMaterial.slice();
        } else {
            node.material = node.userData.originalMaterial;
        }
    }

    isolateGroup(deviceIds) {
        if (!this.model) return;
        if (!deviceIds || deviceIds.length === 0) {
            console.log('[Renderer] isolateGroup(null) — restoring all textures');
            this.model.traverse(n => {
                if (n.isMesh && n.userData.originalMaterial) this._restoreOriginal(n);
            });
            return;
        }

        const activeMeshesSet = this._collectActiveMeshes(deviceIds);

        this.model.traverse(node => {
            if (node.isMesh && node.userData.originalMaterial) {
                // Never ghost animated objects or their ancestor containers (forklift, etc.)
                if (node.userData.isAnimated || node.userData.hasAnimatedDescendant || activeMeshesSet.has(node)) {
                    this._restoreOriginal(node);
                } else {
                    this._makeGhost(node);
                }
            }
        });
    }

    setAllGrey(exceptIds) {
        if (!this.model) return;
        const activeMeshesSet = exceptIds ? this._collectActiveMeshes(exceptIds) : new Set();

        this.model.traverse(node => {
            if (node.isMesh && node.userData.originalMaterial) {
                // Never ghost animated objects or their ancestor containers (forklift, etc.)
                if (node.userData.isAnimated || node.userData.hasAnimatedDescendant || activeMeshesSet.has(node)) {
                    this._restoreOriginal(node);
                } else {
                    this._makeGhost(node);
                }
            }
        });
    }

    resetInteraction() {
        this._selectedDeviceId = null;
        this.clearHighlights();
        this.isolateGroup(null);
        this.resetToDefaultView();
        this.labelRegistry.forEach(l => l.element.style.display = 'block');
    }

    resetToDefaultView() {
        this.animateCamera(this.defaultPosition, this.defaultTarget, this.defaultZoom);
    }

    setChipDisplayMode(mode) {
        this.chipDisplayMode = mode;
        this.labelRegistry.forEach((obj, id) => {
            const data = this.persistentValues.get(id);
            if (data) this.updateDeviceLabel(id, data);
        });
    }

    updateDeviceLabel(rawId, data) {
        let id = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (id.includes('storage') || id.includes('inbound') || id.includes('raw')) id = 'RAWMATERIALS';
        else id = id.toUpperCase();

        this.persistentValues.set(id, data);

        // [USER] Constraint: Do not render individual machine icons
        if (!this.showMachineLabels) {
            // Remove existing if any
            const existing = this.labelRegistry.get(id);
            if (existing) {
                this.scene.remove(existing.object);
                this.labelRegistry.delete(id);
            }
            return;
        }

        let mesh = this.findMesh(id);
        if (id === 'RAWMATERIALS') mesh = this.nodeRegistry.get('storage_01006') || mesh;
        if (!mesh) return;

        // [FIX] Asset Info Lookup for Icon Mapping
        const assetInfo = (this.app && this.app._findAsset) ? this.app._findAsset(id) : null;
        if (assetInfo) {
            console.log(`[Renderer] Matched Asset: ${id} -> Icon: ${assetInfo.icon}`);
        } else {
            console.warn(`[Renderer] No Asset data for ID: ${id}`);
        }

        let labelItem = this.labelRegistry.get(id);
        if (!labelItem) {
            const div = document.createElement('div');
            div.className = 'machine-chip';
            // Start with a skeleton and populate dynamically
            div.innerHTML = `
                <div class="chip-header">
                    <span class="chip-status-dot material-symbols-outlined">settings</span>
                </div>
                <div class="chip-unified-value"></div>
                <div class="chip-val" style="display: none;"></div>
            `;
            div.onclick = () => window.app.setContext('machine', id);
            const obj = new CSS2DObject(div);
            this.scene.add(obj);
            labelItem = { element: div, object: obj };
            this.labelRegistry.set(id, labelItem);
        }

        const el = labelItem.element;

        // [FIX] Dynamic Icon and Status Update
        const dotIndicator = el.querySelector('.chip-status-dot');
        if (dotIndicator) {
            const iconName = (assetInfo && assetInfo.icon) ? assetInfo.icon : 'settings';
            if (dotIndicator.textContent !== iconName) {
                dotIndicator.textContent = iconName;
            }

            // [FIX] Use unified state resolution from App to ensure consistency with sidebar and zone views
            const resolvedState = (this.app ? this.app._getMachineState(id) : 'UNKNOWN').toString().toUpperCase();
            const isRunning = resolvedState === 'RUNNING' || resolvedState === 'NORMAL' || resolvedState === 'ONLINE';
            dotIndicator.className = `chip-status-dot material-symbols-outlined ${isRunning ? 'running' : 'stopped'}`;
        }

    }

    /**
     * [USER] Create high-level departmental zone icons and engraved floor names
     */
    _createZoneIcons(machineGroups) {
        if (!machineGroups || !this.model) return;

        // Zone icon derived from the first machine's asset icon in that zone
        const zoneIconMap = {};
        for (const [zoneId, machines] of Object.entries(machineGroups)) {
            let icon = 'settings';
            if (this.app && this.app._findAsset) {
                for (const mid of machines) {
                    const asset = this.app._findAsset(mid);
                    if (asset && asset.icon) { icon = asset.icon; break; }
                }
            }
            zoneIconMap[zoneId] = icon;
        }

        const zoneNames = {
            'logistics': 'LOGISTICS & RAW MATERIALS',
            'smelting': 'SMELTING DEPT',
            'die_casting': 'DIE CASTING',
            'qc': 'QUALITY ASSURANCE',
            'heat_treating': 'HEAT TREATMENT',
            'machining': 'MACHINING UNIT',
            'paint_shop': 'FINISHING SHOP',
            'shipping': 'SHIPPING'
        };

        // Clear existing zone icons and names
        this.zoneLabelRegistry.forEach(obj => this.scene.remove(obj));
        this.zoneLabelRegistry.clear();
        this.zoneNameRegistry.forEach(obj => this.scene.remove(obj));
        this.zoneNameRegistry.clear();
        this.zoneRegistry.clear();

        for (const [zoneId, machines] of Object.entries(machineGroups)) {
            const zoneBox = new THREE.Box3();
            let hasNodes = false;

            machines.forEach(mid => {
                const devNodes = this._getDeviceNodes(mid);
                devNodes.forEach(({ node }) => {
                    zoneBox.union(new THREE.Box3().setFromObject(node));
                    hasNodes = true;
                });
            });

            if (!hasNodes) continue;
            
            // [USER] Increase zone bounding boxes for more generous hover detection
            zoneBox.expandByScalar(1.5);
            this.zoneRegistry.set(zoneId, zoneBox);

            const centerVec = new THREE.Vector3();
            zoneBox.getCenter(centerVec);

            // [USER] Consolidated Zone Label: Icon + Name in one camera-facing chip
            const iconDiv = document.createElement('div');
            iconDiv.className = 'zone-chip-wrapper';
            iconDiv.style.pointerEvents = 'auto';
            iconDiv.style.cursor = 'pointer';

            const zoneState = this.app ? this.app._getZoneState(zoneId) : 'RUNNING';
            const isRunning = zoneState === 'RUNNING' || zoneState === 'NORMAL' || zoneState === 'ONLINE';
            const statusClass = isRunning ? 'running' : 'stopped';
            const icon = zoneIconMap[zoneId] || 'settings';
            const name = zoneNames[zoneId] || zoneId.toUpperCase();

            iconDiv.innerHTML = `
                <div class="machine-chip">
                    <div class="chip-header">
                        <span class="chip-status-dot material-symbols-outlined ${statusClass}">${icon}</span>
                    </div>
                </div>
                <div class="zone-name-label-plain">${name}</div>
            `;
            iconDiv.onclick = () => window.app.setContext('zone', zoneId);

            const iconLabel = new CSS2DObject(iconDiv);
            iconLabel.position.set(centerVec.x, zoneBox.max.y + 1.2, centerVec.z);
            this.scene.add(iconLabel);
            this.zoneLabelRegistry.set(zoneId, iconLabel);
        }
    }

    onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera.left = -aspect * this.viewSize / 2;
        this.camera.right = aspect * this.viewSize / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    applyUpdatedIds(ids) {
        if (!ids) return;
        ids.forEach(id => this.pendingLabelIds.add(id));
    }

    start() {
        // [ANIM] Reset clock right before loop starts to prevent
        // a huge initial delta (clock was created in constructor, seconds ago)
        this.clock.start();

        const loop = () => {
            requestAnimationFrame(loop);
            this.controls.update();

            // [ANIM] Update AnimationMixer with delta time
            if (this.mixer) {
                const delta = this.clock.getDelta();
                this.mixer.update(delta);
            }

            // [PERF] Label Update Batching
            if (this.pendingLabelIds.size > 0) {
                const LABELS_PER_FRAME = 3;
                let n = 0;
                for (const id of this.pendingLabelIds) {
                    const state = this.stateManager.getDeviceState(id);
                    if (state) this.updateDeviceLabel(id, state.data);
                    this.pendingLabelIds.delete(id);
                    if (++n >= LABELS_PER_FRAME) break;
                }
            }

            this.handleHover();
            this._updateCoordinateTracker();

            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        };
        loop();
    }

    findMesh(id) {
        if (!id) return null;
        const norm = id.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (this.manualMap[id]) return this.nodeRegistry.get(this.manualMap[id]);
        return this.normNodeRegistry.get(norm) || null;
    }

    identifyCameraParameters() {
        const pos = this.camera.position;
        const tar = this.controls.target;
        const off = new THREE.Vector3().subVectors(pos, tar);
        const dist = off.length();
        const hAngle = THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z));
        const vAngle = THREE.MathUtils.radToDeg(Math.asin(off.y / dist));
        return { hAngle: hAngle.toFixed(1), vAngle: vAngle.toFixed(1), distance: dist.toFixed(1) };
    }

    refreshAllLabels() {
        if (this.persistentValues.size === 0) return;
        console.log(`[Renderer] Force refreshing ${this.persistentValues.size} labels...`);
        for (const [id, data] of this.persistentValues.entries()) {
            this.updateDeviceLabel(id, data);
        }
    }
}

export default Renderer;
