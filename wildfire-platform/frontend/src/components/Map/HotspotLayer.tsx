import { useEffect, useRef, useMemo, type MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';
import { Zap, X, Flame } from 'lucide-react';
import type { SimulationRequest } from '@/types/simulation';
import type { Hotspot } from '@/types/hotspot';
import { getDetectionCount, getHotspotDisplayKind, getHotspotFrp, HOTSPOT_ZOOM } from '@/utils/hotspotPresentation.js';

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

function showAggregateSummary(
  map: maplibregl.Map,
  popupRef: MutableRefObject<maplibregl.Popup | null>,
  coordinates: [number, number],
  properties: Hotspot,
  titleText = 'Aggregated detections',
  noteText = 'This map cell summarizes detections; it is not an individual hotspot.',
) {
  const container = document.createElement('div');
  container.className = 'hotspot-summary-popup';

  const title = document.createElement('strong');
  title.textContent = titleText;
  const count = document.createElement('span');
  count.textContent = `${getDetectionCount(properties).toLocaleString()} detections`;
  const frp = document.createElement('span');
  frp.textContent = `${getHotspotFrp(properties).toFixed(1)} MW total FRP`;
  const note = document.createElement('small');
  note.textContent = noteText;
  container.append(title, count, frp, note);

  popupRef.current?.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
    .setLngLat(coordinates)
    .setDOMContent(container)
    .addTo(map);
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
  const clusterLayerId = 'hotspots-clusters';
  const clusterCountLayerId = 'hotspots-cluster-count';
  const singletonLayerId = 'hotspots-singletons';
  const singletonCountLayerId = 'hotspots-singleton-count';
  const heatmapLayerId = 'hotspots-heatmap';
  const circleLayerId = 'hotspots-circle';
  const aggregateLayerId = 'hotspots-aggregate';
  const aggregateCountLayerId = 'hotspots-aggregate-count';
  const selectedSourceId = 'hotspots-selected-source';
  const selectedHaloId = 'hotspots-selected-halo';
  const selectedCoreId = 'hotspots-selected-core';
  const originSourceId = 'sim-origin-source';
  const originHaloId = 'sim-origin-halo';
  const originCoreId = 'sim-origin-core';
  const aggregatePopupRef = useRef<maplibregl.Popup | null>(null);

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
        cluster: true,
        clusterRadius: 60,
        clusterMaxZoom: 4,
        clusterProperties: {
          detection_count: ['+', ['to-number', ['coalesce', ['get', 'count'], 1]]],
          frp_total: ['+', ['to-number', ['coalesce', ['get', 'total_frp'], ['get', 'frp'], 0]]],
        },
      });

      // Count-weighted density gives a geographic concentration view, independent of FRP.
      map.addLayer({
        id: heatmapLayerId,
        type: 'heatmap',
        source: sourceId,
        minzoom: HOTSPOT_ZOOM.densityStart,
        maxzoom: HOTSPOT_ZOOM.densityEnd,
        paint: {
          'heatmap-weight': ['to-number', ['coalesce', ['get', 'detection_count'], ['get', 'count'], 1]],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            3.8, 0.55,
            6, 0.9,
            8.5, 1.15,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0.00, 'rgba(0, 0, 0, 0)',
            0.12, 'rgba(251, 191, 36, 0.38)',
            0.35, 'rgba(249, 115, 22, 0.55)',
            0.7, 'rgba(220, 38, 38, 0.68)',
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            3.8, 10,
            6, 17,
            8.5, 24,
          ],
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            3.8, 0,
            4.5, 0.42,
            6, 0.38,
            8.25, 0.34,
            8.5, 0,
          ],
        },
      });

      map.addLayer({
        id: clusterLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        maxzoom: HOTSPOT_ZOOM.clustersEnd,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'detection_count'],
            2, 10,
            20, 15,
            100, 19,
            500, 24,
          ],
          'circle-color': '#f97316',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 0.9, 4.5, 0],
          'circle-stroke-color': '#fff7ed',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 0.9, 4.5, 0],
        },
      });

      map.addLayer({
        id: clusterCountLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        maxzoom: HOTSPOT_ZOOM.clustersEnd,
        layout: {
          'text-field': ['to-string', ['get', 'detection_count']],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
        },
        paint: {
          'text-color': '#fff',
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 1, 4.5, 0],
          'text-halo-color': '#9a3412',
          'text-halo-width': 0.5,
        },
      });

      // Unclustered detections remain visible at world scale as small, unlabeled points.
      map.addLayer({
        id: singletonLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        maxzoom: HOTSPOT_ZOOM.clustersEnd,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'clustered'], true], 6, 3],
          'circle-color': ['case', ['==', ['get', 'clustered'], true], '#ea580c', '#f97316'],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 0.88, 4.5, 0],
          'circle-stroke-color': '#fff7ed',
          'circle-stroke-width': 1,
        },
      });

      map.addLayer({
        id: singletonCountLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'clustered'], true]],
        maxzoom: HOTSPOT_ZOOM.clustersEnd,
        layout: {
          'text-field': ['to-string', ['get', 'count']],
          'text-font': ['Open Sans Bold'],
          'text-size': 9,
        },
        paint: {
          'text-color': '#fff',
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 1, 4.5, 0],
          'text-halo-color': '#9a3412',
          'text-halo-width': 0.5,
        },
      });

      map.addLayer({
        id: aggregateLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'clustered'], true]],
        minzoom: HOTSPOT_ZOOM.pointsStart,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'count'],
            2, 8,
            20, 13,
            100, 18,
          ],
          'circle-color': '#c2410c',
          'circle-opacity': 0.88,
          'circle-stroke-color': '#fff7ed',
          'circle-stroke-width': 1.5,
        },
      });

      map.addLayer({
        id: aggregateCountLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'clustered'], true]],
        minzoom: HOTSPOT_ZOOM.pointsStart,
        layout: {
          'text-field': ['to-string', ['get', 'count']],
          'text-font': ['Open Sans Bold'],
          'text-size': 10,
        },
        paint: {
          'text-color': '#fff',
          'text-halo-color': '#7c2d12',
          'text-halo-width': 0.75,
        },
      });

      map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'clustered'], true]],
        minzoom: HOTSPOT_ZOOM.pointsStart,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['to-number', ['coalesce', ['get', 'frp'], 0]],
            0, 3,
            25, 3.8,
            100, 5,
            300, 6.3,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['to-number', ['coalesce', ['get', 'frp'], 0]],
            0, '#fbbf24',
            25, '#f97316',
            100, '#ef4444',
            300, '#b91c1c',
          ],
          'circle-opacity': ['case', ['==', ['get', 'is_burned'], true], 0.48, 0.94],
          'circle-stroke-color': '#fff7ed',
          'circle-stroke-width': 1.25,
        },
      });

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

      map.on('click', clusterLayerId, (event) => {
        const feature = event.features?.[0];
        const clusterId = Number(feature?.properties?.cluster_id);
        if (!Number.isFinite(clusterId) || feature?.geometry.type !== 'Point') return;
        const clusterCenter = feature.geometry.coordinates as [number, number];

        const clusterProperties: Hotspot = {
          hotspot_id: `cluster-${clusterId}`,
          clustered: true,
          count: getDetectionCount(feature.properties),
          total_frp: Number(feature.properties?.frp_total ?? 0),
          longitude: clusterCenter[0],
          latitude: clusterCenter[1],
        };
        showAggregateSummary(
          map,
          aggregatePopupRef,
          clusterCenter,
          clusterProperties,
          'Hotspot cluster',
          'Cluster total; zooming in to show its detections.',
        );

        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          if (!map.getSource(sourceId)) return;
          map.easeTo({ center: clusterCenter, zoom, duration: 650 });
        }).catch(() => {});
      });

      map.on('click', heatmapLayerId, (event) => {
        map.easeTo({
          center: [event.lngLat.lng, event.lngLat.lat],
          zoom: Math.min(map.getZoom() + 2, HOTSPOT_ZOOM.pointsStart),
          duration: 650,
        });
      });

      const handleHotspotClick = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const properties = feature.properties as Hotspot;
        const coordinates = feature.geometry.coordinates as [number, number];

        if (getHotspotDisplayKind(properties) === 'aggregate') {
          showAggregateSummary(map, aggregatePopupRef, coordinates, properties);
          return;
        }

        aggregatePopupRef.current?.remove();
        if (useAppStore.getState().isSelectingGroup) {
          useAppStore.getState().toggleGroupHotspot(coordinates);
          return;
        }

        setSelectedHotspot({
          ...properties,
          longitude: Number(properties.longitude ?? coordinates[0]),
          latitude: Number(properties.latitude ?? coordinates[1]),
        });
      };

      map.on('click', circleLayerId, handleHotspotClick);
      map.on('click', aggregateLayerId, handleHotspotClick);
      map.on('click', singletonLayerId, handleHotspotClick);

      const interactiveLayerIds = [clusterLayerId, singletonLayerId, circleLayerId, aggregateLayerId];
      interactiveLayerIds.forEach((layerId) => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      });

      map.on('mouseenter', heatmapLayerId, () => { map.getCanvas().style.cursor = 'zoom-in'; });
      map.on('mouseleave', heatmapLayerId, () => { map.getCanvas().style.cursor = ''; });
    }

    return () => {
      aggregatePopupRef.current?.remove();
    };
  }, [map, setSelectedHotspot]);

  // Push updated GeoJSON to MapLibre whenever raw data or active/burned state changes
  useEffect(() => {
    if (map && map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(enrichedData);
    }
    // Keep hotspot and ignition markers elevated above 3D terrain fills
    const topLayers = [
      clusterLayerId, clusterCountLayerId, singletonLayerId, singletonCountLayerId,
      aggregateLayerId, aggregateCountLayerId, circleLayerId, selectedHaloId, selectedCoreId, originHaloId, originCoreId,
    ];
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

  return (
    <>
      <div className="absolute left-3 top-16 z-30 w-[214px] rounded-lg border border-slate-700/90 bg-slate-950/90 px-3 py-2.5 text-slate-100 shadow-lg backdrop-blur-sm">
        <div className="mb-2 text-[11px] font-semibold text-slate-200">Hotspot key</div>
        <div className="flex items-center justify-between gap-1.5 text-[10px] text-slate-400">
          <span>Density</span>
          <span>Sparse</span>
          <span className="h-2 w-16 rounded-full bg-gradient-to-r from-amber-300 via-orange-500 to-red-700" aria-hidden="true" />
          <span>Dense</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>FRP (MW)</span>
          <span className="flex items-center gap-2" aria-label="Marker color and size increase with FRP">
            <i className="h-2 w-2 rounded-full border border-orange-100 bg-amber-400" />
            <i className="h-2.5 w-2.5 rounded-full border border-orange-100 bg-orange-500" />
            <i className="h-3 w-3 rounded-full border border-orange-100 bg-red-600" />
          </span>
          <span>Higher</span>
        </div>
      </div>
      {selectedGroupHotspots.length > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900/95 backdrop-blur-md border border-amber-500/50 rounded-xl px-4 py-2.5 shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-xs font-bold text-amber-300">
              {selectedGroupHotspots.length} {selectedGroupHotspots.length === 1 ? 'Hotspot' : 'Hotspots'} Selected
            </span>
          </div>
          <button
            onClick={handleRunGroupForecast}
            disabled={simulationLoading}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Zap size={14} className="fill-current" />
            {simulationLoading ? 'Simulating...' : `Run Forecast (${selectedGroupHotspots.length})`}
          </button>
          <button
            onClick={() => clearGroupHotspots()}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition-colors"
            title="Clear selection"
            aria-label="Clear selected hotspots"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
