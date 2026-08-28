export type FuelType = 'GRASS_SHORT' | 'GRASS_TALL' | 'SHRUB_LOW' | 'SHRUB_CHAPARRAL' | 'TIMBER_LITTER' | 'SLASH_HEAVY';

export interface SimulationRequest {
  origin: GeoJSON.Point;
  wind_speed_ms: number;
  wind_direction_deg: number;
  slope_deg?: number;
  fuel_type: FuelType;
  hours: 6 | 12 | 24;
}

export interface SimulationMetadata {
  max_ros_m_min: number;
  wind_speed_ms: number;
  fuel_type: FuelType;
  origin: GeoJSON.Point;
  burned_area_ha_6h: number;
  burned_area_ha_12h: number;
  burned_area_ha_24h: number;
  sim_duration_ms: number;
}

export interface SimulationResult {
  sim_id: string;
  perimeters: {
    type: 'FeatureCollection';
    features: Array<GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon, {
      timeframe_hours: number;
      burned_area_ha: number;
    }>>;
  };
  metadata: SimulationMetadata;
  created_at: string;
  expires_at: number;
}
