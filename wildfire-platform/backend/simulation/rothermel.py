import math
import numpy as np

FUEL_MODELS = {
    'GRASS_SHORT':     {'R0': 2.5,  'beta': 0.0015, 'Mx': 0.12, 'description': 'Short grass (<30cm)'},
    'GRASS_TALL':      {'R0': 3.5,  'beta': 0.0010, 'Mx': 0.25, 'description': 'Tall grass (>60cm)'},
    'SHRUB_LOW':       {'R0': 0.8,  'beta': 0.0060, 'Mx': 0.20, 'description': 'Low shrub (<60cm)'},
    'SHRUB_CHAPARRAL': {'R0': 2.2,  'beta': 0.0080, 'Mx': 0.20, 'description': 'Chaparral/high shrub'},
    'TIMBER_LITTER':   {'R0': 0.12, 'beta': 0.0150, 'Mx': 0.30, 'description': 'Closed timber litter'},
    'SLASH_HEAVY':     {'R0': 1.0,  'beta': 0.0090, 'Mx': 0.25, 'description': 'Heavy logging slash'},
}

# 8 Neighbor offsets: (-1,0)=N, (1,0)=S, (0,-1)=W, (0,1)=E, (-1,-1)=NW, (-1,1)=NE, (1,-1)=SW, (1,1)=SE
# Cartesian angles: +x is East (0 rad), +y is North (pi/2 rad)
NEIGHBOR_OFFSETS = [(-1,0), (1,0), (0,-1), (0,1), (-1,-1), (-1,1), (1,-1), (1,1)]
NEIGHBOR_ANGLES = [np.pi/2, -np.pi/2, np.pi, 0, 3*np.pi/4, np.pi/4, -3*np.pi/4, -np.pi/4]
NEIGHBOR_DISTS_CELLS = [1.0, 1.0, 1.0, 1.0, np.sqrt(2), np.sqrt(2), np.sqrt(2), np.sqrt(2)]

def moisture_damping(moisture_frac: float, Mx: float) -> float:
    """Rothermel moisture damping coefficient (eta_M)."""
    ratio = min(1.0, max(0.0, moisture_frac / Mx))
    val = 1.0 - 2.59 * ratio + 5.11 * (ratio ** 2) - 3.52 * (ratio ** 3)
    return max(0.01, float(val))

def get_base_ros(fuel_type: str, moisture_frac: float = 0.08) -> float:
    """Base zero-wind zero-slope rate of spread in m/min."""
    fuel = FUEL_MODELS.get(fuel_type, FUEL_MODELS['SHRUB_CHAPARRAL'])
    return fuel['R0'] * moisture_damping(moisture_frac, fuel['Mx'])

def wind_phi(wind_speed_ms: float, beta: float) -> float:
    """Rothermel dimensionless wind factor (phi_w).
    
    Note: This is a simplified formulation. The full Rothermel model uses
    phi_w = C * U^B * (beta/beta_op)^(-E) where C, B, E depend on fuel
    properties. This approximation uses fixed coefficients suitable for
    moderate fuel beds.
    """
    return 0.25 * (max(0.0, wind_speed_ms) ** 1.5)

def slope_phi(slope_tan: float | np.ndarray, beta: float) -> float | np.ndarray:
    """Rothermel dimensionless slope factor (phi_s) in upslope direction."""
    return 5.275 * (beta ** -0.3) * (np.maximum(0.0, slope_tan) ** 2)

def compute_effective_vector(
    phi_w: float, 
    wind_travel_cartesian_rad: float, 
    phi_s_grid: np.ndarray, 
    aspect_rad_grid: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """
    Vector composition of wind direction and terrain slope.
    wind_travel_cartesian_rad is the direction the wind is blowing TOWARD in Cartesian (+x East, +y North).
    """
    w_x = phi_w * np.cos(wind_travel_cartesian_rad)
    w_y = phi_w * np.sin(wind_travel_cartesian_rad)
    
    s_x = phi_s_grid * np.cos(aspect_rad_grid)
    s_y = phi_s_grid * np.sin(aspect_rad_grid)
    
    eff_x = w_x + s_x
    eff_y = w_y + s_y
    
    phi_eff_grid = np.sqrt(eff_x**2 + eff_y**2)
    theta_eff_grid = np.arctan2(eff_y, eff_x)
    return phi_eff_grid, theta_eff_grid

def compute_ros_8dir(
    R0: float, 
    phi_eff: np.ndarray, 
    theta_eff: np.ndarray, 
    beta: float
) -> np.ndarray:
    """
    Computes directional rate of spread (m/min) in all 8 neighbor directions
    using standard Alexander / Rothermel elliptical fire spread geometry.
    Shape returned: (8, H, W).
    """
    H, W = phi_eff.shape
    ros_8dir = np.zeros((8, H, W), dtype=np.float32)
    
    # Invert phi_eff = 0.25 * U^1.5 to find effective wind speed in m/s
    u_eff_ms = (phi_eff / 0.25) ** (1.0 / 1.5)
    u_eff_kmh = u_eff_ms * 3.6
    
    # Alexander Length-to-Width Ratio (L/W >= 1.0, capped at realistic maximum 5.0)
    lw_ratio = 1.0 + 0.125 * u_eff_kmh
    lw_ratio = np.clip(lw_ratio, 1.0, 5.0)
    
    # Fire spread ellipse distortion parameter epsilon = (L/W - 1) / (L/W + 1)
    # (Fixes the needle bug where geometric eccentricity was erroneously used)
    epsilon = (lw_ratio - 1.0) / (lw_ratio + 1.0)
    
    # Maximum forward rate of spread (head fire)
    R_head = R0 * (1.0 + phi_eff)
    
    for i, psi in enumerate(NEIGHBOR_ANGLES):
        # Standard Rothermel/Alexander polar equation from ignition point:
        # R(psi) = R_head * (1 - epsilon) / (1 - epsilon * cos(psi - theta_eff))
        cos_diff = np.cos(psi - theta_eff)
        denominator = np.maximum(0.05, 1.0 - epsilon * cos_diff)
        R_dir = R_head * (1.0 - epsilon) / denominator
        
        # Polar Rothermel/Alexander spread formula:
        # At head (cos=1): R = R_head
        # At flank (cos=0): R = R_head * (1 - epsilon) = R_head * (2 / (L/W + 1)) >= 0.33 R_head
        # At back (cos=-1): R = R_head * (1 - epsilon) / (1 + epsilon) = R_head / (L/W) >= 0.20 R_head
        ros_8dir[i] = np.maximum(0.05, R_dir).astype(np.float32)
        
    return ros_8dir
