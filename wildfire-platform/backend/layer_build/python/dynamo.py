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
        from python.config import (
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

def batch_write_hotspots(records: list[dict]):
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(HOTSPOTS_TABLE)
    with table.batch_writer() as batch:
        for record in records:
            # Convert floats to Decimals for DynamoDB
            item = {}
            for k, v in record.items():
                if isinstance(v, float):
                    item[k] = Decimal(str(v))
                else:
                    item[k] = v
            batch.put_item(Item=item)

def query_hotspots_by_bbox(min_lon: float, min_lat: float, max_lon: float, max_lat: float, limit: int = 500) -> list[dict]:
    dynamodb = get_dynamodb_resource()
    table = dynamodb.Table(HOTSPOTS_TABLE)
    
    filter_expr = (Attr('lat').between(Decimal(str(min_lat)), Decimal(str(max_lat))) &
                   Attr('lon').between(Decimal(str(min_lon)), Decimal(str(max_lon))))
    
    items = []
    scan_kwargs = {'FilterExpression': filter_expr}
    
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get('Items', []))
        if len(items) >= limit:
            items = items[:limit]
            break
        if 'LastEvaluatedKey' not in response:
            break
        scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
    
    return items

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
