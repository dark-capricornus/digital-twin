import BaseComponent from './base.js';

/**
 * MessageLogComponent
 * High-density event viewer with asset-specific filtering and timestamps.
 */
export default class MessageLog extends BaseComponent {
    constructor(id, containerId) {
        super(id, containerId);
        this.activeFilter = null;
    }

    setFilter(assetId) {
        this.activeFilter = assetId;
        this.render();
    }

    render() {
        if (!this.element) return;
        
        // Filter messages if a specific asset is selected
        const rawMessages = this.state.messages || [];
        const filteredMessages = this.activeFilter 
            ? rawMessages.filter(msg => msg.assetId === this.activeFilter || msg.isGlobal)
            : rawMessages;

        this.element.innerHTML = `
            <div class="message-log flex flex-col gap-3 py-2 border-t border-slate-800 mt-4 overflow-y-auto max-h-[400px]">
                <div class="flex items-center gap-2 text-slate-500 mb-2">
                    <span class="material-symbols-outlined text-[16px]">mail</span>
                    <span class="text-[11px] font-bold tracking-widest uppercase">MESSAGES</span>
                    <span class="ml-auto text-[10px] opacity-40">${this.activeFilter || 'Global'} View</span>
                </div>
                ${filteredMessages.length > 0 ? filteredMessages.map(msg => `
                    <div class="message-item group relative flex items-start gap-3 p-2 bg-[#0A0A0A] border-l-2 ${this._getBorderColor(msg.type)} hover:bg-[#111]">
                        <div class="flex-shrink-0 mt-1">
                            <span class="material-symbols-outlined text-[16px]" style="color: ${this._getIconColor(msg.type)}">${this._getIcon(msg.type)}</span>
                        </div>
                        <div class="flex flex-col gap-0.5">
                            <div class="flex items-center justify-between gap-10">
                                <span class="text-[11px] font-bold text-white uppercase tracking-tighter">${msg.title || 'LOG ENTRY'}</span>
                                <span class="text-[9px] font-mono text-slate-600">${msg.timestamp || '00:00:00'}</span>
                            </div>
                            <p class="text-[11px] text-slate-400 leading-tight opacity-70">${msg.content || '...'}</p>
                        </div>
                    </div>
                `).join('') : `
                    <div class="text-[11px] text-slate-700 italic px-2">No active logs for ${this.activeFilter || 'system'}.</div>
                `}
            </div>
        `;
    }

    _getIcon(type) {
        switch (type?.toLowerCase()) {
            case 'error': return 'error';
            case 'warning': return 'warning';
            case 'info': return 'info';
            case 'success': return 'check_circle';
            default: return 'report';
        }
    }

    _getIconColor(type) {
        switch (type?.toLowerCase()) {
            case 'error': return '#FF3030';
            case 'warning': return '#FFC400';
            case 'info': return '#00D1FF';
            case 'success': return '#00E676';
            default: return '#888';
        }
    }

    _getBorderColor(type) {
        switch (type?.toLowerCase()) {
            case 'error': return 'border-[#FF3030]';
            case 'warning': return 'border-[#FFC400]';
            case 'info': return 'border-[#00D1FF]';
            case 'success': return 'border-[#00E676]';
            default: return 'border-transparent';
        }
    }
}
