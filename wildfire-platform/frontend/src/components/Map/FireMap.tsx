import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '@/store/appStore';
import { MapContext } from './MapContext';
import HotspotLayer from './HotspotLayer';
import SimulationLayer from './SimulationLayer';
import AlertZoneLayer from './AlertZoneLayer';
import HotspotPopup from '../Panel/HotspotInfoPanel';
import MapContextMenu from './MapContextMenu';
import MapToolbar from './MapToolbar';
import AreaSelectOverlay from './AreaSelectOverlay';
import TimelineControls from '../Simulation/TimelineControls';
import IncidentShowcase from '../Simulation/IncidentShowcase';
import WindCompass from './WindCompass';
import { DEFAULT_MAP_PROJECTION, getProjectionSpecification, type MapProjection } from './mapProjection.js';

export default function FireMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [projection, setProjection] = useState<MapProjection>(DEFAULT_MAP_PROJECTION);

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

    const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY?.trim();
    const mapTilerStyleId = import.meta.env.VITE_MAPTILER_STYLE_ID?.trim() || 'streets-v4';
    const mapStyle = import.meta.env.VITE_MAP_STYLE?.trim() || (mapTilerKey
      ? `https://api.maptiler.com/maps/${encodeURIComponent(mapTilerStyleId)}/style.json?key=${encodeURIComponent(mapTilerKey)}`
      : 'https://tiles.openfreemap.org/styles/liberty');

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [-20, 20],
      zoom: 1.7,
      maxZoom: 22,
      maxPitch: 70,
      dragPan: {
        linearity: 0.25,
        maxSpeed: 1400,
        deceleration: 2500,
        easing: (t) => t * (2 - t),
      },
      attributionControl: { compact: false },
    });
    map.on('error', (event) => {
      const message = event.error?.message?.replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
      console.error('[MapLibre]', message || 'Map resource failed to load');
    });
    map.scrollZoom.setWheelZoomRate(1 / 600);

    map.on('load', () => {
      // 3D Terrain & Hillshade DEM source (AWS Terrarium — global elevation)
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });

      // Keep relief subtle on the road basemap; 3D terrain is enabled on demand.
      map.addLayer({
        id: 'hillshade-layer',
        type: 'hillshade',
        source: 'terrain-dem',
        paint: {
          'hillshade-shadow-color': '#778277',
          'hillshade-highlight-color': '#f7faf7',
          'hillshade-accent-color': '#a6b3a7',
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': 0.04,
        },
      }, map.getStyle().layers.find(l => l.type === 'symbol')?.id);

      setMapInstance(map);
      updateBbox();
    });

    let timeout: number;
    const updateBbox = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      const zoom = map.getZoom();

      let west = bounds.getWest();
      let south = bounds.getSouth();
      let east = bounds.getEast();
      let north = bounds.getNorth();

      // If camera is pitched or zoomed in, prevent distant horizon from inflating bounding box to continental size
      if (zoom >= 6) {
        const maxSpanDeg = Math.min(25, 360 / Math.pow(1.85, zoom - 1));
        west = Math.max(west, center.lng - maxSpanDeg);
        east = Math.min(east, center.lng + maxSpanDeg);
        south = Math.max(south, center.lat - maxSpanDeg);
        north = Math.min(north, center.lat + maxSpanDeg);
      }

      const min_lon = Math.min(west, east);
      const max_lon = Math.max(west, east);
      const min_lat = Math.max(-85, Math.min(south, north));
      const max_lat = Math.min(85, Math.max(south, north));
      setMapBbox([min_lon, min_lat, max_lon, max_lat]);
    };

    const handleMove = () => {
      clearTimeout(timeout);
      timeout = window.setTimeout(updateBbox, 600);
    };

    map.on('moveend', handleMove);
    map.on('zoomend', handleMove);

    map.on('click', (e) => {
      if (useAppStore.getState().isPickingOrigin) {
        useAppStore.getState().clearGroupHotspots();
        setSimulationRequest({
          origins: undefined,
          origin: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] },
        });
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

  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.setProjection(getProjectionSpecification(projection));
  }, [mapInstance, projection]);

  // Toggle 3D terrain on/off
  const toggle3D = () => {
    if (!mapInstance) return;
    if (is3D) {
      mapInstance.setTerrain(undefined as any);
      mapInstance.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      setIs3D(false);
    } else {
      mapInstance.setTerrain({ source: 'terrain-dem', exaggeration: 1.15 });
      mapInstance.easeTo({ pitch: 52, duration: 800 });
      setIs3D(true);
    }
  };

  // Seamlessly fly camera to fire simulation, zoom in, and pitch into 3D
  useEffect(() => {
    if (!mapInstance || !simulationResult) return;

    // Enable 3D terrain elevation with realistic scale
    mapInstance.setTerrain({ source: 'terrain-dem', exaggeration: 1.15 });
    setIs3D(true);

    const windDir = simulationResult.metadata?.wind_direction_deg ?? 0;
    const bearing = (windDir + 180) % 360;

    const bounds = new maplibregl.LngLatBounds();
    let hasCoords = false;

    // 1. Extend with all simulation perimeter coordinates
    const perims = simulationResult.perimeters?.features || [];
    perims.forEach((f) => {
      const geom = f.geometry;
      if (geom.type === 'Polygon') {
        geom.coordinates[0]?.forEach((coord) => {
          bounds.extend([coord[0], coord[1]]);
          hasCoords = true;
        });
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach((poly) => {
          poly[0]?.forEach((coord) => {
            bounds.extend([coord[0], coord[1]]);
            hasCoords = true;
          });
        });
      }
    });

    // 2. Extend with origin point(s)
    const origin = simulationResult.metadata?.origin;
    let fallbackCenter: [number, number] | null = null;
    if (origin) {
      if (origin.type === 'Point' && Array.isArray(origin.coordinates)) {
        bounds.extend(origin.coordinates as [number, number]);
        fallbackCenter = origin.coordinates as [number, number];
        hasCoords = true;
      } else if (origin.type === 'MultiPoint' && Array.isArray(origin.coordinates)) {
        (origin.coordinates as [number, number][]).forEach((pt) => {
          bounds.extend(pt);
          hasCoords = true;
        });
        if (origin.coordinates.length > 0) {
          fallbackCenter = origin.coordinates[0] as [number, number];
        }
      }
    }

    if (hasCoords) {
      // Pad bounds outward slightly so the entire perimeter is beautifully framed
      const center = bounds.getCenter();
      const spanLon = Math.max(0.04, Math.abs(bounds.getEast() - bounds.getWest()) * 1.5);
      const spanLat = Math.max(0.04, Math.abs(bounds.getNorth() - bounds.getSouth()) * 1.5);

      bounds.extend([center.lng - spanLon / 2, center.lat - spanLat / 2]);
      bounds.extend([center.lng + spanLon / 2, center.lat + spanLat / 2]);

      mapInstance.fitBounds(bounds, {
        padding: { top: 90, bottom: 90, left: 380, right: 90 },
        pitch: 52,
        bearing: bearing,
        duration: 1800,
        maxZoom: 13.5,
      });
    } else if (fallbackCenter) {
      mapInstance.flyTo({
        center: fallbackCenter,
        zoom: 12.5,
        pitch: 52,
        bearing: bearing,
        duration: 1800,
      });
    }
  }, [simulationResult?.sim_id]);

  return (
    <div className="w-full h-full relative" ref={mapRef}>
      {mapInstance && (
        <MapContext.Provider value={mapInstance}>
          <HotspotLayer />
          <SimulationLayer />
          <AlertZoneLayer />
          {selectedHotspot && <HotspotPopup />}
          <AreaSelectOverlay />
        </MapContext.Provider>
      )}
      <MapContextMenu />
      <MapToolbar
        is3D={is3D}
        onToggle3D={toggle3D}
        projection={projection}
        onProjectionChange={setProjection}
      />
      <WindCompass />
      <IncidentShowcase />
      <TimelineControls />
    </div>
  );
}
