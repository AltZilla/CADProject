import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useMap } from './MapContext';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';
import type { FireClass } from '@/types/hotspot';
import { classifyHotspot } from '@/utils/classifyHotspot';

/**
 * AreaSelectOverlay renders an interactive rectangle drag selection
 * on top of the map when `isDrawingArea` is active. On mouse-up,
 * it finds all hotspots inside the rectangle and sets them as the
 * active multi-point ignition origins for fire spread forecast.
 */
export default function AreaSelectOverlay() {
  const map = useMap();
  const isDrawingArea = useAppStore((s) => s.isDrawingArea);
  const setIsDrawingArea = useAppStore((s) => s.setIsDrawingArea);
  const setSelectedGroupHotspots = useAppStore((s) => s.setSelectedGroupHotspots);
  const setDetectedFuelType = useAppStore((s) => s.setDetectedFuelType);
  const setSimulationRequest = useAppStore((s) => s.setSimulationRequest);
  const activeFireClasses = useAppStore((s) => s.activeFireClasses);
  const { data } = useHotspots();

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Disable map drag-pan and set crosshair cursor while in area-select mode
  useEffect(() => {
    if (!map) return;
    if (isDrawingArea) {
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'crosshair';
    } else {
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
      setDragStart(null);
      setDragCurrent(null);
    }
    return () => {
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    };
  }, [map, isDrawingArea]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDrawingArea) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragCurrent(null);
  }, [isDrawingArea]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawingArea || !dragStart) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [isDrawingArea, dragStart]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDrawingArea || !dragStart || !map) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const endX = rect ? e.clientX - rect.left : dragStart.x;
    const endY = rect ? e.clientY - rect.top : dragStart.y;

    // Require a minimum drag of 8px to avoid accidental clicks
    if (Math.abs(dragStart.x - endX) < 8 && Math.abs(dragStart.y - endY) < 8) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    // Convert pixel corners to geographical coordinates
    const sw = map.unproject([Math.min(dragStart.x, endX), Math.max(dragStart.y, endY)]);
    const ne = map.unproject([Math.max(dragStart.x, endX), Math.min(dragStart.y, endY)]);

    const minLon = Math.min(sw.lng, ne.lng);
    const maxLon = Math.max(sw.lng, ne.lng);
    const minLat = Math.min(sw.lat, ne.lat);
    const maxLat = Math.max(sw.lat, ne.lat);

    // Find all hotspots inside the drawn bounding box
    const features = data?.features || [];
    const pointsMap = new Map<string, [number, number]>();

    features.forEach((f: any) => {
      const coords = f.geometry?.coordinates;
      if (!coords || !Array.isArray(coords)) return;
      const lon = coords[0];
      const lat = coords[1];

      if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
        const props = f.properties || {};
        const fireClass: FireClass = props.fire_class ?? classifyHotspot(props).fire_class;
        // Only select hotspots that belong to currently active/visible fire classes
        if (!activeFireClasses.has(fireClass)) return;

        // Deduplicate coordinates within ~100m to prevent redundant origin cells
        const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
        if (!pointsMap.has(key)) {
          pointsMap.set(key, [lon, lat]);
        }
      }
    });

    const selectedPoints = Array.from(pointsMap.values());

    if (selectedPoints.length > 0) {
      // 1. Immediately store all selected points
      setSelectedGroupHotspots(selectedPoints);

      // 2. Compute geographic center of selected cluster
      const centerLon = selectedPoints.reduce((acc, p) => acc + p[0], 0) / selectedPoints.length;
      const centerLat = selectedPoints.reduce((acc, p) => acc + p[1], 0) / selectedPoints.length;

      // 3. Auto-fetch live Open-Meteo weather for the selected region
      fetchLiveWeather(centerLat, centerLon).then((weather) => {
        const autoFuel = detectFuelType(weather);
        setDetectedFuelType(autoFuel);
        setSimulationRequest({
          origins: selectedPoints,
          origin: selectedPoints.length === 1
            ? { type: 'Point', coordinates: selectedPoints[0] }
            : { type: 'MultiPoint', coordinates: selectedPoints },
          wind_speed_ms: weather.wind_speed_ms,
          wind_direction_deg: weather.wind_direction_deg,
          fuel_type: autoFuel,
        });
      });

      // 4. Close selection mode
      setIsDrawingArea(false);
    } else {
      setToastMessage('No visible hotspots found in the selected box matching your active filters.');
      setTimeout(() => setToastMessage(null), 3500);
    }

    setDragStart(null);
    setDragCurrent(null);
  }, [isDrawingArea, dragStart, map, data, activeFireClasses, setSelectedGroupHotspots, setDetectedFuelType, setSimulationRequest, setIsDrawingArea]);

  if (!isDrawingArea && !toastMessage) return null;

  // Compute visual bounding box dimensions
  const box = dragStart && dragCurrent ? {
    left: Math.min(dragStart.x, dragCurrent.x),
    top: Math.min(dragStart.y, dragCurrent.y),
    width: Math.abs(dragCurrent.x - dragStart.x),
    height: Math.abs(dragCurrent.y - dragStart.y),
  } : null;

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-30 ${isDrawingArea ? 'select-none pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Visual bounding rectangle while dragging */}
      {box && box.width > 2 && box.height > 2 && (
        <div
          className="absolute border-2 border-cyan-400 bg-cyan-400/15 backdrop-blur-[1px] shadow-2xl rounded-sm pointer-events-none transition-all duration-75"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          }}
        >
          <div className="absolute -top-7 left-0 bg-slate-900/90 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold px-2 py-0.5 rounded shadow-lg flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            Selecting Area ({Math.round(box.width)}×{Math.round(box.height)}px)
          </div>
        </div>
      )}

      {/* Floating instructional pill when area tool is activated */}
      {isDrawingArea && !dragStart && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-cyan-500/60 rounded-full px-4 py-2 shadow-2xl text-cyan-300 text-xs font-semibold flex items-center gap-2 animate-bounce pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Click and drag a box across the map to select all hotspots in that region
        </div>
      )}

      {/* Toast message if zero hotspots were captured */}
      {toastMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-red-900/95 border border-red-500 text-red-100 text-xs font-medium px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in">
          ⚠️ {toastMessage}
        </div>
      )}
    </div>
  );
}
