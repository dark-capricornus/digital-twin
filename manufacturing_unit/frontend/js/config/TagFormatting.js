export function formatTagLabel(tag) {
    if (!tag) return '';
    const labelMap = {
        'plant_wip_molten_metal': 'Molten Metal Produced',
        'plant_wip_degassed_metal': 'Molten Metal Degassed',
        'plant_wip_ingots_available': 'Ingots Available',
        'plant_kpi_ingots_consumed': 'Ingots Consumed',
        'plant_wip_cast_parts': 'Casting Output',
        'plant_wip_cooled_parts_1': 'Cooled Parts (DC)',
        'plant_wip_machined_parts': 'Processed Total',
        'plant_wip_cooled_parts_2': 'Heat Treat Output',
        'plant_wip_painted_parts': 'Painted Total',
        'plant_kpi_total_produced': 'Total Wheels Produced',
        'plant_kpi_throughput': 'Plant Throughput',
        'plant_kpi_yield': 'First Pass Yield',
        'is_running': 'Operational',
        'capacity': 'Storage Capacity',
        'plc_state': 'PLC Power State',
        'plc_scantime': 'PLC Scan Time'
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
    if (upperTag.includes('TEMPERATURE') || upperTag.includes('TEMP')) return '\u00B0C';
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
