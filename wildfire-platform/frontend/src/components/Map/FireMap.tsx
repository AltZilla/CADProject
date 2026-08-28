import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '@/store/appStore';
import { MapContext } from './MapContext';
import HotspotLayer from './HotspotLayer';
import SimulationLayer from './SimulationLayer';
import AlertZoneLayer from './AlertZoneLayer';
import HotspotPopup from '../Panel/HotspotInfoPanel';
import SimulationResultPanel from '../Panel/SimulationResultPanel';

export default function FireMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);

  const setMapBbox = useAppStore(s => s.setMapBbox);
  const isPickingOrigin = useAppStore(s => s.isPickingOrigin);
  const setIsPickingOrigin = useAppStore(s => s.setIsPickingOrigin);
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const isDrawingZone = useAppStore(s => s.isDrawingZone);
  const addDrawnZonePoint = useAppStore(s => s.addDrawnZonePoint);
  const selectedHotspot = useAppStore(s => s.selectedHotspot);

  useEffect(() => {
    if (!mapRef.current || mapInstance) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: import.meta.env.VITE_MAP_STYLE || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-110, 40],
      zoom: 4,
      attributionControl: { compact: false },
    });

    map.on('load', () => {
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', '#0f172a');
      }
      setMapInstance(map);
      updateBbox();
    });

    let timeout: number;
    const updateBbox = () => {
      const bounds = map.getBounds();
      setMapBbox([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
    };

    const handleMove = () => {
      clearTimeout(timeout);
      timeout = window.setTimeout(updateBbox, 500);
    };

    map.on('moveend', handleMove);
    map.on('zoomend', handleMove);

    map.on('click', (e) => {
      if (useAppStore.getState().isPickingOrigin) {
        setSimulationRequest({ origin: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] } });
        setIsPickingOrigin(false);
      } else if (useAppStore.getState().isDrawingZone) {
        addDrawnZonePoint([e.lngLat.lng, e.lngLat.lat]);
      }
    });

    return () => {
      clearTimeout(timeout);
      map.remove();
    };
  }, []);

  return (
    <div className="w-full h-full relative" ref={mapRef}>
      {mapInstance && (
        <MapContext.Provider value={mapInstance}>
          <HotspotLayer />
          <SimulationLayer />
          <AlertZoneLayer />
          {selectedHotspot && <HotspotPopup />}
        </MapContext.Provider>
      )}
      <div className="absolute bottom-6 right-2 text-xs text-slate-500 pointer-events-none z-10">
        Wildfire Platform Map
      </div>
      <SimulationResultPanel />
    </div>
  );
}

