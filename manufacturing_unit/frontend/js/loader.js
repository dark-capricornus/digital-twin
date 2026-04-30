/**
 * LoadingScreen Component
 * Modular, reusable, and self-contained loading UI with an SVG progress circle.
 */
export default class LoadingScreen {
    constructor(options = {}) {
        this.color = options.color || '#ec5b13'; // Industrial Orange
        this.bgColor = options.bgColor || '#0A0A0A'; // Darkest grey
        this.status = 'Initializing...';
        this.progress = 0;
        this.radius = 45;
        this.circumference = 2 * Math.PI * this.radius;

        this._createDOM();
    }

    _createDOM() {
        this.el = document.createElement('div');
        this.el.id = 'loading-screen-component';
        this.el.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: ${this.bgColor};
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            transition: opacity 0.5s ease-out;
            font-family: inherit;
        `;

        this.el.innerHTML = `
            <div class="loader-content" style="display: flex; flex-direction: column; align-items: center; gap: 24px;">
                <div class="loader-svg-wrapper" style="position: relative; width: 120px; height: 120px;">
                    <svg width="120" height="120" style="transform: rotate(-90deg);">
                        <!-- Background Circle -->
                        <circle 
                            cx="60" cy="60" r="${this.radius}" 
                            fill="transparent" 
                            stroke="#1C1C1C" 
                            stroke-width="4" 
                        />
                        <!-- Progress Circle -->
                        <circle 
                            class="progress-circle-stroke"
                            cx="60" cy="60" r="${this.radius}" 
                            fill="transparent" 
                            stroke="${this.color}" 
                            stroke-width="4" 
                            stroke-dasharray="${this.circumference}"
                            stroke-dashoffset="${this.circumference}"
                            stroke-linecap="round"
                            style="transition: stroke-dashoffset 0.3s ease-out;"
                        />
                    </svg>
                    <div class="loader-percent" style="
                        position: absolute; 
                        top: 50%; left: 50%; 
                        transform: translate(-50%, -50%);
                        font-weight: 800; 
                        font-size: 18px; 
                        color: #fff;
                        letter-spacing: 1px;
                    ">0%</div>
                </div>
                <div class="loader-status" style="
                    font-size: 11px; 
                    font-weight: 700; 
                    color: ${this.color}; 
                    text-transform: uppercase; 
                    letter-spacing: 0.3em;
                    text-align: center;
                ">Initializing Digital Twin</div>
            </div>
        `;

        document.body.appendChild(this.el);
        this.circleStroke = this.el.querySelector('.progress-circle-stroke');
        this.percentText = this.el.querySelector('.loader-percent');
        this.statusText = this.el.querySelector('.loader-status');
    }

    /**
     * Update the loading progress and status text
     * @param {number} percent 0-100
     * @param {string} status Status message
     */
    update(percent, status) {
        if (percent !== undefined) {
            this.progress = Math.min(100, Math.max(0, percent));
            const offset = this.circumference - (this.progress / 100) * this.circumference;
            this.circleStroke.style.strokeDashoffset = offset;
            this.percentText.textContent = `${Math.round(this.progress)}%`;
        }
        if (status) {
            this.statusText.textContent = status;
        }
    }

    /**
     * Smoothly hide the loading screen and remove it from DOM
     */
    hide() {
        this.el.style.opacity = '0';
        setTimeout(() => {
            if (this.el.parentNode) {
                this.el.parentNode.removeChild(this.el);
            }
        }, 600);
    }
}
