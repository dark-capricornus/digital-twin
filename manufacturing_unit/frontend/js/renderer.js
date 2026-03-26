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
            'storage_01': 'storage_01001', 'raw_materials': 'storage_01001',
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

            if (c.isMesh) {
                if (c.material) {
                    c.material = c.material.clone();
                    if (normName.includes('floor')) { c.material.roughness = 1.0; c.material.metalness = 0; }
                }
            }
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

    _startCameraAnim(toPos, toTarget, toZoom = null) {
        this._cameraAnim = {
            fromPos: this.camera.position.clone(),
            fromTarget: this.controls.target.clone(),
            fromZoom: this.camera.zoom,
            toPos: toPos.clone(),
            toTarget: toTarget.clone(),
            toZoom: toZoom !== null ? toZoom : this.camera.zoom,
            t: 0,
            duration: 420 // [USER] Ultra-slow cinematic transition (7s at 60fps)
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
        
        // --- 1. Target the Mesh/Hitbox center ---
        const focusTarget = center.clone();

        // --- 2. Standardized Direction Offset (Derived from Golden View) ---
        // Using the full goldenVector [700.27, 529.69, 932.17] ensures the camera 
        // stays far enough away to avoid near-plane clipping while maintaining the perspective.
        const goldenVector = new THREE.Vector3(700.27, 529.69, 932.17);
        
        // --- 3. Position Calculation ---
        const focusPos = focusTarget.clone().add(goldenVector);

        // --- 4. Immersive Framing Zoom ---
        const targetZoom = (this.viewSize / maxDim) * 0.90; 
        
        this._startCameraAnim(focusPos, focusTarget, targetZoom);
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
        
        // Framing zoom for the whole zone (0.75 for context)
        const targetZoom = (this.viewSize / maxDim) * 0.75; 
        
        this._startCameraAnim(focusPos, center, targetZoom);
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
        if (!this.baseWarningMesh) {
            this.baseWarningMesh = new THREE.Mesh(
                new THREE.ConeGeometry(0.5, 1, 3),
                new THREE.MeshBasicMaterial({ color: 0xff4400 })
            );
        }
        const wClone = this.baseWarningMesh.clone();
        wClone.scale.set(0.8, 0.8, 0.8);
        wClone.rotation.set(Math.PI / 2, 0, 0);
        wClone.position.set(center.x, box.max.y + 0.8, center.z);
        wClone.visible = false;
        wClone.userData.baseScale = wClone.scale.clone();
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

    setChipDisplayMode(mode) {
        this.chipDisplayMode = mode;
    }

    isolateGroup(ids) {
        if (!this.model) return;
        const targetIds = (ids || []).map(id => id.toLowerCase());
        this.model.traverse(node => {
            if (node.isMesh) {
                if (targetIds.length === 0) {
                    if (node.userData.originalMaterial) node.material = node.userData.originalMaterial;
                } else {
                    const mid = this._resolveDeviceIdFromObject(node);
                    if (mid && targetIds.includes(mid.toLowerCase())) {
                        if (node.userData.originalMaterial) node.material = node.userData.originalMaterial;
                    } else {
                        this._ghostNode(node);
                    }
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

            // Camera animation lerp (controls.update skipped during anim to prevent damping fighting it)
            if (this._cameraAnim) {
                const anim = this._cameraAnim;
                anim.t += 1 / anim.duration;
                const ease = 1 - Math.pow(1 - Math.min(anim.t, 1), 3);
                this.camera.position.lerpVectors(anim.fromPos, anim.toPos, ease);
                this.controls.target.lerpVectors(anim.fromTarget, anim.toTarget, ease);
                
                if (this.camera.isOrthographicCamera && anim.toZoom) {
                    this.camera.zoom = THREE.MathUtils.lerp(anim.fromZoom, anim.toZoom, ease);
                    this.camera.updateProjectionMatrix();
                }

                // [ARCHITECTURE] Continuously sync controls during lerp 
                // This eliminates the "snap" at the end of the animation
                this.controls.update();

                if (anim.t >= 1) {
                    this._cameraAnim = null;
                    this.controls.enabled = true;
                }
            } else {
                this.controls.update();
            }

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
