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

        // Wire zone nav buttons
        const prevBtn = document.getElementById('zone-prev');
        const nextBtn = document.getElementById('zone-next');
        if (prevBtn) prevBtn.onclick = () => this._cycleZone(-1);
        if (nextBtn) nextBtn.onclick = () => this._cycleZone(1);

        // Wire asset nav buttons
        const assetPrev = document.getElementById('asset-prev');
        const assetNext = document.getElementById('asset-next');
        const assetCarousel = document.getElementById('asset-carousel');
        if (assetPrev && assetCarousel) assetPrev.onclick = () => assetCarousel.scrollBy({ left: -100, behavior: 'smooth' });
        if (assetNext && assetCarousel) assetNext.onclick = () => assetCarousel.scrollBy({ left: 100, behavior: 'smooth' });

        // Wire close button
        const closeBtn = document.getElementById('sidebar-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.collapse();
                if (this.onCollapse) this.onCollapse();
            };
        }

        this.sidebarEl = document.getElementById('hud-right-sidebar');

        this.isInitialized = true;

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
        this._updateAssetPills();
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
        const { asset, plant, production, alarms, maintenance } = data;
        this._renderSection('sb-asset', asset || [], 'metric');
        this._renderSection('sb-plant', plant || [], 'metric');
        this._renderSection('sb-production', production || [], 'output');
        this._renderAlarms(alarms || []);
        this._renderMaintenance(maintenance || []);
    }

    // ─── Private ───────────────────────────────────────────

    _cycleZone(dir) {
        this.currentZoneIndex = (this.currentZoneIndex + dir + this.zones.length) % this.zones.length;
        this.currentAssetId = null;
        this._renderZone();

        const zoneId = this.zones[this.currentZoneIndex];
        const assets = this.zoneAssets[zoneId] || [];
        if (assets.length > 0) {
            this.currentAssetId = assets[0];
            this._updateAssetPills();
            if (this.onAssetSelect) this.onAssetSelect(this.currentAssetId);
        }
        if (this.onZoneChange) this.onZoneChange(zoneId);
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
     * Render metric rows (icon + value + unit, 3 per row)
     * or output rows (value + unit + delta, 3 per row)
     */
    _renderSection(containerId, items, type) {
        const el = document.getElementById(containerId);
        if (!el) return;

        let html;
        if (type === 'output') {
            html = items.map(item => `
                <div class="sb-output-item">
                    ${item.icon ? `<span class="material-symbols-outlined m-icon" style="color: ${item.color || 'var(--text-dim)'}; font-size: 16px;">${item.icon}</span>` : ''}
                    <span class="o-value" id="${item.id || ''}">${item.value || '---'}</span>
                    ${item.unit ? `<span class="o-unit">${item.unit}</span>` : ''}
                    ${item.delta ? `<span class="o-delta ${item.deltaClass || ''}">${item.delta}</span>` : ''}
                </div>
            `).join('');
        } else {
            html = items.map(item => `
                <div class="sb-metric-item">
                    <span class="material-symbols-outlined m-icon" style="color: ${item.color || 'var(--text-dim)'}">${item.icon || 'analytics'}</span>
                    <span class="m-value" id="${item.id || ''}">${item.value || '---'}</span><span class="m-unit">${item.unit || ''}</span>
                </div>
            `).join('');
        }

        if (el.innerHTML !== html) el.innerHTML = html;
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
