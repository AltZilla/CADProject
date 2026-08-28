import requests
import numpy as np
import logging

logger = logging.getLogger(__name__)

def bilinear_interpolate_2d(src: np.ndarray, dst_ny: int, dst_nx: int) -> np.ndarray:
    """Pure-numpy 2D bilinear interpolation (no scipy required)."""
    src_ny, src_nx = src.shape
    y_indices = np.linspace(0, src_ny - 1, dst_ny)
    x_indices = np.linspace(0, src_nx - 1, dst_nx)
    
    y0 = np.floor(y_indices).astype(int)
    y1 = np.minimum(y0 + 1, src_ny - 1)
    x0 = np.floor(x_indices).astype(int)
    x1 = np.minimum(x0 + 1, src_nx - 1)
    
    wy = (y_indices - y0)[:, np.newaxis]
    wx = (x_indices - x0)[np.newaxis, :]
    
    c00 = src[y0[:, np.newaxis], x0[np.newaxis, :]]
    c01 = src[y0[:, np.newaxis], x1[np.newaxis, :]]
    c10 = src[y1[:, np.newaxis], x0[np.newaxis, :]]
    c11 = src[y1[:, np.newaxis], x1[np.newaxis, :]]
    
    top = c00 * (1 - wx) + c01 * wx
    bottom = c10 * (1 - wx) + c11 * wx
    return (top * (1 - wy) + bottom * wy).astype(np.float32)

def fetch_dem_grid(center_lat: float, center_lon: float, ny: int, nx: int, cell_size_m: float) -> np.ndarray:
    try:
        sample_ny = 30
        sample_nx = 30
        
        deg_per_m_lat = 1 / 111132.954
        deg_per_m_lon = 1 / (111412.84 * np.cos(np.radians(center_lat)))
        
        lat_min = center_lat - (ny // 2) * cell_size_m * deg_per_m_lat
        lat_max = center_lat + (ny // 2) * cell_size_m * deg_per_m_lat
        lon_min = center_lon - (nx // 2) * cell_size_m * deg_per_m_lon
        lon_max = center_lon + (nx // 2) * cell_size_m * deg_per_m_lon
        
        lats = np.linspace(lat_max, lat_min, sample_ny)
        lons = np.linspace(lon_min, lon_max, sample_nx)
        
        locations = []
        for lat in lats:
            for lon in lons:
                locations.append({"latitude": float(lat), "longitude": float(lon)})
                
        resp = requests.post(
            "https://api.open-elevation.com/api/v1/lookup",
            json={"locations": locations},
            timeout=5
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        
        if len(results) != sample_ny * sample_nx:
            raise ValueError("Invalid number of results from Open-Elevation")
            
        elevations = np.array([r["elevation"] for r in results]).reshape((sample_ny, sample_nx))
        return bilinear_interpolate_2d(elevations, ny, nx)
        
    except Exception as e:
        logger.warning(f"Open-Elevation failed, returning flat DEM: {str(e)}")
        return np.zeros((ny, nx), dtype=np.float32)

def compute_slope_aspect(dem: np.ndarray, cell_size_m: float) -> tuple[np.ndarray, np.ndarray]:
    gy, gx = np.gradient(dem, cell_size_m, cell_size_m)
    # negate gy because row index increases downwards (South), but Cartesian Y increases upwards (North)
    gy = -gy
    slope_tan = np.sqrt(gx**2 + gy**2)
    aspect_rad = np.arctan2(gy, gx)
    return slope_tan, aspect_rad

def get_flat_dem(ny: int, nx: int) -> tuple[np.ndarray, np.ndarray]:
    return np.zeros((ny, nx), dtype=np.float32), np.zeros((ny, nx), dtype=np.float32)
