# Alloy Wheel Manufacturing - Digital Twin Tag Report Generator
# Reads tags.json, categorises every tag per machine, and produces a
# dark-themed PDF report (one page per machine).
#
# NAMING CONVENTION:
#   Labels are CLEAN - no units in labels since values carry the unit.
#   e.g. "Oil Level" not "Oil Level Pct", "Instant Power" not "Instant Power (kW)"
#   Values show: 85.3 %,  142.7 kW,  3200 RPM, etc.

import json
import random
from datetime import datetime, timedelta
from fpdf import FPDF

random.seed(42)

# 1. LOAD DATA
with open("docs/tags.json", "r") as f:
    data = json.load(f)


# 2. EXTRACT DEVICE STRUCTURE (recursive)
def extract_devices(node, path=""):
    results = []
    if node.get("tagType") == "Folder":
        current = f"{path}/{node['name']}" if path else node["name"]
        atomic_tags = []
        sub_folders = []
        for t in node.get("tags", []):
            if t.get("tagType") == "AtomicTag":
                atomic_tags.append(t)
            elif t.get("tagType") == "Folder":
                sub_folders.append(t)
        if atomic_tags:
            results.append((current, atomic_tags))
        for sf in sub_folders:
            results.extend(extract_devices(sf, current))
    return results


all_devices = extract_devices(data)

# 3. DEPARTMENT MAPPING
DEPT_MAP = {
    "Furnace_01":    "Smelting",
    "LPDC_01":       "Casting",
    "LPDC_02":       "Casting",
    "LPDC_03":       "Casting",
    "Degasser_01":   "Degassing",
    "DEGASSER_02":   "Degassing",
    "HEAT_01":       "Heat Treatment",
    "HEAT_02":       "Heat Treatment",
    "COOLING_01":    "Cooling",
    "COOLING_02":    "Cooling",
    "CNC_01":        "Machining",
    "CNC_02":        "Machining",
    "PRETREAT_01":   "Pre-Treatment",
    "PAINT_01":      "Painting",
    "PAINT_02":      "Painting",
    "Inspection_01": "Quality Inspection",
    "INBOUND_01":    "Inbound Logistics",
    "STORAGE_01":    "Storage",
    "OUTBOUND_01":   "Outbound Logistics",
    "OUTBOUND_02":   "Outbound Logistics",
    "Buffer_01":     "Buffer",
}

