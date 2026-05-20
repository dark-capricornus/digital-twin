import BaseComponent from './base.js';

/**
 * AssetChipComponent
 * Pill-shaped toggle for machine selection.
 */
export class AssetChip extends BaseComponent {
    render() {
        const isActive = this.state.active ? 'border-orange-500 bg-orange-950/20 text-white' : 'border-slate-800 bg-[#0A0A0A] text-slate-400 hover:border-slate-600';
        const dotColor = this.state.status === 'FAULT' ? 'bg-red-500' : 'bg-green-500';
        
        this.element.innerHTML = `
            <div class="asset-chip flex items-center gap-2 px-3 py-1 cursor-pointer transition-all border ${isActive} whitespace-nowrap min-w-fit">
                <div class="h-1.5 w-1.5 rounded-full ${dotColor}"></div>
                <span class="text-[10px] font-bold tracking-tight uppercase">${this.state.id || '---'}</span>
            </div>
        `;

        this.element.onclick = () => {
            if (this.state.onClick) this.state.onClick(this.state.id);
        };
    }
}


/**
 * MetricTileComponent
 * Standard 1x1 data tile for high-density grids.
 */
export class MetricTile extends BaseComponent {
    render() {
        this.element.innerHTML = `
            <div class="metric-tile flex flex-col gap-0.5 p-1.5 border border-slate-900 bg-[#0A0A0A] group hover:border-orange-500 transition-all">
                <div class="flex items-center justify-between text-[#666] group-hover:text-orange-400">
                    <span class="material-symbols-outlined text-[14px] opacity-70">${this.state.icon || 'analytics'}</span>
                    <span class="text-[9px] font-bold tracking-tighter uppercase opacity-50">${this.state.label || '---'}</span>
                </div>
                <div class="flex items-baseline gap-1 mt-auto">
                    <span class="text-[16px] font-bold text-white font-mono">${this.state.value || '0.0'}</span>
                    <span class="text-[9px] font-bold text-slate-600 uppercase font-mono">${this.state.unit || ''}</span>
                </div>
            </div>
        `;
    }
}

/**
 * DiagnosticTileComponent
 * Status-driven asset health indicator.
 */
export class DiagnosticTile extends BaseComponent {
    render() {
        const color = this.state.status === 'SPIKE' ? '#FF3030' : (this.state.status === 'LOW' ? '#FFC400' : '#00E676');
        this.element.innerHTML = `
            <div class="diagnostic-tile flex items-center gap-3 p-2 border border-slate-800 bg-[#0A0A0A] hover:bg-[#111] transition-all">
               <div class="flex items-center justify-center h-8 w-8 rounded-full bg-opacity-10" style="background-color: ${color}22">
                  <span class="material-symbols-outlined" style="color: ${color}">${this.state.icon || 'emergency'}</span>
               </div>
               <div class="flex flex-col">
                  <span class="text-[10px] font-bold tracking-widest uppercase opacity-60 text-slate-400">${this.state.label || 'SYSTEM'}</span>
                  <span class="text-[12px] font-bold tracking-tighter" style="color: ${color}">${this.state.status || 'SYNC'}</span>
               </div>
               <div class="ml-auto opacity-40">
                  <span class="text-[10px] font-mono text-slate-100">${this.state.detail || ''}</span>
               </div>
            </div>
        `;
    }
}

/**
 * TrendMetricComponent
 * Large value metrics with delta indicators (used for OEE/Output).
 */
export class TrendMetric extends BaseComponent {
    render() {
        const deltaColor = (this.state.delta || '').startsWith('+') ? 'text-[#00E676]' : 'text-[#FF3030]';
        this.element.innerHTML = `
            <div class="trend-metric flex flex-col border-r border-slate-800 px-4 last:border-0 first:pl-0">
                <div class="flex items-baseline gap-2">
                   <span class="text-[18px] font-bold text-white font-mono">${this.state.value || '0.0'}</span>
                   <span class="text-[10px] font-bold font-mono ${deltaColor}">${this.state.delta || ''}</span>
                </div>
                <div class="text-[11px] font-bold tracking-wide uppercase text-slate-500 mt-1">${this.state.label || 'Metric'}</div>
            </div>
        `;
    }
}
