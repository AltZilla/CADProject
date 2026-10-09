export interface HotspotDisplayProperties {
  clustered?: boolean;
  count?: number | string | null;
  detection_count?: number | string | null;
  point_count?: number | string | null;
  frp?: number | string | null;
  total_frp?: number | string | null;
}

export const HOTSPOT_ZOOM: {
  clustersEnd: number;
  densityStart: number;
  densityEnd: number;
  pointsStart: number;
};

export function getHotspotDisplayKind(properties?: HotspotDisplayProperties | null): 'detection' | 'aggregate';
export function getDetectionCount(properties?: HotspotDisplayProperties | null): number;
export function getHotspotFrp(properties?: HotspotDisplayProperties | null): number;