# 4. UNIFORM TAG NAME NORMALISATION
# NO UNITS in labels - values already carry the unit
NAME_MAP = {
    # Temperatures - use "Temp" abbreviation consistently
    "Internal Temp":                       "Internal Temp",
    "Holding Furnace Temperature":         "Holding Furnace Temp",
    "Heat Treatment Furnace Temperature":  "Furnace Temp",
    "Die Top Temperature":                 "Die Top Temp",
    "Die Bottom Temperature":              "Die Bottom Temp",
    "Booth Temperature":                   "Booth Temp",
    "Dryer Temperature":                   "Dryer Temp",
    "Temperature":                         "Process Temp",
    "Temperature Setpoint":                "Temp Setpoint",
    "Furnace Temperature":                 "Furnace Temp",
    "Zone Temperatures":                   "Zone Temp",
    "Roof Temperature":                    "Roof Temp",
    "Wall Temperature":                    "Wall Temp",
    "Melt Bath Temperature":               "Melt Bath Temp",
    "TargetTemp":                          "Target Temp",
    "max_furnace_temp":                    "Max Furnace Temp",

    # Percentages - NO "Pct" since value shows %
    "Oil Level Pct":                       "Oil Level",
    "Motor Load Pct":                      "Motor Load",

    # Energy - NO units in label, value shows kW/kWh
    "LPDC Total kWh":                      "Total Energy Consumed",
    "LPDC Instant kW":                     "Instant Power",
    "CNC Total kWh":                       "Total Energy Consumed",
    "CNC Instant kW":                      "Instant Power",
    "Degasser Total kWh":                  "Total Energy Consumed",
    "Degasser Instant kW":                 "Instant Power",
    "HT Total kWh":                        "Total Energy Consumed",
    "HT Instant kW":                       "Instant Power",
    "Furnace Total kWh":                   "Total Energy Consumed",
    "Furnace Instant kW":                  "Instant Power",
    "Cooling Total kWh":                   "Total Energy Consumed",
    "Cooling Instant kW":                  "Instant Power",
    "PT Total kWh":                        "Total Energy Consumed",
    "PT Instant kW":                       "Instant Power",
    "PB1 Total kWh":                       "Total Energy Consumed",
    "PB1 Instant kW":                      "Instant Power",
    "PB2 Total kWh":                       "Total Energy Consumed",
    "PB2 Instant kW":                      "Instant Power",
    "XRay Total kWh":                      "Total Energy Consumed",
    "XRay Instant kW":                     "Instant Power",
    "Outbound Total kWh":                  "Total Energy Consumed",
    "Outbound Instant kW":                 "Instant Power",
    "Inbound Total kWh":                   "Total Energy Consumed",
    "Inbound Instant kW":                  "Instant Power",
    "Storage Total kWh":                   "Total Energy Consumed",
    "Storage Instant kW":                  "Instant Power",
    "PowerKW":                             "Instant Power",
    "PB_1 Run Status":                     "Run Status",

    # Vibration - NO unit in label
    "Vibration mm s":                      "Vibration",

    # Air Supply - NO unit in label
    "Air Supply PSI":                      "Air Supply Pressure",

    # Pressures - NO unit in label
    "Riser Pressure":                      "Riser Pressure",
    "Holding Pressure":                    "Holding Pressure",
    "Pressure Setpoint":                   "Pressure Setpoint",
    "PressurePSI":                         "Pressure",
    "Vacuum Level (kPa)":                  "Vacuum Level",
    "Vacuum Level":                        "Vacuum Level",

    # Production
    "Processed Count":                     "Processed Count",
    "ProcessedCount":                      "Processed Count",
    "Part Count":                          "Part Count",
    "PartCount":                           "Part Count",
    "Shot Count":                          "Shot Count",
    "OK Count":                            "OK Count",
    "NG Count":                            "Not Good Count",
    "Good Part Count":                     "Good Part Count",
    "Good part Count":                     "Good Part Count",
    "Reject Count":                        "Reject Count",
    "Inspected Count":                     "Inspected Count",
    "Inspection Cycle Time":               "Inspection Cycle Time",
    "Cycle Time":                          "Cycle Time",
    "Fill Time":                           "Fill Time",
    "Solidification Time":                 "Solidification Time",
    "Solidfication Time":                  "Solidification Time",
    "Progress":                            "Progress",
    "Capacity":                            "Capacity",
    "Accumulating":                        "Accumulating",

    # Status / Run
    "State":                               "State",
    "Is Running":                          "Is Running",
    "IsRunning":                           "Is Running",
    "Cycle Status":                        "Cycle Status",
    "LPDC Run Status":                     "Run Status",
    "CNC Run Status":                      "Run Status",
    "Degasser Run Status":                 "Run Status",
    "HT Run Status":                       "Run Status",
    "Cooling Run Status":                  "Run Status",
    "PT Run Status":                       "Run Status",
    "PB2 Run Status":                      "Run Status",
    "Outbound Run Status":                 "Run Status",
    "Inbound Run Status":                  "Run Status",
    "Storage Run Status":                  "Run Status",
    "X Ray Run Status":                    "Run Status",
    "Furnace Run Status":                  "Run Status",
    "Furnace Mode":                        "Furnace Mode",
    "Process Step":                        "Process Step",
    "Stage Status":                        "Stage Status",
    "Scan Status":                         "Scan Status",
    "Booth Cycle Status":                  "Booth Cycle Status",
    "Air Flow Status":                     "Air Flow Status",

    # Alarms
    "Alarm Status":                        "Alarm Status",
    "Fault":                               "Fault",

    # Controls / Inputs (will be filtered out)
    "Start":                               "Start",
    "Stop":                                "Stop",
    "Trigger":                             "Trigger",
    "Pour Request":                        "Pour Request",
    "Pour_request":                        "Pour Request",
    "BurnerEnable":                        "Burner Enable",
    "PLC Start":                           "PLC Start",
    "PLC Stop":                            "PLC Stop",

    # Identifiers
    "Model ID":                            "Model ID",
    "Program ID":                          "Program ID",

    # Runtime - NO unit in label
    "Runtime Total Hrs":                   "Total Runtime",
    "RuntimeTotalHrs":                     "Total Runtime",
    "Step Timer":                          "Step Timer",
    "Scan Time ms":                        "Scan Time",
    "scanTime_ms":                         "Scan Time",
    "PLC State":                           "PLC State",

    # Spindle - NO unit in label
    "Spindle RPM":                         "Spindle Speed",
    "SpindleRPM":                          "Spindle Speed",

    # Conveyor
    "Conveyor Speed":                      "Conveyor Speed",

    # Humidity
    "Booth Humidity":                      "Booth Humidity",

    # Queue / Furnace-specific
    "QueueIn":                             "Queue In",
    "QueueOut":                            "Queue Out",

    # Buffer
    "Empty":                               "Empty",
    "Full":                                "Full",

    # WIP / KPI tags - NO unit in label
    "Molten Metal Kg":                     "Molten Metal",
    "Scrap Parts":                         "Scrap Parts",
    "Heat Treated Parts":                  "Heat Treated Parts",
    "Degassed Metal Kg":                   "Degassed Metal",
    "Ingots Kg":                           "Ingots",
    "Machined Parts":                      "Machined Parts",
    "Pretreated Parts":                    "Pretreated Parts",
    "Xray Passed":                         "X-Ray Passed",
    "Cooled Parts 2":                      "Cooled Parts (Stage 2)",
    "Cooled Parts 1":                      "Cooled Parts (Stage 1)",
    "Cast Parts":                          "Cast Parts",
    "Painted Parts":                       "Painted Parts",
    "Qc Passed":                           "QC Passed",
    "Total Scrap":                         "Total Scrap",
    "Total Wheels Produced":               "Total Wheels Produced",
    "Total Ingots Consumed":               "Total Ingots Consumed",
    "Yield Percent":                       "Yield",
    "Throughput Wheels Hr":                "Throughput",
    "Batches Completed":                   "Batches Completed",
    "Kg_degassed":                         "Degassed Metal",
}


def normalize_name(raw_name):
    if raw_name in NAME_MAP:
        return NAME_MAP[raw_name]
    return raw_name.replace("_", " ").title()


# 5. TAG CATEGORISATION
CONTROL_KEYS = ["start", "stop", "trigger", "pour", "burner", "plc start", "plc stop"]

