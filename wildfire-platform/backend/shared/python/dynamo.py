import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
import os

try:
    from config import (
        HOTSPOTS_TABLE,
        SIMULATION_CACHE_TABLE,
        ALERT_ZONES_TABLE,
        ALERT_DEDUP_TABLE,
        AWS_REGION,
        DYNAMODB_ENDPOINT
    )
except ImportError:
    try:
        from shared.python.config import (
            HOTSPOTS_TABLE,
            SIMULATION_CACHE_TABLE,
            ALERT_ZONES_TABLE,
            ALERT_DEDUP_TABLE,
            AWS_REGION,
            DYNAMODB_ENDPOINT
        )
    except ImportError:
        try:
            from python.config import (
                HOTSPOTS_TABLE,
                SIMULATION_CACHE_TABLE,
                ALERT_ZONES_TABLE,
                ALERT_DEDUP_TABLE,
                AWS_REGION,
                DYNAMODB_ENDPOINT
            )
        except ImportError:
            from backend.shared.python.config import (
                HOTSPOTS_TABLE,
                SIMULATION_CACHE_TABLE,
                ALERT_ZONES_TABLE,
                ALERT_DEDUP_TABLE,
                AWS_REGION,
                DYNAMODB_ENDPOINT
            )

def get_dynamodb_resource():
    return boto3.resource(
        'dynamodb',
        region_name=AWS_REGION,
        endpoint_url=DYNAMODB_ENDPOINT
    )

def get_cell_key(lat: float, lon: float) -> str:
    """Generate a 1-degree integer grid cell key, e.g. '34#-118'."""
    import math
    return f"{int(math.floor(lat))}#{int(math.floor(lon))}"

def get_cell_keys_for_bbox(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> list[str]:
    """Return all 1-degree cell keys that intersect the given bounding box."""
    import math
    lat_start = int(math.floor(min_lat))
    lat_end = int(math.floor(max_lat))
    lon_start = int(math.floor(min_lon))
    lon_end = int(math.floor(max_lon))

    # Guard against excessively large bounding boxes generating millions of keys
    lat_span = lat_end - lat_start + 1
    lon_span = lon_end - lon_start + 1
    if lat_span * lon_span > 200:
        return []

    keys = []
    for lat in range(lat_start, lat_end + 1):
        for lon in range(lon_start, lon_end + 1):
            keys.append(f"{lat}#{lon}")
    return keys

def batch_write_hotspot_cells(cells: dict[str, list[dict]], global_summary: list[dict], expires_at: int):
    """Save global index and priority hotspot cells into DynamoDB with throttling protection."""
    import time
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(HOTSPOTS_TABLE)
    now = int(time.time())

    # 1. Save global index summary item directly (only 1 write, fits in any WCU)
    global_item = {
        'hotspot_id': '_GLOBAL_INDEX_',
        'count': len(global_summary),
        'cells': _float_to_decimal(global_summary),
        'updated_at': now,
        'expires_at': expires_at,
    }
    try:
        table.put_item(Item=global_item)
    except Exception as e:
        print(f"[DynamoDB] Warning: failed to write _GLOBAL_INDEX_: {e}")

    # 2. Write priority cells (highest fire activity first) with safe batching
    # Sort cells by total FRP descending
    sorted_cells = sorted(cells.items(), key=lambda kv: sum(p.get('frp', 0) for p in kv[1]), reverse=True)
    # Write top 50 priority cells to respect 5 WCU provisioned capacity
    priority_cells = sorted_cells[:50]

    for cell_key, points in priority_cells:
        if not points:
            continue
        max_frp = max((p.get('frp', 0.0) for p in points), default=0.0)
        total_frp = sum((p.get('frp', 0.0) for p in points))
        
        # Keep points compact
        compact_points = []
        for p in points[:500]:
            compact_points.append({
                'hotspot_id': p.get('hotspot_id'),
                'lat': p.get('lat'),
                'lon': p.get('lon'),
                'latitude': p.get('lat'),
                'longitude': p.get('lon'),
                'frp': p.get('frp'),
                'brightness': p.get('brightness'),
                'confidence': p.get('confidence'),
                'satellite': p.get('satellite'),
                'fire_class': p.get('fire_class'),
                'class_reason': p.get('class_reason'),
                'acq_datetime': p.get('acq_datetime'),
                'daynight': p.get('daynight'),
            })

        cell_item = {
            'hotspot_id': f"cell_{cell_key}",
            'cell_key': cell_key,
            'count': len(points),
            'max_frp': Decimal(str(round(max_frp, 1))),
            'total_frp': Decimal(str(round(total_frp, 1))),
            'hotspots': _float_to_decimal(compact_points),
            'updated_at': now,
            'expires_at': expires_at,
        }
        try:
            table.put_item(Item=cell_item)
            time.sleep(0.04)  # Small pacing to stay strictly under 25 WCU
        except Exception as e:
            # If throughput is exceeded, break gracefully without failing the entire ingestion!
            print(f"[DynamoDB] Rate limit reached at cell {cell_key}: {e}")
            break

def get_global_index() -> list[dict]:
    """Retrieve global cell summary centroids in ~15ms."""
    try:
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(HOTSPOTS_TABLE)
        resp = table.get_item(Key={'hotspot_id': '_GLOBAL_INDEX_'})
        item = resp.get('Item')
        if not item or 'cells' not in item:
            return []
        return decimal_to_float(item.get('cells', []))
    except Exception:
        return []

def query_hotspots_by_cells(cell_keys: list[str], min_lon: float, min_lat: float, max_lon: float, max_lat: float, limit: int = 5000) -> list[dict]:
    """Fetch specific spatial cells using BatchGetItem and unroll individual points."""
    if not cell_keys:
        return []
    dynamodb = get_dynamodb_resource()
    points = []
    chunk_size = 100

    for i in range(0, len(cell_keys), chunk_size):
        chunk = cell_keys[i:i + chunk_size]
        request_items = {
            HOTSPOTS_TABLE: {
                'Keys': [{'hotspot_id': f"cell_{k}"} for k in chunk]
            }
        }
        try:
            resp = dynamodb.batch_get_item(RequestItems=request_items)
            responses = resp.get('Responses', {}).get(HOTSPOTS_TABLE, [])
            for cell_item in responses:
                raw_points = decimal_to_float(cell_item.get('hotspots', []))
                for pt in raw_points:
                    lon = float(pt.get('lon', pt.get('longitude', 0)))
                    lat = float(pt.get('lat', pt.get('latitude', 0)))
                    if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                        points.append(pt)
                        if len(points) >= limit:
                            return points
        except Exception:
            continue

    return points

def query_hotspots_by_bbox(min_lon: float, min_lat: float, max_lon: float, max_lat: float, limit: int = 5000) -> list[dict]:
    """Efficiently query hotspots using cell keys and global index. Zero full-table scans."""
    cell_keys = get_cell_keys_for_bbox(min_lon, min_lat, max_lon, max_lat)

    # 1. If regional view (< 120 intersecting cells): fetch individual raw points from cells
    if cell_keys and len(cell_keys) <= 120:
        points = query_hotspots_by_cells(cell_keys, min_lon, min_lat, max_lon, max_lat, limit)
        if points:
            return points

    # 2. If broad world/continental view (or cell lookup returned 0): use fast global index centroids
    global_cells = get_global_index()
    if global_cells:
        points = []
        for c in global_cells:
            lon = c.get('lon', 0.0)
            lat = c.get('lat', 0.0)
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                points.append({
                    'hotspot_id': f"cluster_{round(lat, 2)}_{round(lon, 2)}",
                    'latitude': lat,
                    'longitude': lon,
                    'lat': lat,
                    'lon': lon,
                    'frp': c.get('frp', 10.0),
                    'total_frp': c.get('total_frp', c.get('frp', 10.0)),
                    'brightness': 335.0,
                    'count': c.get('count', 1),
                    'satellite': c.get('satellite', 'VIIRS Cluster'),
                    'clustered': True,
                    'fire_class': c.get('fire_class', 'verified'),
                    'class_reason': 'Regional satellite cluster',
                })
        return points

    # 3. Fallback: Quick scan limited to first page to avoid timeout
    try:
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(HOTSPOTS_TABLE)
        filter_expr = (Attr('lat').between(Decimal(str(min_lat)), Decimal(str(max_lat))) &
                       Attr('lon').between(Decimal(str(min_lon)), Decimal(str(max_lon))))
        response = table.scan(FilterExpression=filter_expr, Limit=limit)
        return decimal_to_float(response.get('Items', []))
    except Exception:
        return []

def batch_write_hotspots(records: list[dict]):
    """Legacy backward-compatible writer."""
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(HOTSPOTS_TABLE)
    with table.batch_writer() as batch:
        for record in records:
            item = {}
            for k, v in record.items():
                if isinstance(v, float):
                    item[k] = Decimal(str(v))
                else:
                    item[k] = v
            batch.put_item(Item=item)

def get_all_alert_zones() -> list[dict]:
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(ALERT_ZONES_TABLE)
    response = table.scan()
    items = response.get('Items', [])
    while 'LastEvaluatedKey' in response:
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response.get('Items', []))
    return items

