import { useEffect, useRef } from 'react';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import maplibregl from 'maplibre-gl';

export default function SimulationLayer() {
  const map = useMap();
  const simulationResult = useAppStore((s) => s.simulationResult);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!map) return;

    const sourceId = 'sim-source';
    
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Layer 6h
      map.addLayer({
        id: 'sim-fill-6h',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 6],
        paint: {
          'fill-color': 'rgba(254,240,138,0.25)',
        }
      });
      map.addLayer({
        id: 'sim-outline-6h',
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 6],
        paint: {
          'line-color': '#fef08a',
          'line-width': 2,
        }
      });

      // Layer 12h
      map.addLayer({
        id: 'sim-fill-12h',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 12],
        paint: {
          'fill-color': 'rgba(251,146,60,0.30)',
        }
      });
      map.addLayer({
        id: 'sim-outline-12h',
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 12],
        paint: {
          'line-color': '#fb923c',
          'line-width': 2,
        }
      });

      // Layer 24h
      map.addLayer({
        id: 'sim-fill-24h',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 24],
        paint: {
          'fill-color': 'rgba(239,68,68,0.35)',
        }
      });
      map.addLayer({
        id: 'sim-outline-24h',
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'timeframe_hours'], 24],
        paint: {
          'line-color': '#ef4444',
          'line-width': 2,
          'line-dasharray': [4, 4],
        }
      });
    }

    if (simulationResult) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(simulationResult.perimeters);
      
      // Calculate bbox natively without turf
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

      if (hasCoords) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }

      // Animate 24h dash
      let step = 0;
      const animateDashArray = () => {
        step = (step + 1) % 8;
        if (map.getLayer('sim-outline-24h')) {
          map.setPaintProperty('sim-outline-24h', 'line-dasharray', [4, 4, step, 8 - step]);
        }
        animationRef.current = requestAnimationFrame(animateDashArray);
      };
      animateDashArray();

      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    } else {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  }, [map, simulationResult]);

  return null;
}