def categorize_tag(tag_name):
    tl = tag_name.lower()

    # Skip control / input tags
    for k in CONTROL_KEYS:
        if tl == k or tl == k.replace(" ", "_"):
            return None

    # Energy
    if any(k in tl for k in ["instant power", "total energy"]):
        return "energy"

    # Temperature & machine metrics
    if any(k in tl for k in ["temp", "temperature", "spindle speed",
                              "pressure", "humidity", "vacuum", "vibration",
                              "oil level", "motor load", "air supply", "air flow",
                              "conveyor", "zone", "roof", "wall", "melt", "die",
                              "riser", "holding", "setpoint", "bath", "dryer",
                              "booth temp", "booth humidity"]):
        return "metric"

    # Alarms
    if any(k in tl for k in ["alarm", "fault"]):
        return "alarm"

    # Run state / status
    if any(k in tl for k in ["run status", "state", "is running", "isrunning",
                              "cycle status", "process step", "stage status",
                              "mode", "scan status", "booth cycle",
                              "air flow status"]):
        return "status"

    # Production / process
    if any(k in tl for k in ["count", "processed", "shot", "cycle time",
                              "fill time", "solidification", "solidfication",
                              "progress", "capacity", "accumulating",
                              "inspected", "ok count", "ng count", "not good",
                              "part count", "good part", "reject",
                              "kg", "ingots", "molten", "cast", "degassed",
                              "scrap", "machined", "pretreated", "painted",
                              "heat treated", "cooled", "xray", "x-ray",
                              "qc", "yield", "throughput", "wheels",
                              "batches", "queue"]):
        return "production"

    # Identifiers
    if any(k in tl for k in ["model id", "program id"]):
        return "status"

    # Runtime
    if "runtime" in tl or "total runtime" in tl or "step timer" in tl:
        return "metric"

    # Scan time
    if "scan time" in tl:
        return "metric"

    # Remaining booleans (empty/full)
    if tl in ["empty", "full"]:
        return "status"

    return "metric"


# 6. SAMPLE VALUE GENERATION
def generate_value(display_name):
    tl = display_name.lower()

    # Temperatures
    if "roof temp" in tl:              return f"{random.uniform(55,75):.1f} C"
    if "wall temp" in tl:              return f"{random.uniform(45,65):.1f} C"
    if "zone temp" in tl:              return f"{random.uniform(650,750):.1f} C"
    if "melt bath" in tl:             return f"{random.uniform(700,780):.1f} C"
    if "holding furnace" in tl:       return f"{random.uniform(680,760):.1f} C"
    if "die top" in tl:               return f"{random.uniform(350,420):.1f} C"
    if "die bottom" in tl:            return f"{random.uniform(320,390):.1f} C"
    if "internal temp" in tl:         return f"{random.uniform(30,55):.1f} C"
    if "dryer temp" in tl:            return f"{random.uniform(80,120):.1f} C"
    if "booth temp" in tl:            return f"{random.uniform(22,28):.1f} C"
    if "setpoint" in tl and "temp" in tl: return f"{random.uniform(500,550):.1f} C"
    if "target temp" in tl:           return f"{random.uniform(700,750):.1f} C"
    if "max furnace" in tl:           return f"{random.uniform(780,850):.1f} C"
    if "furnace temp" in tl:          return f"{random.uniform(680,760):.1f} C"
    if "process temp" in tl:          return f"{random.uniform(700,740):.1f} C"
    if "temp" in tl:                  return f"{random.uniform(30,800):.1f} C"

    # Spindle
    if "spindle" in tl:               return f"{random.randint(800,3500)} RPM"

    # Pressures
    if "air supply" in tl:            return f"{random.uniform(80,110):.1f} PSI"
    if "pressure" in tl and "setpoint" in tl: return f"{random.uniform(1.0,4.0):.2f} bar"
    if "pressure" in tl:              return f"{random.uniform(0.5,5.0):.2f} bar"
    if "vacuum" in tl:                return f"{random.uniform(-80,-20):.1f} kPa"

    # Humidity
    if "humidity" in tl:              return f"{random.uniform(40,65):.1f} %"

    # Vibration
    if "vibration" in tl:             return f"{random.uniform(0.5,4.5):.2f} mm/s"

    # Oil Level / Motor Load (value shows %)
    if "oil level" in tl:             return f"{random.uniform(70,98):.1f} %"
    if "motor load" in tl:            return f"{random.uniform(40,85):.1f} %"

    # Air Flow
    if "air flow" in tl:              return "Normal"

    # Conveyor
    if "conveyor" in tl:              return f"{random.uniform(0.5,2.5):.2f} m/min"

    # Energy (value shows kW / kWh)
    if "instant power" in tl:         return f"{random.uniform(15,250):.1f} kW"
    if "total energy" in tl:          return f"{random.uniform(500,15000):.1f} kWh"

    # Production / Counts
    if "cycle time" in tl:            return f"{random.uniform(30,180):.1f} sec"
    if "fill time" in tl:             return f"{random.uniform(5,20):.1f} sec"
    if "solidification" in tl:        return f"{random.uniform(60,180):.1f} sec"
    if "progress" in tl:              return f"{random.randint(10,95)} %"
    if "capacity" in tl:              return f"{random.randint(50,200)} units"
    if "accumulating" in tl:          return f"{random.randint(5,50)} pcs"
    if "shot count" in tl:            return f"{random.randint(100,5000)}"
    if "inspected" in tl:             return f"{random.randint(50,500)}"
    if "ok count" in tl:              return f"{random.randint(40,480)}"
    if "not good" in tl:              return f"{random.randint(1,20)}"
    if "good part" in tl:             return f"{random.randint(50,400)}"
    if "reject" in tl:                return f"{random.randint(1,15)}"
    if "part count" in tl:            return f"{random.randint(20,300)}"
    if "processed count" in tl:       return f"{random.randint(100,2000)}"
    if "inspection cycle" in tl:      return f"{random.uniform(10,30):.1f} sec"
    if "scan status" in tl:           return "Active"

    # Runtime (value shows hrs / min / ms)
    if "total runtime" in tl:         return f"{random.uniform(500,8000):.1f} hrs"
    if "step timer" in tl:            return f"{random.randint(5,120)} min"
    if "scan time" in tl:             return f"{random.randint(10,50)} ms"

    # Alarm / Fault
    if "alarm" in tl:
        return random.choice(["None", "Low Oil Warning", "High Temp Alert", "Vibration Warning"])
    if "fault" in tl:
        return random.choice(["None", "Minor: Sensor Drift"])

    # Status / State
    if "run status" in tl:            return random.choice(["Running", "Idle", "Standby"])
    if "state" in tl:                 return random.choice(["Running", "Idle", "Maintenance"])
    if "is running" in tl:            return random.choice(["True", "False"])
    if "mode" in tl:                  return random.choice(["Auto", "Manual"])
    if "cycle status" in tl:          return random.choice(["In Progress", "Completed", "Waiting"])
    if "process step" in tl:          return random.choice(["Heating", "Soaking", "Cooling"])
    if "stage status" in tl:          return random.choice(["Active", "Complete"])
    if "air flow status" in tl:       return "Normal"
    if "booth cycle" in tl:           return random.choice(["Spraying", "Drying", "Idle"])

    # Queue
    if "queue" in tl:                 return f"{random.randint(0,10)}"

    # Boolean statuses
    if tl == "empty":                 return random.choice(["True", "False"])
    if tl == "full":                  return random.choice(["True", "False"])

    # Identifiers
    if "model id" in tl:              return f"AW-{random.randint(100,999)}"
    if "program id" in tl:            return f"PRG-{random.randint(1000,9999)}"

    # Plant WIP / KPI (values carry the unit)
    if "ingots" in tl:                return f"{random.uniform(500,2000):.1f} Kg"
    if "molten" in tl:                return f"{random.uniform(200,800):.1f} Kg"
    if "degassed" in tl:              return f"{random.uniform(150,600):.1f} Kg"
    if "cast" in tl:                  return f"{random.randint(50,300)}"
    if "cooled" in tl:                return f"{random.randint(40,250)}"
    if "machined" in tl:              return f"{random.randint(30,200)}"
    if "scrap" in tl:                 return f"{random.randint(5,30)}"
    if "pretreated" in tl:            return f"{random.randint(20,150)}"
    if "painted" in tl:               return f"{random.randint(15,140)}"
    if "heat treated" in tl:          return f"{random.randint(30,200)}"
    if "x-ray" in tl:                 return f"{random.randint(20,180)}"
    if "qc" in tl:                    return f"{random.randint(15,160)}"
    if "yield" in tl:                 return f"{random.uniform(85,98):.1f} %"
    if "throughput" in tl:            return f"{random.uniform(10,50):.1f} wheels/hr"
    if "wheels" in tl:                return f"{random.randint(100,1000)}"
    if "batches" in tl:               return f"{random.randint(5,50)}"

    return f"{random.uniform(10,100):.1f}"


