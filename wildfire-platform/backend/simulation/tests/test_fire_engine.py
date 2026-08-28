import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

# Build a real geo_utils stub before importing fire_engine
import types
geo_stub = types.ModuleType('shared.python.geo_utils')
geo_stub.make_geojson_feature = lambda geom, props: {'type': 'Feature', 'geometry': geom, 'properties': props}
geo_stub.make_feature_collection = lambda features: {'type': 'FeatureCollection', 'features': features}

shared_stub = types.ModuleType('shared')
shared_python_stub = types.ModuleType('shared.python')
shared_stub.python = shared_python_stub
sys.modules['shared'] = shared_stub
sys.modules['shared.python'] = shared_python_stub
sys.modules['shared.python.geo_utils'] = geo_stub

import numpy as np
from fire_engine import FireSpreadEngine


def test_ignition_cell_center():
    engine = FireSpreadEngine(35.0, -120.0)
    r, c = engine.get_ignition_cell(35.0, -120.0)
    assert r == engine.NY // 2
    assert c == engine.NX // 2


def test_simulation_returns_finite_center():
    '''
    With ROS=1 m/min, fire cannot reach grid edges in 24h (15km grid,
    max reachable radius ~1*1440 min = 1440m = 28.8 cells).
    Assert that the center 50x50 region is fully reached.
    '''
    engine = FireSpreadEngine(35.0, -120.0)
    ros_8dir = np.ones((8, engine.NY, engine.NX), dtype=np.float32)
    r, c = engine.NY // 2, engine.NX // 2
    arr = engine.run_simulation(ros_8dir, r, c, max_hours=24.0)
    # Center 28x28 cells should all have finite arrival times (radius ~14 cells)
    half = 14
    center = arr[r-half:r+half, c-half:c+half]
    assert np.all(np.isfinite(center)), "Center region should be reachable within 24h"
    # Ignition cell must be 0
    assert arr[r, c] == 0.0


def test_perimeter_area_increases():
    engine = FireSpreadEngine(35.0, -120.0)
    ros_8dir = np.ones((8, engine.NY, engine.NX), dtype=np.float32)
    r, c = engine.NY // 2, engine.NX // 2
    arr = engine.run_simulation(ros_8dir, r, c, max_hours=24.0)
    area_6h = int(np.sum(arr <= 6 * 60))
    area_12h = int(np.sum(arr <= 12 * 60))
    assert area_12h > area_6h
    assert area_6h > 0


def test_geojson_valid():
    engine = FireSpreadEngine(35.0, -120.0)
    ros_8dir = np.ones((8, engine.NY, engine.NX), dtype=np.float32)
    r, c = engine.NY // 2, engine.NX // 2
    arr = engine.run_simulation(ros_8dir, r, c, max_hours=24.0)
    fc = engine.extract_perimeters(arr, [6.0, 12.0, 24.0])
    assert fc['type'] == 'FeatureCollection'
    assert len(fc['features']) == 3
    for feat in fc['features']:
        assert 'timeframe_hours' in feat['properties']
        assert 'burned_area_ha' in feat['properties']
        assert feat['properties']['burned_area_ha'] > 0


def test_fast_fuel_spreads_far():
    engine = FireSpreadEngine(35.0, -120.0)
    ros_fast = np.full((8, engine.NY, engine.NX), 5.0, dtype=np.float32)
    ros_slow = np.full((8, engine.NY, engine.NX), 0.5, dtype=np.float32)
    r, c = engine.NY // 2, engine.NX // 2
    arr_fast = engine.run_simulation(ros_fast, r, c, max_hours=6.0)
    arr_slow = engine.run_simulation(ros_slow, r, c, max_hours=6.0)
    area_fast = int(np.sum(arr_fast <= 6 * 60))
    area_slow = int(np.sum(arr_slow <= 6 * 60))
    assert area_fast > area_slow
