import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';
import { useSimulation } from '@/hooks/useSimulation';
import { fetchLiveWeather, detectFuelType } from '@/api/weather';
import { MapPin, Flame, Zap, X, ChevronRight } from 'lucide-react';

interface FireCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  maxFrp: number;
  label: string;
}

export default function IncidentShowcase() {
  const { data } = useHotspots();
  const setSimulationRequest = useAppStore(s => s.setSimulationRequest);
  const setDetectedFuelType = useAppStore(s => s.setDetectedFuelType);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const simulationResult = useAppStore(s => s.simulationResult);
  const simulationLoading = useAppStore(s => s.simulationLoading);
  const { runSim } = useSimulation();
  const [dismissed, setDismissed] = useState(false);

  // Cluster hotspots into major incidents using simple grid binning
  const clusters: FireCluster[] = useMemo(() => {
    if (!data?.features?.length) return [];

    const grid: Record<string, { lats: number[]; lons: number[]; frps: number[]; count: number }> = {};
    
    // 2-degree grid binning
    for (const f of data.features) {
      const lat = f.properties?.latitude ?? f.geometry?.coordinates?.[1] ?? 0;
      const lon = f.properties?.longitude ?? f.geometry?.coordinates?.[0] ?? 0;
      const frp = f.properties?.frp ?? 0;
      const key = `${Math.round(lat / 2) * 2},${Math.round(lon / 2) * 2}`;
      
      if (!grid[key]) grid[key] = { lats: [], lons: [], frps: [], count: 0 };
      grid[key].lats.push(lat);
      grid[key].lons.push(lon);
      grid[key].frps.push(frp);
      grid[key].count++;
    }

    return Object.entries(grid)
      .filter(([, v]) => v.count >= 3)
      .map(([key, v]) => {
        const avgLat = v.lats.reduce((a, b) => a + b, 0) / v.lats.length;
        const avgLon = v.lons.reduce((a, b) => a + b, 0) / v.lons.length;
        const maxFrp = Math.max(...v.frps);
        
        // Simple region labels
        let label = `${Math.abs(avgLat).toFixed(0)}°${avgLat >= 0 ? 'N' : 'S'}, ${Math.abs(avgLon).toFixed(0)}°${avgLon >= 0 ? 'E' : 'W'}`;
        if (avgLat > 25 && avgLat < 50 && avgLon > -130 && avgLon < -60) label = 'North America';
        else if (avgLat > 35 && avgLat < 70 && avgLon > -15 && avgLon < 45) label = 'Europe';
        else if (avgLat > -35 && avgLat < 5 && avgLon > 10 && avgLon < 55) label = 'Central Africa';
        else if (avgLat > 5 && avgLat < 25 && avgLon > -20 && avgLon < 55) label = 'West Africa / Sahel';
        else if (avgLat > -45 && avgLat < -10 && avgLon > 110 && avgLon < 155) label = 'Australia';
        else if (avgLat > -15 && avgLat < 15 && avgLon > 95 && avgLon < 140) label = 'Southeast Asia';
        else if (avgLat > -30 && avgLat < 5 && avgLon > -75 && avgLon < -35) label = 'South America';
        else if (avgLat > 40 && avgLat < 70 && avgLon > 50 && avgLon < 180) label = 'Siberia / Russia';
        else if (avgLat > 20 && avgLat < 45 && avgLon > 60 && avgLon < 100) label = 'Central Asia';
        
        return { id: key, lat: avgLat, lon: avgLon, count: v.count, maxFrp, label };
      })
      .sort((a, b) => b.maxFrp - a.maxFrp)
      .slice(0, 5);
  }, [data]);

  const handleTeleportAndSim = async (cluster: FireCluster) => {
    const origin = { type: 'Point' as const, coordinates: [cluster.lon, cluster.lat] as [number, number] };
    
    const weather = await fetchLiveWeather(cluster.lat, cluster.lon);
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
    setDismissed(true);
    runSim(request as any);
  };

  // Don't show if dismissed, if no data, or if a simulation is already running/displayed
  if (dismissed || simulationResult || simulationLoading || clusters.length === 0) return null;

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-[600px] max-w-[calc(100%-2rem)]">
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200">Active Wildfire Incidents — Live from NASA FIRMS</span>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Incident cards — horizontal scroll */}
        <div className="flex gap-2 p-3 overflow-x-auto">
          {clusters.map(c => (
            <button
              key={c.id}
              onClick={() => handleTeleportAndSim(c)}
              className="flex-shrink-0 w-[140px] p-2.5 bg-slate-800/80 border border-slate-700/60 rounded-xl hover:border-orange-500/50 hover:bg-slate-800 transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <Flame size={14} className="text-orange-400" />
                <ChevronRight size={12} className="text-slate-600 group-hover:text-orange-400 transition-colors" />
              </div>
              <div className="text-[11px] font-semibold text-slate-200 mb-0.5 truncate">{c.label}</div>
              <div className="text-[10px] text-slate-400 mb-2">
                {c.count} hotspots detected
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-orange-400">
                  ⚡ {c.maxFrp.toFixed(0)} MW
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium group-hover:bg-orange-500/30 transition-colors">
                  Simulate
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
