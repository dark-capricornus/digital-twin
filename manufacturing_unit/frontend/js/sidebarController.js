/**
 * SidebarController V1.2
 * Unified right sidebar: zone carousel → asset carousel → 5 sections
 * Sections: Asset Details → Plant Data → Production → Alarms → Maintenance
 */

export default class SidebarController {
    constructor() {
        this.zones = [];
        this.zoneAssets = {};
        this.zoneLabels = {};
        this.currentZoneIndex = 0;
        this.currentAssetId = null;
        this.onAssetSelect = null;
        this.onZoneChange = null;
        this.onCollapse = null;
        this.isInitialized = false;
        this.assetData = {};

        // [USER] Track expanded/navigation state of 7 sections (OPEN BY DEFAULT)
        this.expandedSections = new Set([
            'MACHINE METRICS',
            'ENERGY CONSUMPTION',
            'PRODUCTION DATA',
            'STATUS & RUN INFO',
            'ALARMS',
            'MAINTENANCE',
            'ASSET INFO'
        ]);
        this.container = null;
    }

    /**
     * Initialize with zone/machine data from main app
     */
    init(machineGroups, departmentLabels, callbacks = {}) {
        this.container = document.getElementById('hud-right-sidebar');
        if (!this.container) return;

        this.zones = Object.keys(machineGroups);
        this.zoneAssets = machineGroups;
        this.zoneLabels = departmentLabels || {};
        this.onAssetSelect = callbacks.onAssetSelect || null;
        this.onZoneChange = callbacks.onZoneChange || null;
        this.onCollapse = callbacks.onCollapse || null;

        if (callbacks.assetData) this.assetData = callbacks.assetData;

        this.isInitialized = true;

        // [COMPONENT] Inject self-contained HTML
        this._injectBaseHTML();
        this._attachBaseListeners();
    }

    _injectBaseHTML() {
        this.container.innerHTML = `
            <div class="sb-header-main">
                <div class="sb-dept-name">
                    <button id="zone-prev" class="zone-nav-btn"><span class="material-symbols-outlined">chevron_left</span></button>
                    <div class="sb-dept-title-group">
                        <span id="zone-name" class="sb-dept-title">---</span>
                        <span class="sb-dept-sub">DEPARTMENT</span>
                    </div>
                    <button id="zone-next" class="zone-nav-btn"><span class="material-symbols-outlined">chevron_right</span></button>
                </div>

                <div class="sb-asset-name-row">
                    <button id="asset-prev" class="asset-nav-btn"><span class="material-symbols-outlined">chevron_left</span></button>
                    <span id="sidebar-asset-name" class="sb-asset-name">SELECT ASSET</span>
                    <button id="asset-next" class="asset-nav-btn"><span class="material-symbols-outlined">chevron_right</span></button>
                </div>

                <div id="asset-carousel" class="sb-pill-carousel" style="display:none"></div>

                <div class="sb-uptime-row">
                    <span>UPTIME</span>
                    <span id="sidebar-uptime" class="sb-uptime-val">---</span>
                </div>

                <div class="sb-metrics-label">METRICS</div>
            </div>

            <div id="sidebar-scroll">
                <div id="metric-segments-container"></div>
                <div id="sidebar-dynamic-content"></div> 
            </div>
        `;
    }

