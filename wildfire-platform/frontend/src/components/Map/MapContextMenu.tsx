import React, { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';
import { Flame, MapPin, X } from 'lucide-react';
import { formatPoint } from '@/utils/geo';

export default function MapContextMenu() {
  const pos = useAppStore(s => s.contextMenuPos);
  const setContextMenuPos = useAppStore(s => s.setContextMenuPos);
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const setDetectedFuelType = useAppStore(s => s.setDetectedFuelType);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const { runSim } = useSimulation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [setContextMenuPos]);

  if (!pos) return null;

  const handleSimulate = async () => {
    const origin = { type: 'Point' as const, coordinates: [pos.lng, pos.lat] as [number, number] };
    setContextMenuPos(null);
    
    // Fetch live weather + auto-detect fuel
    const weather = await fetchLiveWeather(pos.lat, pos.lng);
    const autoFuel = detectFuelType(weather);
    setDetectedFuelType(autoFuel);
    
    const request = {
      origin,
      wind_speed_ms: weather.wind_speed_ms,
      wind_direction_deg: weather.wind_direction_deg,
      fuel_type: autoFuel,
      hours: 24 as const,
    };
    setSimulationRequest(request);
    setActiveTab('simulation');
    runSim(request as any);
  };

  const handleSetOrigin = () => {
    setSimulationRequest({
      origin: { type: 'Point', coordinates: [pos.lng, pos.lat] }
    });
    setActiveTab('simulation');
    setContextMenuPos(null);
  };

  const menuWidth = 240;
  const menuHeight = 132;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `clamp(8px, ${pos.x}px, calc(100% - ${menuWidth + 8}px))`,
    top: `clamp(8px, ${pos.y}px, calc(100% - ${menuHeight + 8}px))`,
    zIndex: 50,
  };

  return (
    <div ref={menuRef} style={style} className="bg-slate-800/95 backdrop-blur-sm border border-slate-600 rounded-xl shadow-2xl overflow-hidden min-w-[220px] animate-in fade-in zoom-in-95 duration-150">
      <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
        <span className="text-[11px] text-slate-400 font-medium">
          {formatPoint([pos.lng, pos.lat])}
        </span>
        <button onClick={() => setContextMenuPos(null)} className="text-slate-500 hover:text-slate-300">
          <X size={12} />
        </button>
      </div>
      <button
        onClick={handleSimulate}
        className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-orange-500/20 hover:text-orange-300 flex items-center gap-2.5 transition-colors"
      >
        <Flame size={15} className="text-orange-400" /> Simulate Fire Spread Here
      </button>
      <button
        onClick={handleSetOrigin}
        className="w-full px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors border-t border-slate-700/30"
      >
        <MapPin size={15} className="text-cyan-400" /> Set as Fire Origin
      </button>
    </div>
  );
}
