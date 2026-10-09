import os
import sys
import json
import time
import math
import uuid
import threading
import requests
import csv
from io import StringIO
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, 'backend', 'simulation'))
sys.path.insert(0, os.path.join(BASE_DIR, 'backend'))

import types
if 'shared.python.geo_utils' not in sys.modules:
    geo_stub = types.ModuleType('shared.python.geo_utils')
    geo_stub.make_geojson_feature = lambda geom, props: {'type': 'Feature', 'geometry': geom, 'properties': props}
    geo_stub.make_feature_collection = lambda features: {'type': 'FeatureCollection', 'features': features}
    shared_stub = types.ModuleType('shared')
    shared_python_stub = types.ModuleType('shared.python')
    shared_stub.python = shared_python_stub
    sys.modules['shared'] = shared_stub
    sys.modules['shared.python'] = shared_python_stub
    sys.modules['shared.python.geo_utils'] = geo_stub

from rothermel import FUEL_MODELS, get_base_ros, wind_phi, slope_phi, compute_effective_vector, compute_ros_8dir
from elevation import fetch_dem_grid, compute_slope_aspect
from weather import fetch_live_weather, fetch_hourly_forecast
from fire_engine import FireSpreadEngine

# Fast in-memory numpy storage for Global NASA FIRMS hotspots
HOTSPOT_LATS = np.array([], dtype=np.float32)
HOTSPOT_LONS = np.array([], dtype=np.float32)
HOTSPOT_FRPS = np.array([], dtype=np.float32)
HOTSPOT_BRIGHTS = np.array([], dtype=np.float32)
HOTSPOT_CONFS = np.array([], dtype=np.int16)
HOTSPOT_DATES = []
HOTSPOT_SATS = []
HOTSPOT_DAYNIGHTS = []
LAST_FIRMS_FETCH = 0

# Known industrial thermal source regions (gas flares, refineries, smelters)
# Each entry: (min_lon, min_lat, max_lon, max_lat, label)
INDUSTRIAL_ZONES = [
    (-104, 31, -96, 36, "Permian Basin gas flares"),
    (-97, 49, -93, 53, "Alberta oil sands"),
    (50, 20, 60, 28, "Gulf/Arabian Peninsula"),
    (55, 55, 75, 72, "Siberian gas fields"),
    (5, 4, 9, 8, "Niger Delta"),
    (29, 53, 37, 58, "Russian Volga-Ural"),
    (-66, 7, -60, 12, "Venezuelan Orinoco"),
    (102, 36, 118, 43, "North China industrial"),
]

def in_industrial_zone(lat, lon):
    for min_lon, min_lat, max_lon, max_lat, _ in INDUSTRIAL_ZONES:
        if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
            return True
    return False

def classify_hotspot(lat, lon, frp, brightness, confidence, daynight):
    """
    Returns (fire_class, class_reason) where fire_class is one of:
    'verified' | 'probable' | 'possible' | 'industrial'
    """
    # Rule 1: Night-time + moderate FRP + high steady brightness in industrial zone
    if daynight == 'N' and in_industrial_zone(lat, lon) and brightness > 370 and frp < 80:
        return 'industrial', 'Night-time detection in known industrial/gas flare region'

    # Rule 2: Very high brightness, steady, night = likely industrial furnace / smelter
    if daynight == 'N' and brightness > 420 and frp < 50:
        return 'industrial', 'Persistent high-brightness night-time source (possible gas flare or furnace)'

    # Rule 3: Low confidence from FIRMS sensor
    if confidence < 50:
        return 'possible', f'Low FIRMS sensor confidence ({confidence}%)'

    # Rule 4: Verified — high confidence + strong FRP + high brightness
    if confidence >= 80 and frp >= 50 and brightness >= 330:
        return 'verified', f'High confidence VIIRS ({confidence}%), {frp:.0f} MW FRP, {brightness:.0f} K'

    # Rule 5: Probable — nominal confidence + meaningful FRP
    if confidence >= 60 and frp >= 15:
        return 'probable', f'Nominal confidence ({confidence}%), {frp:.0f} MW FRP'

    # Default
    return 'possible', f'Insufficient data for high-confidence classification ({confidence}%, {frp:.1f} MW)'

ALERT_ZONES = [
    {
        "zone_id": "zone-1",
        "name": "Sierra Nevada Foothills Zone",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [-120.8, 38.5],
                [-120.2, 38.5],
                [-120.2, 39.2],
                [-120.8, 39.2],
                [-120.8, 38.5]
            ]]
        },
        "email": "emergency-watch@example.com",
        "active": True,
        "created_at": "2026-08-26T00:00:00Z"
    }
]

