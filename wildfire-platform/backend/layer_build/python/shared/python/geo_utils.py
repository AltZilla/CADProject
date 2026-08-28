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
        geom = {
            "type": "Point",
            "coordinates": [float(r['lon']), float(r['lat'])]
        }
        props = {
            "frp": float(r.get('frp', 0)),
            "brightness": float(r.get('brightness', 0)),
            "confidence": int(r.get('confidence', 0)),
            "satellite": r.get('satellite', ''),
            "acq_datetime": r.get('acq_datetime', '')
        }
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
