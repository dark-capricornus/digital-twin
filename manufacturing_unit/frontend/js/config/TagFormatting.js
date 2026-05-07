export function formatTagLabel(tag) {
    if (!tag) return '';
    const labelMap = {
        'Plant_WIP_Molten_Metal': 'Molten Metal Produced',
        'Plant_WIP_Degassed_Metal': 'Molten Metal Degassed',
        'Plant_WIP_Ingots_Available': 'Ingots Available',
        'Plant_KPI_Ingots_Consumed': 'Ingots Consumed',
        'Plant_WIP_Cast_Parts': 'Casting Output',
        'Plant_WIP_Cooled_Parts_1': 'Cooled Parts (DC)',
        'Plant_WIP_Machined_Parts': 'Processed Total',
        'Plant_WIP_Cooled_Parts_2': 'Heat Treat Output',
        'Plant_WIP_Painted_Parts': 'Painted Total',
        'Plant_KPI_Total_Produced': 'Total Wheels Produced',
        'Plant_KPI_Throughput': 'Plant Throughput',
        'Plant_KPI_Yield': 'First Pass Yield',
        'IsRunning': 'Operational',
        'capacity': 'Storage Capacity',
        'PLC_State': 'PLC Power State',
        'PLC_ScanTime': 'PLC Scan Time'
    };
    if (labelMap[tag]) return labelMap[tag];
    return tag.replace(/_/g, ' ');
}

export function getUnit(tag) {
    if (!tag) return '';
    const upperTag = tag.toUpperCase();

    if (upperTag.includes('KWH')) return 'kWh';
    if (upperTag.includes('KW')) return 'kW';
    if (upperTag.includes('MOLTEN') || upperTag.includes('METAL') || upperTag.includes('KG')) return 'kg';
    if (upperTag.includes('TEMPERATURE') || upperTag.includes('TEMP')) return '°C';
    if (upperTag.includes('PRESSURE') || upperTag.includes('PSI') || upperTag.includes('BAR')) return 'bar';
    if (upperTag.includes('RPM')) return 'RPM';
    if (upperTag.includes('SPEED')) return 'm/min';
    if (upperTag.includes('HUMIDITY') || upperTag.includes('PCT') || upperTag.includes('%')) return '%';
    if (upperTag.includes('TIME') || upperTag.includes('TIMER')) {
        if (upperTag.includes('SCAN')) return 'ms';
        return 's';
    }
    if (upperTag === 'CAPACITY') return 'units';

    return '';
}

export function normalizeLabel(tag) {
    if (!tag) return '';
    let s = String(tag).replace(/_/g, ' ').trim();

    const machinePrefixes = ['LPDC', 'CNC', 'Furnace', 'HT', 'Heat', 'Cooling',
        'PB1', 'PB2', 'PT', 'Pretreat', 'XRay', 'Paint', 'Painting',
        'Degasser', 'Degassing', 'Inbound', 'Outbound', 'Storage',
        'Inspection', 'Buffer'];
    for (const p of machinePrefixes) {
        const re = new RegExp(`^${p}\\s+`, 'i');
        if (re.test(s)) { s = s.replace(re, ''); break; }
    }

    const replacements = [
        [/\bTotal\s*kWh\b/i, 'Total Consumed'],
        [/\bInstant\s*kW\b/i, 'Instant Power'],
        [/\bRuntime\s*Total\s*Hrs?\b/i, 'Total Runtime'],
        [/\bTotal\s*Runtime\s*Hrs?\b/i, 'Total Runtime'],
        [/\bVibration\s*mm\s*s\b/i, 'Vibration'],
        [/\bAir\s*Supply\s*PSI\b/i, 'Air Supply Pressure'],
        [/\bHumidity\s*Pct\b/i, 'Humidity'],
        [/\bMelt\s*Bath\s*Temperature\b/i, 'Melt Bath Temp'],
        [/\bProcess\s*Temperature\b/i, 'Process Temp'],
        [/\bZone\s*Temperature\b/i, 'Zone Temp'],
        [/\bWall\s*Temperature\b/i, 'Wall Temp'],
        [/\bRoof\s*Temperature\b/i, 'Roof Temp'],
        [/\bTarget\s*Temperature\b/i, 'Target Temp'],
        [/\bMax\s*Furnace\s*Temperature\b/i, 'Max Furnace Temp'],
        [/\bHolding\s*Furnace\s*Temperature\b/i, 'Holding Furnace Temp'],
        [/\bDie\s*Top\s*Temperature\b/i, 'Die Top Temp'],
        [/\bDie\s*Bottom\s*Temperature\b/i, 'Die Bottom Temp'],
        [/\bBooth\s*Temperature\b/i, 'Booth Temp'],
        [/\bDryer\s*Temperature\b/i, 'Dryer Temp'],
        [/\bFurnace\s*Temperature\b/i, 'Furnace Temp'],
        [/\bInternal\s*Temperature\b/i, 'Internal Temp'],
        [/\bTemp\s*Setpoint\b/i, 'Temp Setpoint'],
        [/\bTemperature\b/i, 'Temp'],
        [/\s*Pct\b/i, ''],
    ];
    for (const [re, rep] of replacements) s = s.replace(re, rep);

    s = s.replace(/\s+/g, ' ').trim();

    const acronyms = new Set(['ID', 'OK', 'NG', 'PSI', 'RPM', 'WIP', 'QC']);
    s = s.split(' ').map(w => {
        const up = w.toUpperCase();
        if (acronyms.has(up)) return up;
        if (/^kwh$/i.test(w)) return 'kWh';
        if (/^kw$/i.test(w)) return 'kW';
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');

    return s;
}
