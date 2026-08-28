import { get } from './client';
import type { HotspotFeatureCollection } from '../types/hotspot';

export interface HotspotQueryParams {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
  limit?: number;
  satellite?: string;
}

export async function fetchHotspots(params: HotspotQueryParams): Promise<HotspotFeatureCollection> {
  const query = new URLSearchParams(params as any).toString();
  return get<HotspotFeatureCollection>(`/hotspots?${query}`);
}
