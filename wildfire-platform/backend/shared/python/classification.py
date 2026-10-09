# Common wildfire classification rules for AWS backend

INDUSTRIAL_ZONES = [
    (-104.0, 31.0, -96.0, 36.0),    # Permian Basin, Texas / NM (oil/gas flares)
    (-97.0, 49.0, -93.0, 53.0),     # Bakken Formation, ND / Canada
    (50.0, 20.0, 60.0, 28.0),       # Persian Gulf oil refineries / gas flaring
    (55.0, 55.0, 75.0, 72.0),       # West Siberian oil & gas basin, Russia
    (5.0, 4.0, 9.0, 8.0),           # Niger Delta petroleum fields, Nigeria
    (29.0, 53.0, 37.0, 58.0),       # Ahvaz / Khuzestan oil fields, Iran
    (-66.0, 7.0, -60.0, 12.0),      # Orinoco Belt, Venezuela
    (102.0, 36.0, 118.0, 43.0),     # Ordos / Inner Mongolia coal/industrial basin
]

def in_industrial_zone(lat: float, lon: float) -> bool:
    for min_lon, min_lat, max_lon, max_lat in INDUSTRIAL_ZONES:
        if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
            return True
    return False

def classify_hotspot(lat: float, lon: float, frp: float, brightness: float, confidence: float, daynight: str) -> tuple[str, str]:
    """Classify a hotspot detection based on VIIRS telemetry."""
    # 1. Industrial / Gas Flaring Check
    if daynight == 'N' and in_industrial_zone(lat, lon) and brightness > 370.0 and frp < 80.0:
        return 'industrial', 'Night-time detection in known industrial/gas flare region'
    if daynight == 'N' and brightness > 420.0 and frp < 50.0:
        return 'industrial', 'Persistent high-brightness night-time source'

    # 2. Low confidence
    if confidence < 50:
        return 'possible', f'Low FIRMS sensor confidence ({confidence:.0f}%)'

    # 3. Verified wildfire
    if confidence >= 80 and frp >= 50.0 and brightness >= 330.0:
        return 'verified', f'High confidence VIIRS ({confidence:.0f}%), {frp:.0f} MW FRP'

    # 4. Probable wildfire
    if confidence >= 60 and frp >= 15.0:
        return 'probable', f'Nominal confidence ({confidence:.0f}%), {frp:.0f} MW FRP'

    # 5. Default: Possible
    return 'possible', f'Insufficient data ({confidence:.0f}%, {frp:.1f} MW)'
