import React from 'react';
import { useAppStore } from '@/store/appStore';
import { X } from 'lucide-react';
import { formatAreaHa, formatFuelType, getForecastInterpretation } from '@/utils/forecast';

export default function SimulationResultPanel() {
  const result = useAppStore(s => s.simulationResult);
  const setSimulationResult = useAppStore(s => s.setSimulationResult);
  const activeTab = useAppStore(s => s.activeTab);
  const playbackHour = useAppStore(s => s.playbackHour);

  if (!result || activeTab === 'alerts') return null;

  const { metadata } = result;
  const forecast = getForecastInterpretation(metadata);

  const currentHourBurnedArea = result.perimeters.features
    .filter(f => (f.properties?.timeframe_hours ?? 0) <= playbackHour)
    .reduce((max, f) => Math.max(max, f.properties?.burned_area_ha ?? 0), 0);

  return (
    <div className="absolute bottom-[calc(46vh+1rem)] left-3 right-3 sm:right-auto sm:bottom-4 sm:left-4 bg-slate-800/90 backdrop-blur rounded-xl p-4 sm:w-72 shadow-2xl border border-slate-700 transform transition-transform animate-in slide-in-from-bottom-10 z-10">
      <div className="flex justify-between items-start mb-2">
        <h4 className="text-orange-500 font-semibold text-sm">Fire Spread Forecast</h4>
        <button onClick={() => setSimulationResult(null)} className="text-slate-400 hover:text-slate-200">
          <X size={14} />
        </button>
      </div>
      
      <p className="text-xs text-slate-400 mb-4">
        {formatFuelType(metadata.fuel_type)} · {metadata.wind_speed_ms.toFixed(2)} m/s wind
      </p>

      <div className={`mb-3 rounded-lg border p-2 text-xs ${
        forecast.tone === 'high'
          ? 'border-red-500/30 bg-red-500/10 text-red-200'
          : forecast.tone === 'moderate'
            ? 'border-orange-500/30 bg-orange-500/10 text-orange-200'
            : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
      }`}>
        <div className="font-semibold">{forecast.title}</div>
        <div className="mt-0.5 text-slate-300">{forecast.detail}</div>
      </div>
      
      <div className="space-y-2 text-sm text-slate-200">
        <div className="flex items-center justify-between pb-1 mb-1 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />
            <span className="font-semibold text-orange-300">Hour +{playbackHour}</span>
          </div>
          <span className="font-mono text-xs font-bold text-orange-300">{formatAreaHa(currentHourBurnedArea)}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{background: '#fef08a'}} />
            <span>6h Impact</span>
          </div>
          <span className="font-mono text-xs">{formatAreaHa(metadata.burned_area_ha_6h)}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{background: '#fb923c'}} />
            <span>12h Impact</span>
          </div>
          <span className="font-mono text-xs">{formatAreaHa(metadata.burned_area_ha_12h)}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{background: '#ef4444'}} />
            <span>24h Impact</span>
          </div>
          <span className="font-mono text-xs">{formatAreaHa(metadata.burned_area_ha_24h)}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700/50 space-y-1 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Max spread rate:</span>
          <span className="text-slate-200 font-medium">{metadata.max_ros_m_min.toFixed(2)} m/min</span>
        </div>
        {metadata.weather_source && (
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Weather:</span>
            <span className="text-slate-300 text-right">{metadata.weather_source}</span>
          </div>
        )}
      </div>
    </div>
  );
}
