export const MACHINE_GROUPS = {
    'logistics': ['RAWMATERIALS'],
    'smelting': ['FURNACE_01', 'DEGASSER_01', 'DEGASSER_02'],
    'die_casting': ['LPDC_01', 'LPDC_02', 'LPDC_03', 'COOLING_01'],
    'qc': ['INSPECTION_01'],
    'heat_treating': ['HEAT_01'],
    'machining': ['CNC_01', 'CNC_02'],
    'paint_shop': ['PRETREAT_01', 'PAINT_01', 'PAINT_02'],
    'shipping': ['OUTBOUND_01', 'OUTBOUND_02'],
};

export const DEPARTMENT_LABELS = {
    'logistics': 'Raw Materials',
    'smelting': 'Smelting',
    'die_casting': 'Die Casting',
    'qc': 'Quality Control',
    'heat_treating': 'Heat Treatment',
    'machining': 'Machining',
    'paint_shop': 'Finishing',
    'shipping': 'Shipping',
};

export const PRIMARY_TAGS = {
    'FURNACE': ['Temperature', 'Furnace_Instant_kW', 'Processed_Count'],
    'DEGASSER': ['Temperature', 'Degasser_Instant_kW', 'Processed_Count', 'Vibration_mm_s'],
    'LPDC': ['Riser_Pressure', 'Cycle_Time', 'Shot_Count', 'Internal_Temp'],
    'COOLING': ['Internal_Temp', 'Cooling_Instant_kW', 'Cooling_Run_Status'],
    'CNC': ['Spindle_RPM', 'Part_Count', 'Cycle_Time', 'Motor_Load_Pct'],
    'HEAT': ['Furnace_Temperature', 'Step_Timer', 'Internal_Temp', 'Process_Step'],
    'INSPECTION': ['Inspected_Count', 'OK_Count', 'Inspection_Cycle_Time'],
    'PAINT': ['Booth_Temperature', 'Booth_Humidity', 'Booth_Cycle_Status']
};
