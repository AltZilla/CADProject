import { useEffect, useRef } from 'react';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';

export default function HotspotLayer() {
  const map = useMap();
  const setSelectedHotspot = useAppStore((s) => s.setSelectedHotspot);
  const { data } = useHotspots();
  const sourceId = 'hotspots-source';
  const heatmapLayerId = 'hotspots-heatmap';
  const circleLayerId = 'hotspots-circle';

  useEffect(() => {
    if (!map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: heatmapLayerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 6,
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
          'heatmap-opacity': 0.85,
        }
      });

      map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: 6,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 10],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'frp'],
            0, '#fef08a',
            50, '#fb923c',
            200, '#ef4444'
          ],
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.5,
        }
      });

      map.on('click', circleLayerId, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          setSelectedHotspot(feature.properties as any);
        }
      });

      map.on('mouseenter', circleLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', circleLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    return () => {
      // Cleanup handled on map remove
    };
  }, [map, setSelectedHotspot]);

  useEffect(() => {
    if (map && data && map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(data);
    }
  }, [map, data]);

  return null;
}
