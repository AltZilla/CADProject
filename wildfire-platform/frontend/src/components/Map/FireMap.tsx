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
import MapContextMenu from './MapContextMenu';
import MapToolbar from './MapToolbar';
import TimelineControls from '../Simulation/TimelineControls';
import IncidentShowcase from '../Simulation/IncidentShowcase';
import WindCompass from './WindCompass';

export default function FireMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [is3D, setIs3D] = useState(false);

  const setMapBbox = useAppStore(s => s.setMapBbox);
  const isPickingOrigin = useAppStore(s => s.isPickingOrigin);
  const setIsPickingOrigin = useAppStore(s => s.setIsPickingOrigin);
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const isDrawingZone = useAppStore(s => s.isDrawingZone);
  const addDrawnZonePoint = useAppStore(s => s.addDrawnZonePoint);
  const selectedHotspot = useAppStore(s => s.selectedHotspot);
  const setContextMenuPos = useAppStore(s => s.setContextMenuPos);
  const simulationResult = useAppStore(s => s.simulationResult);

  useEffect(() => {
    if (!mapRef.current || mapInstance) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: import.meta.env.VITE_MAP_STYLE || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-110, 40],
      zoom: 4,
      maxPitch: 70,
      attributionControl: { compact: false },
    });

    map.on('load', () => {
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', '#0f172a');
      }

      // 3D Terrain source (AWS Terrain RGB — free, no key)
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });

      // Hillshade layer — always visible for depth perception
      map.addSource('hillshade-source', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });
      map.addLayer({
        id: 'hillshade-layer',
        type: 'hillshade',
        source: 'hillshade-source',
        paint: {
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#334155',
          'hillshade-accent-color': '#1e293b',
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': 0.3,
        },
      }, map.getStyle().layers.find(l => l.type === 'symbol')?.id);

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

    map.on('contextmenu', (e) => {
      if (useAppStore.getState().isDrawingZone) return;
      e.preventDefault();
      const point = map.project(e.lngLat);
      setContextMenuPos({
        x: point.x,
        y: point.y,
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
      });
    });

    return () => {
      clearTimeout(timeout);
      map.remove();
    };
  }, []);

  // Toggle 3D terrain on/off
  const toggle3D = () => {
    if (!mapInstance) return;
    if (is3D) {
      mapInstance.setTerrain(undefined as any);
      mapInstance.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      setIs3D(false);
    } else {
      mapInstance.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
      mapInstance.easeTo({ pitch: 55, duration: 800 });
      setIs3D(true);
    }
  };

  // Auto-pitch into 3D when simulation result arrives
  useEffect(() => {
    if (!mapInstance || !simulationResult) return;
    const windDir = simulationResult.metadata?.wind_direction_deg;
    if (windDir !== undefined && !is3D) {
      mapInstance.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
      // Rotate camera to look downwind
      const bearing = (windDir + 180) % 360;
      mapInstance.easeTo({ pitch: 50, bearing, duration: 1200 });
      setIs3D(true);
    }
  }, [simulationResult]);

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
      <MapContextMenu />
      <MapToolbar is3D={is3D} onToggle3D={toggle3D} />
      <WindCompass />
      <IncidentShowcase />
      <TimelineControls />
      <SimulationResultPanel />
    </div>
  );
}
