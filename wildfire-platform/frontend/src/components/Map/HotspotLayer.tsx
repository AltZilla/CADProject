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
  const circleLayerId = 'hotspots-circle';
  const selectedSourceId = 'hotspots-selected-source';
  const selectedHaloId = 'hotspots-selected-halo';
  const selectedCoreId = 'hotspots-selected-core';
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
      });

      // Heatmap density layer
      map.addLayer({
        id: heatmapLayerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 9,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0, 0, 100, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(254,240,138,0.6)',
            0.6, 'rgba(251,146,60,0.8)',
            1, 'rgba(239,68,68,1)'
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 25],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.85, 9, 0.3],
        }
      });

      // Individual hotspot circles with dynamic active-to-ash transition
      map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: 5,
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'is_burned'], true],
            ['interpolate', ['linear'], ['zoom'], 5, 2, 8, 3.5, 12, 7], // smaller when ash
            ['interpolate', ['linear'], ['zoom'], 5, 2.5, 8, 5.5, 12, 10]
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'is_burned'], true],
            '#475569', // Quenched charcoal/ash
            [
              'interpolate', ['linear'], ['get', 'frp'],
              0, '#fef08a',
              20, '#f97316',
              100, '#ef4444'
            ]
          ],
          'circle-opacity': [
            'case',
            ['==', ['get', 'is_burned'], true],
            0.45,
            ['interpolate', ['linear'], ['zoom'], 5, 0.65, 8, 0.95]
          ],
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'is_burned'], true],
            '#334155',
            '#ffffff'
          ],
          'circle-stroke-width': [
            'case',
            ['==', ['get', 'is_burned'], true],
            0.8,
            1.5
          ],
          'circle-stroke-opacity': 0.8,
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
            'circle-radius': 4,
            'circle-color': '#fbbf24',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
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
  }, [map, enrichedData]);

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