def load_global_nasa_firms():
    """Fetch live NASA FIRMS Global 24h active fire feed (~100k+ global hotspots)."""
    global HOTSPOT_LATS, HOTSPOT_LONS, HOTSPOT_FRPS, HOTSPOT_BRIGHTS, HOTSPOT_CONFS, HOTSPOT_DATES, HOTSPOT_SATS, HOTSPOT_DAYNIGHTS, LAST_FIRMS_FETCH
    url = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-nrt/csv/J1_VIIRS_C2_Global_24h.csv"
    while True:
        try:
            print("[NASA FIRMS Global] Downloading 24h satellite active fire feed (Worldwide)...", flush=True)
            resp = requests.get(url, timeout=30, headers={"User-Agent": "WildfirePlatform/1.0"})
            if resp.status_code == 200:
                reader = list(csv.DictReader(StringIO(resp.text)))
                
                lats, lons, frps, brights, confs = [], [], [], [], []
                dates, sats, daynights = [], [], []
                
                for row in reader:
                    try:
                        lat = float(row['latitude'])
                        lon = float(row['longitude'])
                        frp = float(row.get('frp', 10.0))
                        bright = float(row.get('bright_ti4', 320.0))
                        conf_raw = str(row.get('confidence', 'n')).lower()
                        conf = 90 if conf_raw.startswith('h') else (60 if conf_raw.startswith('n') else 35)
                        acq_date = row.get('acq_date', '2026-08-26')
                        acq_time = str(row.get('acq_time', '0000')).zfill(4)
                        
                        lats.append(lat)
                        lons.append(lon)
                        frps.append(frp)
                        brights.append(bright)
                        confs.append(conf)
                        dates.append(f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00Z")
                        sats.append("VIIRS NOAA-20")
                        daynights.append(row.get('daynight', 'D'))
                    except Exception:
                        continue
                        
                if lats:
                    HOTSPOT_LATS = np.array(lats, dtype=np.float32)
                    HOTSPOT_LONS = np.array(lons, dtype=np.float32)
                    HOTSPOT_FRPS = np.array(frps, dtype=np.float32)
                    HOTSPOT_BRIGHTS = np.array(brights, dtype=np.float32)
                    HOTSPOT_CONFS = np.array(confs, dtype=np.int16)
                    HOTSPOT_DATES = dates
                    HOTSPOT_SATS = sats
                    HOTSPOT_DAYNIGHTS = daynights
                    LAST_FIRMS_FETCH = time.time()
                    print(f"[NASA FIRMS Global] Loaded {len(HOTSPOT_LATS)} active fire hotspots worldwide!", flush=True)
                    return
            else:
                print(f"[NASA FIRMS Global] Status code: {resp.status_code}", flush=True)
        except Exception as e:
            print(f"[NASA FIRMS Global] Download error: {e}", flush=True)
        time.sleep(10)

# Start background fetch
threading.Thread(target=load_global_nasa_firms, daemon=True).start()

class WildfireDevHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == '/hotspots':
            raw_min_lon = float(query.get('min_lon', [-180])[0])
            raw_min_lat = float(query.get('min_lat', [-90])[0])
            raw_max_lon = float(query.get('max_lon', [180])[0])
            raw_max_lat = float(query.get('max_lat', [90])[0])

            # Add small buffer so boundary hotspots never flicker or clip
            buf = 0.1
            min_lon = max(-180.0, min(raw_min_lon, raw_max_lon) - buf)
            max_lon = min(180.0, max(raw_min_lon, raw_max_lon) + buf)
            min_lat = max(-89.0, min(raw_min_lat, raw_max_lat) - buf)
            max_lat = min(89.0, max(raw_min_lat, raw_max_lat) + buf)
            
            print(f"[Hotspots Query] min_lon={min_lon:.2f}, min_lat={min_lat:.2f}, max_lon={max_lon:.2f}, max_lat={max_lat:.2f} | Total loaded: {len(HOTSPOT_LATS)}", flush=True)
            if len(HOTSPOT_LATS) > 0:
                # Fast numpy vectorized spatial bounding box filtering
                in_bbox = (
                    (HOTSPOT_LONS >= min_lon) & (HOTSPOT_LONS <= max_lon) &
                    (HOTSPOT_LATS >= min_lat) & (HOTSPOT_LATS <= max_lat)
                )
                indices = np.where(in_bbox)[0]
                
                # Unbiased stride sampling when too many hotspots (prevents cluster jump)
                max_return = 5000
                if len(indices) > max_return:
                    stride = max(1, len(indices) // max_return)
                    indices = indices[::stride][:max_return]
                    
                features = []
                for idx in indices:
                    lat = round(float(HOTSPOT_LATS[idx]), 4)
                    lon = round(float(HOTSPOT_LONS[idx]), 4)
                    frp = round(float(HOTSPOT_FRPS[idx]), 1)
                    bright = round(float(HOTSPOT_BRIGHTS[idx]), 1)
                    conf = int(HOTSPOT_CONFS[idx])
                    daynight = HOTSPOT_DAYNIGHTS[idx]
                    fire_class, class_reason = classify_hotspot(lat, lon, frp, bright, conf, daynight)
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [lon, lat]
                        },
                        "properties": {
                            "hotspot_id": f"firms-{idx+1}",
                            "latitude": lat,
                            "longitude": lon,
                            "brightness": bright,
                            "frp": frp,
                            "confidence": conf,
                            "satellite": HOTSPOT_SATS[idx],
                            "instrument": "VIIRS",
                            "acq_datetime": HOTSPOT_DATES[idx],
                            "daynight": daynight,
                            "region_key": f"{round(lat, 1)}#{round(lon, 1)}",
                            "fire_class": fire_class,
                            "class_reason": class_reason,
                        }
                    })
                data = {"type": "FeatureCollection", "features": features}
            else:
                data = {"type": "FeatureCollection", "features": []}
                
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))

        elif path == '/weather':
            try:
                lat = float(query.get('lat', [39.812])[0])
                lon = float(query.get('lon', [-121.456])[0])
                weather_info = fetch_live_weather(lat, lon)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(weather_info).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            
        elif path == '/alert-zones':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(ALERT_ZONES).encode('utf-8'))
            
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len > 0 else b'{}'
        req_json = json.loads(body.decode('utf-8'))

        if path in ['/simulate', '/simulate-spread']:
            try:
                # 1. Parse origin points (supports single Point, MultiPoint, or origins array)
                origins = req_json.get('origins')
                origin_obj = req_json.get('origin', {})
                points: list[tuple[float, float]] = []

                if isinstance(origins, list) and len(origins) > 0:
                    for p in origins:
                        if isinstance(p, (list, tuple)) and len(p) >= 2:
                            points.append((float(p[0]), float(p[1])))
                elif origin_obj:
                    geom_type = origin_obj.get('type')
                    coords = origin_obj.get('coordinates', [])
                    if geom_type == 'MultiPoint' and isinstance(coords, list):
                        for p in coords:
                            if isinstance(p, (list, tuple)) and len(p) >= 2:
                                points.append((float(p[0]), float(p[1])))
                    elif isinstance(coords, (list, tuple)) and len(coords) >= 2:
                        if isinstance(coords[0], (list, tuple)):
                            for p in coords:
                                points.append((float(p[0]), float(p[1])))
                        else:
                            points.append((float(coords[0]), float(coords[1])))

                if not points:
                    points = [(-121.456, 39.812)]

                center_lon = float(np.mean([p[0] for p in points]))
                center_lat = float(np.mean([p[1] for p in points]))

                # 2. Fetch 24-hour real consecutive hourly meteorological forecast (Open-Meteo)
                hourly_weather = fetch_hourly_forecast(center_lat, center_lon, hours=24)
                live_weather = hourly_weather[0] if hourly_weather else fetch_live_weather(center_lat, center_lon)

                user_wind_speed = req_json.get('wind_speed_ms')
                user_wind_dir = req_json.get('wind_direction_deg')
                fuel_type = req_json.get('fuel_type', 'SHRUB_CHAPARRAL')
                fuel = FUEL_MODELS.get(fuel_type, FUEL_MODELS['SHRUB_CHAPARRAL'])
                hours = float(req_json.get('hours', 24))

                engine = FireSpreadEngine(center_lat=center_lat, center_lon=center_lon)

                # Fetch DEM slope & aspect once for the domain
                slope_deg = req_json.get('slope_deg')
                if slope_deg is not None:
                    slope_tan = math.tan(math.radians(float(slope_deg)))
                    slope_tan_grid = np.full((engine.NY, engine.NX), slope_tan, dtype=np.float32)
                    ref_dir = float(user_wind_dir if user_wind_dir is not None else live_weather['wind_direction_deg'])
                    aspect_grid = np.full((engine.NY, engine.NX), math.radians(90.0 - ref_dir), dtype=np.float32)
                else:
                    dem = fetch_dem_grid(center_lat, center_lon, engine.NY, engine.NX, engine.CELL_SIZE_M)
                    slope_tan_grid, aspect_grid = compute_slope_aspect(dem, engine.CELL_SIZE_M)

                phi_s_grid = slope_phi(slope_tan_grid, fuel['beta'])

                # 3. Compute 24 Hourly Directional ROS grids with Alexander physics
                ros_8dir_hourly = np.zeros((24, 8, engine.NY, engine.NX), dtype=np.float32)
                for h_idx, hw in enumerate(hourly_weather[:24]):
                    if user_wind_speed is not None and not req_json.get('use_live_weather', True):
                        w_speed = float(user_wind_speed)
                    else:
                        w_speed = hw['wind_speed_ms']

                    if user_wind_dir is not None and not req_json.get('use_live_weather', True):
                        w_dir = float(user_wind_dir)
                    else:
                        w_dir = hw['wind_direction_deg']

                    f_moisture = hw.get('fuel_moisture_fraction', 0.08)
                    R0_h = get_base_ros(fuel_type, f_moisture)
                    phi_w_h = wind_phi(w_speed, fuel['beta'])

                    travel_bearing_deg = (w_dir + 180.0) % 360.0
                    wind_travel_cartesian_rad = math.radians(90.0 - travel_bearing_deg)

                    phi_eff_h, theta_eff_h = compute_effective_vector(
                        phi_w_h, wind_travel_cartesian_rad, phi_s_grid, aspect_grid
                    )
                    ros_8dir_hourly[h_idx] = compute_ros_8dir(R0_h, phi_eff_h, theta_eff_h, fuel['beta'])

                # 4. Map all ignition points to grid cells
                ignition_cells = []
                for pt in points:
                    r, c = engine.lonlat_to_rc(pt[0], pt[1])
                    if 0 <= r < engine.NY and 0 <= c < engine.NX:
                        ignition_cells.append((r, c))
                if not ignition_cells:
                    ignition_cells = [(engine.NY // 2, engine.NX // 2)]

                print(f"[Simulate] {len(points)} origin points -> {len(ignition_cells)} grid cells, center=({center_lat:.4f}, {center_lon:.4f}), fuel={fuel_type}", flush=True)

                # 5. Continuous Dijkstra arrival-time multi-point solver
                start_time = time.time()
                arrival_time = engine.run_simulation(ros_8dir_hourly, ignition_cells, max_hours=max(hours, 24.0))

                hourly_timeframes = [float(h) for h in range(1, 25)]
                cell_ha = (engine.CELL_SIZE_M ** 2) / 10000.0
                timeframe_areas = {
                    h: float(np.sum(arrival_time <= h * 60.0) * cell_ha)
                    for h in hourly_timeframes
                }

                perimeters = engine.extract_perimeters(arrival_time, hourly_timeframes, timeframe_areas)
                duration_ms = int((time.time() - start_time) * 1000)

                metadata = {
                    "max_ros_m_min": round(float(np.max(ros_8dir_hourly)), 2),
                    "wind_speed_ms": live_weather['wind_speed_ms'],
                    "wind_speed_kmh": round(live_weather['wind_speed_ms'] * 3.6, 1),
                    "wind_direction_deg": live_weather['wind_direction_deg'],
                    "temperature_c": live_weather.get("temperature_c"),
                    "relative_humidity": live_weather.get("relative_humidity"),
                    "weather_source": "Open-Meteo Hourly Forecast (24h Real Meteorological Series)",
                    "fuel_type": fuel_type,
                    "origin": {
                        "type": "MultiPoint" if len(points) > 1 else "Point",
                        "coordinates": points if len(points) > 1 else points[0]
                    },
                    "ignition_points_count": len(points),
                    "hourly_weather": hourly_weather,
                    "burned_area_ha_6h": round(timeframe_areas[6.0], 2),
                    "burned_area_ha_12h": round(timeframe_areas[12.0], 2),
                    "burned_area_ha_24h": round(timeframe_areas[24.0], 2),
                    "sim_duration_ms": duration_ms
                }

                result = {
                    "sim_id": str(uuid.uuid4())[:12],
                    "perimeters": {
                        "type": "FeatureCollection",
                        "features": perimeters.get("features", [])
                    },
                    "metadata": metadata,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))

            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif path == '/alert-zones':
            new_zone = {
                "zone_id": f"zone-{str(uuid.uuid4())[:8]}",
                "name": req_json.get('name', 'New Zone'),
                "geometry": req_json.get('geometry', {}),
                "email": req_json.get('email', ''),
                "active": True,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            ALERT_ZONES.append(new_zone)
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(new_zone).encode('utf-8'))

        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith('/alert-zones/'):
            zone_id = path.split('/')[-1]
            global ALERT_ZONES
            ALERT_ZONES = [z for z in ALERT_ZONES if z.get('zone_id') != zone_id]
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"status": "deleted"}')
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')

def run(port=8000):
    server_address = ('127.0.0.1', port)
    httpd = HTTPServer(server_address, WildfireDevHandler)
    print(f"[Wildfire Dev Server] running Worldwide NASA FIRMS + Open-Meteo at http://127.0.0.1:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()

if __name__ == '__main__':
    run()