# 7. BUILD DEVICE DATA
SKIP_SUBS = {"Inputs", "PLC", "Outputs", "Plant WIP", "Plant KPI"}
SKIP_DEVICES = {"Runtime", "Commands", "Plant"}

devices_raw = []
raw_tag_counts = {}

for path, tags in all_devices:
    parts = path.split("/")
    if len(parts) <= 2:
        continue

    device_name = parts[2]
    sub = parts[3] if len(parts) > 3 else ""

    if device_name in SKIP_DEVICES:
        continue
    if sub in SKIP_SUBS:
        continue

    dept = DEPT_MAP.get(device_name, "General")

    metrics, energy, production, alarms, status_tags = [], [], [], [], []

    for tag_obj in tags:
        raw_name = tag_obj["name"]
        display = normalize_name(raw_name)
        cat = categorize_tag(display)
        if cat is None:
            continue

        val = generate_value(display)
        entry = f"{display} - {val}"

        if cat == "metric":
            metrics.append(entry)
        elif cat == "energy":
            energy.append(entry)
        elif cat == "production":
            production.append(entry)
        elif cat == "alarm":
            alarms.append(entry)
        elif cat == "status":
            status_tags.append(entry)

    # Count ALL atomic tags for this device (including controls)
    raw_tag_counts.setdefault(device_name, 0)
    raw_tag_counts[device_name] += len(tags)

    # Maintenance - EXACTLY 1 upcoming maintenance item per machine
    last_service = datetime(2025, random.randint(9, 12), random.randint(1, 28))
    next_service = last_service + timedelta(days=random.randint(60, 180))
    maint = [random.choice([
        "Replace hydraulic filter in 3 weeks",
        "Scheduled bearing inspection in 2 weeks",
        "Lubrication due in 10 days",
        "Motor alignment check in 1 month",
        "Calibration due in 15 days",
        "Belt replacement scheduled in 4 weeks",
        "Sensor recalibration in 2 weeks",
        "Cooling system flush in 3 weeks",
    ])]

    devices_raw.append({
        "department":    dept,
        "machine":       device_name,
        "metrics":       metrics,
        "energy":        energy,
        "production":    production,
        "alarms":        alarms,
        "status":        status_tags,
        "maintenance":   maint,
        "last_service":  last_service.strftime("%Y-%m-%d"),
        "next_service":  next_service.strftime("%Y-%m-%d"),
    })

# Merge sub-paths for same device (Status, etc.)
merged = {}
for d in devices_raw:
    key = d["machine"]
    if key not in merged:
        merged[key] = d
    else:
        merged[key]["metrics"].extend(d["metrics"])
        merged[key]["energy"].extend(d["energy"])
        merged[key]["production"].extend(d["production"])
        merged[key]["alarms"].extend(d["alarms"])
        merged[key]["status"].extend(d["status"])

devices = list(merged.values())

# 8. SORT: machine with the most tags FIRST, then by department
devices.sort(key=lambda d: raw_tag_counts.get(d["machine"], 0), reverse=True)

# Print tag count ranking
print("\n  MACHINE TAG COUNT RANKING")
print("  " + "-" * 40)
for d in devices:
    count = raw_tag_counts.get(d["machine"], 0)
    print(f"  {d['machine']:<20s}  {count:>3d} tags   ({d['department']})")

