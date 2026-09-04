import React, { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { Play, Pause, SkipBack, SkipForward, Flame, Wind } from 'lucide-react';

export default function TimelineControls() {
  const simulationResult = useAppStore(s => s.simulationResult);
  const playbackHour = useAppStore(s => s.playbackHour);
  const setPlaybackHour = useAppStore(s => s.setPlaybackHour);
  const isPlaying = useAppStore(s => s.isPlaying);
  const setIsPlaying = useAppStore(s => s.setIsPlaying);
  const playbackSpeed = useAppStore(s => s.playbackSpeed);
  const setPlaybackSpeed = useAppStore(s => s.setPlaybackSpeed);
  const intervalRef = useRef<number>();

  // Auto-start playback from hour 1 when a new simulation result arrives
  useEffect(() => {
    if (simulationResult) {
      setPlaybackHour(1);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
      setPlaybackHour(24);
    }
  }, [simulationResult?.sim_id]);

  // Playback timer
  useEffect(() => {
    if (isPlaying && simulationResult) {
      intervalRef.current = window.setInterval(() => {
        const current = useAppStore.getState().playbackHour;
        if (current >= 24) {
          setIsPlaying(false);
          setPlaybackHour(24);
        } else {
          setPlaybackHour(current + 1);
        }
      }, 600 / playbackSpeed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, simulationResult]);

  if (!simulationResult) return null;

  const burnedArea = simulationResult.perimeters.features
    .filter(f => (f.properties?.timeframe_hours ?? 0) <= playbackHour)
    .reduce((max, f) => Math.max(max, f.properties?.burned_area_ha ?? 0), 0);

  const hourlyList = simulationResult.metadata.hourly_weather;
  const hourly = hourlyList && hourlyList.length >= playbackHour ? hourlyList[playbackHour - 1] : null;

  const speeds = [1, 2, 5, 10];

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 w-[560px] max-w-[calc(100%-2rem)]">
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl px-4 py-3">
        {/* Status line */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Flame size={14} className="text-orange-400" />
            <span className="text-xs font-semibold text-slate-200">
              +{playbackHour}h into incident
            </span>
            {hourly && (
              <span className="text-[10px] text-cyan-300 font-mono flex items-center gap-1 bg-slate-800/90 px-2 py-0.5 rounded-full border border-slate-700/60">
                <Wind size={10} className="text-cyan-400" />
                {hourly.wind_speed_kmh} km/h · {Math.round(hourly.wind_direction_deg)}° · {hourly.temperature_c}°C
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-orange-400 font-bold">
              {Math.round(burnedArea).toLocaleString()} ha burned
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">
              {simulationResult.metadata.max_ros_m_min.toFixed(1)} m/min peak
            </span>
          </div>
        </div>

        {/* Scrubber bar */}
        <div className="relative mb-2">
          <input
            type="range"
            min={1}
            max={24}
            step={1}
            value={playbackHour}
            onChange={(e) => {
              setPlaybackHour(Number(e.target.value));
              setIsPlaying(false);
            }}
            className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500 
              [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-orange-500/50
              [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-orange-300
              [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform
              [&::-webkit-slider-thumb]:hover:scale-125"
            style={{
              background: `linear-gradient(to right, #f97316 0%, #f97316 ${((playbackHour - 1) / 23) * 100}%, #334155 ${((playbackHour - 1) / 23) * 100}%, #334155 100%)`,
            }}
          />
          {/* Hour tick marks */}
          <div className="flex justify-between px-0.5 mt-1">
            {[1, 6, 12, 18, 24].map(h => (
              <button
                key={h}
                onClick={() => { setPlaybackHour(h); setIsPlaying(false); }}
                className={`text-[9px] font-mono transition-colors ${
                  h <= playbackHour ? 'text-orange-400' : 'text-slate-600'
                } hover:text-orange-300`}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPlaybackHour(1); setIsPlaying(false); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Reset to start"
            >
              <SkipBack size={14} />
            </button>

            <button
              onClick={() => {
                if (playbackHour >= 24) {
                  setPlaybackHour(1);
                  setIsPlaying(true);
                } else {
                  setIsPlaying(!isPlaying);
                }
              }}
              className="p-2 rounded-xl bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>

            <button
              onClick={() => { setPlaybackHour(24); setIsPlaying(false); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Jump to end"
            >
              <SkipForward size={14} />
            </button>
          </div>

          {/* Speed selector */}
          <div className="flex items-center gap-1">
            {speeds.map(s => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                  playbackSpeed === s
                    ? 'bg-orange-500/25 text-orange-400 ring-1 ring-orange-500/50'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
