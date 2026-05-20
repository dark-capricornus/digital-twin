import BaseComponent from './base.js';
import { AssetChip } from './Library.js';

/**
 * AssetSelector
 * Manages a horizontal list of AssetChips for quick context switching.
 */
export default class AssetSelector extends BaseComponent {
    constructor(id, containerId) {
        super(id, containerId);
        this.chips = [];
    }

    render() {
        this.element.innerHTML = `
            <div class="asset-selector-container flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                <div id="asset-chips-mount" class="flex items-center gap-2"></div>
            </div>
        `;

        const mountPoint = 'asset-chips-mount';
        const assets = this.state.assets || [];
        const activeId = this.state.activeId;

        // Cleanup old chips if any
        this.chips = [];

        assets.forEach(asset => {
            const chip = new AssetChip(`chip-${asset.id}`, mountPoint);
            this.chips.push(chip);
            chip.mount();
            chip.update({
                id: asset.id,
                status: asset.status,
                active: asset.id === activeId,
                onClick: (id) => {
                    if (this.state.onSelect) this.state.onSelect(id);
                }
            });
        });
    }

    // Optimization: Only update chips that changed
    update(nextState) {
        if (!this.element) return;
        
        const assetsChanged = JSON.stringify(this.state.assets) !== JSON.stringify(nextState.assets);
        const activeChanged = this.state.activeId !== nextState.activeId;

        this.state = { ...this.state, ...nextState };

        if (assetsChanged) {
            this.render();
        } else if (activeChanged) {
            this.chips.forEach(chip => {
                chip.update({ active: chip.state.id === this.state.activeId });
            });
        }
    }
}
