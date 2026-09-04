import React from 'react';
import { useAppStore } from '@/store/appStore';
import { Wind } from 'lucide-react';

export default function WindCompass() {
  const simulationResult = useAppStore(s => s.simulationResult);
  const playbackHour = useAppStore(s => s.playbackHour);

  if (!simulationResult?.metadata) return null;

  const hourlyList = simulationResult.metadata.hourly_weather;
  const hourly = (hourlyList && hourlyList.length >= playbackHour) ? hourlyList[playbackHour - 1] : null;

  const windDir = hourly ? hourly.wind_direction_deg : (simulationResult.metadata.wind_direction_deg ?? 0);
  const windSpeed = hourly ? hourly.wind_speed_ms : simulationResult.metadata.wind_speed_ms;
  const windKmh = Math.round(windSpeed * 3.6);
  const tempC = hourly ? hourly.temperature_c : simulationResult.metadata.temperature_c;
  const rh = hourly ? hourly.relative_humidity : simulationResult.metadata.relative_humidity;

  // Arrow points in travel direction (where wind blows toward)
  const arrowRotation = (windDir + 180) % 360;

  return (
    <div className="absolute top-20 right-4 z-30">
      <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700/80 rounded-2xl p-3 shadow-lg w-[104px]">
        {/* Hour badge */}
        <div className="text-[10px] text-center font-bold text-orange-400 mb-1">
          Hour +{playbackHour} Wind
        </div>

        {/* Compass ring */}
        <div className="relative w-16 h-16 mx-auto mb-2">
          {/* Outer ring */}
          <svg viewBox="0 0 64 64" className="w-full h-full">
            <circle cx="32" cy="32" r="28" fill="none" stroke="#334155" strokeWidth="1.5" />
            {/* Cardinal ticks */}
            {[0, 90, 180, 270].map(deg => (
              <line
                key={deg}
                x1={32 + 24 * Math.sin(deg * Math.PI / 180)}
                y1={32 - 24 * Math.cos(deg * Math.PI / 180)}
                x2={32 + 28 * Math.sin(deg * Math.PI / 180)}
                y2={32 - 28 * Math.cos(deg * Math.PI / 180)}
                stroke="#64748b"
                strokeWidth="2"
              />
            ))}
            {/* Minor ticks */}
            {[45, 135, 225, 315].map(deg => (
              <line
                key={deg}
                x1={32 + 25 * Math.sin(deg * Math.PI / 180)}
                y1={32 - 25 * Math.cos(deg * Math.PI / 180)}
                x2={32 + 28 * Math.sin(deg * Math.PI / 180)}
                y2={32 - 28 * Math.cos(deg * Math.PI / 180)}
                stroke="#475569"
                strokeWidth="1"
              />
            ))}
          </svg>

          {/* Cardinal labels */}
          <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-0.5 text-[8px] font-bold text-slate-400">N</span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-0.5 text-[8px] font-bold text-slate-500">S</span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-0.5 text-[8px] font-bold text-slate-500">W</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-0.5 text-[8px] font-bold text-slate-500">E</span>

          {/* Dynamic wind direction arrow */}
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-500 ease-out"
            style={{ transform: `rotate(${arrowRotation}deg)` }}
          >
            <svg viewBox="0 0 24 40" className="w-5 h-8" style={{ filter: 'drop-shadow(0 0 5px rgba(251,146,60,0.8))' }}>
              {/* Arrow body */}
              <line x1="12" y1="36" x2="12" y2="6" stroke="#fb923c" strokeWidth="2.5" strokeLinecap="round" />
              {/* Arrow head */}
              <polygon points="12,2 6,14 18,14" fill="#fb923c" />
              {/* Tail */}
              <circle cx="12" cy="36" r="2" fill="#f97316" />
            </svg>
          </div>
        </div>

        {/* Real meteorological data for this exact hour */}
        <div className="text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1">
            <Wind size={11} className="text-cyan-400" />
            <span className="text-xs font-bold text-cyan-300">{windKmh} <span className="text-[9px] text-slate-400">km/h</span></span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono">
            FROM {Math.round(windDir)}°
          </div>
          {tempC !== undefined && (
            <div className="text-[9px] text-slate-500 pt-0.5 border-t border-slate-800">
              {tempC}°C · {rh}% RH
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
