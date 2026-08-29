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

      // Burned interior — all hours behind the leading edge
      map.addLayer({
        id: 'sim-fill-burned',
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'timeframe_hours'],
            1, 'rgba(120,53,15,0.35)',      // dark brown — earliest burn
            6, 'rgba(180,83,9,0.30)',
            12, 'rgba(217,119,6,0.30)',
            18, 'rgba(234,179,8,0.25)',
            24, 'rgba(253,224,71,0.20)',      // faded yellow — recent
          ],
        }
      });

      // Leading edge glow — only the current hour perimeter
      map.addLayer({
        id: 'sim-fill-leading',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 24],
        paint: {
          'fill-color': 'rgba(251,146,60,0.45)',
        }
      });

      // Outline for all visible perimeters
      map.addLayer({
        id: 'sim-outline',
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': [
            'interpolate', ['linear'], ['get', 'timeframe_hours'],
            1, '#92400e',
            6, '#d97706',
            12, '#f59e0b',
            18, '#fbbf24',
            24, '#fef08a',
          ],
          'line-width': [
            'case',
            ['==', ['get', 'timeframe_hours'], 24], 3,
            1.2
          ],
          'line-opacity': [
            'interpolate', ['linear'], ['get', 'timeframe_hours'],
            1, 0.3,
            24, 0.9,
          ],
        }
      });

      // Bright leading edge outline
      map.addLayer({
        id: 'sim-outline-leading',
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 24],
        paint: {
          'line-color': '#fb923c',
          'line-width': 3,
          'line-dasharray': [4, 4],
        }
      });
    }

    if (visibleData.features.length > 0) {
      // Update leading edge filter to match current playback hour
      if (leadingHour !== null) {
        map.setFilter('sim-fill-leading', ['==', ['get', 'timeframe_hours'], leadingHour]);
        map.setFilter('sim-outline-leading', ['==', ['get', 'timeframe_hours'], leadingHour]);
      }

      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(visibleData);
      
      // Fit bounds on first render (full result, not just visible)
      if (simulationResult?.perimeters) {
        const bounds = new maplibregl.LngLatBounds();
        let hasCoords = false;
        simulationResult.perimeters.features.forEach(f => {
          const geom = f.geometry;
          if (geom.type === 'Polygon') {
            geom.coordinates[0].forEach(coord => {
              bounds.extend([coord[0], coord[1]]);
              hasCoords = true;
            });
          } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => {
              poly[0].forEach(coord => {
                bounds.extend([coord[0], coord[1]]);
                hasCoords = true;
              });
            });
          }
        });
        // Only fit bounds when playback is at max (avoid constant re-fitting during playback)
        if (hasCoords && playbackHour >= 24) {
          map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
        }
      }

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
