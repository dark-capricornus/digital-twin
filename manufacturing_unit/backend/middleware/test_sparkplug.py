import sys
import os

# Set current dir as path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    import sparkplug_b_pb2
    print("SUCCESS: sparkplug_b_pb2 imported correctly.")
    payload = sparkplug_b_pb2.Payload()
    print("SUCCESS: Payload object initialized.")
except Exception as e:
    print(f"FAILURE: {e}")
    sys.exit(1)
