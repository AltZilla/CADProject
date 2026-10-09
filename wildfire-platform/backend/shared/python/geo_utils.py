from shapely.geometry import Point, Polygon
from decimal import Decimal

def hotspot_in_polygon(lat: float, lon: float, polygon_geojson: dict) -> bool:
    pt = Point(lon, lat)
    coords = polygon_geojson.get("coordinates", [])
    if not coords:
        return False
    poly = Polygon(coords[0])
    return pt.within(poly)

def bbox_from_polygon(polygon_geojson: dict) -> tuple[float, float, float, float]:
    coords = polygon_geojson.get("coordinates", [])
    if not coords or not coords[0]:
        return (0.0, 0.0, 0.0, 0.0)
    lons = [c[0] for c in coords[0]]
    lats = [c[1] for c in coords[0]]
    return (min(lons), min(lats), max(lons), max(lats))

def compute_region_key(lat: float, lon: float, precision: int = 1) -> str:
    return f"{round(lat, precision)}#{round(lon, precision)}"

def make_geojson_feature(geometry: dict, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": properties
    }

def make_feature_collection(features: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": features
    }

def hotspots_to_geojson(records: list[dict]) -> dict:
    features = []
    for r in records:
        lat = float(r.get('lat', 0))
        lon = float(r.get('lon', 0))
        geom = {
            "type": "Point",
            "coordinates": [lon, lat]
        }
        props = {
            "hotspot_id": str(r.get('hotspot_id', f"{lat:.4f}#{lon:.4f}")),
            "latitude": lat,
            "longitude": lon,
            "lat": lat,
            "lon": lon,
            "frp": float(r.get('frp', 0)),
            "brightness": float(r.get('brightness', 0)),
            "confidence": int(r.get('confidence', 0)),
            "satellite": str(r.get('satellite', 'VIIRS')),
            "instrument": str(r.get('instrument', 'VIIRS-NRT')),
            "acq_datetime": str(r.get('acq_datetime', '')),
            "daynight": str(r.get('daynight', 'D')),
            "region_key": str(r.get('region_key', ''))
        }
        if 'fire_class' in r:
            props['fire_class'] = r['fire_class']
        if 'class_reason' in r:
            props['class_reason'] = r['class_reason']
        if 'clustered' in r:
            props['clustered'] = r['clustered']
        if 'count' in r:
            props['count'] = r['count']
        if 'total_frp' in r:
            props['total_frp'] = float(r['total_frp'])
        features.append(make_geojson_feature(geom, props))
    return make_feature_collection(features)

def decimal_to_float(obj):
    if isinstance(obj, list):
        return [decimal_to_float(x) for x in obj]
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    return obj
