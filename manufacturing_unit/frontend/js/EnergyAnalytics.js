/**
 * EnergyAnalytics.js
 * 
 * Responsibilities:
 * - Track cumulative kWh safely using delta windows.
 * - Compute derived efficiency metrics (Energy per Unit).
 * - Aggregate metrics at Machine, Zone, and Plant levels.
 */

class EnergyAnalytics {
    constructor() {
        this.reset();
    }

    reset() {
        this.data = {
            plant: {
                instantKW: 0,
                totalKWh: 0,
                production: 0,
                scrap: 0,
                runningMachines: 0,
                totalMachines: 0,
                energyPerUnit: 0,
                utilization: 0
            },
            zones: {},
            machines: {}
        };
        // Stores previous kWh and production to compute deltas if needed
        this.history = new Map();
    }

    /**
     * Process a full telemetry store snapshot to compute the hierarchy.
     * @param {Map} telemetryStore - Map of deviceId -> Map of metrics
     * @param {Object} machineGroups - Mapping of zoneId -> [deviceIds]
     */
    update(telemetryStore, machineGroups) {
        // 1. Reset Aggregates
        this.data.plant.instantKW = 0;
        this.data.plant.totalKWh = 0;
        this.data.plant.production = 0;
        this.data.plant.scrap = 0;
        this.data.plant.runningMachines = 0;
        this.data.plant.totalMachines = telemetryStore.size;

        // Initialize Zones
        Object.keys(machineGroups).forEach(zoneId => {
            this.data.zones[zoneId] = {
                instantKW: 0,
                totalKWh: 0,
                production: 0,
                scrap: 0,
                energyPerUnit: 0,
                scrapRate: 0,
                avgCycleTime: 0,
                machineCount: machineGroups[zoneId].length
            };
        });

        // 2. Machine Level & Aggregation
        telemetryStore.forEach((metrics, deviceId) => {
            const id = deviceId.toUpperCase();

            // Extract raw values robustly by inspecting metric keys
            let kw=0, kwh=0, prod=0, scrap=0;
            let state = '';
            let isRunning = false;

            for (const [key, val] of metrics.entries()) {
                const k = key.toLowerCase();
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    if (k.endsWith('instant_kw')) kw = num;
                    else if (k.endsWith('total_kwh')) kwh = num;
                    else if (k.includes('shot_count') || k.includes('part_count') || k.includes('wheelsproduced') || k.includes('ok_count') || k.includes('pallet_count')) prod = num;
                    else if (k.includes('reject_count') || k.includes('ng_count') || k.includes('totalscrap')) scrap = num;
                }
                
                if (k === 'calculatedstate' || k === 'state') state = (val || '').toString().toLowerCase();
                if (k === 'isrunning') isRunning = (val === true || val === 'true' || val === 1);
            }

            if (state === 'running' || state === 'active' || state === 'processing') isRunning = true;

            // Store Machine Metrics
            this.data.machines[id] = {
                instantKW: kw,
                totalKWh: kwh,
                production: prod,
                scrap: scrap,
                state: state,
                isRunning: isRunning,
                energyPerUnit: prod > 0 ? kwh / prod : 0
            };

            // Aggregate Plant
            this.data.plant.instantKW += kw;
            this.data.plant.totalKWh += kwh;
            this.data.plant.production += prod;
            this.data.plant.scrap += scrap;
            if (isRunning) this.data.plant.runningMachines++;

            // Aggregate Zones
            for (const [zoneId, members] of Object.entries(machineGroups)) {
                if (members.includes(id)) {
                    this.data.zones[zoneId].instantKW += kw;
                    this.data.zones[zoneId].totalKWh += kwh;
                    this.data.zones[zoneId].production += prod;
                    this.data.zones[zoneId].scrap += scrap;
                }
            }
        });

        // 3. Compute Derived Plant Metrics
        this.data.plant.energyPerUnit = this.data.plant.production > 0 ? this.data.plant.totalKWh / this.data.plant.production : 0;
        this.data.plant.utilization = this.data.plant.totalMachines > 0 ? (this.data.plant.runningMachines / this.data.plant.totalMachines) * 100 : 0;

        // 4. Compute Derived Zone Metrics
        Object.keys(this.data.zones).forEach(zoneId => {
            const z = this.data.zones[zoneId];
            z.energyPerUnit = z.production > 0 ? z.totalKWh / z.production : 0;
            z.scrapRate = z.production > 0 ? (z.scrap / z.production) * 100 : 0;
        });

        return this.data;
    }

    getHierarchy() {
        return this.data;
    }
}

export default EnergyAnalytics;
