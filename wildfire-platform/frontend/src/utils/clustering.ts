/**
 * Spatial Connected-Component Clustering for Wildfire Hotspots.
 * Groups satellite detections within threshold distance (default 12 km)
 * into a single unified Fire Complex entity.
 */

export interface FireComplex {
  points: [number, number][]; // [lon, lat][]
  features: any[];
  count: number;
  totalFrp: number;
  maxFrp: number;
  center: [number, number]; // [lon, lat]
  name: string;
}

export function findFireComplex(
  clickedLon: number,
  clickedLat: number,
  allFeatures: any[],
  thresholdKm = 12.0
): FireComplex {
  if (!allFeatures || allFeatures.length === 0) {
    return {
      points: [[clickedLon, clickedLat]],
      features: [],
      count: 1,
      totalFrp: 10,
      maxFrp: 10,
      center: [clickedLon, clickedLat],
      name: 'Single Ignition Point',
    };
  }

  // Geographic distance approximation: 1 deg lat ≈ 111 km
  const cosLat = Math.cos((clickedLat * Math.PI) / 180);
  const getDistKm = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const dLat = (lat2 - lat1) * 111.0;
    const dLon = (lon2 - lon1) * 111.0 * cosLat;
    return Math.hypot(dLat, dLon);
  };

  // 1. Find the nearest seed feature
  let seedIdx = -1;
  let minSeedDist = Infinity;

  allFeatures.forEach((f, idx) => {
    const coords = f.geometry?.coordinates || [f.properties?.longitude, f.properties?.latitude];
    if (!coords) return;
    const d = getDistKm(clickedLon, clickedLat, coords[0], coords[1]);
    if (d < minSeedDist) {
      minSeedDist = d;
      seedIdx = idx;
    }
  });

  const visited = new Set<number>();
  const queue: [number, number][] = [];
  const complexFeatures: any[] = [];
  const points: [number, number][] = [];

  if (seedIdx !== -1 && minSeedDist <= thresholdKm * 1.5) {
    visited.add(seedIdx);
    const seedFeat = allFeatures[seedIdx];
    const seedCoords = seedFeat.geometry?.coordinates || [seedFeat.properties?.longitude, seedFeat.properties?.latitude];
    complexFeatures.push(seedFeat);
    points.push([seedCoords[0], seedCoords[1]]);
    queue.push([seedCoords[0], seedCoords[1]]);
  } else {
    // If click was empty space, seed with the click position
    queue.push([clickedLon, clickedLat]);
    points.push([clickedLon, clickedLat]);
  }

  // 2. Breadth-First Search: chain all adjacent detections within thresholdKm
  while (queue.length > 0) {
    const [qLon, qLat] = queue.shift()!;
    allFeatures.forEach((f, idx) => {
      if (visited.has(idx)) return;
      const coords = f.geometry?.coordinates || [f.properties?.longitude, f.properties?.latitude];
      if (!coords) return;
      const dist = getDistKm(qLon, qLat, coords[0], coords[1]);
      if (dist <= thresholdKm) {
        visited.add(idx);
        complexFeatures.push(f);
        points.push([coords[0], coords[1]]);
        queue.push([coords[0], coords[1]]);
      }
    });
  }

  const count = points.length;
  let totalFrp = 0;
  let maxFrp = 0;

  complexFeatures.forEach(f => {
    const frp = Number(f.properties?.frp ?? f.properties?.total_frp ?? 10);
    totalFrp += frp;
    if (frp > maxFrp) maxFrp = frp;
  });

  if (totalFrp === 0) totalFrp = count * 15;
  if (maxFrp === 0) maxFrp = 15;

  const centerLon = points.reduce((acc, p) => acc + p[0], 0) / count;
  const centerLat = points.reduce((acc, p) => acc + p[1], 0) / count;

  let name = count > 1 ? `Fire Complex (${count} detections)` : 'Active Hotspot';
  if (count >= 5) {
    name = `Major Wildfire Complex (${count} detections)`;
  }

  return {
    points,
    features: complexFeatures,
    count,
    totalFrp,
    maxFrp,
    center: [centerLon, centerLat],
    name,
  };
}
