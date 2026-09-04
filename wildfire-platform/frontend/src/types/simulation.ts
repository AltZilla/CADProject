export type FuelType = 'GRASS_SHORT' | 'GRASS_TALL' | 'SHRUB_LOW' | 'SHRUB_CHAPARRAL' | 'TIMBER_LITTER' | 'SLASH_HEAVY';

export interface HourlyWeather {
  hour: number;
  time: string;
  wind_speed_ms: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  temperature_c: number;
  relative_humidity: number;
  fuel_moisture_fraction: number;
}

export interface SimulationRequest {
  origin?: GeoJSON.Point | GeoJSON.MultiPoint;
  origins?: [number, number][]; // list of [lon, lat] pairs for multi-point ignition
  wind_speed_ms?: number;
  wind_direction_deg?: number;
  slope_deg?: number;
  fuel_type: FuelType;
  hours: 6 | 12 | 24;
}

export interface SimulationMetadata {
  max_ros_m_min: number;
  wind_speed_ms: number;
  wind_speed_kmh?: number;
  wind_direction_deg?: number;
  temperature_c?: number;
  relative_humidity?: number;
  weather_source?: string;
  fuel_type: FuelType;
  origin: GeoJSON.Point | GeoJSON.MultiPoint;
  ignition_points_count?: number;
  hourly_weather?: HourlyWeather[];
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
  expires_at?: number;
}
