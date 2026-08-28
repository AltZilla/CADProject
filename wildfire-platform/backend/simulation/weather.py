import logging
import requests

logger = logging.getLogger(__name__)

def fetch_live_weather(lat: float, lon: float, timeout: float = 6.0) -> dict:
    """
    Fetch real-time atmospheric weather from the free Open-Meteo API.
    Zero API key required.
    
    Returns:
        dict: {
            'wind_speed_ms': float,        # m/s
            'wind_speed_kmh': float,       # km/h
            'wind_direction_deg': float,   # degrees (0-360)
            'temperature_c': float,        # Celsius
            'relative_humidity': float,    # %
            'surface_pressure_hpa': float, # hPa
            'fuel_moisture_fraction': float, # estimated dead fuel moisture (0.03 - 0.30)
            'source': 'Open-Meteo Live API'
        }
    """
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat:.4f}&longitude={lon:.4f}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure"
    
    try:
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": "WildfireEarlyWarningPlatform/1.0"})
        if resp.status_code == 200:
            data = resp.json()
            curr = data.get("current", {})
            
            wind_kmh = float(curr.get("wind_speed_10m", 10.0))
            wind_dir = float(curr.get("wind_direction_10m", 225.0))
            temp_c = float(curr.get("temperature_2m", 25.0))
            rh = float(curr.get("relative_humidity_2m", 30.0))
            press = float(curr.get("surface_pressure", 1013.25))
            
            # Rothermel fine fuel moisture estimation (Fosberg/Nelson approximation)
            # Higher RH -> higher moisture -> lower rate of spread
            moisture_frac = 0.03 + 0.25 * (rh / 100.0) - 0.0006 * max(0.0, temp_c)
            moisture_frac = max(0.03, min(0.30, float(moisture_frac)))
            
            return {
                "wind_speed_ms": round(wind_kmh / 3.6, 2),
                "wind_speed_kmh": round(wind_kmh, 1),
                "wind_direction_deg": round(wind_dir, 1),
                "temperature_c": round(temp_c, 1),
                "relative_humidity": round(rh, 1),
                "surface_pressure_hpa": round(press, 1),
                "fuel_moisture_fraction": round(moisture_frac, 3),
                "source": "Open-Meteo Live API"
            }
        else:
            logger.warning(f"Open-Meteo returned status {resp.status_code}, using standard weather defaults")
    except Exception as e:
        logger.warning(f"Failed to fetch live weather from Open-Meteo: {e}")
        
    # Safe meteorological fallbacks (standard moderate wildfire condition)
    return {
        "wind_speed_ms": 5.0,
        "wind_speed_kmh": 18.0,
        "wind_direction_deg": 225.0,
        "temperature_c": 28.0,
        "relative_humidity": 25.0,
        "surface_pressure_hpa": 1013.2,
        "fuel_moisture_fraction": 0.08,
        "source": "Default Atmospheric Fallback"
    }
