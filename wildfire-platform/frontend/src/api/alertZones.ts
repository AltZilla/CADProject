import { get, post, del } from './client';
import type { AlertZone } from '../types/alert';

export async function fetchAlertZones(): Promise<AlertZone[]> {
  return get<AlertZone[]>('/alert-zones');
}

export async function createAlertZone(data: Omit<AlertZone, 'zone_id' | 'active' | 'created_at'>): Promise<AlertZone> {
  return post<AlertZone>('/alert-zones', data);
}

export async function deleteAlertZone(zoneId: string): Promise<void> {
  return del<void>(`/alert-zones/${zoneId}`);
}
