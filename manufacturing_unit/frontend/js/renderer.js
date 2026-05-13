import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { colorForState } from './stateManager.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MANUAL_MAP, ASSOCIATED_MESH_NAMES, ANIMATION_GROUPS, CUSTOM_ZOOMS } from './config/RendererMappings.js';


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
        this.highlightRegistry = new Map();      // normalized machine id -> highlight mesh (from GLB `highlight_*`)
        this.zoneHighlightRegistry = new Map();  // app zone id -> zone highlight mesh (from GLB `*_zone_highlight`)
        this._lastMachineHighlight = null;
        this._lastZoneHighlight = null;
        this.hoveredDeviceId = null;
        this.hoverTimeout = null;
        this.pendingHoverId = null;
        this.hitGroup = null;
        this.hitBoxMeshes = [];
        this.highlightState = new Map(); // Source of Truth for highlights
        this.lastHovered = null;         // Debounce guard
        this.elevationAnims = new Map(); // [FIX] Required by hover stabilization logic
        this._selectionBoxHelpers = []; // Persistent Box3Helpers for name-pill bbox display; cleared by Home
        this._pinnedZoneId = null;       // Zone whose highlights are pinned by name-pill click
        this._pinnedHighlights = new Set(); // GLB highlight meshes (zone + machines) pinned visible

        // Manual mapping overrides for known discrepancies
        this.manualMap = MANUAL_MAP;

        // Exact extra mesh names that belong to a device but don't share its name prefix
        this.associatedMeshNames = ASSOCIATED_MESH_NAMES;

        // Animation groups: each animated node belongs to one or more logical
        // devices.
        this.animationGroups = ANIMATION_GROUPS;

        // Fresnel overlay system has been removed. Hover feedback is handled
        // purely by machine elevation; cross-zone isolation by ghost materials.

        this.persistentValues = new Map();
        this.chipDisplayMode = 'none';
        this._selectedDeviceId = null;

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pointerMoved = false;

        // [PRECISION] Custom Camera Zoom Map
        this.customZooms = CUSTOM_ZOOMS;

        this.lastCameraZoom = 0;
        this.lastCameraPos = new THREE.Vector3();
        this.frameCounter = 0;
        this.interpolatedValues = new Map();
        this.pendingLabelIds = new Set();
        this.lastZoneRefresh = 0; // [USER] Throttle for high-level status blinking

        this.init();
        this.setupInteraction();
    }

    _viewportSize() {
        const w = (this.container?.clientWidth) || window.innerWidth;
        const h = (this.container?.clientHeight) || window.innerHeight;
        return { w, h };
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0d1117);

        this.viewSize = 40;
        const { w: vpW, h: vpH } = this._viewportSize();
        const aspect = vpW / vpH;
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
        this.defaultZoom = 1.0;

        this.camera.up.set(0, 1, 0);
        this.camera.position.copy(this.defaultPosition);
        this.camera.lookAt(this.defaultTarget);
        this.camera.zoom = this.defaultZoom;
        this.camera.updateProjectionMatrix();

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(vpW, vpH);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0; // [SCADA] Increased to 1.0 to match Blender viewport depth
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);



        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(vpW, vpH);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(this.defaultTarget);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        // OrbitControls' built-in wheel handler always preventDefaults — it
        // would swallow Chromium's Ctrl+wheel page zoom along with the scene
        // zoom. Keep its handler disabled and install our own below that
        // defers to the browser when Ctrl is held.
        this.controls.enableZoom = false;
        this.controls.minZoom = 0.55;
        this.controls.maxZoom = 12.0;
        this.controls.update();

        this.renderer.domElement.style.touchAction = 'auto';

        // [SCROLL-ZOOM] Wheel zooms the orthographic camera; Ctrl+wheel falls
        // through to Chromium's native page zoom.
        this.renderer.domElement.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            // Cancel any in-flight camera animation so the user's manual zoom
            // takes immediate effect instead of fighting the lerp.
            if (this._cameraAnimId) {
                cancelAnimationFrame(this._cameraAnimId);
                this._cameraAnimId = null;
                this.controls.enabled = true;
            }
            // Multiplicative step → consistent feel across deltaMode values
            // (pixel vs line vs page). 0.0015 per pixel gives ~10 % per notch.
            const step = Math.exp(-e.deltaY * 0.0015);
            const next = this.camera.zoom * step;
            this.camera.zoom = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, next));
            this.camera.updateProjectionMatrix();
        }, { passive: false });

        window.addEventListener('resize', () => this.onWindowResize());
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this.onWindowResize());
            this._resizeObserver.observe(this.container);
        }
        this._setupCoordinateTracker();
        this._initEnvironment();
    }

    _initEnvironment() {
        if (!this.renderer || !this.scene) return;

        // [SCADA] Realistic HDRI Loader (Adams Place Bridge)
        // Replaces generated environments with real-world HDR data from project assets
        new EXRLoader().load('assets/textures/textures/adams_place_bridge_2k.exr', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;

            this.scene.environment = envMap;
            this.scene.environmentIntensity = 1.0;

            texture.dispose();
            pmremGenerator.dispose();
            console.log('[Renderer] HDRI Environment loaded successfully.');
        }, undefined, (err) => {
            console.warn('[Renderer] Failed to load EXR environment:', err);
            const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
            this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 1.0).texture;
            pmremGenerator.dispose();
        });

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
        dirLight.position.set(40, 60, 40);
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
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    onPointerClick(event) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);

        if (intersects.length > 0) {
            const deviceId = intersects[0].object.userData.deviceId;
            if (deviceId) this.selectDevice(deviceId);
        }
        // Empty-space clicks no longer reset; the Home button is the sole reset path.
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

            // [HOVER-HIGHLIGHT] Logic is now handled centrally by setHighlight/clearHighlights
            // called above. This prevents the previous "tug-of-war" where hover logic
            // would overwrite selection logic.
            if (hoveredId) {
                // Machine-level hover wins over zone-level hover: hide any
                // zone highlight while a specific machine is targeted.
                if (this._lastZoneHighlight && !this._pinnedHighlights.has(this._lastZoneHighlight)) {
                    this._lastZoneHighlight.visible = false;
                }
            } else if (this._lastZoneHighlight && this.hoveredZoneId) {
                // No machine hover — restore the current zone highlight
                this._lastZoneHighlight.visible = true;
            }

            // [USER] Machine elevation on hover has been removed — the GLB
            // wireframe highlight overlay is now the sole hover affordance.
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

            // [HOVER-HIGHLIGHT] Reveal GLB-baked zone highlight mesh
            if (this._lastZoneHighlight && !this._pinnedHighlights.has(this._lastZoneHighlight)) {
                this._lastZoneHighlight.visible = false;
            }
            this._lastZoneHighlight = null;
            if (newHoveredZoneId) {
                const zhl = this.zoneHighlightRegistry.get(newHoveredZoneId);
                if (zhl) {
                    // Only reveal the zone outline if no specific machine is
                    // currently hovered — machine highlight takes precedence.
                    if (!this._pinnedHighlights.has(zhl) || !this.lastHovered) {
                        zhl.visible = !this.lastHovered || this._pinnedHighlights.has(zhl);
                    }
                    this._lastZoneHighlight = zhl;
                }
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

        // [SCADA] Logistics Collection: treat storage/inbound/raw_materials as one unit
        const isLogisticsGroup = mapped.includes('storage') || mapped.includes('inbound') || mapped.includes('raw_materials') || mapped.includes('rawmaterials');

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
        // [OWNERSHIP] When the device is indexed (e.g. degasser_01), a node may
        // be NAMED with our prefix yet be scene-graph-parented under a sibling
        // instance (e.g. `degasser_01_spinner.001` re-parented under
        // degasser_02 by Blender). Walking the ancestry and checking for a
        // foreign sibling-instance name lets us reject those misclassified
        // seeds — selection then no longer leaks textures across instances.
        const isAncestorForeignSibling = (node) => {
            if (!index) return false;
            let p = node.parent;
            while (p && p !== this.model) {
                const pn = (p.name || '').toLowerCase();
                if (pn) {
                    const looksLikeSameFamily = pn.includes(basePrefix);
                    if (looksLikeSameFamily) {
                        const ownIdx = pn.match(/_(\d+)/);
                        if (ownIdx && ownIdx[1] !== index) return true;
                    }
                }
                p = p.parent;
            }
            return false;
        };

        // Reject a seed whose OWN name encodes a foreign instance index. This
        // catches `heat_02.001` (parent group `heat` carries no index, so
        // ancestor-walking can't disambiguate) when heat_01 is selected.
        const hasForeignOwnIndex = (nameLower) => {
            if (!index) return false;
            if (!nameLower.includes(basePrefix)) return false;
            const m = nameLower.match(/_(\d+)/);
            return !!(m && m[1] !== index);
        };

        this.nodeRegistry.forEach((node, name) => {
            const nameLower = name.toLowerCase();
            const nameNorm = nameLower.replace(/[^a-z0-9]/g, '');

            // 1. Literal Prefix Match (covers "finishing_shop")
            let isMatch = nameLower.startsWith(mapped) ||
                nameNorm.startsWith(mappedNorm) ||
                nameNorm.startsWith(normSearch);

            // 1b. Logistics group — works for the bare `rawmaterials` id which
            // has no numeric index, so it must run independently of the
            // index-gated branch below.
            if (!isMatch && isLogisticsGroup &&
                (nameLower.includes('storage') || nameLower.includes('inbound') ||
                 nameLower.includes('buffer') || nameLower.includes('raw_materials') ||
                 nameLower.includes('rawmaterials'))) {
                isMatch = true;
            }

            // 2. Instance-Aware Match (covers "furnace_body_01" for "furnace_01")
            if (!isMatch && index) {
                const nameHasPrefix = nameLower.includes(basePrefix);
                const nameHasIndex = nameLower.includes(index) || nameNorm.includes(index);
                if (nameHasPrefix && nameHasIndex) isMatch = true;
            }

            // 3. [OWNERSHIP] Reject seeds whose scene-graph ancestor belongs to
            // a sibling instance — fixes degasser_01_spinner.001 which is
            // named with degasser_01 but parented under degasser_02.
            if (isMatch && isAncestorForeignSibling(node)) isMatch = false;
            // 3b. Reject seeds whose own name carries a foreign instance index
            // (heat_02.001 sneaking into heat_01 selection via the bare
            // 'heat' prefix match).
            if (isMatch && hasForeignOwnIndex(nameLower)) isMatch = false;

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
        // For every "seed" node found above, we check its parent. If the
        // parent group is unambiguously this instance's container, harvest
        // all its children to catch oddly-named associated parts.
        //
        // [FIX] Indexed instances (e.g. degasser_01, degasser_02) often share
        // a single parent group named with just the base prefix
        // (`degassers`). Expanding on `pName.includes(basePrefix)` alone
        // pulls in sibling instances' meshes — selecting degasser_01 then
        // leaks degasser_02's textures. So when an index is present, the
        // parent must also carry that index in its name to qualify.
        const seeds = [...nodes];
        seeds.forEach(({ node }) => {
            let p = node.parent;
            if (p && p !== this.model && (p.isGroup || p.isObject3D)) {
                const pName = (p.name || '').toLowerCase();
                const pNameNorm = pName.replace(/[^a-z0-9]/g, '');

                let parentOwnsInstance;
                if (index) {
                    // Indexed device — require parent name to carry the index
                    parentOwnsInstance = (pName.includes(index) || pNameNorm.includes(index)) &&
                        (pName.includes(basePrefix) || pNameNorm.includes(basePrefix.replace(/[^a-z0-9]/g, '')));
                } else {
                    // Non-indexed — full mapped name match is required
                    parentOwnsInstance = pName.includes(mapped) || pNameNorm.includes(mappedNorm);
                }

                if (parentOwnsInstance) {
                    p.traverse(c => {
                        if (c.isMesh) addNode(c.name.toLowerCase(), c);
                    });
                }
            }
        });

        // Final Filter: Prevent double-displacement by only elevating the root-most nodes
        const rootNodes = nodes.filter(({ node }) => {
            let p = node.parent;
            while (p && p !== this.model) {
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
        this.highlightRegistry.forEach(hl => {
            if (!this._pinnedHighlights.has(hl)) hl.visible = false;
        });
        this._lastMachineHighlight = null;
    }

    setHighlight(deviceId, isActive = true) {
        if (!isActive) {
            this.clearHighlights();
            return;
        }

        // Hide any previously-shown highlight before revealing the new one —
        // otherwise hovering machine→machine leaves the old outline on.
        // Pinned highlights (from a name-pill click) stay visible.
        this.highlightRegistry.forEach(hl => {
            if (!this._pinnedHighlights.has(hl)) hl.visible = false;
        });

        const normId = deviceId.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = this.manualMap[deviceId.toLowerCase()] || deviceId;
        const targetLower = target.toLowerCase();
        const targetNorm = targetLower.replace(/[^a-z0-9]/g, '');

        // [SCADA] Logistics Collection: treat storage/inbound/raw_materials as one unit
        const isLogisticsGroup = targetNorm.includes('storage') || targetNorm.includes('inbound') || targetNorm.includes('rawmaterials');

        this.highlightState.clear();
        if (deviceId) this.highlightState.set(deviceId, 1.0);

        // [SCADA] Logical Grouping: Resolve the highlight key by checking
        // if the component belongs to a larger group (like Raw Materials).
        let hlKey = targetNorm;
        if (isLogisticsGroup) hlKey = 'rawmaterials';
        else if (targetNorm === 'preteatment' || targetNorm.includes('pretreat')) hlKey = 'pretreat';
        else if (targetNorm.includes('furnace')) hlKey = 'furnace';
        else if (targetNorm.includes('heat')) hlKey = 'heat';
        else if (!this.highlightRegistry.has(hlKey)) hlKey = normId;

        let hl = this.highlightRegistry.get(hlKey) || this.highlightRegistry.get(normId);
        if (!hl && isLogisticsGroup) hl = this.highlightRegistry.get('raw_materials');
        if (!hl) {
            // [FALLBACK] No GLB-baked highlight — synthesize a wireframe box
            // from the device bounds and cache it. Fixes raw-materials hover
            // (no `highlight_rawmaterials` mesh in the GLB) and any other
            // device whose highlight asset is missing.
            hl = this._buildFallbackHighlight(deviceId, hlKey);
            if (hl) this.highlightRegistry.set(hlKey, hl);
        }

        if (hl) {
            hl.visible = true;
            this._lastMachineHighlight = hl;
        } else {
            this._lastMachineHighlight = null;
        }
    }

    _buildFallbackHighlight(deviceId, cacheKey) {
        if (!this.model) return null;
        const nodes = this._getDeviceNodes(deviceId);
        const box = new THREE.Box3();
        if (nodes.length) {
            nodes.forEach(({ node }) => {
                node.traverse(c => {
                    if (c.isMesh && !c.userData.isAnimated && !c.userData.isHighlight) {
                        box.union(new THREE.Box3().setFromObject(c));
                    }
                });
            });
        }

        // [FALLBACK-LOGISTICS] If the device resolver missed every node (e.g.
        // bare `rawmaterials` id with no numeric suffix), walk the node
        // registry directly for storage/inbound/buffer prefixes and union
        // their static meshes into the box.
        const normId = (deviceId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (box.isEmpty() && (normId === 'rawmaterials' || cacheKey === 'rawmaterials')) {
            this.nodeRegistry.forEach((node, name) => {
                if (name.startsWith('storage') || name.startsWith('inbound') || name.startsWith('buffer')) {
                    node.traverse(c => {
                        if (c.isMesh && !c.userData.isAnimated && !c.userData.isHighlight) {
                            box.union(new THREE.Box3().setFromObject(c));
                        }
                    });
                }
            });
        }

        if (box.isEmpty()) return null;

        box.expandByScalar(0.25);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
        const edges = new THREE.EdgesGeometry(geom);
        const mat = new THREE.LineBasicMaterial({
            color: 0xffa726,
            transparent: true,
            opacity: 1.0,
            depthTest: true,
            depthWrite: false
        });
        const lines = new THREE.LineSegments(edges, mat);
        lines.position.copy(center);
        lines.frustumCulled = false;
        lines.renderOrder = 999;
        lines.userData.isHighlight = true;
        lines.userData.highlightMeshes = [lines];
        lines.userData.baseEmissive = 1;
        lines.userData.fallbackHighlightFor = cacheKey;
        lines.visible = false;
        this.scene.add(lines);
        return lines;
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
    setStorageFillLevel(_deviceId, _level) { }

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
        const angle = THREE.MathUtils.degToRad(45); // [USER] Threshold set to 45° for precise industrial edges

        root.traverse(node => {
            if (node.isMesh && node.geometry) {
                // Skip highlight overlays — their geometry must stay as-authored
                // so EdgesGeometry produces clean box outlines, not the
                // vertex-split output of toCreasedNormals.
                if (node.userData.isHighlight) { count++; return; }

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

                // [SCADA] GLB Fidelity Restoration
                // We rely on the authored material properties (roughness, metalness, and KHR_materials_emissive_strength)
                // from the GLB file rather than applying manual overrides.
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    mats.forEach(m => {
                        // Inherit from GLB authored values (Standard/Physical materials)
                        // [USER] Ensure environment map intensity is normalized for PBR fidelity
                        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
                            m.envMapIntensity = 1.0;
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
                    // Correctly supports node names with dots (e.g. forklift.001)
                    const lastDot = track.name.lastIndexOf('.');
                    const path = lastDot !== -1 ? track.name.substring(0, lastDot) : track.name;
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

        // [HOVER-HIGHLIGHT] Tag highlight meshes BEFORE _setupStaticProperties
        // so its toCreasedNormals pass skips them (vertex-splitting corrupts
        // the clean box geometry that EdgesGeometry needs).
        this.model.traverse(c => {
            if (!c.name) return;
            const n = c.name.toLowerCase();
            if (n.endsWith('_zone_highlight') || n.startsWith('highlight_')) {
                c.userData.isHighlight = true;
                // Tag any mesh descendants too — multi-primitive GLTF meshes
                // are loaded as Groups whose children need the same flag.
                c.traverse(ch => { ch.userData.isHighlight = true; });
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

        // [HOVER-HIGHLIGHT] GLB ships pre-baked yellow highlight meshes:
        //   - `<glb_zone>_zone_highlight`  → shown on zone hover
        //   - `highlight_<machine_id>`     → shown on machine hover
        // Tag them so the hover logic can reveal them and the ghosting/elevation
        // passes skip them. Must run before the nodeRegistry traverse so they
        // are NOT indexed as device nodes (which would cause them to elevate
        // with the machine they highlight).
        const GLB_ZONE_TO_APP = {
            'cnc': 'machining',
            'die_casting': 'die_casting',
            'finishing': 'finishing',
            'heat': 'heat_treatment',
            'inspection': 'quality_control',
            'raw_materials': 'raw_materials',
            'smelting': 'smelting',
            'outbound': 'shipping'
        };
        // Build an orange edge-wireframe (LineSegments) from each highlight
        // mesh's geometry — mirrors the Blender authoring look where highlights
        // read as sharp outlines, not filled yellow blocks. The original filled
        // mesh stays hidden permanently; only the LineSegments toggles on hover.
        // [FLOOR] Several GLB materials (e.g. `M_floor_grey`, `fl_black`, the
        // LPDC mezzanine slab, sky/backdrop planes) ship with no
        // baseColorFactor — GLTF defaults that to white `[1,1,1,1]`. With the
        // RoomEnvironment IBL + envMapIntensity=1.5 from `_setupStaticProperties`,
        // those surfaces render as bright mirror-white. GLTF 2.0 encodes no
        // world/background (Blender's World shader + Strength is viewport-only
        // and is NOT exported to .glb), so this must be fixed in Three.js.
        // Pass 1: explicit named floor/backdrop materials → dark diffuse.
        // Pass 2: any remaining non-highlight material whose color is still
        //         near-white AND has no baseColorTexture → dark diffuse.
        const FLOOR_COLOR = new THREE.Color(0x1a1a1a);
        const darkenedMats = new WeakSet();
        const darkenMaterial = (m) => {
            if (!m || darkenedMats.has(m)) return;
            if (m.color) m.color.copy(FLOOR_COLOR);
            if ('roughness' in m) m.roughness = 0.9;
            if ('metalness' in m) m.metalness = 0;
            if ('envMapIntensity' in m) m.envMapIntensity = 0.15;
            m.needsUpdate = true;
            darkenedMats.add(m);
        };
        const FLOOR_NAMES = new Set(['M_floor_grey', 'fl_black', 'Material', 'Material.006']);
        this.model.traverse(c => {
            if (!c.isMesh || !c.material || c.userData.isHighlight) return;
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(m => {
                if (m && m.name && FLOOR_NAMES.has(m.name)) darkenMaterial(m);
            });
        });

        // [HOVER-HIGHLIGHT] Use the authored GLB highlight meshes directly.
        // Each machine highlight (`highlight_*`) in the GLB shares one emissive
        // orange material (Material.011). Per-mesh clone is required — both
        // because the shared instance would propagate opacity/emissive pulse
        // to every sibling highlight, and because siblings might need
        // independent visibility at the same moment in the future.
        const configurePulseMaterial = (mesh) => {
            if (!mesh || !mesh.material) return null;
            const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const cloned = src.map(m => m.clone());
            cloned.forEach(m => {
                m.transparent = true;
                m.depthWrite = false;
                m.depthTest = true;   // machine meshes occlude the highlight
            });
            mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
            mesh.renderOrder = -1;    // draw before opaque machines at same depth
            mesh.frustumCulled = false;
            mesh.userData.isHighlight = true;
            mesh.userData.baseEmissive = cloned[0].emissiveIntensity ?? 1;
            return mesh;
        };

        // Configure every mesh under a highlight node (handles multi-primitive
        // zone highlight Groups as well as single-mesh machine highlights).
        const configureHighlightSubtree = (node) => {
            const meshes = [];
            node.traverse(ch => {
                if (ch.isMesh && ch.geometry) {
                    configurePulseMaterial(ch);
                    meshes.push(ch);
                }
            });
            node.userData.isHighlight = true;
            node.userData.highlightMeshes = meshes;
            node.visible = false;
            return node;
        };

        this.model.traverse(c => {
            if (!c.name) return;
            const n = c.name.toLowerCase();
            if (n.endsWith('_zone_highlight')) {
                const glbZone = n.replace('_zone_highlight', '');
                const appZone = GLB_ZONE_TO_APP[glbZone] || glbZone;
                configureHighlightSubtree(c);
                this.zoneHighlightRegistry.set(appZone, c);
            } else if (n.startsWith('highlight_')) {
                const machineNorm = n.replace(/^highlight_/, '').replace(/[^a-z0-9]/g, '');
                configureHighlightSubtree(c);
                this.highlightRegistry.set(machineNorm, c);
            }
        });

        let baseWarningMesh = null;
        this.model.traverse(c => {
            // Skip highlight meshes — not real devices, shouldn't participate
            // in device lookup, ghosting, or elevation.
            if (c.userData.isHighlight) return;

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
                    if (name.startsWith('storage') || name.startsWith('inbound') ||
                        name.startsWith('buffer') || name.includes('raw_materials') ||
                        name.includes('rawmaterials')) {
                        // Skip nodes that ARE the animated mover itself (storage_01.013
                        // travels with the forklift), but still include static siblings
                        // even if they share an animated ancestor.
                        if (node.userData.isAnimated) return;
                        const b = new THREE.Box3().setFromObject(node);
                        if (!b.isEmpty()) combinedBox.union(b);
                    }
                });
                if (combinedBox.isEmpty()) continue;
                combinedBox.expandByScalar(0.5);

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
            // Try exact node lookup first; otherwise fall back to the same
            // fuzzy resolver used for elevation/selection. Many GLB node names
            // don't match manualMap targets 1:1 (multi-part machines like
            // `furnace_01.001/.002/.003`, typo'd `preteatment`, parent groups
            // like `heat`, etc.) — without the fallback those devices have no
            // hitbox and can't be clicked.
            const box = new THREE.Box3();
            const exact = this.nodeRegistry.get(targetName.toLowerCase());
            if (exact) box.setFromObject(exact);

            const fuzzy = this._getDeviceNodes(id);
            fuzzy.forEach(({ node: n }) => box.union(new THREE.Box3().setFromObject(n)));

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

        // No toggle: re-clicking the same device is a no-op. The Home button is the sole reset.
        if (this._selectedDeviceId === upperId) return;

        this._selectedDeviceId = upperId;
        this.setHighlight(id, true);
        window.app.setContext('machine', upperId);
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

        // [FRAMING] Use the union of all mesh nodes for this device so the
        // camera frames the entire machine — not just the root mesh.
        // STATIC meshes only — animated transports (e.g. ladel_furnace.001
        // matches FURNACE_01's fuzzy resolver) drift across the plant during
        // their animation, and their mid-flight world position would inflate
        // the bounds, parking the camera far from the actual machine.
        const nodes = this._getDeviceNodes(id);
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        if (nodes.length) {
            nodes.forEach(({ node }) => {
                node.traverse(child => {
                    if (!child.isMesh) return;
                    if (child.userData.isAnimated) return;
                    tmp.setFromObject(child);
                    if (!tmp.isEmpty()) box.union(tmp);
                });
            });
            // Fallback if every mesh in the device is animated.
            if (box.isEmpty()) {
                nodes.forEach(({ node }) => box.union(new THREE.Box3().setFromObject(node)));
            }
        } else {
            const mesh = this.findMesh(id);
            if (!mesh) return;
            box.setFromObject(mesh);
        }
        if (box.isEmpty()) return;

        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);

        // [FRAMING] Auto-fit zoom so the machine fills the view with a 1m
        // safety margin on every side ("stop 1 meter before the end").
        if (targetZoom === null) {
            const { w, h } = this._viewportSize();
            const aspect = w / h;
            const margin = 2.0; // 2 meter padding around the mesh bounds for breathing room
            const fitW = size.x + 2 * margin;
            const fitH = size.y + 2 * margin;
            const fitD = size.z + 2 * margin;
            const horiz = Math.max(fitW, fitD); // ortho axis-aligned ground extent
            const zoomX = (this.viewSize * aspect) / horiz;
            const zoomY = this.viewSize / fitH;
            targetZoom = Math.min(zoomX, zoomY);
            // Clamp inside controls bounds
            targetZoom = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, targetZoom));
        }

        // [CAMERA] Forward/backward only — preserve the existing isometric
        // viewing angle by reusing the default offset vector. No orbit/rotation.
        const isometricOffset = new THREE.Vector3().subVectors(this.defaultPosition, this.defaultTarget);
        const cameraTargetPosition = center.clone().add(isometricOffset);

        this.animateCamera(cameraTargetPosition, center, targetZoom);
    }

    focusOnZone(zoneId, margin = 4.0) {
        if (!window.app || !window.app.machineGroups) return;
        const machines = window.app.machineGroups[zoneId];
        if (machines && machines.length) {
            const allNodes = [];
            machines.forEach(mid => {
                const devNodes = this._getDeviceNodes(mid);
                devNodes.forEach(({ node }) => allNodes.push(node));
            });
            if (allNodes.length) this.frameGroup(allNodes, margin);
        }
    }

    frameGroup(nodes, margin = 4.0) {
        if (!nodes || nodes.length === 0) return;

        // Build bounds from STATIC meshes only. Animated transports (forklift,
        // ladle) drift across the plant during their animation, and including
        // their current world position would balloon the framing — pressing
        // the zone-back arrow at the wrong moment would land on a camera
        // parked far from the actual zone. Skip anything tagged isAnimated.
        const bounds = new THREE.Box3();
        const tmp = new THREE.Box3();
        nodes.forEach(root => {
            root.traverse(child => {
                if (!child.isMesh) return;
                if (child.userData.isAnimated) return;
                tmp.setFromObject(child);
                if (!tmp.isEmpty()) bounds.union(tmp);
            });
        });
        // Fallback: if every mesh in this group is animated, fall back to
        // including them so we still produce a frame.
        if (bounds.isEmpty()) {
            nodes.forEach(n => bounds.union(new THREE.Box3().setFromObject(n)));
        }
        if (bounds.isEmpty()) return;

        const center = new THREE.Vector3();
        bounds.getCenter(center);
        const size = new THREE.Vector3();
        bounds.getSize(size);

        // [FRAMING] Independent fit on the horizontal and vertical screen axes.
        // The earlier formula (viewSize * aspect / (maxDim * multiplier)) left
        // any zone whose maxDim ≈ viewSize at near-default zoom — visually it
        // looked like the camera never moved. Using a proper margin-based fit
        // (same approach as focusOnMachine) yields a tight frame on both axes.
        const { w, h } = this._viewportSize();
        const aspect = w / h;
        const fitW = size.x + 2 * margin;
        const fitH = size.y + 2 * margin;
        const fitD = size.z + 2 * margin;
        const horiz = Math.max(fitW, fitD);
        const zoomX = (this.viewSize * aspect) / horiz;
        const zoomY = this.viewSize / fitH;
        let targetZoom = Math.min(zoomX, zoomY);
        targetZoom = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, targetZoom));

        const isometricOffset = new THREE.Vector3().subVectors(this.defaultPosition, this.defaultTarget);
        this.animateCamera(center.clone().add(isometricOffset), center, targetZoom);
    }

    resetCamera() {
        this.clearSelectionBoxes();
        this.animateCamera(this.defaultPosition.clone(), this.defaultTarget.clone(), this.defaultZoom);
    }

    /**
     * Display persistent Box3Helpers for a device and its containing zone.
     * Called when the user clicks a machine name pill. Cleared by Home.
     */
    showSelectionBoxes(deviceId) {
        if (!deviceId || !this.scene) return;
        this.clearSelectionBoxes();

        // Single-device pin: only the clicked device's highlight glows.
        // Zone-wide highlighting is reserved for zone name-pill clicks.
        const deviceHl = this._resolveMachineHighlight(deviceId);
        if (deviceHl) {
            deviceHl.visible = true;
            this._pinnedHighlights.add(deviceHl);
            this._lastMachineHighlight = deviceHl;
        }
    }

    /**
     * Resolve a device id to its GLB highlight mesh using the same key logic as setHighlight.
     */
    _resolveMachineHighlight(deviceId) {
        if (!deviceId) return null;
        const lower = deviceId.toLowerCase();
        const target = (this.manualMap && this.manualMap[lower]) || lower;
        const targetNorm = target.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normId = lower.replace(/[^a-z0-9]/g, '');

        const isLogisticsGroup = targetNorm.includes('storage') || targetNorm.includes('inbound') || targetNorm.includes('rawmaterials');

        let hlKey = targetNorm;
        if (isLogisticsGroup) hlKey = 'rawmaterials';
        else if (targetNorm === 'preteatment' || targetNorm.includes('pretreat')) hlKey = 'pretreat';
        else if (targetNorm.includes('furnace')) hlKey = 'furnace';
        else if (targetNorm.includes('heat')) hlKey = 'heat';
        else if (!this.highlightRegistry.has(hlKey)) hlKey = normId;

        let hl = this.highlightRegistry.get(hlKey) || this.highlightRegistry.get(normId);
        if (!hl && isLogisticsGroup) hl = this.highlightRegistry.get('raw_materials');
        return hl || null;
    }

    /**
     * Pin GLB-baked highlights for an entire zone (zone outline + all member machines).
     * Triggered by zone name-pill clicks; cleared by Home.
     */
    pinZoneHighlights(zoneId) {
        if (!zoneId) return;
        this.clearSelectionBoxes();

        this._pinnedZoneId = zoneId;

        const zoneHl = this.zoneHighlightRegistry.get(zoneId);
        if (zoneHl) {
            zoneHl.visible = true;
            this._pinnedHighlights.add(zoneHl);
            this._lastZoneHighlight = zoneHl;
        }

        const groups = (window.app && window.app.machineGroups) || {};
        const members = groups[zoneId] || [];
        members.forEach(mid => {
            const hl = this._resolveMachineHighlight(mid);
            if (hl) {
                hl.visible = true;
                this._pinnedHighlights.add(hl);
            }
        });
    }

    clearSelectionBoxes() {
        if (this._selectionBoxHelpers && this._selectionBoxHelpers.length) {
            this._selectionBoxHelpers.forEach(helper => {
                this.scene.remove(helper);
                if (helper.geometry) helper.geometry.dispose();
                if (helper.material) helper.material.dispose();
            });
            this._selectionBoxHelpers = [];
        }

        if (this._pinnedHighlights && this._pinnedHighlights.size) {
            this._pinnedHighlights.forEach(hl => { hl.visible = false; });
            this._pinnedHighlights.clear();
        }
        this._pinnedZoneId = null;
    }

    animateCamera(targetPos, targetLookAt, targetZoom, duration = 3000) {
        // Cancel any in-flight animation so chip-nav clicks don't stack into a snake.
        if (this._cameraAnimId) cancelAnimationFrame(this._cameraAnimId);

        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const startZoom = this.camera.zoom;
        const startTime = performance.now();

        this.controls.enabled = false;

        const animate = (time) => {
            const t = Math.min((time - startTime) / duration, 1);
            // easeInOutQuint — symmetric S-curve, no abrupt start/stop
            const ease = t < 0.5
                ? 16 * t * t * t * t * t
                : 1 - Math.pow(-2 * t + 2, 5) / 2;

            this.camera.position.lerpVectors(startPos, targetPos, ease);
            this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
            this.camera.zoom = THREE.MathUtils.lerp(startZoom, targetZoom, ease);
            this.camera.updateProjectionMatrix();
            this.controls.update();

            if (t < 1) {
                this._cameraAnimId = requestAnimationFrame(animate);
            } else {
                this._cameraAnimId = null;
                this.controls.enabled = true;
            }
        };
        this._cameraAnimId = requestAnimationFrame(animate);
    }

    _collectActiveMeshes(deviceIds) {
        const activeMeshesSet = new Set();

        deviceIds.forEach(id => {
            // [SCADA] Deep Harvesting: Use the smart _getDeviceNodes logic to
            // identify all root nodes, sibling instances, and associated collections
            // that belong to this logical device ID.
            const nodes = this._getDeviceNodes(id);

            nodes.forEach(({ node }) => {
                // Recursively gather all meshes within every identified root or instance
                node.traverse(n => {
                    if (n.isMesh) activeMeshesSet.add(n);
                });
            });

        });

        // [ANIMATION-GROUPS] Walk the explicit animation→device map and add
        // any animated nodes whose group intersects the current selection.
        // This keeps a forklift textured when either of its endpoint zones
        // is selected, while still ghosting it from unrelated views (so a
        // mid-flight forklift doesn't pop into the smelting frame, etc.).
        const selectedNorms = new Set(deviceIds.map(d => d.toUpperCase()));
        if (this.animationGroups) {
            for (const [name, group] of Object.entries(this.animationGroups)) {
                if (!group.some(d => selectedNorms.has(d.toUpperCase()))) continue;
                
                // [SCADA] Robust lookup: try exact name, then normalized alphanumeric name
                const node = this.nodeRegistry.get(name) || 
                             this.normNodeRegistry.get(name.replace(/[^a-z0-9]/g, ''));
                             
                if (!node) continue;
                node.traverse(n => { if (n.isMesh) activeMeshesSet.add(n); });
            }
        }
        // [SCADA] Dynamic Transport Collection:
        // Instead of mapping every ingot/ladle instance manually, we include
        // all animated cargo matching the logical route of the selected device.
        const isFurnaceSelected = selectedNorms.has('FURNACE_01');
        const isLogisticsSelected = selectedNorms.has('RAWMATERIALS');
        const isDegasserSelected = selectedNorms.has('DEGASSER_01') || selectedNorms.has('DEGASSER_02');

        if (isFurnaceSelected || isLogisticsSelected || isDegasserSelected) {
            this.nodeRegistry.forEach((node, name) => {
                if (!node.userData.isAnimated) return;
                
                let shouldInclude = false;
                // Route: Storage <-> Furnace (Ingots)
                if ((isFurnaceSelected || isLogisticsSelected) && (name.includes('storage') || name.includes('ingot'))) {
                    shouldInclude = true;
                }
                // Route: Furnace <-> Degasser (Ladels/Containers)
                if ((isFurnaceSelected || isDegasserSelected) && (name.includes('ladel') || name.includes('container'))) {
                    shouldInclude = true;
                }
                
                if (shouldInclude) {
                    node.traverse(n => { if (n.isMesh) activeMeshesSet.add(n); });
                }
            });
        }

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
                // Plant floor never ghosts — it's the spatial reference
                // the user navigates by, so it keeps its texture even when
                // isolation is active.
                if (node.userData.isFloor) {
                    this._restoreOriginal(node);
                    return;
                }
                if (activeMeshesSet.has(node)) {
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
                if (node.userData.isFloor) {
                    this._restoreOriginal(node);
                    return;
                }
                if (activeMeshesSet.has(node)) {
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
        this.clearSelectionBoxes();
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

        // Priority 1: Use metadata from assets.json if available
        const assetInfo = this.app.assetData ? this.app.assetData[id] : null;
        const displayName = id; // Always show ID as per user request!

        let labelItem = this.labelRegistry.get(id);
        if (!labelItem) {
            const div = document.createElement('div');
            div.className = 'marker-container-stacked';
            div.style.pointerEvents = 'auto';
            div.style.cursor = 'pointer';

            // [PRECISION] Targeted Stacked Structure: Icon Circle over Name Pill
            div.innerHTML = `
                <div class="stacked-icon-circle">
                    <span class="material-symbols-outlined">settings</span>
                </div>
                <div class="stacked-name-pill">${displayName}</div>
            `;
            // Icon and name pill share one handler — both drill into the
            // machine view with the persistent selection-box highlight.
            const machineHandler = (e) => {
                e.stopPropagation();
                this.showSelectionBoxes(id);
                window.app.setContext('machine', id);
            };
            const machineIconBtn = div.querySelector('.stacked-icon-circle');
            const machineNameBtn = div.querySelector('.stacked-name-pill');
            if (machineIconBtn) machineIconBtn.onclick = machineHandler;
            if (machineNameBtn) machineNameBtn.onclick = machineHandler;
            const obj = new CSS2DObject(div);
            // Height adjustment to avoid clipping (stack is taller than pill)
            obj.position.y += 0.5;
            this.scene.add(obj);

            // Register targeting references for flicker-free live updates
            labelItem = {
                element: div,
                object: obj,
                statusDot: div.querySelector('.material-symbols-outlined'),
                statusIndicator: div.querySelector('.stacked-status-dot'),
                idLabel: div.querySelector('.stacked-name-pill'),
                iconCircle: div.querySelector('.stacked-icon-circle')
            };
            this.labelRegistry.set(id, labelItem);
        }

        const { statusDot, statusIndicator, idLabel, iconCircle } = labelItem;

        if (statusDot) {
            const iconName = (assetInfo && assetInfo.icon) ? assetInfo.icon : 'settings';
            if (statusDot.textContent !== iconName) statusDot.textContent = iconName;

            const resolvedState = (this.app ? this.app._getMachineState(id) : 'OFFLINE').toString().toUpperCase();
            const iconColor = colorForState(resolvedState, 'css');

            if (statusDot.style.color !== iconColor) statusDot.style.color = iconColor;
        }

        if (idLabel) {
            if (idLabel.textContent !== displayName) idLabel.textContent = displayName;
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

        // [SYNC] Pull canonical department labels from main app so the WebGL
        // zone names match the sidebar UI labels exactly.
        const appLabels = (this.app && this.app.departmentLabels) || {};

        // Clear existing zone icons and names
        this.zoneLabelRegistry.forEach(obj => this.scene.remove(obj));
        this.zoneLabelRegistry.clear();
        this.zoneNameRegistry.forEach(obj => this.scene.remove(obj));
        this.zoneNameRegistry.clear();
        this.zoneRegistry.clear();

        for (const [zoneId, machines] of Object.entries(machineGroups)) {
            const name = (appLabels[zoneId] || zoneId).toUpperCase();
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

            // [LOGISTICS] For raw materials, anchor the chip to the storage
            // mesh stack itself — the zone box also covers the forklift sweep
            // path, which pulls the centroid off-center.
            if (zoneId === 'raw_materials') {
                const storageBox = new THREE.Box3();
                this.nodeRegistry.forEach((node, name) => {
                    if (name.startsWith('storage') || name.startsWith('inbound') || name.startsWith('buffer')) {
                        node.traverse(c => {
                            if (c.isMesh && !c.userData.isAnimated && !c.userData.isHighlight) {
                                storageBox.union(new THREE.Box3().setFromObject(c));
                            }
                        });
                    }
                });
                if (!storageBox.isEmpty()) {
                    storageBox.getCenter(centerVec);
                    // also use the storage stack's top edge for vertical anchor
                    zoneBox.max.y = storageBox.max.y;
                }
            }

            // [USER] High-fidelity Stacked Marker: Icon Circle over Name Pill
            const iconDiv = document.createElement('div');
            iconDiv.className = 'marker-container-stacked';
            iconDiv.style.pointerEvents = 'auto';
            iconDiv.style.cursor = 'pointer';

            const zoneState = this.app ? this.app._getZoneState(zoneId) : 'OFFLINE';
            const icon = zoneIconMap[zoneId] || 'settings';
            const statusColor = colorForState(zoneState, 'css');
            iconDiv.innerHTML = `
                <div class="stacked-icon-circle">
                    <span class="material-symbols-outlined" style="color: ${statusColor}">${icon}</span>
                </div>
                <div class="stacked-name-pill">${name}</div>
            `;
            // Icon and name pill share one handler — both frame the whole
            // zone with the zone outline + member-machine highlights pinned.
            const zoneHandler = (e) => {
                e.stopPropagation();
                this.pinZoneHighlights(zoneId);
                window.app.setContext('zone', zoneId);
            };
            const iconBtn = iconDiv.querySelector('.stacked-icon-circle');
            const nameBtn = iconDiv.querySelector('.stacked-name-pill');
            if (iconBtn) iconBtn.onclick = zoneHandler;
            if (nameBtn) nameBtn.onclick = zoneHandler;

            const iconLabel = new CSS2DObject(iconDiv);
            // Raw materials chip sits one step higher than other zone chips so
            // it reads cleanly above the storage stack.
            const yOffset = zoneId === 'raw_materials' ? 2.4 : 1.2;
            iconLabel.position.set(centerVec.x, zoneBox.max.y + yOffset, centerVec.z);
            iconLabel.userData = { type: 'zone', id: zoneId }; // Tag for visibility logic
            this.scene.add(iconLabel);
            this.zoneLabelRegistry.set(zoneId, iconLabel);
        }
    }

    onWindowResize() {
        const { w, h } = this._viewportSize();
        const aspect = w / h;
        this.camera.left = -aspect * this.viewSize / 2;
        this.camera.right = aspect * this.viewSize / 2;
        this.camera.top = this.viewSize / 2;
        this.camera.bottom = -this.viewSize / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.labelRenderer.setSize(w, h);
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

            // [PERF/LCP] Dynamic Chip Visibility based on Camera Zoom
            // Hides machine labels when zoomed out to reduce DOM overhead and visual clumping.
            const currentZoom = this.camera.zoom;
            const threshold = 1.8; // Machine labels appear only when getting closer

            this.labelRegistry.forEach((label, id) => {
                const element = label.element;
                if (element) {
                    const shouldShow = currentZoom > threshold;
                    const opacity = shouldShow ? 1 : 0;
                    if (element.style.opacity !== String(opacity)) {
                        element.style.opacity = opacity;
                        element.style.pointerEvents = shouldShow ? 'auto' : 'none';
                    }
                }
            });

            this.handleHover();
            this._updateCoordinateTracker();

            // [PERF] Zone Status Blinking / Refresh
            // Moving this from uiUpdater (2Hz) to the main loop (throttled 10Hz)
            // ensures the Amber/Green blinking for mixed zones is precise and smooth.
            if (performance.now() - this.lastZoneRefresh > 100) {
                this.refreshAllZoneLabels();
                this.lastZoneRefresh = performance.now();
            }

            // [HOVER-HIGHLIGHT] Pulse the active highlight mesh so it breathes.
            // Drives the cloned per-mesh material's opacity and emissiveIntensity
            // around the authored base value.
            const s01 = 0.5 + 0.5 * Math.sin(performance.now() * 0.0075);
            const pulseNode = (node, opacityMin, opacitySpan, emissiveMin, emissiveSpan) => {
                if (!node || !node.visible) return;
                const meshes = node.userData.highlightMeshes || [node];
                const opacity = opacityMin + opacitySpan * s01;
                meshes.forEach(mesh => {
                    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                    mats.forEach(m => {
                        m.opacity = opacity;
                        if ('emissiveIntensity' in m) {
                            const base = mesh.userData.baseEmissive ?? 1;
                            m.emissiveIntensity = base * (emissiveMin + emissiveSpan * s01);
                        }
                    });
                });
            };
            pulseNode(this._lastMachineHighlight, 0.55, 0.45, 0.6, 1.4);
            pulseNode(this._lastZoneHighlight,   0.25, 0.35, 0.5, 1.0);

            // Keep pinned highlights pulsing too so the glow persists after click
            // until the Home button is pressed.
            if (this._pinnedHighlights && this._pinnedHighlights.size) {
                this._pinnedHighlights.forEach(hl => {
                    if (hl === this._lastMachineHighlight || hl === this._lastZoneHighlight) return;
                    pulseNode(hl, 0.55, 0.45, 0.6, 1.4);
                });
            }

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

    /**
     * Recolour zone-level icon chips (SMELTING, HEAT TREATMENT, RAW MATERIALS, …)
     * based on the current rolled-up zone state. Called whenever WS/PLC state
     * flips — zone labels are created once in _createZoneIcons and otherwise
     * never repaint.
     */
    refreshAllZoneLabels() {
        if (!this.zoneLabelRegistry || this.zoneLabelRegistry.size === 0) return;
        this.zoneLabelRegistry.forEach((obj, zoneId) => {
            const el = obj.element;
            if (!el) return;
            const iconSpan = el.querySelector('.stacked-icon-circle .material-symbols-outlined');
            if (!iconSpan) return;

            const state = this.app ? this.app._getZoneState(zoneId) : 'OFFLINE';
            const css = colorForState(state, 'css');

            // [USER] For MIXED states, we force the style update every cycle to 
            // ensure the 1Hz blink (defined in colorForState) is reflected in the DOM.
            if (state === 'MIXED' || iconSpan.style.color !== css) {
                iconSpan.style.color = css;
            }
        });
    }
}

export default Renderer;
