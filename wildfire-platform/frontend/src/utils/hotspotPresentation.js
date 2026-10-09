export const HOTSPOT_ZOOM = {
  clustersEnd: 4.5,
  densityStart: 3.8,
  densityEnd: 8.5,
  pointsStart: 8.5,
};

export function getHotspotDisplayKind(properties) {
  return properties?.clustered === true ? 'aggregate' : 'detection';
}

export function getDetectionCount(properties) {
  const count = Number(properties?.count ?? properties?.detection_count ?? properties?.point_count);
  return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
}

export function getHotspotFrp(properties) {
  const frp = Number(properties?.total_frp ?? properties?.frp ?? 0);
  return Number.isFinite(frp) && frp > 0 ? frp : 0;
}
