import json
import time
from collections import defaultdict

try:
    from shared.python.dynamo import query_hotspots_by_bbox
    from shared.python.geo_utils import decimal_to_float, make_feature_collection, make_geojson_feature, hotspots_to_geojson
except ImportError:
    try:
        from python.dynamo import query_hotspots_by_bbox
        from python.geo_utils import decimal_to_float, make_feature_collection, make_geojson_feature, hotspots_to_geojson
    except ImportError:
        from dynamo import query_hotspots_by_bbox
        from geo_utils import decimal_to_float, make_feature_collection, make_geojson_feature, hotspots_to_geojson

def cluster_hotspots(records: list[dict], grid_size: float = 0.5) -> list[dict]:
    clusters = defaultdict(lambda: {"total_frp": 0.0, "count": 0, "lat_sum": 0.0, "lon_sum": 0.0})
    for r in records:
        lat = r['lat']
        lon = r['lon']
        grid_lat = round(lat / grid_size) * grid_size
        grid_lon = round(lon / grid_size) * grid_size
        
        key = (grid_lat, grid_lon)
        clusters[key]["total_frp"] += r.get('frp', 0.0)
        clusters[key]["count"] += 1
        clusters[key]["lat_sum"] += lat
        clusters[key]["lon_sum"] += lon
        
    features = []
    for key, data in clusters.items():
        count = data["count"]
        centroid_lat = data["lat_sum"] / count
        centroid_lon = data["lon_sum"] / count
        geom = {
            "type": "Point",
            "coordinates": [centroid_lon, centroid_lat]
        }
        props = {
            "hotspot_id": f"cluster_{round(centroid_lat, 2)}_{round(centroid_lon, 2)}",
            "total_frp": data["total_frp"],
            "frp": data["total_frp"],
            "brightness": 330.0,
            "count": count,
            "latitude": centroid_lat,
            "longitude": centroid_lon,
            "lat": centroid_lat,
            "lon": centroid_lon,
            "satellite": "VIIRS Cluster",
            "acq_datetime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "clustered": True
        }
        features.append(make_geojson_feature(geom, props))
        
    return make_feature_collection(features)

def handler(event: dict, context) -> dict:
    method = event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    
    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'body': ''
        }
        
    try:
        params = event.get('queryStringParameters', {}) or {}
        
        required = ['min_lon', 'min_lat', 'max_lon', 'max_lat']
        missing = [p for p in required if p not in params]
        if missing:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': f'Missing required parameters: {missing}'})
            }
        
        min_lon = max(-180.0, float(params['min_lon']))
        min_lat = max(-90.0, float(params['min_lat']))
        max_lon = min(180.0, float(params['max_lon']))
        max_lat = min(90.0, float(params['max_lat']))
        limit = min(int(params.get('limit', 1000)), 1000)
        satellite = params.get('satellite')
        min_confidence = params.get('min_confidence')
            
        records = query_hotspots_by_bbox(min_lon, min_lat, max_lon, max_lat, limit)
        records = decimal_to_float(records)
        
        if satellite:
            records = [r for r in records if r.get('satellite') == satellite]
            
        if min_confidence:
            threshold = {'low': 30, 'nominal': 60, 'high': 90}.get(min_confidence.lower(), 0)
            records = [r for r in records if r.get('confidence', 0) >= threshold]
            
        if len(records) >= limit:  # If we hit the limit, cluster to reduce payload
            geojson = cluster_hotspots(records, grid_size=0.5)
        else:
            geojson = hotspots_to_geojson(records)
            
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Cache-Control': 'max-age=180'
            },
            'body': json.dumps(geojson)
        }
        
    except (ValueError, TypeError, KeyError) as e:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': f'Invalid request: {str(e)}'})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
        }
