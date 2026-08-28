import math
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import numpy as np
from rothermel import (
    moisture_damping, get_base_ros, wind_phi, slope_phi,
    compute_ros_8dir, FUEL_MODELS
)


def test_moisture_damping_at_zero():
    assert moisture_damping(0.0, 0.12) == 1.0


def test_moisture_damping_at_extinction():
    assert moisture_damping(0.12, 0.12) <= 0.01


def test_wind_phi_zero():
    assert wind_phi(0.0, 0.0015) == 0.0


def test_wind_phi_positive():
    assert wind_phi(5.0, 0.0015) > 0.0


def test_slope_phi_flat():
    val = slope_phi(0.0, 0.0015)
    assert float(val) == 0.0


def test_slope_phi_steep():
    val = slope_phi(math.tan(math.radians(30)), 0.0015)
    assert float(val) > 0.0


def test_get_base_ros_all_fuels():
    for f in FUEL_MODELS:
        assert get_base_ros(f, 0.08) > 0.0


def test_ros_8dir_shape():
    phi_eff = np.zeros((10, 10))
    theta_eff = np.zeros((10, 10))
    ros = compute_ros_8dir(1.0, phi_eff, theta_eff, 0.0015)
    assert ros.shape == (8, 10, 10)


def test_ros_head_is_max():
    phi_eff = np.full((1, 1), 10.0)
    theta_eff = np.full((1, 1), 0.0)  # wind blowing East
    ros = compute_ros_8dir(1.0, phi_eff, theta_eff, 0.0015)
    east_idx = 3  # NEIGHBOR_ANGLES[3] = 0 (East)
    assert ros[east_idx, 0, 0] == np.max(ros[:, 0, 0])
