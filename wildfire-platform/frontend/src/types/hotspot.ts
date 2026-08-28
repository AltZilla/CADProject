export interface Hotspot {
  hotspot_id: string;
  latitude: number;
  longitude: number;
  lat?: number;
  lon?: number;
  brightness: number; // Kelvin
  frp: number; // MW
  confidence: number; // 0-100
  satellite: string;
  instrument: string;
  acq_datetime: string; // ISO8601
  daynight: 'D' | 'N';
  region_key: string;
  clustered?: boolean;
  count?: number; // for clustered points
  total_frp?: number; // for clustered points
}

export type HotspotFeature = GeoJSON.Feature<GeoJSON.Point, Hotspot>;
export type HotspotFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, Hotspot>;
