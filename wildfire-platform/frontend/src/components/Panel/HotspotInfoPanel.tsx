import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMap } from '../Map/MapContext';
import { useAppStore } from '@/store/appStore';
import { useSimulation } from '@/hooks/useSimulation';
import { detectFuelType, fetchLiveWeather, LiveWeather } from '@/api/weather';
import { Flame, X, Wind, Thermometer, Droplets, Zap } from 'lucide-react';
import Button from '../UI/Button';
import Badge from '../UI/Badge';
import { formatPoint } from '@/utils/geo';

import { useHotspots } from '@/hooks/useHotspots';
import { findFireComplex } from '@/utils/clustering';
import { getDetectionCount, getHotspotDisplayKind, getHotspotFrp } from '@/utils/hotspotPresentation.js';

export default function HotspotInfoPanel() {
  const map = useMap();
  const hotspot = useAppStore(s => s.selectedHotspot);
  const setSelectedHotspot = useAppStore(s => s.setSelectedHotspot);
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const { data } = useHotspots();
  const { runSim } = useSimulation();
  const loading = useAppStore(s => s.simulationLoading);

  const [weather, setWeather] = useState<LiveWeather | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const complex = React.useMemo(() => {
    if (!hotspot) return null;
    if (getHotspotDisplayKind(hotspot) === 'aggregate') return null;
    const detections = (data?.features || []).filter((feature) => feature.properties.clustered !== true);
    return findFireComplex(hotspot.longitude, hotspot.latitude, detections, 12.0);
  }, [hotspot, data]);

  // Auto-fetch live Open-Meteo weather whenever a hotspot is selected
  useEffect(() => {
    if (!hotspot) {
      setWeather(null);
      return;
    }
    if (getHotspotDisplayKind(hotspot) === 'aggregate') {
      setWeather(null);
      setLoadingWeather(false);
      return;
    }

    let isMounted = true;
    setLoadingWeather(true);
    fetchLiveWeather(hotspot.latitude, hotspot.longitude)
      .then(data => {
        if (isMounted) {
          setWeather(data);
          setLoadingWeather(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoadingWeather(false);
      });

    return () => { isMounted = false; };
  }, [hotspot]);

  useEffect(() => {
    if (!map || !hotspot || !containerRef.current) return;

    if (!popupRef.current) {
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        anchor: 'bottom',
        offset: 15,
        maxWidth: '340px'
      });
    }

    popupRef.current
      .setLngLat([hotspot.longitude, hotspot.latitude])
      .setDOMContent(containerRef.current)
      .addTo(map);

    return () => {
      popupRef.current?.remove();
    };
  }, [map, hotspot]);

  if (!hotspot) return null;

  const handleAutoSimulate = () => {
    if (getHotspotDisplayKind(hotspot) === 'aggregate') return;
    const fuelType = weather ? detectFuelType(weather) : 'SHRUB_CHAPARRAL';
    const points = complex?.points && complex.points.length > 0 ? complex.points : [[hotspot.longitude, hotspot.latitude] as [number, number]];
    const req = {
      origins: points,
      origin: points.length === 1 ? { type: 'Point' as const, coordinates: points[0] } : { type: 'MultiPoint' as const, coordinates: points },
      wind_speed_ms: weather ? weather.wind_speed_ms : 5.0,
      wind_direction_deg: weather ? weather.wind_direction_deg : 225.0,
      fuel_type: fuelType,
      hours: 24 as const
    };
    setSelectedHotspot(null);
    useAppStore.getState().setSelectedGroupHotspots(points);
    setSimulationRequest(req);
    setActiveTab('simulation');
    runSim(req);
  };

  return (
    <div className="hidden">
      <div ref={containerRef} className="bg-slate-900/95 backdrop-blur p-3.5 rounded-xl text-sm min-w-64 shadow-2xl border border-slate-700/80 text-slate-100">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
          <div className="p-1 rounded-md bg-orange-500/20 text-orange-400">
            <Flame size={16} />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-xs">
              {getHotspotDisplayKind(hotspot) === 'aggregate' ? 'Aggregated FIRMS detections' : 'NASA FIRMS Active Fire'}
            </h4>
            {getHotspotDisplayKind(hotspot) === 'detection' && (
              <p className="text-[10px] text-slate-400">{[hotspot.satellite, hotspot.instrument].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <button onClick={() => setSelectedHotspot(null)} className="ml-auto text-slate-400 hover:text-slate-200">
            <X size={14} />
          </button>
        </div>

        {/* Hotspot Satellite Readings */}
        <div className="space-y-1 text-slate-300 text-xs mb-3">
          <div className="flex justify-between py-0.5">
            <span className="text-slate-400">{getHotspotDisplayKind(hotspot) === 'aggregate' ? 'Approx. center:' : 'Coordinates:'}</span>
            <span className="font-mono text-slate-200">
              {formatPoint([(hotspot.longitude ?? hotspot.lon ?? 0), (hotspot.latitude ?? hotspot.lat ?? 0)])}
            </span>
          </div>
          {getHotspotDisplayKind(hotspot) === 'aggregate' ? (
            <>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-400">Detections:</span>
                <span>{getDetectionCount(hotspot).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-400">Total FRP:</span>
                <span className="font-semibold text-orange-400">{getHotspotFrp(hotspot).toFixed(1)} MW</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-400">Fire Radiative Power:</span>
                <span className="font-semibold text-orange-400 flex items-center gap-1">
                  {Number.isFinite(hotspot.frp) ? `${hotspot.frp!.toFixed(1)} MW` : 'Unavailable'}
                  {Number.isFinite(hotspot.confidence) && (
                    <>
                      <span className="text-slate-300">{Math.round(hotspot.confidence!)}% confidence</span>
                      <Badge confidence={hotspot.confidence!} />
                    </>
                  )}
                </span>
              </div>
              {Number.isFinite(hotspot.brightness) && (
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-400">Brightness Temp:</span>
                  <span>{hotspot.brightness!.toFixed(1)} K</span>
                </div>
              )}
              <div className="flex justify-between py-0.5">
                <span className="text-slate-400">Detection Time:</span>
                <span>
                  {hotspot.acq_datetime && !Number.isNaN(new Date(hotspot.acq_datetime).getTime())
                    ? new Date(hotspot.acq_datetime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                    : 'Unavailable'}
                  {hotspot.daynight ? ` (${hotspot.daynight === 'D' ? 'Day' : 'Night'})` : ''}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Live Weather Card (Open-Meteo) */}
        {getHotspotDisplayKind(hotspot) === 'detection' && <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-2.5 mb-3 text-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300 mb-1.5">
            <span className="flex items-center gap-1 text-cyan-400">
              <Wind size={13} /> Live Weather (Open-Meteo)
            </span>
            {loadingWeather && <span className="text-[10px] text-slate-500 animate-pulse">Fetching...</span>}
            {weather?.source.includes('Fallback') && <span className="text-[10px] text-amber-300">Fallback</span>}
          </div>
          
          {weather ? (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="bg-slate-900/60 p-1 rounded">
                <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5"><Wind size={10} /> Wind</div>
                <div className="font-semibold text-cyan-300">{weather.wind_speed_kmh} <span className="text-[9px]">km/h</span></div>
                <div className="text-[9px] text-slate-500">{weather.wind_direction_deg}°</div>
              </div>
              <div className="bg-slate-900/60 p-1 rounded">
                <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5"><Thermometer size={10} /> Temp</div>
                <div className="font-semibold text-amber-300">{weather.temperature_c}°C</div>
              </div>
              <div className="bg-slate-900/60 p-1 rounded">
                <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5"><Droplets size={10} /> Humidity</div>
                <div className="font-semibold text-blue-300">{weather.relative_humidity}%</div>
              </div>
            </div>
          ) : (
            <div className="text-slate-400 text-center py-1">Connecting to Open-Meteo station...</div>
          )}
        </div>}

        {/* 1-Click Auto Simulation Button */}
        {getHotspotDisplayKind(hotspot) === 'detection' && (
          <Button
            size="sm"
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-2 text-xs"
            onClick={handleAutoSimulate}
            loading={loading}
          >
            <Zap size={14} className="mr-1.5 fill-current" />
            {complex && complex.count > 1 ? `Simulate Nearby Detections (${complex.count})` : 'Auto-Simulate Spread Forecast'}
          </Button>
        )}
      </div>
    </div>
  );
}
