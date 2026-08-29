import { useEffect } from 'react';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import maplibregl from 'maplibre-gl';

export default function AlertZoneLayer() {
  const map = useMap();
  const alertZones = useAppStore(s => s.alertZones);
  const isDrawingZone = useAppStore(s => s.isDrawingZone);
  const drawnZonePoints = useAppStore(s => s.drawnZonePoints);

  useEffect(() => {
    if (!map) return;
    const sourceId = 'alert-zones-source';
    
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'alert-zones-fill',
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#f97316',
          'fill-opacity': 0.2,
        }
      });

      map.addLayer({
        id: 'alert-zones-line',
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#f97316',
          'line-width': 2,
          'line-dasharray': [2, 2]
        }
      });

      map.addLayer({
        id: 'alert-zone-drawing-points',
        type: 'circle',
        source: sourceId,
        filter: ['==', ['get', 'drawingPoint'], true],
        paint: {
          'circle-color': '#f97316',
          'circle-radius': 5,
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 2,
        }
      });

      map.addLayer({
        id: 'alert-zone-drawing-labels',
        type: 'symbol',
        source: sourceId,
        filter: ['==', ['get', 'drawingPoint'], true],
        layout: {
          'text-field': ['to-string', ['get', 'pointIndex']],
          'text-size': 11,
          'text-offset': [0, -1.25],
          'text-anchor': 'bottom',
        },
        paint: {
          'text-color': '#fed7aa',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.5,
        }
      });
    }

    const features: any[] = alertZones.map(zone => ({
      type: 'Feature',
      properties: { id: zone.zone_id, name: zone.name },
      geometry: zone.geometry
    }));

    if (isDrawingZone && drawnZonePoints.length > 0) {
      let geometry: GeoJSON.Geometry;
      if (drawnZonePoints.length === 1) {
        geometry = { type: 'Point', coordinates: drawnZonePoints[0] };
      } else if (drawnZonePoints.length === 2) {
        geometry = { type: 'LineString', coordinates: drawnZonePoints };
      } else {
        const coords = [...drawnZonePoints, drawnZonePoints[0]]; // close the ring
        geometry = { type: 'Polygon', coordinates: [coords] };
      }

      features.push({
        type: 'Feature',
        properties: { drawing: true },
        geometry
      });

      drawnZonePoints.forEach((point, index) => {
        features.push({
          type: 'Feature',
          properties: { drawingPoint: true, pointIndex: index + 1 },
          geometry: { type: 'Point', coordinates: point }
        });
      });
    }

    (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features
    });
  }, [map, alertZones, isDrawingZone, drawnZonePoints]);

  return null;
}
