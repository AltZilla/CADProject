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
    }

    (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features
    });
  }, [map, alertZones, isDrawingZone, drawnZonePoints]);

  return null;
}
