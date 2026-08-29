export function formatCoordinate(value: number, axis: 'lat' | 'lon', precision = 4): string {
  const direction = axis === 'lat'
    ? value >= 0 ? 'N' : 'S'
    : value >= 0 ? 'E' : 'W';

  return `${Math.abs(value).toFixed(precision)}°${direction}`;
}

export function formatPoint(coordinates: [number, number], precision = 4): string {
  const [lon, lat] = coordinates;
  return `${formatCoordinate(lat, 'lat', precision)}, ${formatCoordinate(lon, 'lon', precision)}`;
}
