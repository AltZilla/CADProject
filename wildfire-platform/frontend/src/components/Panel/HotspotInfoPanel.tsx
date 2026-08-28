import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMap } from '../Map/MapContext';
import { useAppStore } from '@/store/appStore';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, LiveWeather } from '@/api/weather';
import { Flame, X, Wind, Thermometer, Droplets, Zap } from 'lucide-react';
import Button from '../UI/Button';
import Badge from '../UI/Badge';

export default function HotspotInfoPanel() {
  const map = useMap();
  const hotspot = useAppStore(s => s.selectedHotspot);
  const setSelectedHotspot = useAppStore(s => s.setSelectedHotspot);
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const { runSim } = useSimulation();
  const loading = useAppStore(s => s.simulationLoading);

  const [weather, setWeather] = useState<LiveWeather | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-fetch live Open-Meteo weather whenever a hotspot is selected
  useEffect(() => {
    if (!hotspot) {
      setWeather(null);
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
    const req = {
      origin: { type: 'Point' as const, coordinates: [hotspot.longitude, hotspot.latitude] as [number, number] },
      wind_speed_ms: weather ? weather.wind_speed_ms : 5.0,
      wind_direction_deg: weather ? weather.wind_direction_deg : 225.0,
      fuel_type: 'SHRUB_CHAPARRAL' as const,
      hours: 24 as const
    };
    setSimulationRequest(req);
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
            <h4 className="font-semibold text-slate-100 text-xs">NASA FIRMS Active Fire</h4>
            <p className="text-[10px] text-slate-400">{hotspot.satellite} · {hotspot.instrument}</p>
          </div>
          <button onClick={() => setSelectedHotspot(null)} className="ml-auto text-slate-400 hover:text-slate-200">
            <X size={14} />
          </button>
        </div>

        {/* Hotspot Satellite Readings */}
        <div className="space-y-1 text-slate-300 text-xs mb-3">
          <div className="flex justify-between py-0.5">
            <span className="text-slate-400">Coordinates:</span>
            <span className="font-mono text-slate-200">
              {(hotspot.latitude ?? hotspot.lat ?? 0).toFixed(4)}°, {(hotspot.longitude ?? hotspot.lon ?? 0).toFixed(4)}°
            </span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-slate-400">Fire Radiative Power:</span>
            <span className="font-semibold text-orange-400 flex items-center gap-1">
              ⚡ {(hotspot.frp ?? hotspot.total_frp ?? 0).toFixed(1)} MW <Badge confidence={hotspot.confidence ?? 80} />
            </span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-slate-400">Brightness Temp:</span>
            <span>{(hotspot.brightness ?? 330).toFixed(1)} K</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-slate-400">Detection Time:</span>
            <span>
              {(() => {
                if (!hotspot.acq_datetime) return 'Recent';
                const d = new Date(hotspot.acq_datetime);
                return isNaN(d.getTime()) ? String(hotspot.acq_datetime) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              })()} ({hotspot.daynight === 'D' ? 'Day' : 'Night'})
            </span>
          </div>
        </div>

        {/* Live Weather Card (Open-Meteo) */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-2.5 mb-3 text-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300 mb-1.5">
            <span className="flex items-center gap-1 text-cyan-400">
              <Wind size={13} /> Live Weather (Open-Meteo)
            </span>
            {loadingWeather && <span className="text-[10px] text-slate-500 animate-pulse">Fetching...</span>}
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
        </div>

        {/* 1-Click Auto Simulation Button */}
        <Button 
          size="sm" 
          className="w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-medium py-2 shadow-lg shadow-orange-500/20" 
          onClick={handleAutoSimulate}
          loading={loading}
        >
          <Zap size={14} className="mr-1.5 fill-current" /> Auto-Simulate Spread Forecast
        </Button>
      </div>
    </div>
  );
}
