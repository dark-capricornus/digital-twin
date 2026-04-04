import time
import json
import paho.mqtt.client as mqtt
import sys

# Try to import decoder
try:
    import sparkplug_b_pb2
    HAS_DECODER = True
except ImportError:
    HAS_DECODER = False
    print("CRITICAL: sparkplug_b_pb2 not found. verification failed.")

# Configuration
BROKER = "localhost"
PORT = 1883
TIMEOUT = 10
GROUP_ID = "AlloywheelManufacturingIndustry"
NODE_ID = "PLC"
CMD_TOPIC = f"spBv1.0/{GROUP_ID}/NCMD/{NODE_ID}"

# Storage
devices = {}

def decode_metric(metric):
    val = None
    dtype = "unknown"
    if metric.HasField('int_value'): 
        val = metric.int_value
        dtype = "int"
    elif metric.HasField('long_value'): 
        val = metric.long_value
        dtype = "long"
    elif metric.HasField('float_value'): 
        val = metric.float_value
        dtype = "float"
    elif metric.HasField('double_value'): 
        val = metric.double_value
        dtype = "double"
    elif metric.HasField('boolean_value'): 
        val = metric.boolean_value
        dtype = "boolean"
    elif metric.HasField('string_value'): 
        val = metric.string_value
        dtype = "string"
    return dtype, val

def send_rebirth(client):
    if not HAS_DECODER: return
    print(f"Sending Rebirth: {CMD_TOPIC}...")
    payload = sparkplug_b_pb2.Payload()
    metric = payload.metrics.add()
    metric.name = "Node Control/Rebirth"
    metric.boolean_value = True
    metric.datatype = 11 
    
    data = payload.SerializeToString()
    client.publish(CMD_TOPIC, data, 0, False)

def on_connect(client, userdata, flags, rc):
    print("Connected.")
    client.subscribe("spBv1.0/#")
    send_rebirth(client)

def on_message(client, userdata, msg):
    try:
        topic = msg.topic
        parts = topic.split('/')
        if len(parts) < 5: return 
        
        msg_type = parts[2]
        device_id = parts[4]
        
        if device_id not in devices:
            devices[device_id] = {}

        if not HAS_DECODER: return
        
        payload = sparkplug_b_pb2.Payload()
        try:
            payload.ParseFromString(msg.payload)
        except: return 
        
        for m in payload.metrics:
            key = m.name
            dtype, val = decode_metric(m)
            
            if key.startswith('bdSeq'): continue

            if key not in devices[device_id]:
                devices[device_id][key] = {
                    "type": dtype,
                    "value": val,
                    "source": msg_type 
                }
            else:
                devices[device_id][key]["value"] = val
                if msg_type == "DBIRTH":
                     devices[device_id][key]["source"] = "DBIRTH"
                
    except Exception as e: pass

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

try:
    client.connect(BROKER, PORT, 60)
    client.loop_start()
except: sys.exit(1)

print(f"Sampling ({TIMEOUT}s)...")
time.sleep(TIMEOUT)
client.loop_stop()
client.disconnect()

# --- Report ---
print("\n--- REPORT START ---\n")

print("Devices Observed:", ", ".join(devices.keys()))

all_ready = True

for d, metrics in devices.items():
    print(f"\n[Device: {d}]")
    
    # 1. Search for Candidates via Suffix
    found_key = None
    target_name = None
    
    for key in metrics.keys():
        if key.endswith("IsRunning") or key.endswith("is_running"):
            found_key = key
            target_name = "IsRunning"
            break
        elif key.endswith("State") or key.endswith("Status"):
            if not found_key: # Prefer IsRunning
                found_key = key
                target_name = "State"
    
    if found_key:
        m = metrics[found_key]
        print(f"  Tag: {found_key}")
        print(f"  Type: {m['type']}")
        print(f"  Value: {m['value']}")
        
        # Validation
        if target_name == "IsRunning":
            if m['type'] != 'boolean':
                print("  FAIL: IsRunning found but not Boolean.")
                all_ready = False
            else:
                print("  PASS: Boolean IsRunning found.")
        else:
             print("  WARNING: Found State/Status but missing IsRunning.")
             all_ready = False
    else:
        print("  FAIL: No state tag found.")
        print("  Available Tags: " + ", ".join(metrics.keys())[:200] + "...")
        all_ready = False

print("\nFrontend Readiness:")
print(f"Ready: {'Yes' if all_ready else 'No'}")

print("\n--- REPORT END ---")
