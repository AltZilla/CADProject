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
    from shared.python.dynamo import batch_write_hotspot_cells, get_cell_key
    from shared.python.geo_utils import compute_region_key
    from shared.python.classification import classify_hotspot
except ImportError:
    try:
        from python.config import FIRMS_API_KEY
        from python.dynamo import batch_write_hotspot_cells, get_cell_key
        from python.geo_utils import compute_region_key
        from python.classification import classify_hotspot
    except ImportError:
        try:
            from config import FIRMS_API_KEY
            from dynamo import batch_write_hotspot_cells, get_cell_key
            from geo_utils import compute_region_key
            from classification import classify_hotspot
        except ImportError:
            from backend.shared.python.config import FIRMS_API_KEY
            from backend.shared.python.dynamo import batch_write_hotspot_cells, get_cell_key
            from backend.shared.python.geo_utils import compute_region_key
            from backend.shared.python.classification import classify_hotspot

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def fetch_firms_csv(source: str) -> list[dict]:
    if FIRMS_API_KEY:
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_API_KEY}/{source}/world/1"
        for attempt in range(3):
            try:
                resp = requests.get(url, timeout=20, headers={"User-Agent": "WildfirePlatform/1.0"})
                if resp.status_code == 200 and len(resp.text) > 100:
                    return list(csv.DictReader(StringIO(resp.text)))
                else:
                    logger.warning(f"FIRMS API returned {resp.status_code} on attempt {attempt+1} for {source}")
            except Exception as e:
                logger.warning(f"FIRMS API request failed on attempt {attempt+1} for {source}: {str(e)}")
            time.sleep(2 ** attempt)

    # Fallback to NASA FIRMS Open Direct Global Feed (no API key required)
    logger.info(f"Using NASA FIRMS direct global feed fallback for {source}...")
    fallback_urls = [
        "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-nrt/csv/J1_VIIRS_C2_Global_24h.csv",
        "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-nrt/csv/SUOMI_VIIRS_C2_Global_24h.csv",
    ]
    for fb_url in fallback_urls:
        try:
            resp = requests.get(fb_url, timeout=25, headers={"User-Agent": "WildfirePlatform/1.0"})
            if resp.status_code == 200 and len(resp.text) > 100:
                logger.info(f"Successfully downloaded direct NASA feed from {fb_url}")
                return list(csv.DictReader(StringIO(resp.text)))
        except Exception as e:
            logger.warning(f"Fallback feed error for {fb_url}: {e}")
    return []

def normalize_confidence(conf_str: str) -> int:
    conf_str = str(conf_str).lower().strip()
    if conf_str.startswith('h'): return 90
    if conf_str.startswith('n'): return 60
    if conf_str.startswith('l'): return 30
    try:
        val = int(float(conf_str))
        return min(100, max(0, val))
    except (ValueError, TypeError):
        return 0

def handler(event: dict, context) -> dict:
    try:
        noaa20_records = fetch_firms_csv("VIIRS_NOAA20_NRT")
        noaa21_records = fetch_firms_csv("VIIRS_NOAA21_NRT")
        all_records = noaa20_records + noaa21_records
        
        now = int(time.time())
        expires_at = now + 7 * 24 * 3600
        errors = []
        
        if not all_records:
            logger.warning("No records returned from NASA FIRMS API. Please check your FIRMS_API_KEY.")
            return {
                'statusCode': 200,
                'body': json.dumps({'ingested': 0, 'message': 'No satellite data returned from NASA API (check API key)'})
            }
        
        from collections import defaultdict
        cells_map: Dict[str, list] = defaultdict(list)
        total_valid = 0
        
        for row in all_records:
            try:
                frp = round(float(row.get('frp') or 0), 1)
                conf = normalize_confidence(row.get('confidence', ''))
                lat = round(float(row['latitude']), 4)
                lon = round(float(row['longitude']), 4)
                bright = round(float(row.get('bright_ti4') or row.get('brightness') or 0), 1)
                daynight = str(row.get('daynight') or 'D').upper()
                acq_date = row.get('acq_date', '')
                acq_time = row.get('acq_time', '')
                
                # Classify hotspot using shared classification engine
                fire_class, class_reason = classify_hotspot(lat, lon, frp, bright, conf, daynight)
                
                point_data = {
                    "hotspot_id": f"{lat:.4f}#{lon:.4f}#{acq_date}#{acq_time}",
                    "lat": lat,
                    "lon": lon,
                    "latitude": lat,
                    "longitude": lon,
                    "brightness": bright,
                    "frp": frp,
                    "confidence": conf,
                    "satellite": row.get('satellite', 'VIIRS'),
                    "instrument": row.get('instrument', 'VIIRS'),
                    "acq_datetime": f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00Z" if len(acq_time) >= 4 else f"{acq_date}T00:00:00Z",
                    "region_key": compute_region_key(lat, lon),
                    "daynight": daynight,
                    "fire_class": fire_class,
                    "class_reason": class_reason,
                }
                
                cell_key = get_cell_key(lat, lon)
                cells_map[cell_key].append(point_data)
                total_valid += 1
            except Exception as e:
                errors.append(str(e))
        
        # Build global index summary of all active cells
        global_summary = []
        for cell_key, points in cells_map.items():
            count = len(points)
            c_lat = round(sum(p['lat'] for p in points) / count, 4)
            c_lon = round(sum(p['lon'] for p in points) / count, 4)
            max_frp = round(max(p['frp'] for p in points), 1)
            total_frp = round(sum(p['frp'] for p in points), 1)
            has_verified = any(p['fire_class'] == 'verified' for p in points)
            top_class = 'verified' if has_verified else points[0]['fire_class']
            
            global_summary.append({
                "cell_key": cell_key,
                "lat": c_lat,
                "lon": c_lon,
                "count": count,
                "frp": max_frp,
                "total_frp": total_frp,
                "fire_class": top_class,
            })
        # Upload complete unthrottled GeoJSON snapshot (all 86,000 points) to S3
        geojson_bucket = os.environ.get('GEOJSON_BUCKET') or 'wildfire-geojson-cache-003399066209-ap-south-1-an'
        if geojson_bucket:
            try:
                import boto3
                s3_region = os.environ.get('AWS_REGION', 'ap-south-1')
                s3 = boto3.client('s3', region_name=s3_region)
                all_geojson_features = []
                for cell_points in cells_map.values():
                    for p in cell_points:
                        all_geojson_features.append({
                            "type": "Feature",
                            "geometry": { "type": "Point", "coordinates": [p['lon'], p['lat']] },
                            "properties": p
                        })
                payload = json.dumps({"type": "FeatureCollection", "features": all_geojson_features})
                s3.put_object(
                    Bucket=geojson_bucket,
                    Key='hotspots-latest.json',
                    Body=payload,
                    ContentType='application/json',
                    CacheControl='public, max-age=60'
                )
                logger.info(f"Successfully uploaded full {len(all_geojson_features)} hotspots GeoJSON to S3 bucket {geojson_bucket}")
            except Exception as s3_err:
                logger.warning(f"S3 GeoJSON upload skipped/failed: {s3_err}")

        # Write priority binned cells and global index to DynamoDB with throttling protection
        batch_write_hotspot_cells(cells_map, global_summary, expires_at)
        logger.info(f"Successfully ingested {total_valid} real NASA satellite hotspots into {len(cells_map)} spatial cells.")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'ingested_points': total_valid,
                'cells_written': len(cells_map),
                'errors_count': len(errors)
            })
        }
        
    except Exception as e:
        logger.error(f"Ingestion failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
