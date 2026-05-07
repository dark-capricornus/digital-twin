export const SIDEBAR_SCHEMAS = {
    'FURNACE': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Temperature': ['Temperature', 'TargetTemp', 'FurnaceMaxTemp'],
        'Process': ['Progress', 'State'],
        'Status': ['IsRunning', 'StateCode', 'FaultCode']
    },
    'DEGASSER': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Process': ['VacuumLevel', 'Temp', 'Progress', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'LPDC': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Production': ['ProcessedCount', 'State', 'Progress'],
        'Pressure': ['PressurePSI'],
        'Status': ['IsRunning', 'StateCode']
    },
    'COOLING': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Temperature': ['Temperature', 'TargetTemp'],
        'Status': ['IsRunning', 'StateCode']
    },
    'CNC': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Production': ['ProcessedCount', 'Progress', 'State'],
        'Process': ['SpindleRPM'],
        'Status': ['IsRunning', 'StateCode']
    },
    'HEAT': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Temperature': ['FurnaceTemperature', 'TemperatureSetpoint'],
        'Process': ['ProcessStep', 'StepTimer', 'Progress', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'INSPECTION': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Production': ['RejectCount', 'ProcessedCount', 'Progress', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'PRETREAT': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Process': ['Stage_Status', 'Conveyor_Speed', 'Dryer_Temperature', 'Progress', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'PAINT_01': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
        'Process': ['Booth_Cycle_Status', 'Progress', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'PAINT_02': {
        'Core Energy': ['PowerKW', 'RuntimeTotalHrs'],
        'Environment': ['Booth_Temperature', 'Booth_Humidity', 'Air_Flow_Status'],
        'Process': ['Booth_Cycle_Status', 'Progress', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'OUTBOUND': {
        'Production': ['PartCount', 'State'],
        'Status': ['IsRunning', 'StateCode']
    },
    'RAWMATERIALS': {
        'Storage Status': ['IsRunning', 'Capacity'],
        'Inventory': ['PartCount']
    },
    'SHIPPING': {
        'Status': ['State']
    },
    'PLANT': {
        'PLC Status': ['State', 'ScanTime_ms'],
        'WIP Metrics': ['Molten_Metal_Kg', 'Degassed_Metal_Kg', 'Ingots_Kg', 'Cast_Parts', 'Cooled_Parts_1', 'Cooled_Parts_2', 'Heat_Treated_Parts', 'Machined_Parts', 'Pretreated_Parts', 'Painted_Parts'],
        'Quality': ['Xray_Passed', 'Qc_Passed', 'Scrap_Parts']
    },
    'PRODUCTION': {
        'KPI Overview': ['Production_Target', 'Yield_Pct', 'OEE_Target', 'Uptime_Target', 'Hourly_Throughput', 'Energy_Efficiency_Pct'],
        'Global Output': ['Batches_Completed']
    }
};
