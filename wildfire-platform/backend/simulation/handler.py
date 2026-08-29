import json
import time
import hashlib
import math
import logging
import numpy as np
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

try:
    from shared.python.models import SimulationRequest, SimulationResult
    from shared.python.dynamo import get_simulation_cache, put_simulation_cache, decimal_to_float
except ImportError:
    try:
        from python.models import SimulationRequest, SimulationResult
        from python.dynamo import get_simulation_cache, put_simulation_cache, decimal_to_float
    except ImportError:
        from models import SimulationRequest, SimulationResult
        from dynamo import get_simulation_cache, put_simulation_cache, decimal_to_float
from rothermel import FUEL_MODELS, get_base_ros, wind_phi, slope_phi, compute_effective_vector, compute_ros_8dir
from elevation import fetch_dem_grid, compute_slope_aspect, get_flat_dem
from weather import fetch_live_weather
from fire_engine import FireSpreadEngine


def handler(event: dict, context) -> dict:
    """Lambda Function URL handler for POST /simulate-spread."""
    method = event.get("requestContext", {}).get("http", {}).get("method", "POST")

    headers = {
        "Content-Type": "application/json",
    }

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}

    try:
        body_str = event.get("body", "{}")
        if event.get("isBase64Encoded", False):
            import base64
            body_str = base64.b64decode(body_str).decode("utf-8")

        req_dict = json.loads(body_str)
        request = SimulationRequest(**req_dict)

        origin_lon: float = request.origin["coordinates"][0]
        origin_lat: float = request.origin["coordinates"][1]

        # Auto-fetch live atmospheric weather if not explicitly supplied
        live_weather = fetch_live_weather(origin_lat, origin_lon)
        
        wind_speed_ms = request.wind_speed_ms
        if wind_speed_ms is None or wind_speed_ms <= 0.0:
            wind_speed_ms = live_weather["wind_speed_ms"]
            
        wind_dir_deg = request.wind_direction_deg
        if wind_dir_deg is None:
            wind_dir_deg = live_weather["wind_direction_deg"]

        fuel_moisture = live_weather.get("fuel_moisture_fraction", 0.08)

        # Cache lookup — hash RESOLVED parameters (after live weather substitution)
        cache_params = {
            'origin': request.origin,
            'wind_speed_ms': wind_speed_ms,
            'wind_direction_deg': wind_dir_deg,
            'fuel_type': request.fuel_type,
            'hours': request.hours,
            'slope_deg': request.slope_deg,
            'fuel_moisture': fuel_moisture,
        }
        req_json_str = json.dumps(cache_params, sort_keys=True, default=str)
        sim_id = hashlib.sha256(req_json_str.encode()).hexdigest()[:16]

        cached = None
        try:
            cached = get_simulation_cache(sim_id)
        except Exception as e:
            logger.warning(f"Failed to read simulation cache: {e}")

        if cached:
            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps(decimal_to_float(cached)),
            }

        start_time = time.time()

        fuel = FUEL_MODELS.get(request.fuel_type)
        if not fuel:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps({"error": f"Unknown fuel_type: {request.fuel_type}. Valid types: {list(FUEL_MODELS.keys())}"}),
            }
        R0 = get_base_ros(request.fuel_type, moisture_frac=fuel_moisture)
        phi_w_scalar = wind_phi(wind_speed_ms, fuel["beta"])

        engine = FireSpreadEngine(center_lat=origin_lat, center_lon=origin_lon)

        # Wind travel direction (downwind)
        travel_bearing_deg = (wind_dir_deg + 180.0) % 360.0
        wind_travel_cartesian_rad = math.radians(90.0 - travel_bearing_deg)

        # 3D Elevation / Slope
        if request.slope_deg is not None:
            slope_tan = math.tan(math.radians(float(request.slope_deg)))
            slope_tan_grid = np.full((engine.NY, engine.NX), slope_tan, dtype=np.float32)
            aspect_grid = np.full((engine.NY, engine.NX), math.radians(90.0 - travel_bearing_deg), dtype=np.float32)
        else:
            dem = fetch_dem_grid(origin_lat, origin_lon, engine.NY, engine.NX, engine.CELL_SIZE_M)
            slope_tan_grid, aspect_grid = compute_slope_aspect(dem, engine.CELL_SIZE_M)

        phi_s_grid = slope_phi(slope_tan_grid, fuel["beta"])

        phi_eff_grid, theta_eff_grid = compute_effective_vector(
            phi_w_scalar, wind_travel_cartesian_rad, phi_s_grid, aspect_grid
        )

        ros_8dir = compute_ros_8dir(R0, phi_eff_grid, theta_eff_grid, fuel["beta"])

        ignition_row, ignition_col = engine.get_ignition_cell(origin_lat, origin_lon)
        arrival_time = engine.run_simulation(
            ros_8dir, ignition_row, ignition_col, max_hours=max(float(request.hours), 24.0)
        )

        # Metric calculation
        cell_area_ha = (engine.CELL_SIZE_M ** 2) / 10_000.0
        timeframe_areas: dict[float, float] = {
            h: float(np.sum(arrival_time <= h * 60.0) * cell_area_ha)
            for h in [6.0, 12.0, 24.0]
        }

        perimeters = engine.extract_perimeters(
            arrival_time, [6.0, 12.0, 24.0], timeframe_areas
        )

        duration_ms = int((time.time() - start_time) * 1000)

        metadata = {
            "max_ros_m_min": round(float(np.max(ros_8dir)), 2),
            "wind_speed_ms": wind_speed_ms,
            "wind_speed_kmh": round(wind_speed_ms * 3.6, 1),
            "wind_direction_deg": wind_dir_deg,
            "temperature_c": live_weather.get("temperature_c"),
            "relative_humidity": live_weather.get("relative_humidity"),
            "weather_source": live_weather.get("source"),
            "fuel_type": request.fuel_type,
            "origin": request.origin,
            "burned_area_ha_6h": round(timeframe_areas[6.0], 2),
            "burned_area_ha_12h": round(timeframe_areas[12.0], 2),
            "burned_area_ha_24h": round(timeframe_areas[24.0], 2),
            "sim_duration_ms": duration_ms,
        }

        now_ts = int(time.time())
        result = SimulationResult(
            sim_id=sim_id,
            perimeters=perimeters,
            metadata=metadata,
            created_at=datetime.now(timezone.utc).isoformat(),
            expires_at=now_ts + 3600,
        )

        result_dict = result.model_dump()
        try:
            put_simulation_cache(sim_id, result_dict, ttl_seconds=3600)
        except Exception as e:
            logger.warning(f"Failed to write simulation cache: {e}")

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps(result_dict),
        }

    except Exception as exc:
        import traceback
        traceback.print_exc()
        return {
            "statusCode": 400,
            "headers": headers,
            "body": json.dumps({"error": str(exc)}),
        }