# Print Alarm & Maintenance counts for UI designers
print("\n  ALARM & MAINTENANCE ITEM COUNTS (for UI design)")
print("  " + "-" * 60)
print(f"  {'Machine':<20s}  {'Alarms':>7s}  {'Maint':>6s}  Notes")
print("  " + "-" * 60)
for d in devices:
    a_count = len(d["alarms"])
    m_count = len(d["maintenance"])
    print(f"  {d['machine']:<20s}  {a_count:>7d}  {m_count:>6d}")
total_alarms = sum(len(d["alarms"]) for d in devices)
total_maint  = sum(len(d["maintenance"]) for d in devices)
print("  " + "-" * 60)
print(f"  {'TOTAL':<20s}  {total_alarms:>7d}  {total_maint:>6d}")
print(f"\n  Summary:")
print(f"    - Alarm tags per machine: 0-2 (from tags.json: 'Alarm Status' and/or 'Fault')")
print(f"    - Maintenance items per machine: exactly 1 upcoming task")
print(f"    - Total alarm entries across all machines: {total_alarms}")
print(f"    - Total maintenance entries across all machines: {total_maint}")

# Section-wise breakdown for TOP machine (first page)
top = devices[0]
print(f"\n  FIRST PAGE: {top['machine']} ({top['department']}) - {raw_tag_counts.get(top['machine'], 0)} tags")
print("  " + "-" * 50)
print(f"    Machine Metrics  : {len(top['metrics'])} values")
print(f"    Energy           : {len(top['energy'])} values")
print(f"    Production       : {len(top['production'])} values")
print(f"    Status & Run Info: {len(top['status'])} values")
print(f"    Alarms           : {len(top['alarms'])} values")
print(f"    Maintenance      : {len(top['maintenance'])} values")
print(f"    Asset Info       : 2 values (Last Service, Next Service)")
print()


# 9. PDF GENERATION (dark theme matching reference image)
BG    = (34, 34, 34)
WHITE = (230, 230, 230)
GREEN = (100, 210, 110)
RED   = (210, 80, 80)
GREY  = (170, 170, 170)
AMBER = (255, 191, 0)


class TagReportPDF(FPDF):
    def header(self):
        self.set_fill_color(*BG)
        self.rect(0, 0, 210, 297, "F")
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*WHITE)
        self.cell(0, 8,
                  "Alloy Wheel Manufacturing - Digital Twin Tag Report",
                  align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(80, 80, 80)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(*GREY)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        self.cell(0, 10,
                  f"Generated {ts}   |   Page {self.page_no()}/{{nb}}",
                  align="C")


pdf = TagReportPDF()
pdf.alias_nb_pages()
pdf.set_auto_page_break(auto=True, margin=20)


def section(title):
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*RED)
    pdf.cell(0, 6, title.upper(), new_x="LMARGIN", new_y="NEXT")


def items(entries):
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*WHITE)
    for e in entries:
        pdf.cell(0, 4.5, f"  {e}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


# ==========================================================================
# PAGE 1: CONSOLIDATED SECTION-WISE TAG COUNT TABLE
# ==========================================================================
pdf.add_page()

pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*GREY)
pdf.cell(0, 5, "CONSOLIDATED OVERVIEW", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 14)
pdf.set_text_color(*WHITE)
pdf.cell(0, 8, "Section-Wise Tag Count Summary", new_x="LMARGIN", new_y="NEXT")
pdf.ln(2)

pdf.set_font("Helvetica", "I", 7)
pdf.set_text_color(*GREY)
pdf.cell(0, 4,
         "Per-machine count of tags in each section. Highest in each column is highlighted.",
         new_x="LMARGIN", new_y="NEXT")
pdf.ln(2)

# Pre-compute section counts for all devices
dev_section_counts = []
for dev in devices:
    counts = {
        "metrics":  len(dev["metrics"]),
        "energy":   len(dev["energy"]),
        "prod":     len(dev["production"]),
        "status":   len(dev["status"]),
        "alarms":   len(dev["alarms"]),
        "maint":    len(dev["maintenance"]),
        "asset":    2,
        "total":    raw_tag_counts.get(dev["machine"], 0),
    }
    dev_section_counts.append(counts)

# Find the MAX in each column for highlighting
col_keys = ["metrics", "energy", "prod", "status", "alarms", "maint", "asset", "total"]
col_max = {}
for key in col_keys:
    col_max[key] = max(c[key] for c in dev_section_counts) if dev_section_counts else 0

# Table column widths
c_num  = 8
c_mach = 30
c_dept = 28
c_met  = 17
c_ene  = 16
c_pro  = 15
c_sta  = 15
c_alm  = 16
c_mnt  = 15
c_ast  = 14
c_tot  = 14
col_widths = [c_met, c_ene, c_pro, c_sta, c_alm, c_mnt, c_ast, c_tot]

# Table header
pdf.set_font("Helvetica", "B", 7)
pdf.set_text_color(*RED)
pdf.cell(c_num, 5, "#",          new_x="RIGHT", new_y="TOP")
pdf.cell(c_mach, 5, "Machine",   new_x="RIGHT", new_y="TOP")
pdf.cell(c_dept, 5, "Dept",      new_x="RIGHT", new_y="TOP")
pdf.cell(c_met, 5, "Metrics",    new_x="RIGHT", new_y="TOP")
pdf.cell(c_ene, 5, "Energy",     new_x="RIGHT", new_y="TOP")
pdf.cell(c_pro, 5, "Prod.",      new_x="RIGHT", new_y="TOP")
pdf.cell(c_sta, 5, "Status",     new_x="RIGHT", new_y="TOP")
pdf.cell(c_alm, 5, "Alarms",     new_x="RIGHT", new_y="TOP")
pdf.cell(c_mnt, 5, "Maint.",     new_x="RIGHT", new_y="TOP")
pdf.cell(c_ast, 5, "Asset",      new_x="RIGHT", new_y="TOP")
pdf.cell(c_tot, 5, "Total",      new_x="LMARGIN", new_y="NEXT")

