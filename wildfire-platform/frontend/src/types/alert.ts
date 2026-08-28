export interface AlertZone {
  zone_id: string;
  name: string;
  geometry: GeoJSON.Polygon;
  email: string;
  active: boolean;
  created_at: string;
}
