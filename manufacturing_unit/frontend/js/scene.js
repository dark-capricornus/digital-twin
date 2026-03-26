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
        this.normNodeRegistry = new Map(); // [PERF] Pre-calculated normalized names
        this.labelRegistry = new Map();
        this.warningMeshes = new Map(); // Map of deviceId -> warning mesh instance
        this.hoveredDeviceId = null;
        this.hoverTimeout = null;
        this.pendingHoverId = null;
        this.hitGroup = null;
        this.hitBoxMeshes = [];

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
            'raw_materials': 'storage_01001',
            'rawmaterials': 'storage_01001',
            'outbound_01': 'outbound_01',
            'outbound01': 'outbound_01',
            'outbound_02': null, 
            'outbound02': null,
            'pretreat_01': 'pretreat_01',
            'pretreat01': 'pretreat_01',
            'pretreatment_01': 'pretreat_01',
        };

        this.overlayLayouts = new Map();
        this.persistentValues = new Map();
        this.chipDisplayMode = 'none'; // 'none', 'energy', 'cycle', etc.

        this.raycaster = new THREE.Raycaster();
        this.hoveredDeviceId = null;
        this.pointer = new THREE.Vector2();
        this.pointerMoved = false;

        // [PERF] Component State Tracking
        this.lastCameraZoom = 0;
        this.lastCameraPos = new THREE.Vector3();
        this.frameCounter = 0;

        // [PRECISION] Value Interpolation Store
        this.interpolatedValues = new Map(); // id -> { current, target, element, lastFormatted, unit }

        this.init();
        this.setupInteraction();
    }

    setChipDisplayMode(mode) {
        this.chipDisplayMode = mode;
        
        // Force immediate redraw of all labels using latest cached data
        this.labelRegistry.forEach((obj, id) => {
            const data = this.persistentValues.get(id);
            if (data && obj.element) {
                this.updateDeviceLabel(id, data);
            }
        });
    }

    /**
     * Manually set camera position based on angles and distance
     * @param {number} thetaDeg - Horizontal Angle (Azimuth) in degrees
     * @param {number} phiDeg - Vertical Angle (Polar) in degrees
     * @param {number} distance - Zoom Level (Distance)
     */
    computeOrthoFrustum(viewSize, canvasWidth, canvasHeight) {
        const aspect = canvasWidth / canvasHeight;
        return {
            left: -aspect * viewSize / 2,
            right: aspect * viewSize / 2,
            top: viewSize / 2,
            bottom: -viewSize / 2
        };
    }

    updateFrustum() {
        if (!this.camera || !this.renderer) return;
        const canvas = this.renderer.domElement;
        const frustum = this.computeOrthoFrustum(this.viewSize, canvas.clientWidth, canvas.clientHeight);
        
        this.camera.left = frustum.left;
        this.camera.right = frustum.right;
        this.camera.top = frustum.top;
        this.camera.bottom = frustum.bottom;
        
        this.camera.updateProjectionMatrix();
    }

    identifyCameraParameters() {
        if (!this.camera || !this.controls) return null;
        
        const position = this.camera.position;
        const target = this.controls.target;
        
        const offset = new THREE.Vector3().subVectors(position, target);
        const distance = offset.length();
        
        // Prevent division by zero or NaN propagation
        if (distance < 0.0001 || isNaN(distance)) {
            return {
                hAngle: 0,
                vAngle: 0,
                distance: isNaN(distance) ? 0 : distance,
                zoom: isNaN(this.camera.zoom) ? 1 : this.camera.zoom
            };
        }
        
        // Calculate Angles
        // Azimuthal (Horizontal) - Angle in XZ plane
        const hRad = Math.atan2(offset.x, offset.z);
        let hAngle = THREE.MathUtils.radToDeg(hRad);
        if (isNaN(hAngle)) hAngle = 0;
        
        // Polar (Vertical) - Angle from XZ plane towards Y axis
        // Use clamping to prevent NaN from floating point precision errors
        const verticalRatio = Math.max(-1, Math.min(1, offset.y / distance));
        const vRad = Math.asin(verticalRatio);
        let vAngle = THREE.MathUtils.radToDeg(vRad);
        if (isNaN(vAngle)) vAngle = 0;
        
        return {
            hAngle: parseFloat(hAngle.toFixed(1)),
            vAngle: parseFloat(vAngle.toFixed(1)),
            distance: parseFloat(distance.toFixed(1)),
            zoom: parseFloat(this.camera.zoom.toFixed(2))
        };
    }

    getAssetInfo(id) {
        if (!window.app || !window.app.assets) return null;
        const normId = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
        // 1. Try exact match first
        const assets = window.app.assets;
        if (assets[id.toUpperCase()]) return assets[id.toUpperCase()];
        if (assets[id]) return assets[id];
        
        // 2. Try normalized match (e.g. RAW_MATERIALS -> RAWMATERIALS)
        for (const [key, val] of Object.entries(assets)) {
            if (key.replace(/[^A-Z0-9]/g, '') === normId) return val;
        }
        return null;
    }
    getCameraConfig() {
        if (!this.camera || !this.controls) return null;
        const params = this.identifyCameraParameters();
        return {
            position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
            zoom: this.camera.zoom,
            angles: {
                horizontalAngle: params ? params.hAngle : 0,
                verticalAngle: params ? params.vAngle : 0
            },
            frustum: {
                left: this.camera.left,
                right: this.camera.right,
                top: this.camera.top,
                bottom: this.camera.bottom
            },
            near: this.camera.near,
            far: this.camera.far
        };
    }

    setCameraView(position, target, zoom = 1) {
        if (!this.controls || !this.camera) return;

        this.camera.position.copy(position);
        this.controls.target.copy(target);
        this.camera.zoom = zoom;
        
        this.camera.updateProjectionMatrix();
        this.controls.update();

        console.log('[Scene] Camera Config:', this.getCameraConfig());
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

        // Screen-Matched Industrial Pseudo-Isometric View (from User Screenshot)
        this.defaultTarget = new THREE.Vector3(-6.84, -4.58, 10.27);
        // Derived from H:45, V:27.9, Dist:1280.6
        this.defaultPosition = new THREE.Vector3(793.43, 594.61, 810.54); 
        this.defaultZoom = 1.13;

        // Force strictly vertical orientation to fix "bending" artifact
        this.camera.up.set(0, 1, 0); 
        this.camera.position.copy(this.defaultPosition);
        this.camera.lookAt(this.defaultTarget);
        this.camera.zoom = this.defaultZoom;
        this.camera.updateProjectionMatrix();

        // Use standard depth buffer for Orthographic stability
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

        // HDRI & Lights
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        window.addEventListener('resize', () => this.onWindowResize());
        this._setupCoordinateTracker();
    }

    _setupCoordinateTracker() {
        // 1. Coordinate Tracker (Bottom Right)
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
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            display: none; 
            z-index: 1000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            pointer-events: none;
        `;
        this.container.appendChild(this.coordsOverlay);

        // 2. Energy Toggle Overlay (Bottom Center) - Removed per user request
        // Energy controls overlay is no longer needed
    }

    _updateCoordinateTracker() {
        if (!this.coordsOverlay || !this.controls || !this.camera) return;
        
        // Visibility control: Only in energy_analytics mode
        const isEnergyMode = window.app && window.app.activeContext && window.app.activeContext.type === 'energy_analytics';
        this.coordsOverlay.style.display = isEnergyMode ? 'block' : 'none';
        
        if (!isEnergyMode) return;

        const params = this.identifyCameraParameters();
        const target = this.controls.target;
        
        const safeX = isNaN(target.x) ? "0.00" : target.x.toFixed(2);
        const safeY = isNaN(target.y) ? "0.00" : target.y.toFixed(2);
        const safeZ = isNaN(target.z) ? "0.00" : target.z.toFixed(2);

        // Update Right Coordinates (Fewer updates, but still necessary for tracking)
        if (!params) {
            this.coordsOverlay.innerHTML = '<span style="color:#ef4444">CAM ERR</span>';
            return;
        }

        this.coordsOverlay.innerHTML = `
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 6px 12px;">
                <span><small style="color:var(--primary)">X:</small>${safeX}</span>
                <span><small style="color:var(--primary)">Y:</small>${safeY}</span>
                <span><small style="color:var(--primary)">Z:</small>${safeZ}</span>
                <span><small style="color:var(--primary)">Z:</small>${params.zoom || "1.0"}</span>
                <span><small style="color:var(--primary)">H:</small>${params.hAngle}°</span>
                <span><small style="color:var(--primary)">V:</small>${params.vAngle}°</span>
                <span><small style="color:var(--primary)">D:</small>${params.distance}</span>
                <span><small style="color:var(--primary)">S:</small>${this.viewSize}</span>
            </div>
        `;
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
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);

        if (intersects.length > 0) {
            const deviceId = intersects[0].object.userData.deviceId;
            if (deviceId) {
                this.selectDevice(deviceId);
            }
        }
    }

    /**
     * Generates invisible hit-box meshes for each machine group to ensure 
     * stable raycasting (no gaps or internal mesh interference).
     */
    _updateHitZones() {
        // Clean up existing group
        if (this.hitGroup) {
            this.scene.remove(this.hitGroup);
            this.hitGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
        
        this.hitGroup = new THREE.Group();
        this.hitGroup.name = 'InteractionHitZones';
        this.scene.add(this.hitGroup);
        
        this.hitBoxMeshes = [];
        const processedNodes = new Set();
        
        console.log('[Scene] Updating hit zones for manualMap:', Object.keys(this.manualMap).length);

        for (const [id, targetName] of Object.entries(this.manualMap)) {
            if (!targetName) continue;
            
            const node = this.nodeRegistry.get(targetName.toLowerCase());
            if (!node || processedNodes.has(node)) continue;
            processedNodes.add(node);

            // Calculate world-space bounding box
            const box = new THREE.Box3().setFromObject(node);
            if (box.isEmpty()) continue;

            // Expand box slightly (Padding) to prevent flickering at edges and improve "stickiness"
            box.expandByScalar(0.15);

            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);

            // Create invisible proxy mesh
            const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const material = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00, 
                visible: false, 
                transparent: true, 
                opacity: 0 
            }); 
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(center);
            mesh.userData.deviceId = id;
            mesh.name = `HitZone_${id}`;
            
            this.hitGroup.add(mesh);
            this.hitBoxMeshes.push(mesh);
        }
        console.log(`[Scene] Generated ${this.hitBoxMeshes.length} unique hit zones.`);
    }

    /**
     * Resolves a machine/device ID from a 3D object by traversing upwards
     * and checking against manual mapping and node registry.
     */
    _resolveDeviceIdFromObject(object) {
        if (!object) return null;

        let current = object;
        while (current) {
            // Check if this node is floor/plant/ignore
            const normCurrent = current.name.toLowerCase().trim();
            if (normCurrent.includes('floor') || normCurrent.includes('ground') || normCurrent.includes('warehouse') || normCurrent.includes('plant') || normCurrent.includes('plane')) {
                return null; // Ignore plant-level elements strictly
            }

            // Check for manual mapping or ID match
            const matchedId = Object.keys(this.manualMap).find(id => {
                const target = this.manualMap[id];
                return target && (normCurrent === target.toLowerCase() || normCurrent === id.toLowerCase());
            });

            if (matchedId) {
                return matchedId;
            }
            current = current.parent;
        }
        return null;
    }


    onPointerMove(event) {
        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.pointerMoved = true; // Flag for raycasting throttle
    }

    /**
     * Specialized Hover Handler (Synchronous)
     * Executed within the render loop to ensure interaction happens on stable state.
     */
    handleHover() {
        if (!this.raycaster || !this.camera || !this.hitBoxMeshes.length) return;
        
        // [PERF] Only raycast if the mouse has actually moved since the last frame
        if (!this.pointerMoved) return;
        this.pointerMoved = false; // Reset for next frame

        this.raycaster.setFromCamera(this.pointer, this.camera);

        // Raycast against stable hit zones only
        const intersects = this.raycaster.intersectObjects(this.hitBoxMeshes);
        
        let hoveredId = null;
        if (intersects.length > 0) {
            hoveredId = intersects[0].object.userData.deviceId;
        }

        // --- Hover Persistence: Prevent drop between frames ---
        if (!hoveredId && this.hoveredDeviceId) {
            // Keep the previous hover if nothing is hit this frame
            return;
        }

        // IMPORTANT: Stabilize cursor to match the current stable or pending hover state
        const isHovering = hoveredId || (this.pendingHoverId && this.pendingHoverId !== null);
        this.renderer.domElement.style.cursor = isHovering ? 'pointer' : 'default';

        // --- Robust Hover Debouncing System ---
        if (this.hoveredDeviceId !== hoveredId) {
            // Already pending this exact state? Skip to avoid resetting cooldown
            if (this.pendingHoverId === hoveredId) return;

            clearTimeout(this.hoverTimeout);
            this.pendingHoverId = hoveredId;

            // Stability: Wait longer (250ms) to clear hover, but switch machines faster (40ms)
            const delay = hoveredId === null ? 250 : 40;
            
            this.hoverTimeout = setTimeout(() => {
                const oldId = this.hoveredDeviceId;
                this.hoveredDeviceId = hoveredId;
                this.pendingHoverId = null;
                this.checkZoom();
                
                // --- Visual Feedback Integration ---
                this.labelRegistry.forEach(data => {
                    if (data && data.element) data.element.classList.remove('hovered');
                });
                
                if (this.hoveredDeviceId) {
                    const label = this.labelRegistry.get(this.hoveredDeviceId);
                    if (label && label.element) {
                        label.element.classList.add('hovered');
                    }
                }

                if (oldId !== hoveredId) {
                    console.log(`[Scene] Hover state: ${hoveredId || 'none'}`);
                    // Trigger UI update only on actual change
                    if (window.app && typeof window.app.onHoverChange === 'function') {
                        window.app.onHoverChange(hoveredId);
                    }
                }
            }, delay);
        } else if (this.pendingHoverId !== hoveredId) {
            // Cancel any pending transitions if we are back to the current stable ID
            clearTimeout(this.hoverTimeout);
            this.pendingHoverId = hoveredId;
        }
    }

    selectDevice(id) {
        if (!id) return;

        // View-aware chip click handling
        if (window.app) {
            const mode = window.app.primaryMode;
            
            // In zones mode: focus camera only, no sidebar changes
            if (mode === 'zones') {
                this.focusOnMachine(id);
                this.activeDeviceId = id;
                return;
            }
            
            // All other modes: use setContext for proper routing
            // Energy mode is handled in setContext (keeps chips alive)
            window.app.setContext('machine', id);
        }

        this.activeDeviceId = id;
        this.focusOnMachine(id);
    }

    /**
     * Resets interaction state and returns camera to department/plant overview.
     */
    resetInteraction() {
        this.activeDeviceId = null;
        this.isolateGroup([]); // Restore all materials and frame overview
        this.resetToDefaultView();

        // Ensure chips are visible after exiting alarm mode
        this.labelRegistry.forEach(data => {
            if (data && data.element) data.element.style.display = 'block';
        });

        // Hide all warning meshes by default unless telemetry dictates otherwise
        this.warningMeshes.forEach(m => m.visible = false);
    }

    /**
     * Smoothly glides the camera back to the calibrated plant isometric view.
     */
    resetToDefaultView() {
        if (!this.camera || !this.controls || !this.defaultPosition) return;
        this.animateCamera(this.defaultPosition, this.defaultTarget, this.defaultZoom);
    }

    /**
     * Focuses the camera on a specific machine, maintaining constant scale.
     */
    focusOnMachine(id) {
        const mesh = this.findMesh(id);
        if (!mesh) return;

        // Step 1: Detect Focus Target (Anchor or Mesh Center)
        let targetLookAt = new THREE.Vector3();
        const anchorName = `${id}_FocusAnchor`.toLowerCase();
        const anchor = this.nodeRegistry.get(anchorName) || (this.model ? this.model.getObjectByName(anchorName) : null);
        
        if (anchor) {
            anchor.getWorldPosition(targetLookAt);
        } else {
            const box = new THREE.Box3().setFromObject(mesh);
            if (box.isEmpty()) return;
            box.getCenter(targetLookAt);
        }

        // USER REQUIREMENT: Smooth Forward/Backward movement (isometric translation)
        // Instead of rotating to a front-facing view, we use the EXACT isometric offset of the main view.
        const isometricOffset = new THREE.Vector3().subVectors(this.defaultPosition, this.defaultTarget);
        const cameraTargetPosition = targetLookAt.clone().add(isometricOffset);

        // Transition at high detail zoom (3.5) for the "forward" glide sensation
        const inspectionZoom = 3.5;
        this.animateCamera(cameraTargetPosition, targetLookAt, inspectionZoom);
    }

    /**
     * Smoothly animates the camera to a target position, target lookAt, and target zoom.
     */
    animateCamera(targetPosition, targetLookAt, targetZoom = null) {
        if (!targetPosition || !targetLookAt || !this.camera || !this.controls) return;
        
        // Safety check for NaN
        if (isNaN(targetPosition.x) || isNaN(targetLookAt.x)) {
            console.error('[Scene] Invalid animation target:', targetPosition, targetLookAt);
            return;
        }

        const duration = 2.5; // Seconds (Balanced for responsive yet smooth UX)
        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const startZoom = this.camera.zoom;
        const endZoom = targetZoom !== null ? targetZoom : startZoom;
        
        // Disable controls during animation to prevent state conflict
        this.controls.enabled = false;
        
        // If start and end are same, re-enable and skip
        if (startPos.distanceTo(targetPosition) < 0.01 && 
            startTarget.distanceTo(targetLookAt) < 0.01 && 
            Math.abs(startZoom - endZoom) < 0.001) {
            this.controls.enabled = true;
            return;
        }

        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = (currentTime - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            
            // Ease in-out cubic
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // Update state
            this.camera.position.lerpVectors(startPos, targetPosition, ease);
            this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
            this.camera.zoom = THREE.MathUtils.lerp(startZoom, endZoom, ease);
            
            // Stabilize orientation
            this.camera.up.set(0, 1, 0); 
            
            // Critical Updates: Ensure all matrices are valid
            this.camera.updateMatrixWorld(true);
            this.camera.updateProjectionMatrix();
            this.controls.update();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                // Ensure final state is exact and stable
                this.camera.position.copy(targetPosition);
                this.controls.target.copy(targetLookAt);
                this.camera.zoom = endZoom;
                this.camera.up.set(0, 1, 0);
                this.camera.updateMatrixWorld(true);
                this.camera.updateProjectionMatrix();
                this.controls.update();
                this.controls.enabled = true; // Re-enable controls
                console.log('[Scene] Animation Complete. Config:', this.getCameraConfig());
            }
        };

        requestAnimationFrame(animate);
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
            const isAlarmMode = window.app && window.app._isAlarmMode(window.app.primaryMode);
            
            if (isAlarmMode) {
                this.highlightAlarms();
            } else {
                this.model.traverse((node) => {
                    if (node.isMesh && node.userData.originalMaterial) {
                        node.material = node.userData.originalMaterial;
                        node.userData.isGhosted = false;
                    }
                });
            }
            return;
        }

        // [PERF] Pre-calculate the active set to turn O(N*M) traversal into O(N)
        const activeNodes = deviceIds.map(id => this.findMesh(id)).filter(Boolean);
        const activeMeshesSet = new Set();
        activeNodes.forEach(root => {
            root.traverse(n => {
                if (n.isMesh) activeMeshesSet.add(n);
            });
        });

        const isAlarmMode = window.app && window.app._isAlarmMode(window.app.primaryMode);

        this.model.traverse((node) => {
            if (node.isMesh) {
                if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;

                const isActive = activeMeshesSet.has(node);
                
                // Warning meshes ignore ghosting
                if (node.name.toLowerCase().includes('warning')) return;

                // [Phase 23] Find if this mesh belongs to a machine in fault
                let belongsToFault = false;
                if (isAlarmMode) {
                    for (const [mid, mName] of Object.entries(this.manualMap)) {
                        if (mName && node.name.toLowerCase().includes(mName.toLowerCase())) {
                            const cache = window.app.liveState.get(mid.toUpperCase());
                            const state = (cache?.get('CalculatedState') || '').toLowerCase();
                            if (['fault', 'error', 'stopped'].includes(state)) belongsToFault = true;
                            break;
                        }
                    }
                }

                if (isActive || (isAlarmMode && belongsToFault)) {
                    // Restore original texture for focused OR faulty machines
                    node.material = node.userData.originalMaterial;
                    node.userData.isGhosted = false;

                    // Add emissive glow ONLY for fault machines, NOT for focused healthy ones
                    if (isAlarmMode && belongsToFault) {
                        node.material = node.userData.originalMaterial.clone();
                        node.material.emissive = new THREE.Color(0xff0000);
                        node.material.emissiveIntensity = 0.6;
                    } else if (node.material.emissive) {
                        node.material.emissive.setHex(0x000000);
                    }
                } else {
                    // Gray out / Ghost everything else
                    this._ghostNode(node, isAlarmMode);
                    if (node.material.emissive) {
                        node.material.emissive.setHex(0x000000);
                    }
                }
            }
        });

        // Hide ALL labels in Zone/Plant view for clean look, but keep them in Energy mode
        const isEnergyMode = window.app && window.app.primaryMode === 'energy';
        if (!isEnergyMode) {
            this.labelRegistry.forEach(label => label.element.style.display = 'none');
        }

        // Frame the active group or focus if single machine
        if (deviceIds.length === 1) {
            this.focusOnMachine(deviceIds[0]);
        } else {
            this.frameGroup(activeNodes);
        }

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

        // Optimal Zonal Zoom Calculation (Orthographic)
        const maxDim = Math.max(size.x, size.y, size.z);
        const padding = 1.1; // Tighter fit for better detail (Reduced from 1.3)
        
        // Based on frustumSize = 1000 in constructor/resize
        const frustumBase = 1000; 
        const aspect = window.innerWidth / window.innerHeight;
        
        // Calculate zoom to fit world maxDim into world-space frustum
        let targetZoom = (frustumBase * aspect) / (maxDim * padding);
        
        // Clamp zoom for zones to keep a high-level department overview
        targetZoom = Math.max(0.8, Math.min(targetZoom, 2.5)); // Increased max from 1.8 to 2.5

        // Use the EXACT isometric angle for the gliding effect
        const isometricOffset = new THREE.Vector3().subVectors(this.defaultPosition, this.defaultTarget);
        const cameraTargetPosition = center.clone().add(isometricOffset);

        console.log(`[Scene] Zonal Focus: Framing ${nodes.length} nodes at zoom ${targetZoom.toFixed(2)}`);
        this.animateCamera(cameraTargetPosition, center, targetZoom);
    }

    frameAllMachines() {
        if (!this.model) return;
        const machineNodes = [];
        // Frame everything in the manualMap that isn't null
        Object.keys(this.manualMap).forEach(id => {
            if (this.manualMap[id]) {
                const node = this.findMesh(id);
                if (node) machineNodes.push(node);
            }
        });

        if (machineNodes.length > 0) {
            this.frameGroup(machineNodes);
        }
    }

    resetInteraction() {
        this.activeDeviceId = null;
        this.isolateGroup(null);
        // Reset camera to default overview position
        this.resetToDefaultView();

        // Show labels in overview
        this.labelRegistry.forEach(label => label.element.style.display = 'block');
    }

    /**
     * Diagnostic View: Highlights machines in fault state and hides standard UI labels.
     */
    highlightAlarms() {
        if (!this.model) return;

        // Hide ALL machine-chip labels for a clean diagnostic look
        this.labelRegistry.forEach(data => {
            if (data && data.element) data.element.style.display = 'none';
        });

        this.model.traverse((node) => {
            if (node.isMesh) {
                if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;

                // Find if this mesh belongs to a machine in fault
                let belongsToFault = false;
                let machineId = null;

                if (window.app && window.app.telemetryStore) {
                    for (const [mid, mName] of Object.entries(this.manualMap)) {
                        if (mName && node.name.toLowerCase().includes(mName.toLowerCase())) {
                            machineId = mid;
                            break;
                        }
                    }

                    if (machineId) {
                        const cache = window.app.telemetryStore.get(machineId.toUpperCase());
                        const state = (cache?.get('CalculatedState') || '').toLowerCase();
                        if (['fault', 'error', 'stopped'].includes(state)) {
                            belongsToFault = true;
                        }
                    }
                }

                if (belongsToFault) {
                    // [Phase 23] Preserve textures even in global alarm mode
                    node.material = node.userData.originalMaterial.clone();
                    node.material.emissive = new THREE.Color(0xff0000);
                    node.material.emissiveIntensity = 0.6;
                    node.userData.isGhosted = false;
                } else {
                    this._ghostNode(node, true);
                }

                // Sync 3D Warning Mesh visibility with fault state
                if (machineId) {
                    const wMesh = this.warningMeshes.get(machineId);
                    if (wMesh) wMesh.visible = belongsToFault;
                }
            }
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

    _ghostNode(node, isDiagnostic = false) {
        if (isDiagnostic) {
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
        } else {
            // High-end Transparent Ghosting for Energy/Zones
            if (!node.userData.standardGhostMaterial) {
                node.userData.standardGhostMaterial = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    roughness: 0.5,
                    metalness: 0,
                    transparent: true,
                    opacity: 0.15,
                    depthWrite: false
                });
            }
            node.material = node.userData.standardGhostMaterial;
        }
        node.userData.isGhosted = true;
    }

    async loadModel(path) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(path);
        this.model = gltf.scene;
        this.scene.add(this.model);

        let baseWarningMesh = null;
        let totalNodes = 0;
        let unnamedNodes = 0;
        let prunedNodes = 0;

        this.model.traverse(c => {
            totalNodes++;
            if (!c.name) {
                unnamedNodes++;
                return;
            }
            const normName = c.name.toLowerCase();

            // Template Detection: The warning mesh 'error' is needed for cloning
            if (normName === 'error' || normName === 'warning' || normName === 'symbol') {
                if (!baseWarningMesh) {
                    baseWarningMesh = c.clone();
                    baseWarningMesh.visible = false;
                }
                c.visible = false;
                c.matrixAutoUpdate = false;
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
                prunedNodes++;
                c.visible = false;
                c.matrixAutoUpdate = false; // Freeze it
                return;
            }

            // Track all nodes (groups and meshes) for ID resolution
            if (!this.nodeRegistry.has(normName) || c.isMesh) {
                this.nodeRegistry.set(normName, c);
                this.normNodeRegistry.set(normName.replace(/[^a-z0-9]/g, ''), c);
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

        console.log(`[Scene] Model loaded. Total nodes in GLB: ${totalNodes} (Unnamed: ${unnamedNodes}, Pruned: ${prunedNodes})`);
        console.log('[Scene] Registered for interaction:', this.nodeRegistry.size, 'Meshes:', this.meshRegistry.size);
        console.log('[Scene] All node names:', [...this.nodeRegistry.keys()].sort().join(', '));

        // Dismiss loading screen once model is ready
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
            setTimeout(() => loadingScreen.remove(), 700);
        }
        
        // Finalize scene metadata and hit zones
        this.model.updateMatrixWorld(true);
        this._updateHitZones();

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
        
        // 2.1 [PERF] Fast Normalized Match
        if (this.normNodeRegistry.has(normId)) {
            const match = this.normNodeRegistry.get(normId);
            this.manualMap[id] = match.name.toLowerCase();
            return match;
        }

        let bestMatch = null;
        let bestPriority = -1;

        // 3. Normalized fuzzy search with priority
        for (const [normName, node] of this.normNodeRegistry.entries()) {
            if (normName.includes(normId) || normId.includes(normName)) {
                let priority = 0;
                // Perfect alpha-numeric match (redundant if 2.1 worked, but good for sub-containment)
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
        if (!this.model) return null; // Safety Guard: Skip deep scan if model is not loaded
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
        if (!this.model) return; // Safety Guard: Skip update if model is not loaded
        if (!rawId || !data) return;

        // Strict ID Unification: Strip symbols, underscores, and spaces
        let id = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (id === 'plant' || id === 'pack01' || id === 'outbound02') return; // Skip devices with no mesh in the scene

        // Strict Unification: Storage and Inbound are RAWMATERIALS
        const isRawMaterials = id.includes('storage') || id.includes('inbound') || id.includes('raw');
        if (isRawMaterials) {
            id = 'RAWMATERIALS';
        } else {
            id = id.toUpperCase();
        }

        // State lookup logic (Unified for Storage/Raw Materials)
        const stateLookupId = id; // Already unified to RAWMATERIALS if applicable
        const stateColor = window.app && window.app.stateManager ? window.app.stateManager.getDeviceState(stateLookupId) : null;
        const hex = stateColor ? '#' + stateColor.color.toString(16).padStart(6, '0') : null;

        let labelId = id;
        const assetInfo = window.app && typeof window.app._findAsset === 'function' ? window.app._findAsset(id) : null;
        let displayName = (assetInfo && assetInfo.name ? assetInfo.name : id).toUpperCase().replace(/_/g, ' ');

        // HIGH PRIORITY MANUAL REFINEMENTS
        if (id.includes('inspection')) displayName = 'X RAY';
        if (id.toLowerCase() === 'raw_materials') displayName = 'RAW MATERIALS';
        if (id.toLowerCase().includes('storage') || id.toLowerCase().includes('inbound')) displayName = 'RAW MATERIALS';

        let mesh = this.findMesh(id);
        // FORCE: Raw materials always anchor to the main storage bin mesh
        if (id === 'RAWMATERIALS') {
            mesh = this.nodeRegistry.get('storage_01001') || mesh;
        }

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
            div.style.pointerEvents = 'auto'; // Make entire chip clickable
            div.style.cursor = 'pointer';
            // Retrieve icon directly from asset metadata (assets.json)
            // This fixes the overlap by ensuring ONLY defined machines get labels.
            let iconName = (assetInfo && assetInfo.icon) ? assetInfo.icon : '';
            
            // If no explicit icon is defined for this ID, skip label creation.
            // This prevents "ghost" icons for un-unified or internal IDs.
            if (!iconName) return;

            div.innerHTML = `
                <div class="chip-header">
                    <span class="chip-status-dot material-symbols-outlined">${iconName}</span>
                </div>
                <!-- Unified Value Display (Directly replaces dot in Energy Mode) -->
                <div class="chip-unified-value"></div>
                <!-- The value container for energy view -->
                <div class="chip-value"></div>
            `;

            div.onclick = (event) => {
                event.stopPropagation(); 
                // [PERF] Yield to the browser's paint thread to improve INP
                setTimeout(() => {
                    window.app.setContext('machine', id);
                }, 0);
            };

            label = new CSS2DObject(div);

            // Precision World-Space Anchoring
            const box = new THREE.Box3().setFromObject(mesh);
            const center = new THREE.Vector3();
            box.getCenter(center);
            
            // USER REQUEST: Position icons just above machines to avoid "ghostly" floating
            const suffixMatch = id.match(/_?(\d+)$/);
            const index = suffixMatch ? parseInt(suffixMatch[1]) : 0;

            // Base offset 0.5 (reduced from 3.5) + cascading step (index * 0.5)
            const stepOffset = index > 0 ? (index - 1) * 0.5 : 0;
            const verticalOffset = 0.5 + stepOffset;

            const worldTopCenter = new THREE.Vector3(
                center.x,
                box.max.y + verticalOffset,
                center.z
            );

            // Save world position BEFORE
            const warningWorldPos = worldTopCenter.clone();

            label.position.copy(worldTopCenter);

            this.scene.add(label);
            this.labelRegistry.set(id, { element: div, parent: this.scene, object: label });

            // Attach Warning Mesh at WORLD coordinates (scene root)
            // Adding to scene root avoids all parent transform issues
            if (this.baseWarningMesh) {
                const warningClone = this.baseWarningMesh.clone();

                // Direct world-space scale (no parent compensation needed)
                const targetSize = 0.8; // User Request: 22px equivalent (~0.8 units)
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

        if (stateColor && hex) {
            const dotIndicator = element.querySelector('.chip-status-dot');
            if (dotIndicator) {
                // Remove background/box-shadow as user wants no background
                dotIndicator.style.backgroundColor = 'transparent';
                dotIndicator.style.boxShadow = 'none';
                
                // Set icon color dynamically based on state
                // [PERF] Removed expensive text-shadow glow which caused 150ms+ renderer violations
                dotIndicator.style.color = hex;
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

        // Cache data for immediate redraw on mode switch
        this.persistentValues.set(id, data);

        // ── Dynamic Value Display ──
        const valueEl = element.querySelector('.chip-value');
        const unifiedEl = element.querySelector('.chip-unified-value');
        const headerEl = element.querySelector('.chip-header');

        if (this.chipDisplayMode === 'energy') {
            if (headerEl) headerEl.style.display = 'none';
            if (valueEl) valueEl.classList.remove('visible');
            
            if (unifiedEl) {
                const rawKW = this.getValue(data, 'Instant_kW') || 0;
                const targetKW = parseFloat(rawKW);
                
                // Initialize or update interpolation target
                if (!this.interpolatedValues.has(id)) {
                    this.interpolatedValues.set(id, { 
                        current: targetKW, 
                        target: targetKW, 
                        element: unifiedEl,
                        lastFormatted: targetKW.toFixed(2),
                        unit: 'kW'
                    });
                    unifiedEl.textContent = `${targetKW.toFixed(2)} kW`;
                } else {
                    const entry = this.interpolatedValues.get(id);
                    entry.target = targetKW;
                    entry.element = unifiedEl; 
                }

                unifiedEl.style.display = 'block';
                // Premium look for energy value
                unifiedEl.style.background = 'linear-gradient(135deg, #2a1e19, #1c1411)';
                unifiedEl.style.borderRadius = '12px';
                unifiedEl.style.padding = '4px 10px';
                unifiedEl.style.color = 'var(--primary)';
                unifiedEl.style.fontWeight = '900';
                unifiedEl.style.fontSize = '12px';
                unifiedEl.style.border = '1px solid rgba(236, 91, 19, 0.4)';
                unifiedEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
            }
        } else {
            if (headerEl) headerEl.style.display = 'flex';
            if (unifiedEl) unifiedEl.style.display = 'none';
            if (valueEl) valueEl.classList.remove('visible'); // Default to hidden for cleaner look
        }
    }

    setLabelMode(id, mode) {}

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

            if (slot && slot.textContent !== val) {
                slot.textContent = val;
                slot.classList.add('value-updated');
                setTimeout(() => slot.classList.remove('value-updated'), 500);
            }
        });
    }

    /**
     * Smoothly lerps telemetry values for 3D labels.
     * Prevents "jumpy" UI during high-frequency WebSocket streams.
     */
    updateInterpolations(deltaTime) {
        const lerpFactor = Math.min(deltaTime * 8.0, 1.0); // Slightly faster lerp
        
        this.interpolatedValues.forEach((data, id) => {
            if (Math.abs(data.current - data.target) > 0.0001) {
                data.current += (data.target - data.current) * lerpFactor;
                
                // [PERF] Only update DOM if the formatted string has actually changed
                // This prevents redundant layout thrashing during fine lerp adjustments
                const formatted = data.current.toFixed(2);
                if (formatted !== data.lastFormatted) {
                    data.lastFormatted = formatted;
                    if (data.element) {
                        data.element.textContent = `${formatted} ${data.unit}`;
                    }
                }
            } else if (data.current !== data.target) {
                data.current = data.target;
                const formatted = data.current.toFixed(2);
                data.lastFormatted = formatted;
                if (data.element) {
                    data.element.textContent = `${formatted} ${data.unit}`;
                }
            }
        });
    }

    checkZoom(zoomDelta, posDelta) {
        if (!this.camera) return;
        
        // [PERF] Skip expensive DOM visibility iteration if camera state is stable
        if (zoomDelta < 0.001 && posDelta < 0.01) return;
        
        this.lastCameraZoom = this.camera.zoom;
        this.lastCameraPos.copy(this.camera.position);

        // [PERF] Only apply styles to labels if they aren't already visible/correct
        // This avoids layout thrashing every single frame
        this.labelRegistry.forEach((data, id) => {
            if (!data) return;
            const element = data.element;
            if (element && element.style.display !== 'block') {
                element.style.display = 'block';
                element.classList.remove('mini');
            }
        });
    }

    onWindowResize() {
        // MUST update renderer size BEFORE updating camera frustum to prevent stretching
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.updateFrustum();
    }

    start() {
        // Animation Clock for Warning Meshes
        const clock = new THREE.Clock();

        const loop = () => {
            requestAnimationFrame(loop);
            const elapsedTime = clock.getElapsedTime();

            // --- Event-Driven Pipeline ---
            // Removed synchronous data processing from render loop
            // Data is now processed asynchronously as it arrives in main.js  

            this.controls.update();

            // [PERF] Throttle interactions to improve frame consistency
            // [PERF] Only raycast every 4 frames AND only if pointer actually moved
            // This drastically reduces CPU overhead for interaction checks
            if (window.app && this.pointerMoved && this.frameCounter % 4 === 0) {
                this.handleHover();
            }

            this.frameCounter++;
            const zoomDelta = Math.abs(this.camera.zoom - this.lastCameraZoom);
            const posDelta = this.camera.position.distanceTo(this.lastCameraPos);
            const isMoving = this.pointerMoved || zoomDelta > 0.001 || posDelta > 0.01;

            this.checkZoom(zoomDelta, posDelta);
            this._updateCoordinateTracker();

            // Update Value Interpolations
            const deltaTime = clock.getDelta();
            this.updateInterpolations(deltaTime);

            // Animate Warning Meshes (Static Orientation, Pulse Scale)
            this.warningMeshes.forEach(wMesh => {
                if (wMesh.visible) {
                    const scalePulse = 1.0 + Math.sin(elapsedTime * 4.0) * 0.15;
                    wMesh.scale.copy(wMesh.userData.baseScale).multiplyScalar(scalePulse);
                }
            });

            this.renderer.render(this.scene, this.camera);
            
            if (isMoving || this.frameCounter % 2 === 0) {
                this.labelRenderer.render(this.scene, this.camera);
            }
        };
        loop();
    }
}

export default SceneManager;