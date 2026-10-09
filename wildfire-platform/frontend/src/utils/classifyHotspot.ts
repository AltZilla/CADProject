import type { Hotspot, FireClass } from '@/types/hotspot';

const INDUSTRIAL_ZONES: [number, number, number, number][] = [
  [-104, 31, -96, 36],
  [-97, 49, -93, 53],
  [50, 20, 60, 28],
  [55, 55, 75, 72],
  [5, 4, 9, 8],
  [29, 53, 37, 58],
  [-66, 7, -60, 12],
  [102, 36, 118, 43],
];

function inIndustrialZone(lat: number, lon: number): boolean {
  return INDUSTRIAL_ZONES.some(
    ([minLon, minLat, maxLon, maxLat]) =>
      lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
  );
}

export function classifyHotspot(h: Hotspot): { fire_class: FireClass; class_reason: string } {
  const lat = h.latitude ?? h.lat ?? 0;
  const lon = h.longitude ?? h.lon ?? 0;
  const frp = h.frp ?? 0;
  const brightness = h.brightness ?? 0;
  const confidence = h.confidence ?? 60;
  const daynight = h.daynight ?? 'D';

  if (daynight === 'N' && inIndustrialZone(lat, lon) && brightness > 370 && frp < 80)
    return { fire_class: 'industrial', class_reason: 'Night-time detection in known industrial/gas flare region' };

  if (daynight === 'N' && brightness > 420 && frp < 50)
    return { fire_class: 'industrial', class_reason: 'Persistent high-brightness night-time source' };

  if (confidence < 50)
    return { fire_class: 'possible', class_reason: `Low FIRMS sensor confidence (${confidence}%)` };

  if (confidence >= 80 && frp >= 50 && brightness >= 330)
    return { fire_class: 'verified', class_reason: `High confidence VIIRS (${confidence}%), ${frp.toFixed(0)} MW FRP` };

  if (confidence >= 60 && frp >= 15)
    return { fire_class: 'probable', class_reason: `Nominal confidence (${confidence}%), ${frp.toFixed(0)} MW FRP` };

  return { fire_class: 'possible', class_reason: `Insufficient data (${confidence}%, ${frp.toFixed(1)} MW)` };
}

export const CLASS_LABELS: Record<FireClass, string> = {
  verified: '🔴 Verified Wildfire',
  probable: '🟠 Probable Wildfire',
  possible: '🟡 Possible Fire',
  industrial: '⚫ Suspected Industrial',
};

export const CLASS_SHORT_LABELS: Record<FireClass, string> = {
  verified: 'Verified',
  probable: 'Probable',
  possible: 'Possible',
  industrial: 'Industrial',
};

export const CLASS_STYLES: Record<FireClass, string> = {
  verified: 'bg-red-500/20 text-red-400 border-red-500/40',
  probable: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  possible: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  industrial: 'bg-slate-600/30 text-slate-400 border-slate-500/40',
};

export const CLASS_COLORS: Record<FireClass, string> = {
  verified: '#dc2626',
  probable: '#ea580c',
  possible: '#ca8a04',
  industrial: '#6b7280',
};