def get_simulation_cache(sim_id: str) -> dict | None:
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(SIMULATION_CACHE_TABLE)
    response = table.get_item(Key={'sim_id': sim_id})
    return response.get('Item')

def put_simulation_cache(sim_id: str, result: dict, ttl_seconds: int = 3600):
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(SIMULATION_CACHE_TABLE)
    # convert floats to decimals
    item = _float_to_decimal(result)
    item['sim_id'] = sim_id
    table.put_item(Item=item)

def put_alert_zone(zone: dict):
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(ALERT_ZONES_TABLE)
    table.put_item(Item=zone)

def delete_alert_zone(zone_id: str):
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(ALERT_ZONES_TABLE)
    table.delete_item(Key={'zone_id': zone_id})

def list_alert_zones() -> list[dict]:
    return get_all_alert_zones()

def check_and_set_alert_dedup(zone_id: str, ttl_seconds: int = 3600) -> bool:
    import time
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(ALERT_DEDUP_TABLE)
    now = int(time.time())
    try:
        table.put_item(
            Item={
                'dedup_key': zone_id,
                'last_alert_time': now,
                'expires_at': now + ttl_seconds
            },
            ConditionExpression="attribute_not_exists(dedup_key) OR last_alert_time < :threshold",
            ExpressionAttributeValues={
                ':threshold': now - ttl_seconds
            }
        )
        return True
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        return False

def decimal_to_float(obj):
    from decimal import Decimal
    if isinstance(obj, list):
        return [decimal_to_float(x) for x in obj]
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    return obj

def _float_to_decimal(obj):
    if isinstance(obj, list):
        return [_float_to_decimal(x) for x in obj]
    elif isinstance(obj, dict):
        return {k: _float_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, float):
        return Decimal(str(obj))
    return obj
