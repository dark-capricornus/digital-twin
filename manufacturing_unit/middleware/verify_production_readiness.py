import socket
import asyncio
import os
import sys

# Production Readiness Health Check - Digital Twin V1
# Verifies all core service links for port forwarding suitability.

def check_port(host, port, name):
    """Check if a service is listening on a specific port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(2)
        try:
            s.connect((host, port))
            print(f"  [PASS] {name} ({host}:{port}) is reachable.")
            return True
        except Exception as e:
            print(f"  [FAIL] {name} ({host}:{port}) NOT REACHABLE: {e}")
            return False

def check_env_overrides():
    """Report on environment variable overrides."""
    vars = ["MQTT_HOST", "MQTT_PORT", "OPCUA_HOST"]
    print("\n--- ENVIRONMENT VARIABLES ---")
    any_set = False
    for v in vars:
        val = os.getenv(v)
        if val:
            print(f"  {v}: {val}")
            any_set = True
    if not any_set:
        print("  (No specific overrides set, using defaults)")

def main():
    print("=" * 60)
    print(" DIGITAL TWIN - PRODUCTION READINESS VERIFICATION")
    print("=" * 60)

    # 1. Check Service Defaults
    print("\n--- CORE SERVICES ---")
    
    mqtt_host = os.getenv("MQTT_HOST", "127.0.0.1")
    mqtt_port = int(os.getenv("MQTT_PORT", "1883"))
    mqtt_ok = check_port(mqtt_host, mqtt_port, "MQTT Broker")

    opcua_host = os.getenv("OPCUA_HOST", "127.0.0.1")
    opcia_port = 4840
    opcua_ok = check_port(opcua_host, opcia_port, "OPC-UA Server")

    bridge_port = 8001
    bridge_ok = check_port("127.0.0.1", bridge_port, "WebSocket Bridge")

    # 2. Check UI Accessibility
    print("\n--- FRONTEND ---")
    frontend_port = 8000
    frontend_ok = check_port("127.0.0.1", frontend_port, "Frontend UI / Dev Server")

    check_env_overrides()

    # 3. Final Summary
    print("\n" + "=" * 60)
    if all([mqtt_ok, opcua_ok, bridge_ok, frontend_ok]):
        print(" [READY] System verified for production-readiness/port-forwarding.")
        print("          All internal services are healthy.")
    else:
        print(" [WARNING] Services missing. Ensure 'uvicorn' and 'python' background")
        print("           processes are fully initialized before port forwarding.")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()
