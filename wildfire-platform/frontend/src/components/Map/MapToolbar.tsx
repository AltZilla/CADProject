import React from 'react';
import { useAppStore } from '@/store/appStore';
import { useHotspots } from '@/hooks/useHotspots';
import { Flame, RefreshCw, Crosshair, Mountain } from 'lucide-react';

interface MapToolbarProps {
  is3D?: boolean;
  onToggle3D?: () => void;
}

export default function MapToolbar({ is3D, onToggle3D }: MapToolbarProps) {
  const isPickingOrigin = useAppStore(s => s.isPickingOrigin);
  const setIsPickingOrigin = useAppStore(s => s.setIsPickingOrigin);
  const { data, refetch, isFetching } = useHotspots();
  
  const count = data?.features?.length ?? 0;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-sm border border-slate-700/80 rounded-full px-2 py-1 shadow-lg">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-orange-500/15 text-orange-400">
        <Flame size={13} />
        <span className="text-xs font-bold tabular-nums">{count.toLocaleString()}</span>
      </div>
      
      <div className="w-px h-5 bg-slate-700" />
      
      <button
        onClick={() => refetch()}
        disabled={isFetching}
        className="p-1.5 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
        title="Refresh hotspots"
      >
        <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
      </button>
      
      <button
        onClick={() => setIsPickingOrigin(!isPickingOrigin)}
        className={`p-1.5 rounded-full transition-colors ${
          isPickingOrigin
            ? 'text-cyan-400 bg-cyan-500/20'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`}
        title={isPickingOrigin ? 'Cancel origin pick' : 'Pick fire origin on map'}
      >
        <Crosshair size={14} />
      </button>

      {onToggle3D && (
        <button
          onClick={onToggle3D}
          className={`p-1.5 rounded-full transition-colors ${
            is3D
              ? 'text-emerald-400 bg-emerald-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title={is3D ? 'Switch to 2D' : 'Switch to 3D terrain'}
        >
          <Mountain size={14} />
        </button>
      )}

      {isPickingOrigin && (
        <span className="text-[11px] text-cyan-400 font-medium animate-pulse pr-1">
          Click map to place origin
        </span>
      )}
    </div>
  );
}
