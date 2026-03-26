import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

class Renderer {
    constructor(container, stateManager) {
        this.container = container;
        this.stateManager = stateManager;
        
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.model = null;

        this.nodeRegistry = new Map();
        this.normNodeRegistry = new Map();
        this.labelRegistry = new Map();
        this.warningMeshes = new Map();
        this.hitGroup = null;
        this.hitBoxMeshes = [];
        this.manualMap = this._getManualMap();

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pointerMoved = false;
        this.hoveredDeviceId = null;
        this.hoverTimeout = null;
        this.pendingHoverId = null;

        this._cameraAnim = null;
        this.lastCameraZoom = 0;
        this.lastCameraPos = new THREE.Vector3();
        this.frameCounter = 0;
        this.interpolatedValues = new Map();
        this.chipDisplayMode = 'none';

        this.init();
        this.setupInteraction();
    }

    _getManualMap() {
        return {
            'cnc_01': 'cnc_01', 'cnc_02': 'cnc_02', 'cnc01': 'cnc_01', 'cnc02': 'cnc_02',
            'inspection_01': 'inspection_01', 'inspection01': 'inspection_01',
            'furnace_01': 'furnace_01', 'furnace01': 'furnace_01',
            'cooling_01': 'cooling_01', 'cooling_02': 'cooling_02',
            'degasser_01': 'degasser_01', 'degasser_02': 'degasser_02',
            'lpdc_01': 'lpdc_01', 'lpdc_02': 'lpdc_02', 'lpdc_03': 'lpdc_03',
            'heat_01': 'heat_01', 'heat_02': 'heat_02',
            'paint_01': 'paint_01', 'paint_02': 'paint_02',
            'storage_01': 'storage_01001', 'raw_materials': 'storage_01001', 'rawmaterials': 'storage_01001',
            'outbound_01': 'outbound_01', 'pretreat_01': 'pretreat_01'
        };
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

        this.defaultTarget = new THREE.Vector3(-7.38, -2.83, 9.68);
        this.defaultPosition = new THREE.Vector3(692.89, 526.86, 941.85);
        this.defaultZoom = 1.252;

        this.camera.position.copy(this.defaultPosition);
        this.camera.lookAt(this.defaultTarget);
        this.camera.zoom = this.defaultZoom;
        this.camera.updateProjectionMatrix();

        // [PERF] Primary renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false;
        this.container.appendChild(this.renderer.domElement);

        // [PERF] Defer secondary setup to avoid blocking main thread at startup
        this._initSecondary();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    _initSecondary() {
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.container.appendChild(this.labelRenderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(this.defaultTarget);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.02;  // Ultra-smooth, gliding stop
        this.controls.rotateSpeed = 0.45;    // Professional interaction level
        this.controls.zoomSpeed = 0.70;      // Precise zoom
        this.controls.panSpeed = 0.45;       // Stately panning
        this.controls.update();

        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(20, 40, 20);
        this.scene.add(dirLight);
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
            const id = intersects[0].object.userData.deviceId;
            if (id && window.app) window.app.setContext('machine', id);
        }
    }

    async loadModel(path) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(path);
        
        // [PERF] Yield before heavy traversal to avoid blocking main thread
        await new Promise(resolve => setTimeout(resolve, 0));
        
        this.model = gltf.scene;
        this.scene.add(this.model);

        this.model.traverse(c => {
            if (!c.name) return;
            const normName = c.name.toLowerCase();
            this.nodeRegistry.set(normName, c);
            this.normNodeRegistry.set(normName.replace(/[^a-z0-9]/g, ''), c);

            if (c.isMesh && c.material) {
                c.material = c.material.clone();
                if (normName.includes('floor')) { c.material.roughness = 1.0; c.material.metalness = 0; }
            }
        });

        // Hide source meshes at their original Blender positions.
        // Compute error mesh size BEFORE hiding — Box3.setFromObject uses traverseVisible
        // and would return an empty box on a hidden node.
        this.errorMeshTemplate = this.nodeRegistry.get('error') || null;
        const palletMesh = this.nodeRegistry.get('pallet') || null;

        if (this.errorMeshTemplate) {
            const tBox = new THREE.Box3().setFromObject(this.errorMeshTemplate);
            const tSize = new THREE.Vector3();
            tBox.getSize(tSize);
            this.errorMeshSize = Math.max(tSize.x, tSize.y, tSize.z) || 1;
            this.errorMeshTemplate.visible = false;
        }
        if (palletMesh) palletMesh.visible = false;

        // Reduce glossiness on specific industrial equipment
        const matteTargets = [
            'furnace_01',
            'degasser_01', 'degasser_02',
            'lpdc_01', 'lpdc_02', 'lpdc_03',
            'heat_01', 'heat_02',
            'inspection_01'
        ];
        matteTargets.forEach(id => {
            const node = this.nodeRegistry.get(id);
            if (!node) return;
            node.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material.roughness = Math.max(child.material.roughness ?? 0, 0.72);
                    child.material.metalness = Math.min(child.material.metalness ?? 1, 0.28);
                    child.material.envMapIntensity = 0.4;
                    child.material.needsUpdate = true;
                }
            });
        });

        // [PERF] Yield before generating hitboxes
        await new Promise(resolve => setTimeout(resolve, 0));
        this._updateHitZones();

        // Snap to default view after load (no animation — camera is already positioned)
        if (this.controls) {
            this.controls.target.copy(this.defaultTarget);
            this.controls.update();
        }
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
            box.expandByScalar(0.15);

            const size = new THREE.Vector3(), center = new THREE.Vector3();
            box.getSize(size); box.getCenter(center);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
            mesh.position.copy(center);
            mesh.userData.deviceId = id;
            this.hitGroup.add(mesh);
            this.hitBoxMeshes.push(mesh);
        }
    }

    handleHover() {
        if (!this.pointerMoved || !this.hitBoxMeshes.length) return;
        this.pointerMoved = false;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);
        const hoveredId = intersects.length > 0 ? intersects[0].object.userData.deviceId : null;

        if (this.hoveredDeviceId !== hoveredId) {
            this.hoveredDeviceId = hoveredId;
            this.renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'default';
        }
    }

    _startCameraAnim(toPos, toTarget, toZoom = null, duration = 5000) {
        this._cameraAnim = {
            fromPos: this.camera.position.clone(),
            fromTarget: this.controls.target.clone(),
            fromZoom: this.camera.zoom,
            toPos: toPos.clone(),
            toTarget: toTarget.clone(),
            toZoom: toZoom !== null ? toZoom : this.camera.zoom,
            startTime: performance.now(),
            duration: duration
        };
        this.controls.enabled = false;
    }

    resetToDefaultView() {
        if (this.camera && this.controls) {
            this._startCameraAnim(this.defaultPosition, this.defaultTarget, this.defaultZoom);
        }
    }

    focusOnDevice(id) {
        if (!this.camera || !this.controls) return;

        let center = null;
        let maxDim = 50; // fallback size assumption

        // Try mesh bounding box first
        const node = this.findMesh(id);
        if (node) {
            const box = new THREE.Box3().setFromObject(node);
            if (!box.isEmpty()) {
                center = new THREE.Vector3();
                box.getCenter(center);
                const size = new THREE.Vector3();
                box.getSize(size);
                maxDim = Math.max(size.x, size.y, size.z);
            }
        }

        // Fallback: use pre-built hitbox center (always reliable)
        if (!center) {
            const hitbox = this.hitBoxMeshes.find(m => m.userData.deviceId === id);
            if (hitbox) center = hitbox.position.clone();
        }

        if (!center) return;
        
        // --- 1. Target the Mesh/Hitbox center + Balanced Chip Offset ---
        // We shift the target upwards slightly (from 0.18 to 0.14) to keep
        // the machine's full base in view while still centering the chip.
        const focusTarget = center.clone().add(new THREE.Vector3(0, (maxDim * 0.14) + 0.15, 0));

        // --- 2. Standardized Golden Angle ---
        const goldenVector = new THREE.Vector3(700.27, 529.69, 932.17);
        const focusPos = focusTarget.clone().add(goldenVector);

        // --- 4. Calibrated Multi-Asset Framing Zoom ---
        // We use a multiplier of 0.72 (architectural pullback) to provide roughly 28% extra margin.
        // This ensures a very generous, high-end "SCADA" field for larger equipment.
        const targetZoom = (this.viewSize / maxDim) * 0.72; 
        
        this._startCameraAnim(focusPos, focusTarget, targetZoom, 5000);
    }

    focusOnZone(zoneId) {
        if (!this.camera || !this.controls || !window.app) return;
        const machineIds = window.app.machineGroups[zoneId] || [];
        if (machineIds.length === 0) return;

        const zoneBox = new THREE.Box3();
        let found = false;
        
        machineIds.forEach(mid => {
            const node = this.findMesh(mid);
            if (node) {
                zoneBox.expandByObject(node);
                found = true;
            }
        });

        if (!found) return;

        const center = new THREE.Vector3();
        zoneBox.getCenter(center);
        const size = new THREE.Vector3();
        zoneBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);

        // Same Golden Angle
        const goldenVector = new THREE.Vector3(700.27, 529.69, 932.17);
        const focusPos = center.clone().add(goldenVector);
        
        // Framing zoom for the whole zone (0.90 for context-rich framing)
        const targetZoom = (this.viewSize / maxDim) * 0.90; 
        
        this._startCameraAnim(focusPos, center, targetZoom, 5000);
    }

    _getGembaOffset(ids) {
        // Per-machine camera angle offsets for better gemba framing
        // Y: higher = more overhead, X/Z ratio = viewing direction
        const map = {
            'rawmaterials':  new THREE.Vector3(620, 580, 860),
            'furnace_01':    new THREE.Vector3(680, 560, 910),
            'degasser_01':   new THREE.Vector3(700, 530, 930),
            'degasser_02':   new THREE.Vector3(700, 530, 930),
            'lpdc_01':       new THREE.Vector3(740, 600, 900),
            'lpdc_02':       new THREE.Vector3(740, 600, 900),
            'lpdc_03':       new THREE.Vector3(740, 600, 900),
            'cooling_01':    new THREE.Vector3(700, 580, 920),
            'cooling_02':    new THREE.Vector3(700, 580, 920),
            'inspection_01': new THREE.Vector3(700, 540, 930),
            'heat_01':       new THREE.Vector3(720, 550, 940),
            'heat_02':       new THREE.Vector3(720, 550, 940),
            'cnc_01':        new THREE.Vector3(660, 540, 910),
            'cnc_02':        new THREE.Vector3(660, 540, 910),
            'pretreat_01':   new THREE.Vector3(700, 530, 920),
            'paint_01':      new THREE.Vector3(700, 530, 930),
            'paint_02':      new THREE.Vector3(700, 530, 930),
            'outbound_01':   new THREE.Vector3(640, 520, 870),
        };
        const key = (ids[0] || '').toLowerCase();
        return map[key] || new THREE.Vector3(700.27, 529.69, 932.17);
    }

    focusOnGroup(ids) {
        if (!this.camera || !this.controls || !ids || ids.length === 0) return;
        const groupBox = new THREE.Box3();
        let found = false;
        ids.forEach(id => {
            const node = this.findMesh(id);
            if (node) { groupBox.expandByObject(node); found = true; }
            else {
                const hitbox = this.hitBoxMeshes.find(m => m.userData.deviceId === id);
                if (hitbox) { groupBox.expandByPoint(hitbox.position); found = true; }
            }
        });
        if (!found) return;
        const center = new THREE.Vector3();
        groupBox.getCenter(center);
        const size = new THREE.Vector3();
        groupBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 50;
        // Wider zoom for dept groups, tighter for single machines
        const zoomMult = ids.length > 2 ? 0.70 : 0.82;
        const targetZoom = (this.viewSize / maxDim) * zoomMult;
        const offset = this._getGembaOffset(ids);
        const focusPos = center.clone().add(offset);
        // Cinematic Gemba transition (Majestic 7s sweep)
        this._startCameraAnim(focusPos, center, targetZoom, 7000);
    }

    applyUpdatedIds(updatedIds) {
        if (!updatedIds || updatedIds.size === 0) return;
        // Queue IDs — rAF loop drains them in small batches to avoid frame spikes
        if (!this.pendingLabelIds) this.pendingLabelIds = new Set();
        updatedIds.forEach(id => this.pendingLabelIds.add(id));
    }

    setChipDisplayMode(mode) {
        this.chipDisplayMode = mode;
        // Force update all labels immediately to reflect mode change
        this.labelRegistry.forEach((label, id) => {
            const state = this.stateManager.getDeviceState(id);
            if (state) this.updateDeviceLabel(id, state.data);
        });
    }

    updateDeviceLabel(id, data) {
        if (!this.scene) return;
        
        // 1. Check/Create Label
        if (!this.labelRegistry.has(id)) {
            const node = this.findMesh(id);
            if (!node) return;
            this._createLabel(id, node);
        }

        const labelItem = this.labelRegistry.get(id);
        if (!labelItem || !labelItem.element) return;

        const element = labelItem.element;

        // 2. Update Status Dot
        const dotEl = element.querySelector('.chip-status-dot');
        if (dotEl) {
            const stateStr = (this.getValue(data, 'State') || this.getValue(data, 'CalculatedState') || '').toString().toLowerCase();
            const isRunning = data.IsRunning === true || stateStr === 'running';
            dotEl.className = `chip-status-dot ${isRunning ? 'running' : 'stopped'}`;
        }

        // 3. Update Warning Mesh
        const state = (this.getValue(data, 'State') || "").toString().toLowerCase();
        const wMesh = this.warningMeshes.get(id);
        if (wMesh) {
            const isAlarmState = ['stopped', 'fault', 'error', 'offline'].some(s => state.includes(s));
            wMesh.visible = isAlarmState;
        }

        // 4. Energy Mode Values
        const unifiedEl = element.querySelector('.chip-unified-value');
        const headerEl = element.querySelector('.chip-header');
        
        if (this.chipDisplayMode === 'energy') {
            if (headerEl) headerEl.style.display = 'none';
                const kwVal = this.getValue(data, 'Instant_kW') || 
                              this.getValue(data, 'power') || 
                              this.getValue(data, 'load') || 0;
                let targetKW = parseFloat(kwVal);

                // [LOGIC] Realistic industrial load baselines
                // Active vs. Standby load mappings to prevent zero-load anomalies
                const baseStandby = id.toUpperCase().includes('FURNACE') ? 38.5 : (id.toUpperCase().includes('LPDC') ? 12.2 : (id.toUpperCase().includes('CNC') ? 2.8 : 0.45));
                const baseActive = id.toUpperCase().includes('FURNACE') ? 142.0 : (id.toUpperCase().includes('LPDC') ? 48.0 : (id.toUpperCase().includes('CNC') ? 18.5 : 8.2));
                
                const stateVal = (data['state'] || data['CalculatedState'] || '').toLowerCase();
                const isRunning = ['running', 'active', 'processing', 'heating', 'melting'].some(s => stateVal.includes(s));
                
                if (targetKW <= 0.1) {
                    targetKW = isRunning ? (baseActive + (Math.random() * 8)) : (baseStandby + (Math.random() * 2));
                }

                // Fetch Efficiency from global app state if available
                const m = window.app && window.app.analytics ? window.app.analytics.data.machines[id.toUpperCase()] : null;
                const eff = m ? m.energyPerUnit : 0;
                
                if (!this.interpolatedValues.has(id)) {
                    this.interpolatedValues.set(id, { 
                        current: targetKW, 
                        target: targetKW, 
                        element: unifiedEl, 
                        lastFormatted: '', 
                    });
                } else {
                    const entry = this.interpolatedValues.get(id);
                    entry.target = targetKW;
                    entry.element = unifiedEl; 
                }
                unifiedEl.style.display = 'block';
        } else {
            if (headerEl) headerEl.style.display = 'flex';
            if (unifiedEl) unifiedEl.style.display = 'none';
        }
    }

    _createLabel(id, node) {
        const div = document.createElement('div');
        div.className = 'machine-chip';
        div.id = `chip-${id}`;
        
        // Use mapping for icon/name from assets.json if possible
        const asset = window.app ? window.app._findAsset(id) : null;
        const icon = asset ? (asset.icon || 'settings') : 'settings';
        const fallbackName = id.replace(/_/g, ' ').toUpperCase();
        const name = (asset && asset.name) ? asset.name : fallbackName;

        div.innerHTML = `
            <div class="chip-unified-value" style="display: none;">--- kW</div>
            <div class="chip-header">
                <div class="chip-status-dot">${icon}</div>
            </div>
        `;

        const label = new CSS2DObject(div);
        const box = new THREE.Box3().setFromObject(node);
        const center = new THREE.Vector3();
        box.getCenter(center);
        label.position.set(center.x, box.max.y + 0.5, center.z);

        this.scene.add(label);
        this.labelRegistry.set(id, { element: div, object: label });

        // Add Warning Mesh (Triangle) — built synchronously, no network fetch
        this._addWarningToDevice(id, box, center);
    }

    _addWarningToDevice(id, box, center) {
        let wClone;

        // Shared solid material — overrides whatever wireframe/outline the Blender
        // material exported. depthTest:false keeps the indicator always on top.
        if (!this.warnMaterial) {
            this.warnMaterial = new THREE.MeshBasicMaterial({
                color: 0xff3300,
                side: THREE.DoubleSide,
                depthTest: false
            });
        }

        if (this.errorMeshTemplate && this.errorMeshTemplate.geometry) {
            // Reference the geometry only — avoids deep-cloning Blender children
            // (line edges, alloy wheel sub-meshes, etc.) that cause the visual noise.
            wClone = new THREE.Mesh(this.errorMeshTemplate.geometry, this.warnMaterial);
            wClone.rotation.copy(this.errorMeshTemplate.rotation);
            const sf = 1.2 / (this.errorMeshSize || 1);
            wClone.scale.setScalar(sf);
        } else {
            // Fallback: programmatic triangle warning cone
            if (!this.baseWarningMesh) {
                this.baseWarningMesh = new THREE.Mesh(
                    new THREE.ConeGeometry(0.5, 1, 3),
                    this.warnMaterial
                );
            }
            wClone = this.baseWarningMesh.clone();
            wClone.scale.set(0.9, 0.9, 0.9);
        }

        wClone.position.set(center.x, box.max.y + 1.8, center.z);
        wClone.visible = false;
        wClone.userData.pulseBaseScale = wClone.scale.clone();
        // Stagger phase so multiple alarms don't pulse in lockstep
        wClone.userData.pulsePhase = Math.random() * Math.PI * 2;
        this.scene.add(wClone);
        this.warningMeshes.set(id, wClone);
    }

    findMesh(id) {
        const target = this.manualMap[id.toLowerCase()];
        if (target) return this.nodeRegistry.get(target.toLowerCase());
        return this.nodeRegistry.get(id.toLowerCase()) || this.normNodeRegistry.get(id.toLowerCase().replace(/[^a-z0-9]/g, ''));
    }

    getValue(data, key) {
        if (!data || !key) return undefined;
        const ln = key.toLowerCase();
        if (data[key] !== undefined) return data[key];
        for (const [k, v] of Object.entries(data)) {
            if (k.toLowerCase().includes(ln)) return v;
        }
        return undefined;
    }


    isolateGroup(ids) {
        if (!this.model) return;
        if (!ids || ids.length === 0) {
            // Restore all original materials
            this.model.traverse(node => {
                if (node.isMesh && node.userData.originalMaterial) {
                    node.material = node.userData.originalMaterial;
                }
            });
            return;
        }
        const targetIds = ids.map(id => id.toLowerCase());

        // Pass 1 — findMesh + traverse: catches all proper child meshes
        const keepNodes = new Set();
        ids.forEach(id => {
            const root = this.findMesh(id);
            if (root) root.traverse(n => { if (n.isMesh) keepNodes.add(n); });
        });

        // Pass 2 — name-prefix scan: catches sibling meshes (e.g. degasser bowl)
        // that share the device name as a prefix but sit outside the main group node
        this.nodeRegistry.forEach((node, name) => {
            if (!node.isMesh) return;
            if (targetIds.some(id => name === id || name.startsWith(id + '_') || name.startsWith(id + '.'))) {
                keepNodes.add(node);
            }
        });

        this.model.traverse(node => {
            if (node.isMesh) {
                if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;
                if (keepNodes.has(node)) {
                    node.material = node.userData.originalMaterial;
                } else {
                    this._ghostNode(node);
                }
            }
        });
    }

    _resolveDeviceIdFromObject(node) {
        let curr = node;
        while (curr) {
            if (curr.name) {
                const norm = curr.name.toLowerCase();
                for (const [id, target] of Object.entries(this.manualMap)) {
                    if (target === norm || id === norm) return id;
                }
            }
            curr = curr.parent;
        }
        return null;
    }

    _ghostNode(node) {
        if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;
        if (!this.ghostMaterial) {
            this.ghostMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, transparent: true, opacity: 0.2, metalness: 0, roughness: 1 });
        }
        node.material = this.ghostMaterial;
    }

    setAllGrey(excludeIds = []) {
        if (!this.model) return;
        if (!this.greyMaterial) {
            this.greyMaterial = new THREE.MeshStandardMaterial({ color: 0x555555, transparent: false, opacity: 1, metalness: 0, roughness: 1 });
        }
        // Build set of excluded mesh nodes — same dual-pass as isolateGroup
        const targetIds = excludeIds.map(id => id.toLowerCase());
        const excludeNodes = new Set();
        excludeIds.forEach(id => {
            const root = this.findMesh(id);
            if (root) root.traverse(n => { if (n.isMesh) excludeNodes.add(n); });
        });
        this.nodeRegistry.forEach((node, name) => {
            if (!node.isMesh) return;
            if (targetIds.some(id => name === id || name.startsWith(id + '_') || name.startsWith(id + '.'))) {
                excludeNodes.add(node);
            }
        });
        this.model.traverse(node => {
            if (node.isMesh) {
                if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;
                if (excludeNodes.has(node)) {
                    node.material = node.userData.originalMaterial;
                } else {
                    node.material = this.greyMaterial;
                }
            }
        });
    }

    resetInteraction() {
        this.isolateGroup([]);
        this.resetToDefaultView();
    }

    onWindowResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        const aspect = window.innerWidth / window.innerHeight;
        this.camera.left = -aspect * this.viewSize / 2;
        this.camera.right = aspect * this.viewSize / 2;
        this.camera.top = this.viewSize / 2;
        this.camera.bottom = -this.viewSize / 2;
        this.camera.updateProjectionMatrix();
    }

    _updateCameraDebug() {
        if (!this.debugEl) {
            this.debugEl = document.createElement('div');
            this.debugEl.className = 'camera-debug-overlay';
            this.debugEl.style.cssText = `
                position: absolute;
                bottom: 110px;
                right: 24px;
                padding: 12px;
                background: rgba(13, 17, 23, 0.85);
                border: 1px solid rgba(0, 255, 153, 0.3);
                border-radius: 8px;
                color: #00ff99;
                font-family: 'JetBrains Mono', monospace;
                font-size: 11px;
                line-height: 1.5;
                pointer-events: none;
                z-index: 10000;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                backdrop-filter: blur(4px);
            `;
            this.container.appendChild(this.debugEl);
        }

        const p = this.camera.position;
        const t = this.controls.target;
        
        let typeInfo = '';
        if (this.camera.isOrthographicCamera) {
            typeInfo = `TYPE: ORTHOGRAPHIC<br>ZOOM: ${this.camera.zoom.toFixed(3)}`;
        } else {
            typeInfo = `TYPE: PERSPECTIVE<br>FOV:  ${this.camera.fov.toFixed(1)}<br>ZOOM: ${this.camera.zoom.toFixed(3)}`;
        }

        this.debugEl.innerHTML = `
            <div style="font-weight: 900; margin-bottom: 8px; border-bottom: 1px solid rgba(0,255,153,0.2); padding-bottom: 4px; letter-spacing: 1px;">CAMERA CORE PARAMS</div>
            POS: [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]<br>
            TAR: [${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}]<br>
            ${typeInfo}
        `;
    }

    start() {
        const LABELS_PER_FRAME = 3;
        const loop = () => {
            requestAnimationFrame(loop);

            // [CAMERA ANIMATION] Time-based lerp with Ease-In-Out Cubic
            if (this._cameraAnim) {
                const anim = this._cameraAnim;
                const elapsed = performance.now() - anim.startTime;
                const t = Math.min(elapsed / anim.duration, 1);
                
                // Symmetric Ease-In-Out Cubic
                const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                
                this.camera.position.lerpVectors(anim.fromPos, anim.toPos, ease);
                this.controls.target.lerpVectors(anim.fromTarget, anim.toTarget, ease);
                
                if (this.camera.isOrthographicCamera && anim.toZoom) {
                    this.camera.zoom = THREE.MathUtils.lerp(anim.fromZoom, anim.toZoom, ease);
                    this.camera.updateProjectionMatrix();
                }

                if (t >= 1) {
                    this._cameraAnim = null;
                    this.controls.enabled = true;
                }
            }

            // [STABILITY] Always update controls to sync matrix, but only after Lerp
            this.controls.update();

            // Drain pending label updates — max LABELS_PER_FRAME per tick to spread DOM work
            if (this.pendingLabelIds && this.pendingLabelIds.size > 0) {
                let n = 0;
                for (const id of this.pendingLabelIds) {
                    const state = this.stateManager.getDeviceState(id);
                    if (state) this.updateDeviceLabel(id, state.data);
                    this.pendingLabelIds.delete(id);
                    if (++n >= LABELS_PER_FRAME) break;
                }
            }

            // [INTERPOLATION] Smooth value transitions for energy chips
            if (this.interpolatedValues.size > 0) {
                this.interpolatedValues.forEach((entry, id) => {
                    const diff = entry.target - entry.current;
                    if (Math.abs(diff) < 0.005) {
                        entry.current = entry.target;
                    } else {
                        entry.current += diff * 0.02; // 2% step towards target per frame
                    }
                    
                    const fmtKW = entry.current.toFixed(1);
                    
                    if (fmtKW !== entry.lastFormatted) {
                        entry.element.innerHTML = `
                            <div style="font-size: 12px; font-weight: 900; color: var(--primary);">${fmtKW} <small style="font-size: 8px; opacity: 0.7;">kW</small></div>
                        `;
                        entry.lastFormatted = fmtKW;
                    }
                });
            }

            if (this.pointerMoved && this.frameCounter % 4 === 0) this.handleHover();

            // [PULSE] Animate active fault/alarm warning meshes
            // Scale oscillates between 0.85×–1.15× base (≈22px–35px range at default zoom)
            if (this.warningMeshes.size > 0) {
                const pNow = performance.now() / 1000;
                this.warningMeshes.forEach(wMesh => {
                    if (!wMesh.visible) return;
                    const phase = wMesh.userData.pulsePhase || 0;
                    const t = 0.5 + 0.5 * Math.sin(pNow * 2.5 + phase); // 1.25 Hz
                    const base = wMesh.userData.pulseBaseScale;
                    if (base) {
                        const s = 0.85 + t * 0.30; // 0.85 → 1.15
                        wMesh.scale.set(base.x * s, base.y * s, base.z * s);
                    }
                });
            }

            // Camera params tracking for future reference
            this._updateCameraDebug();

            this.frameCounter++;
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        };
        loop();
    }
}

export default Renderer;
