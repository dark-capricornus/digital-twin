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
        
        // [USER] Track expanded/navigation state of sections
        this.expandedSections = new Set();
        this.activeDetailView = null; // [USER] Tracks drill-down state: 'asset', 'plant', 'production', etc.
        this.assetData = null; // Stored metadata from assets.json
        this.statusColors = {
            'running': 'var(--success)',
            'ok': 'var(--success)',
            'nominal': 'var(--success)',
            'healthy': 'var(--success)',
            'warning': 'var(--warning)',
            'fault': 'var(--danger)',
            'error': 'var(--danger)',
            'alarm': 'var(--danger)',
            'offline': 'var(--text-dim)',
            'stopped': 'var(--text-dim)'
        };
    }

    /**
     * Initialize with zone/machine data from main app
     */
    init(machineGroups, departmentLabels, callbacks = {}) {
        this.zones = Object.keys(machineGroups);
        this.zoneAssets = machineGroups;
        this.zoneLabels = departmentLabels || {};
        this.onAssetSelect = callbacks.onAssetSelect || null;
        this.onZoneChange = callbacks.onZoneChange || null;
        this.onCollapse = callbacks.onCollapse || null;
        // [FIX] Don't overwrite if already set or use fallback to empty object
        if (callbacks.assetData) this.assetData = callbacks.assetData;
        if (!this.assetData) this.assetData = {};

        // Wire zone nav buttons
        const prevBtn = document.getElementById('zone-prev');
        const nextBtn = document.getElementById('zone-next');
        if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); this._cycleZone(-1); };
        if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); this._cycleZone(1); };

        // Wire asset nav buttons
        const assetPrev = document.getElementById('asset-prev');
        const assetNext = document.getElementById('asset-next');
        if (assetPrev) assetPrev.onclick = (e) => {
            e.stopPropagation();
            this._navigateAsset(-1);
        };
        if (assetNext) assetNext.onclick = (e) => {
            e.stopPropagation();
            this._navigateAsset(1);
        };

        // Wire close button
        const closeBtn = document.getElementById('sidebar-close-btn');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.collapse();
                if (this.onCollapse) this.onCollapse();
            };
        }

        this.sidebarEl = document.getElementById('hud-right-sidebar');

        // [USER] Close sidebar on outside click
        document.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (!this.sidebarEl || this.sidebarEl.classList.contains('collapsed')) return;
            if (this.sidebarEl.contains(e.target)) return;
            // Don't collapse/reset for 3D canvas clicks — renderer handles those via selectDevice
            const container = document.getElementById('container');
            const is3D = container && container.contains(e.target);
            this.collapse();
            if (!is3D && this.onCollapse) this.onCollapse();
        });

        this.isInitialized = true;
        this.mainTemplate = this.sidebarEl.querySelector('#sidebar-scroll').innerHTML;

        // Initial view: plant overview (no asset selected)
        const initialAsset = callbacks.initialAssetId;
        if (initialAsset) {
            this.setAsset(initialAsset);
        } else {
            this._renderZone();
        }
    }

    setZoneById(zoneId) {
        const idx = this.zones.indexOf(zoneId);
        if (idx >= 0 && idx !== this.currentZoneIndex) {
            this.currentZoneIndex = idx;
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
        
        // Reset rendering contexts to force structural refresh for the newly selected asset
        const headerEl = document.getElementById('sb-asset-header');
        if (headerEl) headerEl.dataset.renderedAssetId = '';
        
        const scrollEl = document.getElementById('sidebar-scroll');
        if (scrollEl) scrollEl.dataset.detailContext = '';

        this._updateAssetPills();
        this._scrollToActiveAsset();
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
        this.lastUpdateData = data; // Cache for detail view refreshes

        // [USER] Partial Update Logic: Only update values, don't re-render containers if structure exists
        if (this.activeDetailView) {
            this._renderDetailViewPartial(this.activeDetailView, data);
            return;
        }

        const { asset, plant, production, alarms, maintenance } = data;

        // [USER] Render Asset Summary (Name + Model + Service Dates)
        this._renderAssetSummary(this.currentAssetId, data.status || 'NOMINAL');

        // Update sections — show summary (deduped) in main view
        const plantItems = plant?.summary || plant || [];
        const prodItems = production?.summary || production || [];
        this._updateSectionIconic('sb-plant', plantItems, 'plant', 'PLANT DATA', 'factory');
        this._updateSectionIconic('sb-production', prodItems, 'production', 'PRODUCTION', 'inventory_2');
        
        // Alarms and Maintenance: Center Titles + Top 1 Log
        this._updateModernHeaderSection('sb-alarms', alarms || [], 'alarms', 'ACTIVE ALARMS', 'warning');
        this._updateModernHeaderSection('sb-maintenance', maintenance || [], 'maintenance', 'PENDING MAINTENANCE', 'build');
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

    _cycleZone(dir, selectLast = false) {
        this.currentZoneIndex = (this.currentZoneIndex + dir + this.zones.length) % this.zones.length;
        const zoneId = this.zones[this.currentZoneIndex];
        const assets = this.zoneAssets[zoneId] || [];
        
        if (assets.length > 0) {
            this.currentAssetId = selectLast ? assets[assets.length - 1] : assets[0];
            this._renderZone();
            this._updateAssetPills();
            this._scrollToActiveAsset();
            if (this.onAssetSelect) this.onAssetSelect(this.currentAssetId);
        } else {
            this.currentAssetId = null;
            this._renderZone();
        }
        
        if (this.onZoneChange) this.onZoneChange(zoneId);
    }

    _navigateAsset(dir) {
        const zoneId = this.zones[this.currentZoneIndex];
        const assets = this.zoneAssets[zoneId] || [];
        const currentIndex = assets.indexOf(this.currentAssetId);

        if (dir === 1) {
            if (currentIndex < assets.length - 1) {
                // Next asset in same zone
                const nextId = assets[currentIndex + 1];
                this.currentAssetId = nextId;
                this._updateAssetPills();
                this._scrollToActiveAsset();
                if (this.onAssetSelect) this.onAssetSelect(nextId);
            } else {
                // Wrap to next zone
                this._cycleZone(1, false);
            }
        } else {
            if (currentIndex > 0) {
                // Prev asset in same zone
                const prevId = assets[currentIndex - 1];
                this.currentAssetId = prevId;
                this._updateAssetPills();
                this._scrollToActiveAsset();
                if (this.onAssetSelect) this.onAssetSelect(prevId);
            } else {
                // Wrap to prev zone (and select last asset)
                this._cycleZone(-1, true);
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
            const label = this.zoneLabels[zoneId] || zoneId;
            nameEl.textContent = label.toUpperCase().replace(/\s+/g, '_');
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
                                    <span class="msg-title">${item.title || 'STATUS MESSAGE'}</span>
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
                <div class="detail-meta-row" style="${m.highlight ? 'padding: 14px 16px; background: rgba(255,255,255,0.03); margin-bottom: 4px;' : ''}">
                    <span class="detail-meta-label">${m.label}</span>
                    <span class="detail-meta-value" id="detail-val-meta-${m.id}" style="color: ${m.color || (m.highlight ? 'var(--primary)' : 'white')}">---</span>
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
                        <span class="m-value" id="detail-val-${item.id}">---</span>
                        <span class="m-unit">${item.unit || ''}</span>
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
