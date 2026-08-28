import os

FIRMS_API_KEY = os.environ.get("FIRMS_API_KEY", "")
HOTSPOTS_TABLE = os.environ.get("HOTSPOTS_TABLE", "WildfireHotspots")
SIMULATION_CACHE_TABLE = os.environ.get("SIMULATION_CACHE_TABLE", "SimulationCache")
ALERT_ZONES_TABLE = os.environ.get("ALERT_ZONES_TABLE", "AlertZones")
ALERT_DEDUP_TABLE = os.environ.get("ALERT_DEDUP_TABLE", "AlertDedup")
GEOJSON_BUCKET = os.environ.get("GEOJSON_BUCKET", "")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_ENDPOINT = os.environ.get("DYNAMODB_ENDPOINT", None)
