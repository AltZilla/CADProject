import { useEffect, useRef, useMemo } from 'react';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import maplibregl from 'maplibre-gl';

export default function SimulationLayer() {
  const map = useMap();
  const simulationResult = useAppStore((s) => s.simulationResult);
  const playbackHour = useAppStore((s) => s.playbackHour);
  const animationRef = useRef<number>();

  // Filter features to only show up to the current playback hour
  const visibleData = useMemo(() => {
    if (!simulationResult?.perimeters) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    const features = simulationResult.perimeters.features.filter(
      (f) => (f.properties?.timeframe_hours ?? 0) <= playbackHour
    );
    return { type: 'FeatureCollection' as const, features };
  }, [simulationResult, playbackHour]);

  // The "leading edge" is the outermost perimeter at the current hour
  const leadingHour = useMemo(() => {
    if (!visibleData.features.length) return null;
    return Math.max(...visibleData.features.map(f => f.properties?.timeframe_hours ?? 0));
  }, [visibleData]);

  useEffect(() => {
    if (!map) return;

    const sourceId = 'sim-source';
    
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      const beforeId = map.getLayer('hotspots-glow') ? 'hotspots-glow' : (map.getLayer('hotspots-circle') ? 'hotspots-circle' : undefined);

      // Burned interior — single unified semi-transparent warm fill for the current burned perimeter
      map.addLayer({
        id: 'sim-fill-burned',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 1],
        paint: {
          'fill-color': 'rgba(234, 88, 12, 0.20)',
          'fill-outline-color': 'rgba(234, 88, 12, 0.40)',
        }
      }, beforeId);

      // Leading edge glow — accentuates the active burning front
      map.addLayer({
        id: 'sim-fill-leading',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 1],
        paint: {
          'fill-color': 'rgba(251, 146, 60, 0.15)',
        }
      }, beforeId);

      // Isochrone contour outlines for each hour of progression
      map.addLayer({
        id: 'sim-outline',
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['get', 'timeframe_hours'],
            1, '#b45309',
            6, '#d97706',
            12, '#f59e0b',
            18, '#fbbf24',
            24, '#fef08a',
          ],
          'line-width': 1.6,
          'line-opacity': 0.85,
        }
      }, beforeId);

      // Bright animated leading edge outline
      map.addLayer({
        id: 'sim-outline-leading',
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 1],
        paint: {
          'line-color': '#f97316',
          'line-width': 3.5,
          'line-dasharray': [4, 4],
        }
      }, beforeId);
    }

    if (visibleData.features.length > 0) {
      // Update leading edge filter to match current playback hour (prevents stacking 24 overlapping fills)
      if (leadingHour !== null) {
        if (map.getLayer('sim-fill-burned')) {
          map.setFilter('sim-fill-burned', ['==', ['get', 'timeframe_hours'], leadingHour]);
        }
        if (map.getLayer('sim-fill-leading')) {
          map.setFilter('sim-fill-leading', ['==', ['get', 'timeframe_hours'], leadingHour]);
        }
        if (map.getLayer('sim-outline-leading')) {
          map.setFilter('sim-outline-leading', ['==', ['get', 'timeframe_hours'], leadingHour]);
        }
      }

      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(visibleData);

      // Animate leading edge dash
      let step = 0;
      const animateDashArray = () => {
        step = (step + 1) % 8;
        if (map.getLayer('sim-outline-leading')) {
          map.setPaintProperty('sim-outline-leading', 'line-dasharray', [4, 4, step, 8 - step]);
        }
        animationRef.current = requestAnimationFrame(animateDashArray);
      };
      animateDashArray();

      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    } else {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: [] });
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [map, visibleData, leadingHour]);

  return null;
}
