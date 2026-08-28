import heapq
import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

try:
    from shared.python.geo_utils import make_geojson_feature, make_feature_collection
except ImportError:
    from geo_utils import make_geojson_feature, make_feature_collection

def find_contours_fallback(padded: np.ndarray, level: float = 0.5) -> list[np.ndarray]:
    """Extracts 2D perimeter contour from mask without requiring scikit-image."""
    try:
        from skimage.measure import find_contours
        return find_contours(padded, level=level)
    except ImportError:
        pass

    mask = padded >= level
    if not np.any(mask):
        return []

    up = np.pad(mask[1:, :], ((0, 1), (0, 0)), constant_values=False)
    down = np.pad(mask[:-1, :], ((1, 0), (0, 0)), constant_values=False)
    left = np.pad(mask[:, 1:], ((0, 0), (0, 1)), constant_values=False)
    right = np.pad(mask[:, :-1], ((0, 0), (1, 0)), constant_values=False)

    is_boundary = mask & ~(up & down & left & right)
    r_idx, c_idx = np.where(is_boundary)

    if len(r_idx) < 3:
        return []

    cy, cx = float(r_idx.mean()), float(c_idx.mean())
    angles = np.arctan2(r_idx - cy, c_idx - cx)
    order = np.argsort(angles)

    step = max(1, len(order) // 60)
    ordered_r = r_idx[order][::step]
    ordered_c = c_idx[order][::step]

    coords = np.column_stack((ordered_r, ordered_c))
    coords = np.vstack([coords, coords[0]])
    return [coords]


class FireSpreadEngine:
    """
    Continuous arrival-time fire spread engine using Dijkstra's algorithm
    on a 8-connected grid. Domain: 300x300 cells at 50m = 15km x 15km.
    """
    NY = 300
    NX = 300
    CELL_SIZE_M = 50.0

    def __init__(self, center_lat: float, center_lon: float) -> None:
        self.center_lat = center_lat
        self.center_lon = center_lon

        # Geographic conversion factors at this latitude
        self.deg_per_m_lat = 1.0 / 111_132.954
        self.deg_per_m_lon = 1.0 / (111_412.84 * np.cos(np.radians(center_lat)))

        # 8-connected neighbor (dr, dc) offsets
        self.neighbor_offsets = [
            (-1, 0), (1, 0), (0, -1), (0, 1),   # N S W E
            (-1, -1), (-1, 1), (1, -1), (1, 1),   # NW NE SW SE
        ]
        # Real-world distances per neighbor direction (metres)
        self.neighbor_dists_m = [
            self.CELL_SIZE_M, self.CELL_SIZE_M,
            self.CELL_SIZE_M, self.CELL_SIZE_M,
            self.CELL_SIZE_M * np.sqrt(2), self.CELL_SIZE_M * np.sqrt(2),
            self.CELL_SIZE_M * np.sqrt(2), self.CELL_SIZE_M * np.sqrt(2),
        ]

    def run_simulation(
        self,
        ros_8dir: np.ndarray,
        ignition_row: int,
        ignition_col: int,
        max_hours: float = 24.0,
    ) -> np.ndarray:
        """
        Dijkstra arrival-time solver.

        Parameters
        ----------
        ros_8dir : ndarray, shape (8, NY, NX), units m/min
        ignition_row, ignition_col : grid coordinates of fire origin
        max_hours : stop propagating beyond this time limit

        Returns
        -------
        arrival_time : ndarray, shape (NY, NX), units minutes
                       Cells not reached within max_hours contain np.inf.
        """
        arrival_time = np.full((self.NY, self.NX), np.inf, dtype=np.float32)
        arrival_time[ignition_row, ignition_col] = 0.0

        pq: list[tuple[float, int, int]] = [(0.0, ignition_row, ignition_col)]
        visited = np.zeros((self.NY, self.NX), dtype=bool)
        max_minutes = max_hours * 60.0

        while pq:
            t_curr, r, c = heapq.heappop(pq)
            if visited[r, c]:
                continue
            visited[r, c] = True
            if t_curr > max_minutes:
                # All remaining items in queue will be >= t_curr, stop early
                break

            for k, (dr, dc) in enumerate(self.neighbor_offsets):
                nr, nc = r + dr, c + dc
                if 0 <= nr < self.NY and 0 <= nc < self.NX:
                    ros = float(ros_8dir[k, r, c])
                    if ros <= 0.0:
                        continue
                    t_new = t_curr + self.neighbor_dists_m[k] / ros
                    if t_new < arrival_time[nr, nc]:
                        arrival_time[nr, nc] = t_new
                        heapq.heappush(pq, (t_new, nr, nc))

        return arrival_time

    def _rc_to_lonlat(self, r: float, c: float) -> tuple[float, float]:
        """Convert grid (row, col) to (lon, lat) WGS84."""
        lon = self.center_lon + (c - self.NX / 2) * self.CELL_SIZE_M * self.deg_per_m_lon
        lat = self.center_lat - (r - self.NY / 2) * self.CELL_SIZE_M * self.deg_per_m_lat
        return lon, lat

    def extract_perimeters(
        self,
        arrival_time: np.ndarray,
        timeframes_hours: list[float],
        timeframe_areas: dict[float, float] | None = None,
    ) -> dict:
        """
        Extract GeoJSON FeatureCollection of fire perimeters for each timeframe.

        Parameters
        ----------
        arrival_time : ndarray (NY, NX) in minutes
        timeframes_hours : list of hours to extract perimeters at
        timeframe_areas : optional dict {hours -> burned_area_ha} from caller

        Returns
        -------
        GeoJSON FeatureCollection dict
        """
        features = []

        for hours in timeframes_hours:
            mask = arrival_time <= hours * 60.0
            burned_count = int(np.sum(mask))
            if burned_count == 0:
                continue

            area_ha = (timeframe_areas or {}).get(hours, burned_count * (self.CELL_SIZE_M ** 2) / 10_000.0)

            properties = {
                "timeframe_hours": hours,
                "burned_area_ha": round(float(area_ha), 2),
            }

            try:
                padded = np.pad(mask.astype(np.float32), pad_width=1, constant_values=0.0)
                contours = find_contours_fallback(padded, level=0.5)
                polys: list[Polygon] = []
                for contour in contours:
                    if len(contour) >= 3:
                        coords = [self._rc_to_lonlat(pt[0] - 1, pt[1] - 1) for pt in contour]
                        if len(coords) >= 3:
                            polys.append(Polygon(coords))

                if polys:
                    merged = unary_union(polys)
                    simplified = merged.simplify(0.0002, preserve_topology=True)
                    if simplified.geom_type == "Polygon":
                        rings = [list(map(list, simplified.exterior.coords))]
                        for interior in simplified.interiors:
                            rings.append(list(map(list, interior.coords)))
                        geom = {
                            "type": "Polygon",
                            "coordinates": rings,
                        }
                    elif simplified.geom_type == "MultiPolygon":
                        geom = {
                            "type": "MultiPolygon",
                            "coordinates": [
                                [list(map(list, p.exterior.coords))] +
                                [list(map(list, interior.coords)) for interior in p.interiors]
                                for p in simplified.geoms
                            ],
                        }
                    else:
                        raise ValueError(f"Unexpected geometry type: {simplified.geom_type}")

                    features.append(make_geojson_feature(geom, properties))
                    continue

            except Exception:
                pass  # fall through to bounding-box fallback

            # --- Bounding-box fallback ---
            r_idx, c_idx = np.where(mask)
            r_min, r_max = int(r_idx.min()), int(r_idx.max())
            c_min, c_max = int(c_idx.min()), int(c_idx.max())
            lon0, lat0 = self._rc_to_lonlat(r_max, c_min)
            lon1, lat1 = self._rc_to_lonlat(r_min, c_max)
            geom = {
                "type": "Polygon",
                "coordinates": [[
                    [lon0, lat0], [lon1, lat0], [lon1, lat1],
                    [lon0, lat1], [lon0, lat0],
                ]],
            }
            features.append(make_geojson_feature(geom, properties))

        return make_feature_collection(features)

    def get_ignition_cell(self, lat: float, lon: float) -> tuple[int, int]:
        """
        Convert a WGS84 coordinate to grid (row, col).
        The ignition point is placed at grid center (NY//2, NX//2).
        """
        return self.NY // 2, self.NX // 2
