/**
 * Base Component Class
 * Provides standard mount/render/update cycle for framework-ready UI.
 */
export default class BaseComponent {
    constructor(id, containerId) {
        this.id = id;
        this.containerId = containerId;
        this.element = null;
        this.state = {};
    }

    /**
     * Standardized mount point
     */
    mount() {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        
        const wrapper = document.createElement('div');
        wrapper.id = this.id;
        wrapper.className = 'component-wrapper';
        container.appendChild(wrapper);
        this.element = wrapper;
    }

    /**
     * Deep update of state and selective re-render
     */
    update(newState) {
        // Simple shallow comparison for high-frequency telemetry
        let changed = false;
        for (const [key, val] of Object.entries(newState)) {
            if (this.state[key] !== val) {
                this.state[key] = val;
                changed = true;
            }
        }
        if (changed) this.render();
    }

    /**
     * To be overridden by concrete components
     */
    render() {
        if (!this.element) return;
        this.element.innerHTML = `<!-- Component Default Render -->`;
    }
}
