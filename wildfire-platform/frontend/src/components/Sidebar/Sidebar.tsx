import { Flame, Wind, Bell, Zap } from 'lucide-react';
import { useHotspots } from '@/hooks/useHotspots';
import { useAppStore } from '@/store/appStore';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';
import SimulationControls from './SimulationControls';
import AlertZoneEditor from './AlertZoneEditor';
import Button from '../UI/Button';
import { formatPoint } from '@/utils/geo';
import { findFireComplex } from '@/utils/clustering';

export default function Sidebar() {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const { data, refetch, isFetching, error: hotspotsError } = useHotspots();
  const setSelectedHotspot = useAppStore(s => s.setSelectedHotspot);
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const setDetectedFuelType = useAppStore(s => s.setDetectedFuelType);
  const { runSim } = useSimulation();
  const simulationLoading = useAppStore(s => s.simulationLoading);

  const hotspots = data?.features.map(f => f.properties) || [];
  const topHotspots = [...hotspots].sort((a, b) => (b.frp ?? b.total_frp ?? 0) - (a.frp ?? a.total_frp ?? 0)).slice(0, 8);

  const handleQuickSim = async (h: any) => {
    const lat = h.latitude ?? h.lat ?? 0;
    const lon = h.longitude ?? h.lon ?? 0;

    const complex = findFireComplex(lon, lat, data?.features || [], 12.0);
    const points = complex.points;
    const origin = points.length === 1 ? { type: 'Point' as const, coordinates: points[0] } : { type: 'MultiPoint' as const, coordinates: points };
    const centerLon = complex.center[0];
    const centerLat = complex.center[1];

    const weather = await fetchLiveWeather(centerLat, centerLon);
    const autoFuel = detectFuelType(weather);
    setDetectedFuelType(autoFuel);

    const request = {
      origins: points,
      origin,
      wind_speed_ms: weather.wind_speed_ms,
      wind_direction_deg: weather.wind_direction_deg,
      fuel_type: autoFuel,
      hours: 24 as const,
    };
    useAppStore.getState().setSelectedGroupHotspots(points);
    setSimulationRequest(request);
    setActiveTab('simulation');
    runSim(request as any);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 h-[46vh] sm:relative sm:inset-auto sm:h-full sm:w-[360px] bg-slate-900 border-t sm:border-t-0 sm:border-r border-slate-700 flex flex-col z-40 shadow-2xl sm:shadow-none">
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
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'hotspots' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setActiveTab('hotspots')}
        >
          <Flame size={16} /> Hotspots
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'simulation' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setActiveTab('simulation')}
        >
          <Wind size={16} /> Simulation
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === 'alerts' ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-200'}`}
          onClick={() => setActiveTab('alerts')}
        >
          <Bell size={16} /> Alerts
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === 'hotspots' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-slate-200">Active Hotspots in View</h2>
              <Button size="sm" variant="outline" onClick={() => refetch()} loading={isFetching}>
                Refresh
              </Button>
            </div>
            
            <div className="text-2xl font-bold text-slate-100">{hotspots.length}</div>

            {isFetching && hotspots.length === 0 && (
              <p className="text-xs text-slate-400">Checking the current map view for active fire detections...</p>
            )}

            {hotspotsError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                Hotspots could not be loaded. Check the API URL or try refreshing the map.
              </div>
            )}

            {!isFetching && !hotspotsError && hotspots.length === 0 && (
              <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-3 text-xs text-slate-400">
                No active hotspots are visible in this map area. Pan or zoom to another region, then refresh.
              </div>
            )}

            {topHotspots.length > 0 && (
              <div className="space-y-2 mt-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Top by Intensity (FRP)</h3>
                {topHotspots.map(h => (
                  <div 
                    key={h.hotspot_id}
                    className="p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-500 cursor-pointer transition-colors group"
                    onClick={() => setSelectedHotspot(h)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-slate-200">{(h.frp ?? h.total_frp ?? 0).toFixed(1)} MW</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">{h.satellite || 'VIIRS'}</span>
                      <button
                          onClick={(e) => { e.stopPropagation(); handleQuickSim(h); }}
                          disabled={simulationLoading}
                          className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-md bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                          aria-label={`Quick simulate hotspot at ${formatPoint([(h.longitude ?? h.lon ?? 0), (h.latitude ?? h.lat ?? 0)])}`}
                          title="Quick simulate from this hotspot"
                        >
                          <Zap size={11} className="fill-current" /> Sim
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatPoint([(h.longitude ?? h.lon ?? 0), (h.latitude ?? h.lat ?? 0)])}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'simulation' && <SimulationControls />}
        {activeTab === 'alerts' && <AlertZoneEditor />}
      </div>

      <div className="p-3 text-xs text-center text-slate-500 border-t border-slate-800">
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