    _attachBaseListeners() {
        const prevBtn = document.getElementById('zone-prev');
        const nextBtn = document.getElementById('zone-next');
        const assetPrev = document.getElementById('asset-prev');
        const assetNext = document.getElementById('asset-next');

        if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); this._cycleZone(-1); };
        if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); this._cycleZone(1); };
        if (assetPrev) assetPrev.onclick = (e) => { e.stopPropagation(); this._navigateAsset(-1); };
        if (assetNext) assetNext.onclick = (e) => { e.stopPropagation(); this._navigateAsset(1); };

        this.sidebarEl = this.container;

        // [USER] Close sidebar on outside click
        document.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (!this.sidebarEl || this.sidebarEl.classList.contains('collapsed')) return;
            if (this.sidebarEl.contains(e.target)) return;
            // Don't collapse/reset for 3D canvas clicks
            const container = document.getElementById('container');
            const is3D = container && container.contains(e.target);
            if (!is3D && this.onCollapse) this.onCollapse();
        });
    }

    setZoneById(zoneId) {
        const idx = this.zones.indexOf(zoneId);
        if (idx >= 0 && (idx !== this.currentZoneIndex || !this._hasRenderedZone)) {
            this.currentZoneIndex = idx;
            this._hasRenderedZone = true;
            this._renderZone();
        }
    }

    setAsset(assetId) {
        if (this.currentAssetId === assetId) return;

        for (let i = 0; i < this.zones.length; i++) {
            if (this.zoneAssets[this.zones[i]].includes(assetId)) {
                if (i !== this.currentZoneIndex) {
                    this.currentZoneIndex = i;
                    this._renderZone();
                }
                break;
            }
        }

        this.currentAssetId = assetId;

        this._updateAssetNameHeader();

        // Reset uptime for new asset
        const uptimeEl = document.getElementById('sidebar-uptime');
        if (uptimeEl) uptimeEl.textContent = '---';

        const scrollEl = document.getElementById('sidebar-scroll');
        if (scrollEl) scrollEl.dataset.detailContext = '';
    }

    getCurrentZone() {
        return this.zones[this.currentZoneIndex] || null;
    }

    collapse() {
        if (this.sidebarEl) this.sidebarEl.classList.add('collapsed');
    }

    expand() {
        if (this.sidebarEl) this.sidebarEl.classList.remove('collapsed');
    }

    get isCollapsed() {
        return this.sidebarEl?.classList.contains('collapsed') || false;
    }

    /**
     * Main update — receives 5 section data objects
     */
    update(data) {
        if (!this.isInitialized) return;
        this.lastUpdateData = data;

        const container = document.getElementById('metric-segments-container');
        if (!container) return;

        // Update Uptime in Header
        const uptimeEl = document.getElementById('sidebar-uptime');
        if (uptimeEl && data.uptime != null) {
            const upText = `${data.uptime} MINUTES`;
            if (uptimeEl.textContent !== upText) uptimeEl.textContent = upText;
        }

        // [PALETTE] Cohesive accent set:
        //   - Cool informational hues for telemetry (metrics, status)
        //   - Brand orange for energy (matches primary accent)
        //   - Green for production output (positive)
        //   - Red reserved for alarms only (no pink/magenta competing)
        //   - Amber for maintenance (caution, distinct from alarm red)
        //   - Neutral slate for asset metadata
        const segmentsDef = [
            ['metrics', 'MACHINE METRICS', '#06B6D4', 'list'],
            ['energy', 'ENERGY CONSUMPTION', '#F97316', 'split'],
            ['production', 'PRODUCTION DATA', '#22C55E', 'split'],
            ['status', 'STATUS & RUN INFO', '#3B82F6', 'list'],
            ['alarms', 'ALARMS', '#EF4444', 'list'],
            ['maintenance', 'MAINTENANCE', '#F59E0B', 'list'],
            ['assetInfo', 'ASSET INFO', '#94A3B8', 'list'],
        ];

        // Structural signature: asset + segment shapes/labels (NO values).
        // Only a label/count change triggers a full re-render, so value flicker stops.
        const sig = this._buildStructuralSignature(data, segmentsDef);
        if (container.dataset.sig !== sig) {
            let html = '';
            segmentsDef.forEach(([key, title, accent, layout]) => {
                if (data[key]) html += this._renderSegmentedBox(title, data[key], accent, layout);
            });
            container.innerHTML = html;
            container.dataset.sig = sig;
            this._attachSegmentListeners();
        }

        // Targeted value/status updates — leaves DOM structure intact.
        segmentsDef.forEach(([key, title, , layout]) => {
            const items = data[key];
            if (!items) return;
            const slug = this._sigKey(title);
            items.forEach((item, i) => {
                const valEl = document.getElementById(`sb-v-${slug}-${i}`);
                if (!valEl) return;
                if (layout === 'split') {
                    const newVal = item.value || '---';
                    if (valEl.textContent !== newVal) valEl.textContent = newVal;
                    const uEl = document.getElementById(`sb-u-${slug}-${i}`);
                    if (uEl) {
                        const newUnit = item.unit || '';
                        if (uEl.textContent !== newUnit) uEl.textContent = newUnit;
                    }
                } else {
                    const txt = `${item.value || '---'} ${item.unit || ''}`.trim();
                    if (valEl.textContent !== txt) valEl.textContent = txt;
                }
                const statusClass = item.status ? `status-${item.status.toLowerCase()}` : '';
                const base = layout === 'split' ? 'sb-metric-value' : 'sb-temp-value';
                const desired = statusClass ? `${base} ${statusClass}` : base;
                if (valEl.className !== desired) valEl.className = desired;
            });
        });
    }

    _sigKey(title) {
        return String(title).replace(/[^a-zA-Z0-9]+/g, '-');
    }

    _buildStructuralSignature(data, segmentsDef) {
        const parts = [this.currentAssetId || ''];
        segmentsDef.forEach(([key, title]) => {
            const items = data[key];
            if (!items) { parts.push(`${title}:0`); return; }
            parts.push(`${title}:${items.length}:${items.map(it => it.label || '').join('|')}`);
        });
        return parts.join('§');
    }

    _renderSegmentedBox(title, items, accentColor, layout = 'list') {
        const isCollapsed = !this.expandedSections.has(title);
        const slug = this._sigKey(title);
        let itemsHtml = '';

        if (layout === 'split') {
            const left = items[0] || {};
            const right = items[1] || {};
            itemsHtml = `
                <div class="sb-grid-split">
                    ${this._renderMetricPair(left, slug, 0)}
                    <div class="sb-grid-divider"></div>
                    ${this._renderMetricPair(right, slug, 1)}
                </div>
            `;
        } else {
            itemsHtml = `<div class="sb-temp-list">
                ${items.map((item, i) => this._renderMetricListRow(item, slug, i)).join('')}
            </div>`;
        }

        return `
            <div class="sb-segment ${isCollapsed ? 'collapsed' : ''}" style="--accent: ${accentColor}" data-section="${title}">
                <div class="sb-segment-header">
                    <div class="sb-segment-title">${title}</div>
                    <span class="material-symbols-outlined sb-segment-chevron">
                        ${isCollapsed ? 'expand_more' : 'expand_less'}
                    </span>
                </div>
                <div class="sb-segment-body">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    _attachSegmentListeners() {
        const segments = this.container.querySelectorAll('.sb-segment');
        segments.forEach(seg => {
            const header = seg.querySelector('.sb-segment-header');
            header.onclick = (e) => {
                e.stopPropagation();
                const title = seg.dataset.section;
                if (this.expandedSections.has(title)) {
                    this.expandedSections.delete(title);
                    seg.classList.add('collapsed');
                } else {
                    this.expandedSections.add(title);
                    seg.classList.remove('collapsed');
                }
            };
        });
    }

    _renderMetricPair(item, slug, i) {
        const statusClass = item.status ? `status-${item.status.toLowerCase()}` : '';
        return `
            <div class="sb-metric-unit-pair">
                <span class="sb-metric-label">${item.label || '---'}</span>
                <div class="sb-metric-value-row">
                    <span class="sb-metric-value ${statusClass}" id="sb-v-${slug}-${i}">${item.value || '---'}</span>
                    <span class="sb-metric-unit" id="sb-u-${slug}-${i}">${item.unit || ''}</span>
                </div>
            </div>
        `;
    }

    _renderMetricListRow(item, slug, i) {
        const statusClass = item.status ? `status-${item.status.toLowerCase()}` : '';
        return `
            <div class="sb-temp-row">
                <span class="sb-temp-label">${item.label || '---'}</span>
                <span class="sb-temp-value ${statusClass}" id="sb-v-${slug}-${i}">${item.value || '---'} ${item.unit || ''}</span>
            </div>
        `;
    }

    _renderAssetSummary(assetId, status = 'NOMINAL') {
        const headerEl = document.getElementById('sb-asset-header');
        if (!headerEl) return;

        const assetData = (this.assetData && assetId) ? (this.assetData[assetId] || {}) : {};
        const prevService = assetData.last_service_date || assetData.install_date || '---';
        const nextService = assetData.next_service_date || '---';

        const assetIcon = assetData.icon || 'precision_manufacturing';

        const html = `
            <div class="section-header-modern">
                <span class="material-symbols-outlined header-icon">${assetIcon}</span>
                <span class="header-title">ASSET DETAILS</span>
                <span class="material-symbols-outlined header-arrow">chevron_right</span>
            </div>
            <div class="asset-service-row">
                <div class="service-date-cell">
                    <span class="service-date-label">PREV SERVICE</span>
                    <span class="service-date-value">${prevService}</span>
                </div>
                <div class="service-date-cell">
                    <span class="service-date-label">NEXT SERVICE</span>
                    <span class="service-date-value">${nextService}</span>
                </div>
            </div>
        `;

        if (headerEl.dataset.renderedAssetId !== assetId) {
            headerEl.innerHTML = html;
            headerEl.classList.add('vibrant-asset-header');
            headerEl.onclick = () => this.setDetailView('asset');
            headerEl.dataset.renderedAssetId = assetId;
        }
    }

    setDetailView(sectionId) {
        this.activeDetailView = sectionId;
        if (this.lastUpdateData) {
            this.update(this.lastUpdateData);
        }
    }

    goBack() {
        this.activeDetailView = null;
        const scrollEl = document.getElementById('sidebar-scroll');
        if (scrollEl) {
            scrollEl.innerHTML = this.mainTemplate;
            delete scrollEl.dataset.detailContext;
        }
        if (this.lastUpdateData) {
            this.update(this.lastUpdateData);
        }
    }


    // ─── Private ───────────────────────────────────────────

    _updateAssetNameHeader() {
        const nameEl = document.getElementById('sidebar-asset-name');
        if (!nameEl) return;
        if (!this.currentAssetId) {
            nameEl.textContent = 'SELECT ASSET';
            return;
        }
        const raw = String(this.currentAssetId);
        // Preserve IDs like "Furnace_01" (Capitalize first letter of each underscore segment)
        nameEl.textContent = raw
            .split('_')
            .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)
            .join('_');
    }

    _cycleZone(dir, selectLast = false, autoSelectAsset = false) {
        this.currentZoneIndex = (this.currentZoneIndex + dir + this.zones.length) % this.zones.length;
        const zoneId = this.zones[this.currentZoneIndex];
        const assets = this.zoneAssets[zoneId] || [];

        // Zone arrow navigation = zone-level view. Do NOT auto-select the
        // first child machine (that overrides the zone camera/highlights with
        // a single-machine focus). The user has to click an asset pill — or
        // use the asset arrows, which pass autoSelectAsset=true — to drill
        // into a specific machine.
        if (autoSelectAsset && assets.length > 0) {
            this.currentAssetId = selectLast ? assets[assets.length - 1] : assets[0];
            this._renderZone();
            this._updateAssetPills();
            this._scrollToActiveAsset();
            this._updateAssetNameHeader();
            // Only the asset callback fires — it's a machine-level navigation
            // (asset arrow wrapped past a zone boundary). Firing onZoneChange
            // too would race a zone-frame animation against the machine-frame
            // animation, and the last one (zone) would win — leaving the user
            // looking at a zone view while the sidebar shows a single machine.
            if (this.onAssetSelect) this.onAssetSelect(this.currentAssetId);
        } else {
            this.currentAssetId = null;
            this._renderZone();
            this._updateAssetPills();
            this._updateAssetNameHeader();
            if (this.onZoneChange) this.onZoneChange(zoneId);
        }
    }

    _navigateAsset(dir) {
        if (!this.zones.length) return;
        const zoneId = this.zones[this.currentZoneIndex];
        const assets = this.zoneAssets[zoneId] || [];
        const currentIndex = assets.indexOf(this.currentAssetId);

        const commit = (id) => {
            this.currentAssetId = id;
            this._updateAssetPills();
            this._scrollToActiveAsset();
            this._updateAssetNameHeader();
            if (this.onAssetSelect) this.onAssetSelect(id);
        };

        if (dir === 1) {
            if (currentIndex === -1 && assets.length > 0) { commit(assets[0]); return; }
            if (currentIndex < assets.length - 1) {
                commit(assets[currentIndex + 1]);
            } else {
                this._cycleZone(1, false, true);
            }
        } else {
            if (currentIndex === -1 && assets.length > 0) { commit(assets[assets.length - 1]); return; }
            if (currentIndex > 0) {
                commit(assets[currentIndex - 1]);
            } else {
                this._cycleZone(-1, true, true);
            }
        }
    }

    _scrollToActiveAsset() {
        const carousel = document.getElementById('asset-carousel');
        const activePill = carousel?.querySelector('.asset-pill.active');
        if (carousel && activePill) {
            const pillRect = activePill.getBoundingClientRect();
            const carouselRect = carousel.getBoundingClientRect();

            // If pill is outside carousel view, scroll it into view
            if (pillRect.left < carouselRect.left || pillRect.right > carouselRect.right) {
                activePill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    }

    _renderZone() {
        const zoneId = this.zones[this.currentZoneIndex];
        if (!zoneId) return;

        const nameEl = document.getElementById('zone-name');
        if (nameEl) {
            const label = (this.zoneLabels[zoneId] || zoneId).trim();
            nameEl.textContent = label.toUpperCase();
        }

        const carousel = document.getElementById('asset-carousel');
        if (!carousel) return;

        const assets = this.zoneAssets[zoneId] || [];
        carousel.innerHTML = assets.map(id => {
            const isActive = id === this.currentAssetId;
            return `<div class="asset-pill ${isActive ? 'active' : ''}" data-asset-id="${id}">
                <span class="status-dot" id="pill-dot-${id}"></span>
                <span>${id}</span>
            </div>`;
        }).join('');

        carousel.querySelectorAll('.asset-pill').forEach(pill => {
            pill.onclick = () => {
                const id = pill.dataset.assetId;
                this.currentAssetId = id;
                this._updateAssetPills();
                if (this.onAssetSelect) this.onAssetSelect(id);
            };
        });
    }

    _updateAssetPills() {
        document.querySelectorAll('#asset-carousel .asset-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.assetId === this.currentAssetId);
        });
    }

    updateAssetStatuses(getState) {
        const zoneId = this.zones[this.currentZoneIndex];
        if (!zoneId) return;
        for (const id of (this.zoneAssets[zoneId] || [])) {
            const dot = document.getElementById(`pill-dot-${id}`);
            if (!dot) continue;
            const state = getState(id);
            dot.className = 'status-dot';
            if (state === 'fault' || state === 'error' || state === 'alarm') dot.classList.add('fault');
            else if (state === 'warning') dot.classList.add('warning');
            else if (state === 'offline' || state === 'stopped') dot.classList.add('offline');
        }
    }

    /**
     * Clean icon+value row section for Plant/Production
     */
    _updateSectionIconic(containerId, items, sectionId, sectionName, sectionIcon) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const sectionEl = container.closest('.sb-section');
        const header = sectionEl?.querySelector('.sb-section-header');

        if (header) {
            const headerHtml = `
                <div class="section-header-modern" onclick="app.sidebar.setDetailView('${sectionId}')">
                    <span class="material-symbols-outlined header-icon">${sectionIcon}</span>
                    <span class="header-title">${sectionName}</span>
                    <span class="material-symbols-outlined header-arrow">chevron_right</span>
                </div>
            `;
            if (header.dataset.renderedContext !== sectionId) {
                header.innerHTML = headerHtml;
                header.dataset.renderedContext = sectionId;
            }
        }

        const structureId = `${sectionId}-${items.length}`;
        if (container.dataset.renderedStructure !== structureId) {
            container.innerHTML = items.map((item, i) => `
                <div class="sb-clean-row">
                    <span class="material-symbols-outlined sb-row-icon" style="color: ${item.color || 'var(--primary)'}">${item.icon || 'analytics'}</span>
                    <div class="sb-clean-row-right">
                        <span class="sb-row-value" id="summary-val-${sectionId}-${item.id}">---</span>
                        <span class="sb-row-unit">${item.unit || ''}</span>
                    </div>
                </div>
            `).join('');
            container.dataset.renderedStructure = structureId;
        }

        // Live value updates (flicker-free)
        items.forEach(item => {
            const valEl = document.getElementById(`summary-val-${sectionId}-${item.id}`);
            if (valEl) {
                const newVal = item.value || '---';
                if (valEl.textContent !== newVal) valEl.textContent = newVal;
            }
        });
    }

    /**
     * Log section for Alarms/Maintenance — top 1 entry
     */
    _updateModernHeaderSection(containerId, items, sectionId, sectionName, sectionIcon) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const sectionEl = container.closest('.sb-section');
        const header = sectionEl?.querySelector('.sb-section-header');

        if (header) {
            const headerHtml = `
                <div class="section-header-modern" onclick="app.sidebar.setDetailView('${sectionId}')">
                    <span class="material-symbols-outlined header-icon">${sectionIcon}</span>
                    <span class="header-title">${sectionName}</span>
                    <span class="material-symbols-outlined header-arrow">chevron_right</span>
                </div>
            `;
            if (header.dataset.renderedContext !== sectionId) {
                header.innerHTML = headerHtml;
                header.dataset.renderedContext = sectionId;
            }
        }

        if (items.length === 0) {
            const emptyId = `empty-${sectionId}`;
            if (container.dataset.renderedLogId !== emptyId) {
                container.innerHTML = `<div class="empty-log">No active ${sectionId} logs.</div>`;
                container.dataset.renderedLogId = emptyId;
            }
            return;
        }

        const item = items[0];
        const topId = item.id || sectionId;
        if (container.dataset.renderedLogId !== topId) {
            container.innerHTML = `
                <div class="sb-clean-row sb-log-row">
                    <div class="sb-clean-row-left">
                        <span class="material-symbols-outlined sb-row-icon" style="color: ${item.iconColor || 'var(--text-dim)'}">${item.icon || 'info'}</span>
                        <span class="sb-row-label">${item.title || 'STATUS MESSAGE'}</span>
                    </div>
                    <span class="sb-row-time" id="summary-log-time-${sectionId}">${item.time || ''}</span>
                </div>
            `;
            container.dataset.renderedLogId = topId;
        }

        // Live timestamp update
        const timeEl = document.getElementById(`summary-log-time-${sectionId}`);
        if (timeEl && item.time && timeEl.textContent !== item.time) {
            timeEl.textContent = item.time;
        }
    }

    _renderDetailViewPartial(sectionId, data) {
        const scrollEl = document.getElementById('sidebar-scroll');
        if (!scrollEl) return;

        // Initial Detail View Structure: Only render UNLESS the section changed
        if (scrollEl.dataset.detailContext !== sectionId) {
            this._renderDetailViewStructure(sectionId, data);
            scrollEl.dataset.detailContext = sectionId;
        }

        // Live Log Update (History View)
        if (sectionId === 'alarms' || sectionId === 'maintenance') {
            const sectionData = this._getSectionData(sectionId, data);
            const items = sectionData.items || [];
            if (items.length > 0) {
                const historyContainer = document.getElementById('detail-history-content');
                const topId = items[0].id || `${sectionId}-${items.length}`;
                if (historyContainer && historyContainer.dataset.renderedHistoryId !== topId) {
                    historyContainer.innerHTML = items.map(item => `
                        <div class="sb-msg-item detail-log">
                            <span class="material-symbols-outlined msg-icon" style="color: ${item.iconColor || 'var(--text-dim)'}">${item.icon || 'info'}</span>
                            <div class="msg-body">
                                <div class="msg-header">
                                    <span class="msg-title" style="color: var(--text-dim);">${item.title || 'STATUS MESSAGE'}</span>
                                    <span class="msg-time">${item.time || ''}</span>
                                </div>
                                <div class="msg-desc">${item.desc || ''}</div>
                            </div>
                        </div>
                    `).join('');
                    historyContainer.dataset.renderedHistoryId = topId;
                }
            }
            return;
        }

        // 1. Live Update Metadata (Asset Only)
        if (sectionId === 'asset') {
            const assetData = (this.assetData && this.currentAssetId) ? (this.assetData[this.currentAssetId] || {}) : {};
            const assetName = this.currentAssetId ? this.currentAssetId.replace(/_/g, ' ') : 'UNKNOWN ASSET';

            const metaToSync = {
                'name': assetName,
                'model': assetData.model || 'INDUSTRIAL_UNIT',
                'last_service_date': assetData.last_service_date || assetData.install_date || '---',
                'next_service_date': assetData.next_service_date || '---',
                'serial_number': assetData.serial_number || 'SN-XXXX-XXXX',
                'vendor': assetData.vendor || 'INDUSTRIAL_GEN',
                'install_date': assetData.install_date || '2024-01-01',
                'department': assetData.department || 'MANUFACTURING'
            };

            Object.entries(metaToSync).forEach(([id, val]) => {
                const el = document.getElementById(`detail-val-meta-${id}`);
                if (el && el.textContent !== val) el.textContent = val;
            });
            return;
        }

        // 2. Live Update Detail Values (Metrics/Telemetry)
        const sectionData = this._getSectionData(sectionId, data);
        const items = sectionData.items || [];
        items.forEach(item => {
            const valEl = document.getElementById(`detail-val-${item.id}`);
            if (valEl) {
                const newVal = item.value || '---';
                if (valEl.textContent !== newVal) valEl.textContent = newVal;
            }
        });
    }

    _renderDetailViewStructure(sectionId, data) {
        const scrollEl = document.getElementById('sidebar-scroll');
        const sectionData = this._getSectionData(sectionId, data);
        const sectionName = sectionId === 'asset' ? 'METADATA' : `${sectionId.toUpperCase()} DATA`;

        let headerIcon = 'analytics';
        if (sectionId === 'plant') headerIcon = 'factory';
        if (sectionId === 'production') headerIcon = 'inventory_2';
        if (sectionId === 'asset') headerIcon = 'precision_manufacturing';
        if (sectionId === 'alarms') headerIcon = 'warning';
        if (sectionId === 'maintenance') headerIcon = 'build';

        const items = sectionData.items || [];
        const type = sectionData.type || 'metric';

        let itemsHtml;
        if (sectionId === 'asset') {
            // [USER] Asset Detail View: Includes Name, Model, and Service Dates at the top
            const assetName = this.currentAssetId ? this.currentAssetId.replace(/_/g, ' ') : 'UNKNOWN ASSET';
            const assetData = (this.assetData && this.currentAssetId) ? (this.assetData[this.currentAssetId] || {}) : {};
            const metadataCols = [
                { label: 'Asset Name', id: 'name', val: assetName, highlight: true },
                { label: 'Model', id: 'model', val: assetData.model || 'INDUSTRIAL_UNIT', highlight: true },
                { label: 'Prev Service', id: 'last_service_date', val: assetData.last_service_date || assetData.install_date || '---' },
                { label: 'Next Service', id: 'next_service_date', val: assetData.next_service_date || '---' },
                { label: 'Serial Number', id: 'serial_number', val: assetData.serial_number || 'SN-XXXX-XXXX' },
                { label: 'Vendor', id: 'vendor', val: assetData.vendor || 'INDUSTRIAL_GEN' },
                { label: 'Install Date', id: 'install_date', val: assetData.install_date || '2024-01-01' },
                { label: 'Purchase Date', id: 'purchase_date', val: assetData.purchase_date || '---' },
                { label: 'Department', id: 'department', val: assetData.department || 'MANUFACTURING' }
            ];
            itemsHtml = metadataCols.map(m => `
                <div class="detail-meta-row" style="${m.highlight ? 'padding: 14px 16px; background: #FFFFFF08; margin-bottom: 4px;' : ''}">
                    <span class="detail-meta-label">${m.label}</span>
                    <span class="detail-meta-value" id="detail-val-meta-${m.id}" style="color: ${m.color || (m.highlight ? 'var(--primary)' : 'var(--text-dim)')}">---</span>
                </div>
            `).join('');
        } else if (sectionId === 'alarms' || sectionId === 'maintenance') {
            // [USER] History View for Alarms/Maintenance: Uses a container for log-aware updates
            itemsHtml = `<div id="detail-history-content" data-rendered-history-id="-1"></div>`;
        } else {
            // [USER] Telemetry View: Restore stable layout and IDs for flicker-free data updates
            itemsHtml = items.map(item => `
                <div class="sb-detail-row">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span class="material-symbols-outlined m-icon" style="color: ${item.color || 'var(--text-dim)'}">${item.icon || 'analytics'}</span>
                        <span class="detail-label">${item.label || item.id}</span>
                    </div>
                    <div class="detail-value-group">
                        <span class="m-value" id="detail-val-${item.id}" style="color: var(--text-dim);">---</span>
                        <span class="m-unit" style="color: var(--text-dim); opacity: 0.8;">${item.unit || ''}</span>
                    </div>
                </div>
            `).join('');
        }

        const html = `
            <div class="detail-view-container">
                <div class="detail-header">
                    <button class="back-text-btn" onclick="app.sidebar.goBack()">
                        <span class="material-symbols-outlined">arrow_back</span>
                        <span>CLOSE</span>
                    </button>
                    <div class="detail-title centered-detail-title">
                        <span class="material-symbols-outlined">${headerIcon}</span>
                        <span>${sectionName}</span>
                    </div>
                </div>
                <div class="detail-content">
                    ${itemsHtml}
                </div>
            </div>
        `;
        // Strict Structural Render: Only runs once per section toggle
        scrollEl.innerHTML = html;
    }

    _getSectionData(sectionId, data) {
        if (sectionId === 'asset') return { items: data.asset || [], type: 'metric' };
        if (sectionId === 'plant') {
            const p = data.plant;
            return { items: p?.all || p || [], type: 'metric' };
        }
        if (sectionId === 'production') {
            const pr = data.production;
            return { items: pr?.all || pr || [], type: 'output' };
        }
        if (sectionId === 'alarms') return { items: data.alarms || [], type: 'log' };
        if (sectionId === 'maintenance') return { items: data.maintenance || [], type: 'log' };
        return { items: [], type: 'metric' };
    }

    _renderAlarms(items) {
        const el = document.getElementById('sb-alarms');
        if (!el) return;

        if (items.length === 0) {
            el.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 8px 0; opacity: 0.5;">No active alarms.</div>';
            return;
        }

        const html = items.map(item => `
            <div class="sb-msg-item">
                <span class="material-symbols-outlined msg-icon" style="color: ${item.iconColor || 'var(--danger)'}">${item.icon || 'warning'}</span>
                <div class="msg-body">
                    <div class="msg-header">
                        <span class="msg-title">${item.title || 'ALARM'}</span>
                        <span class="msg-time">${item.time || ''}</span>
                    </div>
                    <div class="msg-desc">${item.desc || ''}</div>
                </div>
            </div>
        `).join('');

        if (el.innerHTML !== html) el.innerHTML = html;
    }

    _renderMaintenance(items) {
        const el = document.getElementById('sb-maintenance');
        if (!el) return;

        if (items.length === 0) {
            el.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 8px 0; opacity: 0.5;">No pending maintenance.</div>';
            return;
        }

        const html = items.map(item => `
            <div class="sb-msg-item">
                <span class="material-symbols-outlined msg-icon" style="color: ${item.iconColor || 'var(--warning)'}">${item.icon || 'build'}</span>
                <div class="msg-body">
                    <div class="msg-header">
                        <span class="msg-title">${item.title || 'TASK'}</span>
                        <span class="msg-time">${item.time || ''}</span>
                    </div>
                    <div class="msg-desc">${item.desc || ''}</div>
                </div>
            </div>
        `).join('');

        if (el.innerHTML !== html) el.innerHTML = html;
    }
}
