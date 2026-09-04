import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, LiveWeather, detectFuelType } from '@/api/weather';
import Button from '../UI/Button';
import { MapPin, Flame, Wind, Sparkles, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import type { FuelType } from '@/types/simulation';
import { formatPoint } from '@/utils/geo';
import { formatAreaHa, formatFuelType, getForecastInterpretation } from '@/utils/forecast';

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
  const detectedFuelType = useAppStore(s => s.detectedFuelType);
  const setDetectedFuelType = useAppStore(s => s.setDetectedFuelType);
  
  const { runSim } = useSimulation();
  const loading = useAppStore(s => s.simulationLoading);
  const error = useAppStore(s => s.simulationError);
  const playbackHour = useAppStore(s => s.playbackHour);

  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [showFuelOverride, setShowFuelOverride] = useState(false);

  const centerCoord = React.useMemo<[number, number] | null>(() => {
    if (req.origins && req.origins.length > 0) {
      const lons = req.origins.map(p => p[0]);
      const lats = req.origins.map(p => p[1]);
      return [lons.reduce((a, b) => a + b, 0) / lons.length, lats.reduce((a, b) => a + b, 0) / lats.length];
    }
    if (!req.origin) return null;
    if (req.origin.type === 'Point' && Array.isArray(req.origin.coordinates)) {
      return [req.origin.coordinates[0], req.origin.coordinates[1]];
    }
    if (req.origin.type === 'MultiPoint' && Array.isArray(req.origin.coordinates) && req.origin.coordinates.length > 0) {
      const coords = req.origin.coordinates;
      const lons = coords.map(p => p[0]);
      const lats = coords.map(p => p[1]);
      return [lons.reduce((a, b) => a + b, 0) / lons.length, lats.reduce((a, b) => a + b, 0) / lats.length];
    }
    return null;
  }, [req.origin, req.origins]);

  // When origin changes, auto-fetch live weather and detect fuel type
  useEffect(() => {
    if (!centerCoord) return;
    const [lon, lat] = centerCoord;
    setLoadingWeather(true);
    fetchLiveWeather(lat, lon)
      .then(w => {
        setLiveWeather(w);
        setLoadingWeather(false);
        
        // Auto-detect fuel type
        const autoFuel = detectFuelType(w);
        setDetectedFuelType(autoFuel);
        
        setReq({
          wind_speed_ms: w.wind_speed_ms,
          wind_direction_deg: Math.round(w.wind_direction_deg),
          fuel_type: autoFuel,
        });
      })
      .catch(() => setLoadingWeather(false));
  }, [centerCoord?.[0], centerCoord?.[1]]);

  const handleAutoRun = async () => {
    if (!centerCoord) return;
    
    let fuel = detectedFuelType || req.fuel_type || 'SHRUB_CHAPARRAL';
    let resolvedWeather = liveWeather;
    
    // If no weather yet, fetch it
    if (!resolvedWeather) {
      const [lon, lat] = centerCoord;
      const w = await fetchLiveWeather(lat, lon);
      resolvedWeather = w;
      setLiveWeather(w);
      fuel = detectFuelType(w);
      setDetectedFuelType(fuel);
    }
    
    runSim({
      origin: req.origin,
      origins: req.origins,
      wind_speed_ms: resolvedWeather ? resolvedWeather.wind_speed_ms : req.wind_speed_ms ?? 5.0,
      wind_direction_deg: resolvedWeather ? resolvedWeather.wind_direction_deg : req.wind_direction_deg ?? 225.0,
      fuel_type: fuel as FuelType,
      hours: (req.hours || 24) as 6 | 12 | 24,
    });
  };

  const activeFuel = FUEL_TYPES.find(f => f.id === (detectedFuelType || req.fuel_type));
  const forecast = simulationResult ? getForecastInterpretation(simulationResult.metadata) : null;

  return (
    <div className="space-y-5">
      {/* Simulation Result Card — shown at top when results exist */}
      {simulationResult && !loading && (
        <div className="p-3 bg-slate-800/90 rounded-xl border border-slate-700 space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-1.5">
            <h4 className="font-semibold text-orange-400 flex items-center gap-1">
              <Flame size={13} /> Spread Forecast Computed
            </h4>
            <span className="text-[10px] text-slate-400">{simulationResult.metadata.sim_duration_ms}ms</span>
          </div>

          {forecast && (
            <div className={`rounded-lg border p-2 ${
              forecast.tone === 'high'
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : forecast.tone === 'moderate'
                  ? 'border-orange-500/30 bg-orange-500/10 text-orange-200'
                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
            }`}>
              <div className="font-semibold">{forecast.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-300">{forecast.detail}</div>
            </div>
          )}

          <div className="flex justify-between text-slate-300 text-[11px]">
            <span>Max Spread Rate:</span>
            <span className="font-semibold text-slate-100">{simulationResult.metadata.max_ros_m_min.toFixed(2)} m/min</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center text-xs pt-1">
            <div className="bg-slate-900/80 p-1.5 rounded-lg border border-yellow-500/20">
              <div className="text-yellow-400 font-bold">{formatAreaHa(simulationResult.metadata.burned_area_ha_6h)}</div>
              <div className="text-[10px] text-slate-400">6h Spread</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded-lg border border-orange-500/20">
              <div className="text-orange-400 font-bold">{formatAreaHa(simulationResult.metadata.burned_area_ha_12h)}</div>
              <div className="text-[10px] text-slate-400">12h Spread</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded-lg border border-red-500/20">
              <div className="text-red-400 font-bold">{formatAreaHa(simulationResult.metadata.burned_area_ha_24h)}</div>
              <div className="text-[10px] text-slate-400">24h Spread</div>
            </div>
          </div>

          {playbackHour !== 6 && playbackHour !== 12 && playbackHour !== 24 && (
            <div className="bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-orange-500/40 flex justify-between items-center text-xs">
              <span className="text-orange-300 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                Active Playback Hour +{playbackHour}:
              </span>
              <span className="text-orange-400 font-bold font-mono">
                {formatAreaHa(
                  simulationResult.perimeters.features
                    .filter(f => (f.properties?.timeframe_hours ?? 0) <= playbackHour)
                    .reduce((max, f) => Math.max(max, f.properties?.burned_area_ha ?? 0), 0)
                )}
              </span>
            </div>
          )}

          <div className="text-[11px] text-slate-400">
            {formatFuelType(simulationResult.metadata.fuel_type)} · {simulationResult.metadata.weather_source || liveWeather?.source || 'Weather source unavailable'}
          </div>
        </div>
      )}

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
            {req.origins && req.origins.length > 1 ? (
              <span className="text-amber-400 font-semibold">
                Cluster of {req.origins.length} hotspots ({centerCoord ? formatPoint(centerCoord) : ''})
              </span>
            ) : req.origin && req.origin.type === 'Point' ? (
              formatPoint(req.origin.coordinates as [number, number])
            ) : req.origin && req.origin.type === 'MultiPoint' ? (
              <span className="text-amber-400 font-semibold">
                Multi-Point ({(req.origin.coordinates as [number, number][]).length} pts)
              </span>
            ) : (
              <span className="text-slate-500 font-sans">Click map, right-click, or select hotspots</span>
            )}
          </div>
          <Button 
            size="sm" 
            variant={isPickingOrigin ? 'default' : 'outline'}
            onClick={() => setIsPickingOrigin(!isPickingOrigin)}
          >
            <MapPin size={13} className="mr-1" /> {isPickingOrigin ? 'Click Map' : 'Pick'}
          </Button>
        </div>
      </div>

      {/* Compact Weather + Auto-Detected Fuel */}
      {liveWeather && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-cyan-500/30 p-3 rounded-xl shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
              <Wind size={14} /> Live Conditions
            </span>
            {loadingWeather ? (
              <span className="text-[10px] text-slate-400 animate-pulse">Syncing...</span>
            ) : liveWeather.source.includes('Fallback') ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">FALLBACK</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium">LIVE</span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Wind</div>
              <div className="font-bold text-cyan-300">{liveWeather.wind_speed_kmh} <span className="text-[9px]">km/h</span></div>
            </div>
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Temp</div>
              <div className="font-bold text-amber-300">{liveWeather.temperature_c}°C</div>
            </div>
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Humidity</div>
              <div className="font-bold text-blue-300">{liveWeather.relative_humidity}%</div>
            </div>
            <div className="bg-slate-900/60 p-1.5 rounded-lg border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Soil</div>
              <div className="font-bold text-emerald-300">{Math.round(liveWeather.soil_moisture * 100)}%</div>
            </div>
          </div>
          {liveWeather.source.includes('Fallback') && (
            <p className="mt-2 text-[11px] text-amber-200">
              Live weather was unavailable, so the forecast uses conservative default atmospheric inputs.
            </p>
          )}
        </div>
      )}

      {/* Auto-Detected Fuel Badge + Override */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Fuel Model</h3>
          <button
            onClick={() => setShowFuelOverride(!showFuelOverride)}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
          >
            {showFuelOverride ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showFuelOverride ? 'Hide' : 'Override'}
          </button>
        </div>
        
        {/* Auto-detected badge */}
        {activeFuel && (
          <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg mb-2">
            <span className="text-base">{activeFuel.icon}</span>
            <div>
              <div className="text-xs font-medium text-emerald-300">Auto-detected: {activeFuel.label}</div>
              <div className="text-[10px] text-slate-400">Based on live soil moisture + climate</div>
            </div>
          </div>
        )}

        {/* Override grid — collapsed by default */}
        {showFuelOverride && (
          <div className="grid grid-cols-2 gap-1.5">
            {FUEL_TYPES.map(f => (
              <button
                key={f.id}
                onClick={() => {
                  setReq({ fuel_type: f.id });
                  setDetectedFuelType(f.id);
                }}
                className={`p-2 flex items-center gap-2 rounded-lg border text-xs font-medium transition-all ${
                  (detectedFuelType || req.fuel_type) === f.id
                    ? 'bg-orange-500/20 border-orange-500 text-orange-200 shadow-sm' 
                    : 'bg-slate-800/60 border-slate-700/70 text-slate-400 hover:border-slate-600'
                }`}
              >
                <span className="text-sm">{f.icon}</span> <span>{f.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Timeframe Toggle — compact */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Projection</h3>
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
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Primary Action */}
      <Button 
        className="w-full py-2.5 bg-gradient-to-r from-orange-500 via-red-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-semibold shadow-lg shadow-orange-500/25" 
        onClick={handleAutoRun}
        disabled={!req.origin && (!req.origins || req.origins.length === 0)}
        loading={loading}
      >
        <Zap size={16} className="mr-2 fill-current" />
        {req.origins && req.origins.length > 1
          ? `Run Forecast for ${req.origins.length} Hotspots`
          : 'Run Fire Spread Forecast'}
      </Button>

      {error && <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">{error}</div>}
    </div>
  );
}
