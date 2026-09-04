import { useEffect, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';
import { findFireComplex } from '@/utils/clustering';
import { Zap, X, Flame } from 'lucide-react';
import type { SimulationRequest } from '@/types/simulation';

function isPointInPoly(pt: [number, number], ring: number[][]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function HotspotLayer() {
  const map = useMap();
  const setSelectedHotspot = useAppStore((s) => s.setSelectedHotspot);
  const setSimulationRequest = useAppStore((s) => s.setSimulationRequest);
  const setDetectedFuelType = useAppStore((s) => s.setDetectedFuelType);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const playbackHour = useAppStore((s) => s.playbackHour);
  const simulationResult = useAppStore((s) => s.simulationResult);
  const simulationLoading = useAppStore((s) => s.simulationLoading);
  const isSelectingGroup = useAppStore((s) => s.isSelectingGroup);
  const setIsSelectingGroup = useAppStore((s) => s.setIsSelectingGroup);
  const selectedGroupHotspots = useAppStore((s) => s.selectedGroupHotspots);
  const toggleGroupHotspot = useAppStore((s) => s.toggleGroupHotspot);
  const clearGroupHotspots = useAppStore((s) => s.clearGroupHotspots);
  const { data } = useHotspots();
  const { runSim } = useSimulation();
  
  const sourceId = 'hotspots-source';
  const heatmapLayerId = 'hotspots-heatmap';
  const glowLayerId = 'hotspots-glow';
  const circleLayerId = 'hotspots-circle';
  const innerLayerId = 'hotspots-inner';
  const selectedSourceId = 'hotspots-selected-source';
  const selectedHaloId = 'hotspots-selected-halo';
  const selectedCoreId = 'hotspots-selected-core';
  const originSourceId = 'sim-origin-source';
  const originHaloId = 'sim-origin-halo';
  const originCoreId = 'sim-origin-core';
  const clusterPopupRef = useRef<maplibregl.Popup | null>(null);

  // Active perimeters at the current playback hour
  const currentPerimeterPolys = useMemo(() => {
    if (!simulationResult?.perimeters?.features) return [];
    const polys: number[][][] = [];
    simulationResult.perimeters.features.forEach((f) => {
      const hours = f.properties?.timeframe_hours ?? 0;
      if (hours <= playbackHour) {
        const geom = f.geometry;
        if (geom.type === 'Polygon') {
          polys.push(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach((p) => polys.push(p[0]));
        }
      }
    });
    return polys;
  }, [simulationResult, playbackHour]);

  // Enrich hotspot features with active vs burned status based on current fire perimeter
  const enrichedData = useMemo(() => {
    if (!data?.features) return { type: 'FeatureCollection' as const, features: [] };
    if (currentPerimeterPolys.length === 0) return data;

    const enrichedFeatures = data.features.map((feat) => {
      const coords = feat.geometry?.coordinates;
      if (!coords) return feat;
      const pt: [number, number] = [coords[0], coords[1]];
      const isBurned = currentPerimeterPolys.some((ring) => isPointInPoly(pt, ring));
      return {
        ...feat,
        properties: {
          ...feat.properties,
          is_burned: isBurned,
        },
      };
    });

    return { type: 'FeatureCollection' as const, features: enrichedFeatures };
  }, [data, currentPerimeterPolys]);

  useEffect(() => {
    if (!map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        tolerance: 0,
        buffer: 128,
      });

      // 1. Heatmap density layer with smooth crossfade between zoom 4 and 10.5
      map.addLayer({
        id: heatmapLayerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 11,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0, 0.1, 50, 0.6, 200, 1.0],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(251,146,60,0.6)',
            0.6, 'rgba(239,68,68,0.85)',
            1, 'rgba(185,28,28,1)'
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 25],
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            4, 0.9,
            7, 0.8,
            9, 0.45,
            10.5, 0.0
          ],
        }
      });

      // 2. Soft glowing heat halo underneath individual hotspots (visible even in 3D terrain)
      map.addLayer({
        id: glowLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: 4,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'viewport',
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 5,
            7, 9,
            10, 14,
            13, 20,
            16, 28
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'is_burned'], true],
            'rgba(234, 88, 12, 0.35)',
            [
              'interpolate', ['linear'], ['get', 'frp'],
              0, 'rgba(249, 115, 22, 0.35)',
              30, 'rgba(239, 68, 68, 0.50)',
              100, 'rgba(220, 38, 38, 0.65)'
            ]
          ],
          'circle-blur': 0.75,
          'circle-opacity': 0.85,
        }
      });

      // 3. Primary high-contrast hotspot dot — anchored to 3D terrain with razor-sharp dark outline
      map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: 4,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'viewport',
          'circle-radius': [
            'case',
            ['==', ['get', 'is_burned'], true],
            ['interpolate', ['linear'], ['zoom'], 4, 3.0, 7, 5.0, 10, 8.0, 13, 11.5, 16, 16],
            ['interpolate', ['linear'], ['zoom'], 4, 3.5, 7, 5.5, 10, 8.5, 13, 12.0, 16, 17]
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'is_burned'], true],
            '#ea580c', // Bright glowing ember core (never invisible grey!)
            [
              'interpolate', ['linear'], ['get', 'frp'],
              0, '#f97316',      // Crisp visible amber-orange (never pale washed-out yellow)
              15, '#ea580c',
              50, '#ef4444',     // Crimson
              150, '#b91c1c'     // Intense fire red
            ]
          ],
          'circle-opacity': 0.95,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'is_burned'], true],
            '#ffffff', // White ignition rim
            '#0f172a'  // Dark slate border for supreme contrast on light basemaps & satellite
          ],
          'circle-stroke-width': [
            'interpolate', ['linear'], ['zoom'],
            4, 1.0,
            8, 1.8,
            13, 2.4
          ],
          'circle-stroke-opacity': 0.95,
        }
      });

      // 4. White-hot inner thermal core for authentic satellite VIIRS signature
      map.addLayer({
        id: innerLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: 6,
        paint: {
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'viewport',
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            6, 1.5,
            10, 3.0,
            14, 4.5
          ],
          'circle-color': '#ffffff',
          'circle-opacity': 0.92,
        }
      });

      const handleClusterClick = (lngLat: maplibregl.LngLat) => {
        const rawFeatures = data?.features || [];
        const complex = findFireComplex(lngLat.lng, lngLat.lat, rawFeatures, 12.0);

        clusterPopupRef.current?.remove();

        const container = document.createElement('div');
        container.className = 'text-xs';
        container.innerHTML = `
          <div style="background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 14px; min-width: 250px; font-family: system-ui; box-shadow: 0 20px 30px -10px rgba(0,0,0,0.7); border: 1px solid rgba(251,146,60,0.3);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-weight: 700; color: #fb923c; font-size: 13px; display: flex; align-items: center; gap: 5px;">
                🔥 ${complex.count > 1 ? 'Fire Complex' : 'Active Hotspot'}
              </div>
              <span style="font-size: 10px; background: rgba(249,115,22,0.25); color: #fed7aa; padding: 2px 7px; border-radius: 999px; font-weight: 700;">
                ${complex.count} ${complex.count === 1 ? 'detection' : 'detections'}
              </span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; font-size: 11px;">
              <div style="background: rgba(30,41,59,0.85); padding: 7px; border-radius: 8px; border: 1px solid rgba(51,65,85,0.7);">
                <div style="color: #94a3b8; font-size: 10px;">Total FRP</div>
                <div style="color: #f97316; font-weight: 700; font-size: 12px;">${complex.totalFrp.toFixed(1)} MW</div>
              </div>
              <div style="background: rgba(30,41,59,0.85); padding: 7px; border-radius: 8px; border: 1px solid rgba(51,65,85,0.7);">
                <div style="color: #94a3b8; font-size: 10px;">Peak FRP</div>
                <div style="color: #ef4444; font-weight: 700; font-size: 12px;">${complex.maxFrp.toFixed(1)} MW</div>
              </div>
            </div>

            <button id="sim-complex-btn" style="width: 100%; padding: 9px 12px; background: linear-gradient(to right, #ea580c, #dc2626); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 15px rgba(234,88,12,0.4); margin-bottom: 6px;">
              ⚡ ${complex.count > 1 ? `Simulate Entire Complex (${complex.count} pts)` : 'Simulate Fire Spread'}
            </button>

            ${complex.count > 1 ? `
              <button id="sim-single-btn" style="width: 100%; padding: 5px 8px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 500;">
                Simulate single center point only
              </button>
            ` : ''}
          </div>
        `;

        clusterPopupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          anchor: 'bottom',
          offset: 12,
        })
          .setLngLat(lngLat)
          .setDOMContent(container)
          .addTo(map);

        setTimeout(() => {
          const runSimulationWithPoints = async (points: [number, number][]) => {
            clusterPopupRef.current?.remove();
            useAppStore.getState().setSelectedGroupHotspots(points);

            const centerLon = points.reduce((a, b) => a + b[0], 0) / points.length;
            const centerLat = points.reduce((a, b) => a + b[1], 0) / points.length;

            if (map) {
              map.flyTo({
                center: [centerLon, centerLat],
                zoom: Math.max(map.getZoom(), 11.5),
                pitch: 45,
                duration: 1200,
              });
            }

            const weather = await fetchLiveWeather(centerLat, centerLon);
            const autoFuel = detectFuelType(weather);
            setDetectedFuelType(autoFuel);

            const request = {
              origins: points,
              origin: points.length === 1 ? { type: 'Point' as const, coordinates: points[0] } : { type: 'MultiPoint' as const, coordinates: points },
              wind_speed_ms: weather.wind_speed_ms,
              wind_direction_deg: weather.wind_direction_deg,
              fuel_type: autoFuel,
              hours: 24 as const,
            };
            setSimulationRequest(request);
            setActiveTab('simulation');
            runSim(request as any);
          };

          const compBtn = document.getElementById('sim-complex-btn');
          if (compBtn) {
            compBtn.addEventListener('click', () => runSimulationWithPoints(complex.points));
          }

          const singleBtn = document.getElementById('sim-single-btn');
          if (singleBtn) {
            singleBtn.addEventListener('click', () => runSimulationWithPoints([[lngLat.lng, lngLat.lat]]));
          }
        }, 50);
      };

      // Selection Halo and Core layers for manually selected hotspot group
      if (!map.getSource(selectedSourceId)) {
        map.addSource(selectedSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: selectedHaloId,
          type: 'circle',
          source: selectedSourceId,
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-pitch-scale': 'viewport',
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, 7,
              8, 12,
              12, 18
            ],
            'circle-color': 'rgba(245, 158, 11, 0.25)',
            'circle-stroke-color': '#f59e0b',
            'circle-stroke-width': 2.5,
            'circle-stroke-opacity': 0.95,
          },
        });

        map.addLayer({
          id: selectedCoreId,
          type: 'circle',
          source: selectedSourceId,
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-pitch-scale': 'viewport',
            'circle-radius': 4.5,
            'circle-color': '#fbbf24',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }

      // Dedicated Simulation Ignition Origin Beacon
      if (!map.getSource(originSourceId)) {
        map.addSource(originSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: originHaloId,
          type: 'circle',
          source: originSourceId,
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-pitch-scale': 'viewport',
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              4, 10,
              8, 16,
              12, 24,
              16, 32
            ],
            'circle-color': 'rgba(239, 68, 68, 0.35)',
            'circle-stroke-color': '#ef4444',
            'circle-stroke-width': 2.5,
            'circle-stroke-opacity': 0.95,
          },
        });

        map.addLayer({
          id: originCoreId,
          type: 'circle',
          source: originSourceId,
          paint: {
            'circle-pitch-alignment': 'map',
            'circle-pitch-scale': 'viewport',
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              4, 5,
              8, 7,
              12, 10,
              16, 14
            ],
            'circle-color': '#dc2626',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2.5,
            'circle-opacity': 1.0,
          },
        });
      }

      map.on('click', circleLayerId, (e) => {
        if (!e.lngLat) return;
        if (useAppStore.getState().isSelectingGroup) {
          const feat = e.features?.[0];
          if (feat && feat.geometry && feat.geometry.type === 'Point') {
            const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
            useAppStore.getState().toggleGroupHotspot(coords);
          } else {
            useAppStore.getState().toggleGroupHotspot([e.lngLat.lng, e.lngLat.lat]);
          }
          return;
        }
        handleClusterClick(e.lngLat);
      });

      map.on('click', heatmapLayerId, (e) => {
        if (!e.lngLat) return;
        if (useAppStore.getState().isSelectingGroup) {
          useAppStore.getState().toggleGroupHotspot([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        handleClusterClick(e.lngLat);
      });

      map.on('mouseenter', circleLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', circleLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', heatmapLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', heatmapLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    return () => {
      clusterPopupRef.current?.remove();
    };
  }, [map, data, setSelectedHotspot]);

  // Push updated GeoJSON to MapLibre whenever raw data or active/burned state changes
  useEffect(() => {
    if (map && map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(enrichedData);
    }
    // Keep hotspot and ignition markers elevated above 3D terrain fills
    const topLayers = [glowLayerId, circleLayerId, innerLayerId, originHaloId, originCoreId, selectedHaloId, selectedCoreId];
    topLayers.forEach((id) => {
      if (map && map.getLayer(id)) {
        try {
          map.moveLayer(id);
        } catch (_) {}
      }
    });
  }, [map, enrichedData]);

  // Push Simulation Origin GeoJSON to MapLibre
  useEffect(() => {
    if (!map || !map.getSource(originSourceId)) return;
    const origin = simulationResult?.metadata?.origin;
    const origins = (simulationResult?.metadata as any)?.origins;
    const pts: [number, number][] = [];
    if (origins && Array.isArray(origins)) {
      origins.forEach((p: any) => pts.push(p as [number, number]));
    } else if (origin) {
      if (origin.type === 'Point' && Array.isArray(origin.coordinates)) {
        pts.push(origin.coordinates as [number, number]);
      } else if (origin.type === 'MultiPoint' && Array.isArray(origin.coordinates)) {
        (origin.coordinates as [number, number][]).forEach((p: any) => pts.push(p));
      }
    }
    const features = pts.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: p },
      properties: { is_origin: true },
    }));
    (map.getSource(originSourceId) as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    });
  }, [map, simulationResult]);

  // Push selected hotspots GeoJSON to MapLibre
  useEffect(() => {
    if (map && map.getSource(selectedSourceId)) {
      const features = selectedGroupHotspots.map((pt) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: pt,
        },
        properties: {},
      }));
      (map.getSource(selectedSourceId) as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features,
      });
    }
  }, [map, selectedGroupHotspots]);

  const handleRunGroupForecast = async () => {
    if (selectedGroupHotspots.length === 0) return;
    const centerLon = selectedGroupHotspots.reduce((a, b) => a + b[0], 0) / selectedGroupHotspots.length;
    const centerLat = selectedGroupHotspots.reduce((a, b) => a + b[1], 0) / selectedGroupHotspots.length;

    if (map) {
      map.flyTo({
        center: [centerLon, centerLat],
        zoom: Math.max(map.getZoom(), 11.5),
        pitch: 45,
        duration: 1200,
      });
    }

    const weather = await fetchLiveWeather(centerLat, centerLon);
    const autoFuel = detectFuelType(weather);
    setDetectedFuelType(autoFuel);

    const request: SimulationRequest = {
      origins: selectedGroupHotspots,
      origin: selectedGroupHotspots.length === 1
        ? { type: 'Point', coordinates: selectedGroupHotspots[0] }
        : { type: 'MultiPoint', coordinates: selectedGroupHotspots },
      wind_speed_ms: weather.wind_speed_ms,
      wind_direction_deg: weather.wind_direction_deg,
      fuel_type: autoFuel,
      hours: 24,
    };
    setSimulationRequest(request);
    setActiveTab('simulation');
    setIsSelectingGroup(false);
    runSim(request);
  };

  if (selectedGroupHotspots.length === 0) return null;

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900/95 backdrop-blur-md border border-amber-500/50 rounded-2xl px-4 py-2.5 shadow-2xl animate-in slide-in-from-top-4">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
        <span className="text-xs font-bold text-amber-300">
          {selectedGroupHotspots.length} {selectedGroupHotspots.length === 1 ? 'Hotspot' : 'Hotspots'} Selected
        </span>
      </div>
      <button
        onClick={handleRunGroupForecast}
        disabled={simulationLoading}
        className="px-3.5 py-1.5 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-orange-500/30 flex items-center gap-1.5 transition-all disabled:opacity-50"
      >
        <Zap size={14} className="fill-current" />
        {simulationLoading ? 'Simulating...' : `Run Multi-Point Forecast (${selectedGroupHotspots.length})`}
      </button>
      <button
        onClick={() => clearGroupHotspots()}
        className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition-colors"
        title="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}