pdf.set_draw_color(80, 80, 80)
pdf.line(10, pdf.get_y(), 200, pdf.get_y())
pdf.ln(1)

# Table rows
sum_counts = {k: 0 for k in col_keys}

pdf.set_font("Helvetica", "", 7)
for idx, (dev, counts) in enumerate(zip(devices, dev_section_counts), 1):
    for k in col_keys:
        sum_counts[k] += counts[k]

    # Machine name & department in white
    pdf.set_text_color(*WHITE)
    pdf.cell(c_num, 4.5, str(idx),           new_x="RIGHT", new_y="TOP")
    pdf.cell(c_mach, 4.5, dev["machine"],    new_x="RIGHT", new_y="TOP")
    pdf.cell(c_dept, 4.5, dev["department"], new_x="RIGHT", new_y="TOP")

    # Each count cell: GREEN if it's the column max, white otherwise, dim if 0
    for key, cw in zip(col_keys, col_widths):
        val = counts[key]
        if val > 0 and val == col_max[key]:
            pdf.set_text_color(*GREEN)  # HIGHEST in this column
        elif val > 0:
            pdf.set_text_color(*WHITE)
        else:
            pdf.set_text_color(100, 100, 100)
        pdf.cell(cw, 4.5, str(val), new_x="RIGHT", new_y="TOP")

    pdf.ln(4.5)

# Separator
pdf.set_draw_color(80, 80, 80)
pdf.line(10, pdf.get_y(), 200, pdf.get_y())
pdf.ln(1)

# Totals row
pdf.set_font("Helvetica", "B", 7)
pdf.set_text_color(*AMBER)
pdf.cell(c_num, 5, "",             new_x="RIGHT", new_y="TOP")
pdf.cell(c_mach, 5, "TOTAL",      new_x="RIGHT", new_y="TOP")
pdf.cell(c_dept, 5, f"{len(devices)} machines", new_x="RIGHT", new_y="TOP")
for key, cw in zip(col_keys, col_widths):
    pdf.cell(cw, 5, str(sum_counts[key]), new_x="RIGHT", new_y="TOP")
pdf.ln(5)

# "Highest" row - show which machine has the max per column
pdf.set_font("Helvetica", "I", 7)
pdf.set_text_color(100, 100, 100)
pdf.cell(c_num, 5, "",        new_x="RIGHT", new_y="TOP")
pdf.cell(c_mach, 5, "Highest", new_x="RIGHT", new_y="TOP")
pdf.cell(c_dept, 5, "",        new_x="RIGHT", new_y="TOP")
for key, cw in zip(col_keys, col_widths):
    # Find the machine name with the max value for this column
    max_val = col_max[key]
    winner = ""
    for dev, counts in zip(devices, dev_section_counts):
        if counts[key] == max_val and max_val > 0:
            # Use short name
            winner = dev["machine"].replace("_0", "_").replace("_", "")
            break
    pdf.set_text_color(*GREEN)
    pdf.cell(cw, 5, winner[:8], new_x="RIGHT", new_y="TOP")
pdf.ln(5)
pdf.ln(2)

# Grand total note
pdf.set_font("Helvetica", "I", 8)
pdf.set_text_color(*GREY)
total_tags = sum_counts["total"]
pdf.cell(0, 5, f"Grand Total: {total_tags} tags across {len(devices)} machines",
         new_x="LMARGIN", new_y="NEXT")
pdf.ln(2)

# Legend
pdf.set_font("Helvetica", "B", 7)
pdf.set_text_color(*AMBER)
pdf.cell(0, 4, "COLUMN KEY:", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 7)
pdf.set_text_color(*WHITE)
legend = [
    "Metrics = Machine Metrics (Temp, Pressure, Vibration, Oil Level, Motor Load, etc.)",
    "Energy  = Energy Consumption (Instant Power, Total Energy Consumed)",
    "Prod.   = Production Data (Cycle Time, Part Count, Shot Count, Fill Time, etc.)",
    "Status  = Status & Run Info (State, Is Running, Run Status, Mode, etc.)",
    "Alarms  = Alarm Status, Fault",
    "Maint.  = Upcoming Maintenance Tasks (always 1 per machine)",
    "Asset   = Asset Info (Last Service, Next Service - always 2 per machine)",
    "Total   = All atomic tags from tags.json (includes controls not shown in report)",
    "",
    "GREEN = highest count in that column across all machines",
]
for line in legend:
    pdf.cell(0, 3.5, f"  {line}", new_x="LMARGIN", new_y="NEXT")


