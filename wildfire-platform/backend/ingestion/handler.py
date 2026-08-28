import os
import csv
import json
import time
import logging
import requests
from io import StringIO
from typing import Dict, Any

try:
    from shared.python.config import FIRMS_API_KEY
    from shared.python.dynamo import batch_write_hotspots
    from shared.python.geo_utils import compute_region_key
except ImportError:
    try:
        from python.config import FIRMS_API_KEY
        from python.dynamo import batch_write_hotspots
        from python.geo_utils import compute_region_key
    except ImportError:
        from config import FIRMS_API_KEY
        from dynamo import batch_write_hotspots
        from geo_utils import compute_region_key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def fetch_firms_csv(source: str) -> list[dict]:
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_API_KEY}/{source}/world/1"
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code == 200:
                return list(csv.DictReader(StringIO(resp.text)))
            else:
                logger.warning(f"FIRMS API returned {resp.status_code} on attempt {attempt+1} for {source}")
        except Exception as e:
            logger.warning(f"FIRMS API request failed on attempt {attempt+1} for {source}: {str(e)}")
        
        time.sleep(2 ** attempt)
    return []

def normalize_confidence(conf_str: str) -> int:
    conf_str = conf_str.lower()
    if conf_str == 'h': return 90
    if conf_str == 'n': return 60
    if conf_str == 'l': return 30
    return 0

def handler(event: dict, context) -> dict:
    try:
        noaa20_records = fetch_firms_csv("VIIRS_NOAA20_NRT")
        noaa21_records = fetch_firms_csv("VIIRS_NOAA21_NRT")
        all_records = noaa20_records + noaa21_records
        
        now = int(time.time())
        expires_at = now + 7 * 24 * 3600
        hotspots_map: Dict[str, dict] = {}
        errors = []
        
        if not all_records:
            logger.warning("No records returned from NASA FIRMS API. Please check your FIRMS_API_KEY.")
            return {
                'statusCode': 200,
                'body': json.dumps({'ingested': 0, 'message': 'No satellite data returned from NASA API (check API key)'})
            }
        
        for row in all_records:
            try:
                frp = float(row.get('frp') or 0)
                conf = normalize_confidence(row.get('confidence', ''))
                
                # Filter out low-intensity or noise to respect DynamoDB write capacity
                if frp < 3.0 and conf < 50:
                    continue
                    
                lat = float(row['latitude'])
                lon = float(row['longitude'])
                acq_date = row['acq_date']
                acq_time = row['acq_time']
                
                hotspot_id = f"{lat:.4f}#{lon:.4f}#{acq_date}#{acq_time}"
                if hotspot_id in hotspots_map:
                    continue
                
                hotspots_map[hotspot_id] = {
                    "lat": lat,
                    "lon": lon,
                    "brightness": float(row.get('bright_ti4') or 0),
                    "frp": frp,
                    "confidence": conf,
                    "satellite": row.get('satellite', ''),
                    "instrument": row.get('instrument', ''),
                    "acq_datetime": f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00Z",
                    "region_key": compute_region_key(lat, lon),
                    "hotspot_id": hotspot_id,
                    "expires_at": expires_at,
                    "daynight": row.get('daynight', '')
                }
            except Exception as e:
                errors.append(str(e))
        
        # Sort real NASA hotspots by intensity (FRP) and ingest top 1,000 to prevent DynamoDB write throttling
        hotspots_list = sorted(hotspots_map.values(), key=lambda x: x.get('frp', 0), reverse=True)[:1000]
        
        if hotspots_list:
            batch_write_hotspots(hotspots_list)
            logger.info(f"Successfully ingested {len(hotspots_list)} real NASA satellite hotspots into DynamoDB.")
            
        return {
            'statusCode': 200,
            'body': json.dumps({'ingested': len(hotspots_list), 'errors_count': len(errors)})
        }
        
    except Exception as e:
        logger.error(f"Ingestion failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
