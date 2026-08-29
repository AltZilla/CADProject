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
from weather import fetch_live_weather
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
            min_lon = float(query.get('min_lon', [-180])[0])
            min_lat = float(query.get('min_lat', [-90])[0])
            max_lon = float(query.get('max_lon', [180])[0])
            max_lat = float(query.get('max_lat', [90])[0])
            
            print(f"[Hotspots Query] min_lon={min_lon}, min_lat={min_lat}, max_lon={max_lon}, max_lat={max_lat} | Total loaded in memory: {len(HOTSPOT_LATS)}", flush=True)
            if len(HOTSPOT_LATS) > 0:
                # Fast numpy vectorized spatial bounding box filtering
                in_bbox = (
                    (HOTSPOT_LONS >= min_lon) & (HOTSPOT_LONS <= max_lon) &
                    (HOTSPOT_LATS >= min_lat) & (HOTSPOT_LATS <= max_lat)
                )
                indices = np.where(in_bbox)[0]
                
                # Limit density when zoomed out for smooth rendering
                max_return = 1000
                if len(indices) > max_return:
                    # Select the highest FRP hotspots in current view
                    sub_frps = HOTSPOT_FRPS[indices]
                    top_k = np.argsort(sub_frps)[-max_return:]
                    indices = indices[top_k]
                    
                features = []
                for idx in indices:
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [round(float(HOTSPOT_LONS[idx]), 4), round(float(HOTSPOT_LATS[idx]), 4)]
                        },
                        "properties": {
                            "hotspot_id": f"firms-{idx+1}",
                            "latitude": round(float(HOTSPOT_LATS[idx]), 4),
                            "longitude": round(float(HOTSPOT_LONS[idx]), 4),
                            "brightness": round(float(HOTSPOT_BRIGHTS[idx]), 1),
                            "frp": round(float(HOTSPOT_FRPS[idx]), 1),
                            "confidence": int(HOTSPOT_CONFS[idx]),
                            "satellite": HOTSPOT_SATS[idx],
                            "instrument": "VIIRS",
                            "acq_datetime": HOTSPOT_DATES[idx],
                            "daynight": HOTSPOT_DAYNIGHTS[idx],
                            "region_key": f"{round(float(HOTSPOT_LATS[idx]), 1)}#{round(float(HOTSPOT_LONS[idx]), 1)}"
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
                origin = req_json.get('origin', {})
                coords = origin.get('coordinates', [-121.456, 39.812])
                origin_lon, origin_lat = float(coords[0]), float(coords[1])
                
                # --- AUTO-FETCH LIVE ATMOSPHERIC WEATHER (Open-Meteo) ---
                live_weather = fetch_live_weather(origin_lat, origin_lon)
                
                wind_speed_ms = req_json.get('wind_speed_ms')
                if wind_speed_ms is None or req_json.get('use_live_weather', True):
                    wind_speed_ms = live_weather['wind_speed_ms']
                else:
                    wind_speed_ms = float(wind_speed_ms)

                wind_dir_deg = req_json.get('wind_direction_deg')
                if wind_dir_deg is None or req_json.get('use_live_weather', True):
                    wind_dir_deg = live_weather['wind_direction_deg']
                else:
                    wind_dir_deg = float(wind_dir_deg)

                fuel_moisture = live_weather.get('fuel_moisture_fraction', 0.08)
                fuel_type = req_json.get('fuel_type', 'SHRUB_CHAPARRAL')
                hours = float(req_json.get('hours', 24))

                fuel = FUEL_MODELS.get(fuel_type, FUEL_MODELS['SHRUB_CHAPARRAL'])
                R0 = get_base_ros(fuel_type, fuel_moisture)
                phi_w = wind_phi(wind_speed_ms, fuel['beta'])

                engine = FireSpreadEngine(center_lat=origin_lat, center_lon=origin_lon)

                # --- AUTO-FETCH LIVE TERRAIN ELEVATION (Open-Elevation DEM) ---
                slope_deg = req_json.get('slope_deg')
                if slope_deg is not None:
                    slope_tan = math.tan(math.radians(float(slope_deg)))
                    slope_tan_grid = np.full((engine.NY, engine.NX), slope_tan, dtype=np.float32)
                    aspect_grid = np.full((engine.NY, engine.NX), math.radians(90.0 - wind_dir_deg), dtype=np.float32)
                else:
                    dem = fetch_dem_grid(origin_lat, origin_lon, engine.NY, engine.NX, engine.CELL_SIZE_M)
                    slope_tan_grid, aspect_grid = compute_slope_aspect(dem, engine.CELL_SIZE_M)

                phi_s_grid = slope_phi(slope_tan_grid, fuel['beta'])
                
                # --- TRUE DOWNWIND DIRECTION (Meteorological to Cartesian) ---
                travel_bearing_deg = (wind_dir_deg + 180.0) % 360.0
                wind_travel_cartesian_rad = math.radians(90.0 - travel_bearing_deg)
                
                phi_eff_grid, theta_eff_grid = compute_effective_vector(
                    phi_w, wind_travel_cartesian_rad, phi_s_grid, aspect_grid
                )
                
                # Compute directional ROS with Alexander elliptical fire spread physics
                ros_8dir = compute_ros_8dir(R0, phi_eff_grid, theta_eff_grid, fuel['beta'])

                start_time = time.time()
                r, c = engine.get_ignition_cell(origin_lat, origin_lon)
                arrival_time = engine.run_simulation(ros_8dir, r, c, max_hours=max(hours, 24.0))
                
                hourly_timeframes = [float(h) for h in range(1, 25)]
                cell_ha = (engine.CELL_SIZE_M ** 2) / 10000.0
                timeframe_areas = {
                    h: float(np.sum(arrival_time <= h * 60.0) * cell_ha)
                    for h in hourly_timeframes
                }
                
                perimeters = engine.extract_perimeters(arrival_time, hourly_timeframes, timeframe_areas)
                duration_ms = int((time.time() - start_time) * 1000)

                metadata = {
                    "max_ros_m_min": round(float(np.max(ros_8dir)), 2),
                    "wind_speed_ms": wind_speed_ms,
                    "wind_speed_kmh": round(wind_speed_ms * 3.6, 1),
                    "wind_direction_deg": wind_dir_deg,
                    "temperature_c": live_weather.get("temperature_c"),
                    "relative_humidity": live_weather.get("relative_humidity"),
                    "weather_source": live_weather.get("source"),
                    "fuel_type": fuel_type,
                    "origin": origin,
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
