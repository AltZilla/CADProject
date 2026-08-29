import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';

export default function HotspotLayer() {
  const map = useMap();
  const setSelectedHotspot = useAppStore((s) => s.setSelectedHotspot);
  const setSimulationRequest = useAppStore((s) => s.setSimulationRequest);
  const setDetectedFuelType = useAppStore((s) => s.setDetectedFuelType);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const { data } = useHotspots();
  const { runSim } = useSimulation();
  const sourceId = 'hotspots-source';
  const heatmapLayerId = 'hotspots-heatmap';
  const circleLayerId = 'hotspots-circle';
  const clusterPopupRef = useRef<maplibregl.Popup | null>(null);

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

      map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        minzoom: 5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 8, 5, 12, 10],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'frp'],
            0, '#fef08a',
            50, '#fb923c',
            200, '#ef4444'
          ],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 0.9],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.5,
        }
      });

      // Circle click — select individual hotspot
      map.on('click', circleLayerId, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          setSelectedHotspot(feature.properties as any);
        }
      });

      // Heatmap click — show cluster popup
      map.on('click', heatmapLayerId, (e) => {
        // Query nearby features from the source layer
        const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - 30, e.point.y - 30],
          [e.point.x + 30, e.point.y + 30]
        ];
        const features = map.queryRenderedFeatures(bbox, { layers: [circleLayerId] });
        
        // If we got individual circle features, show cluster summary
        // If not (too zoomed out for circles), use the heatmap point count
        const count = features.length || 'Multiple';
        
        let maxFrp = 0;
        let hottestFeature: any = null;
        
        if (features.length > 0) {
          features.forEach(f => {
            const frp = f.properties?.frp ?? 0;
            if (frp > maxFrp) {
              maxFrp = frp;
              hottestFeature = f.properties;
            }
          });
        }
        
        // Remove existing popup
        clusterPopupRef.current?.remove();
        
        const container = document.createElement('div');
        container.className = 'text-xs';
        container.innerHTML = `
          <div style="background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 10px; min-width: 180px; font-family: system-ui;">
            <div style="font-weight: 600; color: #fb923c; margin-bottom: 6px; font-size: 12px;">🔥 Fire Cluster</div>
            <div style="color: #94a3b8; margin-bottom: 4px;">Hotspots detected: <strong style="color: #e2e8f0;">${count}</strong></div>
            ${maxFrp > 0 ? `<div style="color: #94a3b8; margin-bottom: 8px;">Highest FRP: <strong style="color: #fb923c;">⚡ ${maxFrp.toFixed(1)} MW</strong></div>` : ''}
            ${hottestFeature ? `<button id="sim-hottest-btn" style="width: 100%; padding: 6px 10px; background: linear-gradient(to right, #f97316, #dc2626); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">⚡ Simulate from Hottest</button>` : ''}
          </div>
        `;
        
        clusterPopupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          anchor: 'bottom',
          offset: 10,
        })
          .setLngLat(e.lngLat)
          .setDOMContent(container)
          .addTo(map);
        
        // Attach click handler to simulate button
        if (hottestFeature) {
          setTimeout(() => {
            const btn = document.getElementById('sim-hottest-btn');
            if (btn) {
              btn.addEventListener('click', async () => {
                clusterPopupRef.current?.remove();
                const lat = hottestFeature.latitude ?? hottestFeature.lat ?? e.lngLat.lat;
                const lon = hottestFeature.longitude ?? hottestFeature.lon ?? e.lngLat.lng;
                const origin = { type: 'Point' as const, coordinates: [lon, lat] as [number, number] };
                
                const weather = await fetchLiveWeather(lat, lon);
                const autoFuel = detectFuelType(weather);
                setDetectedFuelType(autoFuel);
                
                const request = {
                  origin,
                  wind_speed_ms: weather.wind_speed_ms,
                  wind_direction_deg: weather.wind_direction_deg,
                  fuel_type: autoFuel,
                  hours: 24 as const,
                };
                setSimulationRequest(request);
                setActiveTab('simulation');
                runSim(request as any);
              });
            }
          }, 50);
        }
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
  }, [map, setSelectedHotspot]);

  useEffect(() => {
    if (map && data && map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(data);
    }
  }, [map, data]);

  return null;
}
