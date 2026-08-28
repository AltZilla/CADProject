import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, LiveWeather } from '@/api/weather';
import Button from '../UI/Button';
import { MapPin, Flame, Wind, Sparkles, Zap } from 'lucide-react';
import type { FuelType } from '@/types/simulation';

const FUEL_TYPES: { id: FuelType; label: string; icon: string }[] = [
  { id: 'SHRUB_CHAPARRAL', label: 'Chaparral', icon: '🪴' },
  { id: 'GRASS_SHORT', label: 'Short Grass', icon: '🌾' },
  { id: 'GRASS_TALL', label: 'Tall Grass', icon: '🌿' },
  { id: 'SHRUB_LOW', label: 'Low Shrub', icon: '🌱' },
  { id: 'TIMBER_LITTER', label: 'Timber', icon: '🌲' },
  { id: 'SLASH_HEAVY', label: 'Heavy Slash', icon: '🪵' },
];

export default function SimulationControls() {
  const req = useAppStore(s => s.simulationRequest);
  const setReq = useAppStore(s => s.setSimulationRequest);
  const isPickingOrigin = useAppStore(s => s.isPickingOrigin);
  const setIsPickingOrigin = useAppStore(s => s.setIsPickingOrigin);
  const simulationResult = useAppStore(s => s.simulationResult);
  
  const { runSim } = useSimulation();
  const loading = useAppStore(s => s.simulationLoading);
  const error = useAppStore(s => s.simulationError);

  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  // When origin changes, auto-fetch live weather from Open-Meteo
  useEffect(() => {
    if (!req.origin) return;
    const [lon, lat] = req.origin.coordinates;
    setLoadingWeather(true);
    fetchLiveWeather(lat, lon)
      .then(w => {
        setLiveWeather(w);
        setLoadingWeather(false);
        setReq({
          wind_speed_ms: w.wind_speed_ms,
          wind_direction_deg: Math.round(w.wind_direction_deg)
        });
      })
      .catch(() => setLoadingWeather(false));
  }, [req.origin?.coordinates?.[0], req.origin?.coordinates?.[1]]);

  const handleAutoRun = () => {
    if (!req.origin) return;
    runSim({
      origin: req.origin,
      wind_speed_ms: liveWeather ? liveWeather.wind_speed_ms : 5.0,
      wind_direction_deg: liveWeather ? liveWeather.wind_direction_deg : 225.0,
      fuel_type: req.fuel_type || 'SHRUB_CHAPARRAL',
      hours: req.hours || 24
    });
  };

  return (
    <div className="space-y-5">
      {/* Origin Selector */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Fire Origin Point</h3>
          <span className="text-[11px] text-cyan-400 font-medium flex items-center gap-1">
            <Sparkles size={11} /> Auto-Sync Active
          </span>
        </div>
        <div className="flex items-center justify-between bg-slate-800/90 border border-slate-700/80 p-2.5 rounded-lg">
          <div className="text-xs font-mono text-slate-300">
            {req.origin 
              ? `${req.origin.coordinates[1].toFixed(4)}°N, ${req.origin.coordinates[0].toFixed(4)}°W`
              : <span className="text-slate-500 font-sans">Click map or any fire hotspot</span>
            }
          </div>
          <Button 
            size="sm" 
            variant={isPickingOrigin ? 'default' : 'outline'}
            onClick={() => setIsPickingOrigin(!isPickingOrigin)}
          >
            <MapPin size={13} className="mr-1" /> {isPickingOrigin ? 'Click Map' : 'Select'}
          </Button>
        </div>
      </div>

      {/* Live Atmospheric Conditions (Open-Meteo) */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-cyan-500/30 p-3 rounded-xl shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
            <Wind size={14} /> Live Weather (Open-Meteo)
          </span>
          {loadingWeather ? (
            <span className="text-[10px] text-slate-400 animate-pulse">Syncing...</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium">LIVE API</span>
          )}
        </div>

        {liveWeather ? (
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Wind</div>
              <div className="font-bold text-cyan-300">{liveWeather.wind_speed_kmh} <span className="text-[9px]">km/h</span></div>
              <div className="text-[9px] text-slate-500">{liveWeather.wind_direction_deg}° WSW</div>
            </div>
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Temp</div>
              <div className="font-bold text-amber-300">{liveWeather.temperature_c}°C</div>
              <div className="text-[9px] text-slate-500">{Math.round((liveWeather.temperature_c * 9/5) + 32)}°F</div>
            </div>
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Humidity</div>
              <div className="font-bold text-blue-300">{liveWeather.relative_humidity}%</div>
              <div className="text-[9px] text-slate-500">M_f: {Math.round(liveWeather.fuel_moisture_fraction * 100)}%</div>
            </div>
          </div>
        ) : (
          <div className="text-slate-400 text-xs text-center py-2">
            Select a point on the map to automatically load live weather.
          </div>
        )}
      </div>

      {/* Fuel Type Presets */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Fuel Model</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {FUEL_TYPES.map(f => (
            <button
              key={f.id}
              onClick={() => setReq({ fuel_type: f.id })}
              className={`p-2 flex items-center gap-2 rounded-lg border text-xs font-medium transition-all ${
                req.fuel_type === f.id || (!req.fuel_type && f.id === 'SHRUB_CHAPARRAL')
                  ? 'bg-orange-500/20 border-orange-500 text-orange-200 shadow-sm' 
                  : 'bg-slate-800/60 border-slate-700/70 text-slate-400 hover:border-slate-600'
              }`}
            >
              <span className="text-sm">{f.icon}</span> <span>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timeframe Toggle */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Projection Horizons</h3>
        <div className="flex gap-2">
          {[6, 12, 24].map(h => (
            <button 
              key={h} 
              onClick={() => setReq({ hours: h as 6|12|24 })}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                (req.hours || 24) === h 
                  ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-md' 
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {h} Hours
            </button>
          ))}
        </div>
      </div>

      {/* Primary Action: 1-Click Automated Simulation */}
      <Button 
        className="w-full py-2.5 bg-gradient-to-r from-orange-500 via-red-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-semibold shadow-lg shadow-orange-500/25" 
        onClick={handleAutoRun}
        disabled={!req.origin}
        loading={loading}
      >
        <Zap size={16} className="mr-2 fill-current" /> Run Live Fire Spread Forecast
      </Button>

      {error && <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">{error}</div>}
      
      {/* Simulation Result Card */}
      {simulationResult && !loading && (
        <div className="p-3 bg-slate-800/90 rounded-xl border border-slate-700 space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-1.5">
            <h4 className="font-semibold text-orange-400 flex items-center gap-1">
              <Flame size={13} /> Spread Forecast Computed
            </h4>
            <span className="text-[10px] text-slate-400">{simulationResult.metadata.sim_duration_ms}ms</span>
          </div>

          <div className="flex justify-between text-slate-300 text-[11px]">
            <span>Max Spread Rate:</span>
            <span className="font-semibold text-slate-100">{simulationResult.metadata.max_ros_m_min.toFixed(2)} m/min</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center text-xs pt-1">
            <div className="bg-slate-900/80 p-1.5 rounded-lg border border-yellow-500/20">
              <div className="text-yellow-400 font-bold">{Math.round(simulationResult.metadata.burned_area_ha_6h).toLocaleString()} ha</div>
              <div className="text-[10px] text-slate-400">6h Spread</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded-lg border border-orange-500/20">
              <div className="text-orange-400 font-bold">{Math.round(simulationResult.metadata.burned_area_ha_12h).toLocaleString()} ha</div>
              <div className="text-[10px] text-slate-400">12h Spread</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded-lg border border-red-500/20">
              <div className="text-red-400 font-bold">{Math.round(simulationResult.metadata.burned_area_ha_24h).toLocaleString()} ha</div>
              <div className="text-[10px] text-slate-400">24h Spread</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