# ==========================================================================
# PER-DEVICE PAGES (machine details)
# ==========================================================================
# Per-device pages
for dev in devices:
    pdf.add_page()

    tag_count = raw_tag_counts.get(dev["machine"], 0)

    # Section counts
    n_metrics = len(dev["metrics"])
    n_energy  = len(dev["energy"])
    n_prod    = len(dev["production"])
    n_status  = len(dev["status"])
    n_alarms  = len(dev["alarms"])
    n_maint   = len(dev["maintenance"])
    n_asset   = 2  # Last Service + Next Service (always 2)

    # Department / Machine header
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*GREY)
    pdf.cell(95, 5, "DEPARTMENT", new_x="RIGHT", new_y="TOP")
    pdf.cell(95, 5, "MACHINE", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 14)
    pdf.set_text_color(*WHITE)
    pdf.cell(95, 8, dev["department"], new_x="RIGHT", new_y="TOP")
    pdf.set_text_color(*GREEN)
    pdf.cell(95, 8, dev["machine"], new_x="LMARGIN", new_y="NEXT")

    # Tag count badge
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(*GREY)
    pdf.cell(0, 4, f"Total tags: {tag_count}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # --- SECTION-WISE COUNT SUMMARY BOX ---
    pdf.set_draw_color(80, 80, 80)
    box_y = pdf.get_y()
    pdf.rect(10, box_y, 190, 22, "D")

    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*AMBER)
    pdf.set_xy(12, box_y + 1)
    pdf.cell(0, 4, "SECTION-WISE VALUE COUNT (for UI layout)", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(*WHITE)
    col_w = 27
    pdf.set_x(12)
    sections_summary = [
        ("Metrics", n_metrics),
        ("Energy", n_energy),
        ("Production", n_prod),
        ("Status", n_status),
        ("Alarms", n_alarms),
        ("Maintenance", n_maint),
        ("Asset Info", n_asset),
    ]
    # Row 1: section names
    for label, _ in sections_summary:
        pdf.set_text_color(*GREY)
        pdf.cell(col_w, 4, label, new_x="RIGHT", new_y="TOP")
    pdf.ln(4)
    # Row 2: counts
    pdf.set_x(12)
    for _, count in sections_summary:
        if count > 0:
            pdf.set_text_color(*GREEN)
        else:
            pdf.set_text_color(100, 100, 100)
        pdf.cell(col_w, 4, str(count), new_x="RIGHT", new_y="TOP")
    pdf.ln(4)

    pdf.set_y(box_y + 24)

    # Machine Metrics
    if dev["metrics"]:
        section(f"Machine Metrics ({n_metrics})")
        items(dev["metrics"])

    # Energy Consumption
    if dev["energy"]:
        section(f"Energy Consumption ({n_energy})")
        items(dev["energy"])

    # Production Data
    if dev["production"]:
        section(f"Production Data ({n_prod})")
        items(dev["production"])

    # Status
    if dev["status"]:
        section(f"Status & Run Info ({n_status})")
        items(dev["status"])

    # Alarms
    if dev["alarms"]:
        section(f"Alarms ({n_alarms})")
        items(dev["alarms"])

    # Maintenance
    section(f"Maintenance ({n_maint})")
    items(dev["maintenance"])

    # Asset Info
    section(f"Asset Info ({n_asset})")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 4.5, f"  Last serviced on - {dev['last_service']}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 4.5, f"  Next service on  - {dev['next_service']}", new_x="LMARGIN", new_y="NEXT")


# Plant Overview page
pdf.add_page()
pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*GREY)
pdf.cell(0, 5, "DEPARTMENT", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 14)
pdf.set_text_color(*WHITE)
pdf.cell(0, 8, "Plant Overview", new_x="LMARGIN", new_y="NEXT")
pdf.ln(5)

section("Plant KPI")
kpi = [
    f"Total Wheels Produced - {random.randint(500,2000)}",
    f"Total Ingots Consumed - {random.uniform(2000,8000):.1f} Kg",
    f"Yield - {random.uniform(88,97):.1f} %",
    f"Throughput - {random.uniform(15,45):.1f} wheels/hr",
    f"Batches Completed - {random.randint(10,80)}",
    f"Total Scrap - {random.randint(10,60)}",
]
items(kpi)

section("Work In Progress (WIP)")
wip = [
    f"Ingots Available - {random.uniform(800,2500):.1f} Kg",
    f"Molten Metal - {random.uniform(200,600):.1f} Kg",
    f"Degassed Metal - {random.uniform(150,500):.1f} Kg",
    f"Cast Parts - {random.randint(50,200)}",
    f"Cooled Parts (Stage 1) - {random.randint(30,150)}",
    f"Cooled Parts (Stage 2) - {random.randint(25,130)}",
    f"Heat Treated Parts - {random.randint(30,180)}",
    f"Machined Parts - {random.randint(25,160)}",
    f"Pretreated Parts - {random.randint(20,140)}",
    f"Painted Parts - {random.randint(15,130)}",
    f"X-Ray Passed - {random.randint(15,120)}",
    f"QC Passed - {random.randint(10,110)}",
    f"Scrap Parts - {random.randint(5,25)}",
]
items(wip)


# UI Design Reference page - alarm & maintenance breakdown
pdf.add_page()
pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*AMBER)
pdf.cell(0, 5, "UI DESIGN REFERENCE", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 14)
pdf.set_text_color(*WHITE)
pdf.cell(0, 8, "Alarm & Maintenance Counts Per Machine", new_x="LMARGIN", new_y="NEXT")
pdf.ln(3)

pdf.set_font("Helvetica", "I", 8)
pdf.set_text_color(*GREY)
pdf.cell(0, 5, "This page documents the exact number of alarm and maintenance items",
         new_x="LMARGIN", new_y="NEXT")
pdf.cell(0, 5, "that the UI must accommodate for each machine.",
         new_x="LMARGIN", new_y="NEXT")
pdf.ln(3)

# Table header
pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*RED)
pdf.cell(10, 6, "#",          new_x="RIGHT", new_y="TOP")
pdf.cell(45, 6, "Machine",    new_x="RIGHT", new_y="TOP")
pdf.cell(40, 6, "Department", new_x="RIGHT", new_y="TOP")
pdf.cell(25, 6, "Alarms",     new_x="RIGHT", new_y="TOP")
pdf.cell(25, 6, "Maint.",     new_x="RIGHT", new_y="TOP")
pdf.cell(20, 6, "Tags",       new_x="LMARGIN", new_y="NEXT")
pdf.set_draw_color(80, 80, 80)
pdf.line(10, pdf.get_y(), 200, pdf.get_y())
pdf.ln(2)

