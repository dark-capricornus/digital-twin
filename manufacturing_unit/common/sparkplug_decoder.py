import logging
import base64
import os
import sys

logger = logging.getLogger("SparkplugDecoder")

# Ensure the middleware directory is in path for proto imports if needed
middleware_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "middleware"))
if middleware_dir not in sys.path:
    sys.path.insert(0, middleware_dir)

try:
    import sparkplug_b_pb2
    HAS_SPARKPLUG_DECODER = True
    logger.info("Sparkplug B decoder loaded successfully.")
except ImportError:
    HAS_SPARKPLUG_DECODER = False
    logger.warning("sparkplug_b_pb2 not found. Sparkplug B decoding disabled.")

def decode_sparkplug_metrics(payload_bytes):
    """Decode Sparkplug B payload and extract metrics as dict"""
    if not HAS_SPARKPLUG_DECODER:
        return None
    
    try:
        payload = sparkplug_b_pb2.Payload()
        payload.ParseFromString(payload_bytes)
        
        metrics = {}
        for metric in payload.metrics:
            value = None
            if metric.HasField('int_value'): value = metric.int_value
            elif metric.HasField('long_value'): value = metric.long_value
            elif metric.HasField('float_value'): value = metric.float_value
            elif metric.HasField('double_value'): value = metric.double_value
            elif metric.HasField('boolean_value'): value = metric.boolean_value
            elif metric.HasField('string_value'): value = metric.string_value
            
            if metric.name and value is not None:
                metrics[metric.name] = value
        
        return metrics
    except Exception as e:
        logger.error(f"Sparkplug decode error: {e}")
        return None

def decode_payload(payload_bytes, topic):
    """Try to decode payload as JSON or Sparkplug B."""
    # 1. Try JSON
    try:
        import json
        data = json.loads(payload_bytes.decode('utf-8'))
        return data, "json"
    except:
        pass

    # 2. Try Sparkplug B
    metrics = decode_sparkplug_metrics(payload_bytes)
    if metrics:
        return metrics, "sparkplug"

    # 3. Fallback to Base64
    return base64.b64encode(payload_bytes).decode('utf-8'), "binary"
