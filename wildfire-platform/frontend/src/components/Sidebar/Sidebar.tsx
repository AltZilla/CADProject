import { useState } from 'react';
import { Flame, Wind, Bell } from 'lucide-react';
import { useHotspots } from '@/hooks/useHotspots';
import { useAppStore } from '@/store/appStore';
import SimulationControls from './SimulationControls';
import AlertZoneEditor from './AlertZoneEditor';
import Button from '../UI/Button';

export default function Sidebar() {
  const [tab, setTab] = useState<'hotspots' | 'simulation' | 'alerts'>('hotspots');
  const { data, refetch, isFetching } = useHotspots();
  const setSelectedHotspot = useAppStore(s => s.setSelectedHotspot);

  const hotspots = data?.features.map(f => f.properties) || [];
  const topHotspots = [...hotspots].sort((a, b) => (b.frp ?? b.total_frp ?? 0) - (a.frp ?? a.total_frp ?? 0)).slice(0, 5);

  return (
    <div className="w-[360px] h-full bg-slate-900 border-r border-slate-700 flex flex-col z-20">
      <div className="p-4 border-b border-slate-700 flex items-center gap-3">
        <div className="bg-orange-500/20 p-2 rounded-lg">
          <Flame className="text-orange-500" size={24} />
        </div>
        <div>
          <h1 className="font-bold text-slate-100">Wildfire Platform</h1>
          <p className="text-xs text-slate-400">Early Warning & Simulation</p>
        </div>
      </div>

      <div className="flex border-b border-slate-700">
        <button
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${tab === 'hotspots' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setTab('hotspots')}
        >
          <Flame size={16} /> Hotspots
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${tab === 'simulation' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setTab('simulation')}
        >
          <Wind size={16} /> Simulation
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${tab === 'alerts' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setTab('alerts')}
        >
          <Bell size={16} /> Alerts
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {tab === 'hotspots' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-slate-200">Active Hotspots in View</h2>
              <Button size="sm" variant="outline" onClick={() => refetch()} loading={isFetching}>
                Refresh
              </Button>
            </div>
            
            <div className="text-2xl font-bold text-slate-100">{hotspots.length}</div>
            
            {topHotspots.length > 0 && (
              <div className="space-y-2 mt-6">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Top by Intensity (FRP)</h3>
                {topHotspots.map(h => (
                  <div 
                    key={h.hotspot_id}
                    className="p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-500 cursor-pointer transition-colors"
                    onClick={() => setSelectedHotspot(h)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-slate-200">{(h.frp ?? h.total_frp ?? 0).toFixed(1)} MW</span>
                      <span className="text-xs text-slate-400">{h.satellite || 'VIIRS'}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {(h.latitude ?? h.lat ?? 0).toFixed(4)}°, {(h.longitude ?? h.lon ?? 0).toFixed(4)}°
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'simulation' && <SimulationControls />}
        {tab === 'alerts' && <AlertZoneEditor />}
      </div>

      <div className="p-3 text-xs text-center text-slate-500 border-t border-slate-800">
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