pdf.set_font("Helvetica", "", 8)
for idx, dev in enumerate(devices, 1):
    a_count = len(dev["alarms"])
    m_count = len(dev["maintenance"])
    t_count = raw_tag_counts.get(dev["machine"], 0)
    if idx == 1:
        pdf.set_text_color(*GREEN)
    else:
        pdf.set_text_color(*WHITE)
    pdf.cell(10, 5, str(idx),           new_x="RIGHT", new_y="TOP")
    pdf.cell(45, 5, dev["machine"],     new_x="RIGHT", new_y="TOP")
    pdf.cell(40, 5, dev["department"],  new_x="RIGHT", new_y="TOP")
    pdf.cell(25, 5, str(a_count),       new_x="RIGHT", new_y="TOP")
    pdf.cell(25, 5, str(m_count),       new_x="RIGHT", new_y="TOP")
    pdf.cell(20, 5, str(t_count),       new_x="LMARGIN", new_y="NEXT")

pdf.set_draw_color(80, 80, 80)
pdf.line(10, pdf.get_y(), 200, pdf.get_y())
pdf.ln(2)

# Totals row
pdf.set_font("Helvetica", "B", 8)
pdf.set_text_color(*AMBER)
pdf.cell(10, 5, "",                   new_x="RIGHT", new_y="TOP")
pdf.cell(45, 5, "TOTAL",              new_x="RIGHT", new_y="TOP")
pdf.cell(40, 5, f"{len(devices)} machines", new_x="RIGHT", new_y="TOP")
pdf.cell(25, 5, str(total_alarms),    new_x="RIGHT", new_y="TOP")
pdf.cell(25, 5, str(total_maint),     new_x="RIGHT", new_y="TOP")
total_tags = sum(raw_tag_counts.get(d["machine"], 0) for d in devices)
pdf.cell(20, 5, str(total_tags),      new_x="LMARGIN", new_y="NEXT")
pdf.ln(5)

# Design notes
pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*RED)
pdf.cell(0, 6, "UI DESIGN NOTES", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 8)
pdf.set_text_color(*WHITE)
design_notes = [
    "1. ALARM TAGS: Each machine has 1-2 alarm entries from tags.json.",
    "   - 'Alarm Status' tag: value is one of [None, Low Oil Warning, High Temp Alert, Vibration Warning]",
    "   - 'Fault' tag: value is one of [None, Minor: Sensor Drift]",
    "   - UI should show these as dismissible notification chips or status badges.",
    "",
    "2. MAINTENANCE: Exactly 1 upcoming maintenance task per machine.",
    "   - Format: descriptive action + time horizon (e.g. 'Replace hydraulic filter in 3 weeks')",
    "   - UI should display as a card or list item with a countdown indicator.",
    "",
    "3. ASSET INFO: 2 fixed fields per machine (Last Service Date, Next Service Date).",
    "",
    "4. LABEL FORMAT: Labels are unit-free. Values carry units.",
    "   - Example: 'Oil Level - 85.3 %' not 'Oil Level Pct - 85.3'",
    "   - Example: 'Instant Power - 142.7 kW' not 'Instant Power (kW) - 142.7'",
    "",
    "5. SECTIONS PER MACHINE PAGE: Up to 7 sections.",
    "   - Machine Metrics, Energy Consumption, Production Data,",
    "   - Status & Run Info, Alarms, Maintenance, Asset Info",
]
for note in design_notes:
    pdf.cell(0, 4.5, f"  {note}", new_x="LMARGIN", new_y="NEXT")


# Summary page
pdf.add_page()
pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*GREY)
pdf.cell(0, 5, "SUMMARY", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Helvetica", "", 14)
pdf.set_text_color(*WHITE)
pdf.cell(0, 8, "Tag Count Summary", new_x="LMARGIN", new_y="NEXT")
pdf.ln(5)

# Table header
pdf.set_font("Helvetica", "B", 9)
pdf.set_text_color(*RED)
pdf.cell(10, 6, "#",      new_x="RIGHT", new_y="TOP")
pdf.cell(50, 6, "Machine", new_x="RIGHT", new_y="TOP")
pdf.cell(50, 6, "Department", new_x="RIGHT", new_y="TOP")
pdf.cell(30, 6, "Tag Count", new_x="LMARGIN", new_y="NEXT")
pdf.set_draw_color(80, 80, 80)
pdf.line(10, pdf.get_y(), 200, pdf.get_y())
pdf.ln(2)

pdf.set_font("Helvetica", "", 8)
for idx, dev in enumerate(devices, 1):
    count = raw_tag_counts.get(dev["machine"], 0)
    if idx == 1:
        pdf.set_text_color(*GREEN)  # highlight top machine
    else:
        pdf.set_text_color(*WHITE)
    pdf.cell(10, 5, str(idx),        new_x="RIGHT", new_y="TOP")
    pdf.cell(50, 5, dev["machine"],  new_x="RIGHT", new_y="TOP")
    pdf.cell(50, 5, dev["department"], new_x="RIGHT", new_y="TOP")
    pdf.cell(30, 5, str(count),      new_x="LMARGIN", new_y="NEXT")

pdf.ln(5)
pdf.set_font("Helvetica", "I", 8)
pdf.set_text_color(*GREY)
pdf.cell(0, 5, f"Grand Total: {total_tags} tags across {len(devices)} machines",
         new_x="LMARGIN", new_y="NEXT")


# Save
output_path = "tag_report.pdf"
pdf.output(output_path)
print(f"\n  [OK]  PDF generated: {output_path}")
print(f"  Total device pages: {len(devices)}")
print(f"  Total pages: {pdf.page_no()}")
