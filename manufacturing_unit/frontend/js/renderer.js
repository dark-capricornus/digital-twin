import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
        this.warningMeshes = new Map(); // Map of deviceId -> warning mesh instance
        this.hoveredDeviceId = null;
        this.hoverTimeout = null;
        this.pendingHoverId = null;
        this.hitGroup = null;
        this.hitBoxMeshes = [];

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

        this.persistentValues = new Map();
        this.chipDisplayMode = 'none';

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
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
        pmremGenerator.dispose();
    }

    _setupCoordinateTracker() {
        this.coordsOverlay = document.createElement('div');
        this.coordsOverlay.id = 'scene-coords-overlay';
        this.coordsOverlay.style.cssText = `
            position: absolute;
            bottom: 85px;
            right: 20px;
            background: rgba(13, 17, 23, 0.85);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(19, 146, 236, 0.3);
            border-radius: 8px;
            padding: 8px 12px;
            color: white;
            font-family: 'Public Sans', monospace;
            font-size: 11px;
            display: none; 
            z-index: 1000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            pointer-events: none;
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
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 6px 12px;">
                <span><small style="color:var(--primary)">X:</small>${target.x.toFixed(2)}</span>
                <span><small style="color:var(--primary)">Y:</small>${target.y.toFixed(2)}</span>
                <span><small style="color:var(--primary)">Z:</small>${target.z.toFixed(2)}</span>
                <span><small style="color:var(--primary)">Z:</small>${this.camera.zoom.toFixed(2)}</span>
                <span><small style="color:var(--primary)">H:</small>${params.hAngle}°</span>
                <span><small style="color:var(--primary)">V:</small>${params.vAngle}°</span>
                <span><small style="color:var(--primary)">D:</small>${params.distance}</span>
                <span><small style="color:var(--primary)">S:</small>${this.viewSize}</span>
            </div>
        `;
    }

    setupInteraction() {
        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('pointermove', (e) => {
            this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
            this.pointerMoved = true;
        });
    }

    onPointerDown(event) {
        if (event.target !== this.renderer.domElement) return;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);
        if (intersects.length > 0) {
            const deviceId = intersects[0].object.userData.deviceId;
            if (deviceId) this.selectDevice(deviceId);
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

    async loadModel(path, onProgress) {
        const loader = new GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
            loader.load(path, resolve, (xhr) => { if (onProgress) onProgress(xhr); }, reject);
        });
        this.model = gltf.scene;
        this.scene.add(this.model);

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

        for (const [id, targetName] of Object.entries(this.manualMap)) {
            if (!targetName) continue;
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
        const current = window.app.activeContext;
        if (current && current.type === 'machine' && current.id === id) {
            window.app.resetInteraction();
        } else {
            window.app.setContext('machine', id);
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
        const group = window.app.machineGroups[zoneId];
        if (group) {
            const nodes = group.machines.map(m => this.findMesh(m)).filter(Boolean);
            this.frameGroup(nodes);
            this.isolateGroup(group.machines);
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
            node.userData.ghostMat = new THREE.MeshStandardMaterial({
                color: 0x888888, transparent: true, opacity: 0.15, depthWrite: false
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
        node.material = Array.isArray(node.userData.originalMaterial)
            ? node.userData.originalMaterial.slice() : node.userData.originalMaterial;
    }

    isolateGroup(deviceIds) {
        if (!this.model) return;
        if (!deviceIds || deviceIds.length === 0) {
            this.model.traverse(n => {
                if (n.isMesh && n.userData.originalMaterial) this._restoreOriginal(n);
            });
            return;
        }

        const activeMeshesSet = this._collectActiveMeshes(deviceIds);

        this.model.traverse(node => {
            if (node.isMesh && node.userData.originalMaterial) {
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
                if (activeMeshesSet.has(node)) {
                    this._restoreOriginal(node);
                } else {
                    this._makeGhost(node);
                }
            }
        });
    }

    resetInteraction() {
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

        // Always sync position
        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        labelItem.object.position.set(center.x, box.max.y + 0.5, center.z);

        const valEl = el.querySelector('.chip-val');
        if (this.chipDisplayMode === 'energy') {
            const kw = data.Instant_kW || 0;
            if (valEl) {
                valEl.textContent = `${parseFloat(kw).toFixed(1)} kW`;
                valEl.style.display = 'block';
            }
            const header = el.querySelector('.chip-header');
            if (header) header.style.display = 'none';
        } else {
            if (valEl) valEl.style.display = 'none';
            const header = el.querySelector('.chip-header');
            if (header) header.style.display = 'flex';
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
        const loop = () => {
            requestAnimationFrame(loop);
            this.controls.update();

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
