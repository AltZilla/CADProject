import json
import uuid
import time
import boto3
from datetime import datetime, timedelta

try:
    from shared.python.models import AlertZone
    from shared.python.dynamo import (
        get_all_alert_zones,
        put_alert_zone,
        delete_alert_zone,
        check_and_set_alert_dedup,
        query_hotspots_by_bbox,
        decimal_to_float
    )
    from shared.python.geo_utils import hotspot_in_polygon, bbox_from_polygon
    from shared.python.config import SNS_TOPIC_ARN, AWS_REGION
except ImportError:
    try:
        from python.models import AlertZone
        from python.dynamo import (
            get_all_alert_zones,
            put_alert_zone,
            delete_alert_zone,
            check_and_set_alert_dedup,
            query_hotspots_by_bbox,
            decimal_to_float
        )
        from python.geo_utils import hotspot_in_polygon, bbox_from_polygon
        from python.config import SNS_TOPIC_ARN, AWS_REGION
    except ImportError:
        from models import AlertZone
        from dynamo import (
            get_all_alert_zones,
            put_alert_zone,
            delete_alert_zone,
            check_and_set_alert_dedup,
            query_hotspots_by_bbox,
            decimal_to_float
        )
        from geo_utils import hotspot_in_polygon, bbox_from_polygon
        from config import SNS_TOPIC_ARN, AWS_REGION

def publish_sns_alert(zone: dict, hotspot: dict):
    if not SNS_TOPIC_ARN:
        return
        
    client = boto3.client('sns', region_name=AWS_REGION)
    message = f"""🔥 WILDFIRE ALERT: Zone "{zone['name']}" BREACHED

An active fire hotspot has entered your monitored zone.

📍 Location: {hotspot['lat']:.4f}°N, {hotspot['lon']:.4f}°W
🌡️  Brightness: {hotspot['brightness']:.1f} K  
⚡ Fire Radiative Power: {hotspot['frp']:.1f} MW
🛰️  Satellite: {hotspot['satellite']}
🕐 Detection: {hotspot['acq_datetime']} UTC

This is an automated alert from the Wildfire Early Warning Platform."""

    client.publish(
        TopicArn=SNS_TOPIC_ARN,
        Message=message,
        Subject=f"Wildfire Alert: {zone['name']}"
    )

def process_zones():
    zones = get_all_alert_zones()
    three_hours_ago = datetime.utcnow() - timedelta(hours=3)
    three_hours_ago_str = three_hours_ago.strftime("%Y-%m-%dT%H:%M:%S")

    for zone in zones:
        if not zone.get('active', True):
            continue
            
        min_lon, min_lat, max_lon, max_lat = bbox_from_polygon(zone['geometry'])
        hotspots = query_hotspots_by_bbox(min_lon, min_lat, max_lon, max_lat, limit=1000)
        hotspots = decimal_to_float(hotspots)
        
        breaching_hotspots = []
        for h in hotspots:
            if h.get('acq_datetime', '') >= three_hours_ago_str:
                if hotspot_in_polygon(h['lat'], h['lon'], zone['geometry']):
                    breaching_hotspots.append(h)
                    
        if breaching_hotspots:
            # Find max FRP hotspot
            max_frp_hotspot = max(breaching_hotspots, key=lambda x: x.get('frp', 0.0))
            if check_and_set_alert_dedup(zone['zone_id'], ttl_seconds=3600):
                publish_sns_alert(zone, max_frp_hotspot)

def handle_scheduled_check():
    process_zones()

def handle_stream(event):
    """Process DynamoDB stream events for new hotspot inserts."""
    new_hotspots = []
    for record in event.get('Records', []):
        if record.get('eventName') != 'INSERT':
            continue
        new_image = record.get('dynamodb', {}).get('NewImage', {})
        if new_image:
            # DynamoDB stream format uses type descriptors
            hotspot = {
                'lat': float(new_image.get('lat', {}).get('N', 0)),
                'lon': float(new_image.get('lon', {}).get('N', 0)),
                'frp': float(new_image.get('frp', {}).get('N', 0)),
                'brightness': float(new_image.get('brightness', {}).get('N', 0)),
                'satellite': new_image.get('satellite', {}).get('S', ''),
                'acq_datetime': new_image.get('acq_datetime', {}).get('S', ''),
                'hotspot_id': new_image.get('hotspot_id', {}).get('S', ''),
            }
            new_hotspots.append(hotspot)
    
    if not new_hotspots:
        return
    
    zones = get_all_alert_zones()
    zones = decimal_to_float(zones)
    
    for zone in zones:
        if not zone.get('active', True):
            continue
        for h in new_hotspots:
            if hotspot_in_polygon(h['lat'], h['lon'], zone['geometry']):
                if check_and_set_alert_dedup(zone['zone_id'], ttl_seconds=3600):
                    publish_sns_alert(zone, h)
                break  # One alert per zone per dedup window

def route_http(event) -> dict:
    method = event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    path = event.get('requestContext', {}).get('http', {}).get('path', '')
    
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    }
    
    if method == 'OPTIONS':
        headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return {'statusCode': 200, 'headers': headers, 'body': ''}
        
    try:
        if method == 'POST' and path.endswith('/alert-zones'):
            body = json.loads(event.get('body', '{}'))
            body['zone_id'] = str(uuid.uuid4())
            body['active'] = True
            body['created_at'] = datetime.utcnow().isoformat()
            
            zone = AlertZone(**body)
            put_alert_zone(zone.model_dump())
            
            if SNS_TOPIC_ARN:
                client = boto3.client('sns', region_name=AWS_REGION)
                client.subscribe(
                    TopicArn=SNS_TOPIC_ARN,
                    Protocol='email',
                    Endpoint=zone.email
                )
                
            return {'statusCode': 201, 'headers': headers, 'body': json.dumps({'zone_id': zone.zone_id})}
            
        elif method == 'GET' and path.endswith('/alert-zones'):
            zones = get_all_alert_zones()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps(zones)}
            
        elif method == 'DELETE' and '/alert-zones/' in path:
            zone_id = path.rstrip('/').split('/')[-1]
            delete_alert_zone(zone_id)
            return {'statusCode': 204, 'headers': headers, 'body': ''}
            
        return {'statusCode': 404, 'headers': headers, 'body': 'Not Found'}
        
    except Exception as e:
        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': str(e)})}

def handler(event: dict, context):
    if 'Records' in event:
        handle_stream(event)
    elif 'requestContext' in event:
        return route_http(event)
    else:
        handle_scheduled_check()
