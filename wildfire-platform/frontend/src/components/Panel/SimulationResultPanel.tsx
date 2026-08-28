import React from 'react';
import { useAppStore } from '@/store/appStore';
import { X } from 'lucide-react';

export default function SimulationResultPanel() {
  const result = useAppStore(s => s.simulationResult);
  const setSimulationResult = useAppStore(s => s.setSimulationResult);

  if (!result) return null;

  const { metadata } = result;

  const formatHa = (val: number) => Math.round(val).toLocaleString();

  return (
    <div className="absolute bottom-4 left-4 bg-slate-800/90 backdrop-blur rounded-xl p-4 w-72 shadow-2xl border border-slate-700 transform transition-transform animate-in slide-in-from-bottom-10 z-10">
      <div className="flex justify-between items-start mb-2">
        <h4 className="text-orange-500 font-semibold text-sm">Fire Spread Forecast</h4>
        <button onClick={() => setSimulationResult(null)} className="text-slate-400 hover:text-slate-200">
          <X size={14} />
        </button>
      </div>
      
      <p className="text-xs text-slate-400 mb-4">
        {metadata.fuel_type.replace('_', ' ')} · {metadata.wind_speed_ms}m/s wind
      </p>
      
      <div className="space-y-2 text-sm text-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{background: '#fef08a'}} />
            <span>6h Impact</span>
          </div>
          <span className="font-mono text-xs">{formatHa(metadata.burned_area_ha_6h)} ha</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{background: '#fb923c'}} />
            <span>12h Impact</span>
          </div>
          <span className="font-mono text-xs">{formatHa(metadata.burned_area_ha_12h)} ha</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{background: '#ef4444'}} />
            <span>24h Impact</span>
          </div>
          <span className="font-mono text-xs">{formatHa(metadata.burned_area_ha_24h)} ha</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700/50 flex justify-between items-center text-xs">
        <span className="text-slate-400">Max spread rate:</span>
        <span className="text-slate-200 font-medium">{metadata.max_ros_m_min.toFixed(1)} m/min</span>
      </div>
    </div>
  );
}
