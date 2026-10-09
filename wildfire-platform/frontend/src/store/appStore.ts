import { create } from 'zustand';
import type { Hotspot, FireClass } from '../types/hotspot';
import type { FuelType, SimulationRequest, SimulationResult } from '../types/simulation';
import type { AlertZone } from '../types/alert';

interface AppState {
  // Map
  mapBbox: [number, number, number, number] | null; // [min_lon, min_lat, max_lon, max_lat]
  setMapBbox: (bbox: [number, number, number, number]) => void;

  // Context menu
  contextMenuPos: { x: number; y: number; lng: number; lat: number } | null;
  setContextMenuPos: (pos: { x: number; y: number; lng: number; lat: number } | null) => void;

  // Auto fuel detection
  detectedFuelType: FuelType | null;
  setDetectedFuelType: (ft: FuelType | null) => void;

  // Active sidebar tab (so we can switch to simulation programmatically)
  activeTab: 'hotspots' | 'simulation' | 'alerts';
  setActiveTab: (tab: 'hotspots' | 'simulation' | 'alerts') => void;

  // Hotspots
  selectedHotspot: Hotspot | null;
  setSelectedHotspot: (h: Hotspot | null) => void;
  isSelectingGroup: boolean;
  setIsSelectingGroup: (v: boolean) => void;
  selectedGroupHotspots: [number, number][]; // [lon, lat] pairs
  toggleGroupHotspot: (point: [number, number]) => void;
  setSelectedGroupHotspots: (points: [number, number][]) => void;
  clearGroupHotspots: () => void;

  // Simulation
  simulationRequest: Partial<SimulationRequest>;
  setSimulationRequest: (updates: Partial<SimulationRequest>) => void;
  simulationResult: SimulationResult | null;
  setSimulationResult: (r: SimulationResult | null) => void;
  simulationLoading: boolean;
  setSimulationLoading: (v: boolean) => void;
  simulationError: string | null;
  setSimulationError: (e: string | null) => void;
  isPickingOrigin: boolean;
  setIsPickingOrigin: (v: boolean) => void;

  // Timeline playback
  playbackHour: number;
  setPlaybackHour: (h: number) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (s: number) => void;

  // Alert Zones
  alertZones: AlertZone[];
  setAlertZones: (zones: AlertZone[]) => void;
  isDrawingZone: boolean;
  setIsDrawingZone: (v: boolean) => void;
  drawnZonePoints: [number, number][]; // [lon, lat] pairs
  addDrawnZonePoint: (point: [number, number]) => void;
  undoDrawnZonePoint: () => void;
  resetDrawnZonePoints: () => void;

  // Area selection (rectangle drag to select all hotspots in a region)
  isDrawingArea: boolean;
  setIsDrawingArea: (v: boolean) => void;
  drawnAreaBounds: { start: [number, number]; end: [number, number] } | null;
  setDrawnAreaBounds: (b: { start: [number, number]; end: [number, number] } | null) => void;

  // Fire classification filter
  activeFireClasses: Set<FireClass>;
  setActiveFireClasses: (classes: Set<FireClass>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mapBbox: null,
  setMapBbox: (bbox) => set({ mapBbox: bbox }),

  contextMenuPos: null,
  setContextMenuPos: (pos) => set({ contextMenuPos: pos }),

  detectedFuelType: null,
  setDetectedFuelType: (ft) => set({ detectedFuelType: ft }),

  activeTab: 'hotspots',
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedHotspot: null,
  setSelectedHotspot: (h) => set({ selectedHotspot: h }),
  isSelectingGroup: false,
  setIsSelectingGroup: (v) => set({ isSelectingGroup: v }),
  selectedGroupHotspots: [],
  toggleGroupHotspot: (point) =>
    set((state) => {
      const exists = state.selectedGroupHotspots.some(
        (p) => Math.abs(p[0] - point[0]) < 0.005 && Math.abs(p[1] - point[1]) < 0.005
      );
      const newGroup: [number, number][] = exists
        ? state.selectedGroupHotspots.filter(
            (p) => !(Math.abs(p[0] - point[0]) < 0.005 && Math.abs(p[1] - point[1]) < 0.005)
          )
        : [...state.selectedGroupHotspots, point];

      const simUpdates: Partial<SimulationRequest> = newGroup.length > 0 ? {
        origins: newGroup,
        origin: newGroup.length === 1
          ? { type: 'Point', coordinates: newGroup[0] }
          : { type: 'MultiPoint', coordinates: newGroup },
      } : { origins: undefined };

      return {
        selectedGroupHotspots: newGroup,
        simulationRequest: {
          ...state.simulationRequest,
          ...simUpdates,
        },
      };
    }),
  setSelectedGroupHotspots: (points) =>
    set((state) => ({
      selectedGroupHotspots: points,
      simulationRequest: {
        ...state.simulationRequest,
        origins: points.length > 0 ? points : undefined,
        origin: points.length === 1
          ? { type: 'Point', coordinates: points[0] }
          : points.length > 1
          ? { type: 'MultiPoint', coordinates: points }
          : state.simulationRequest.origin,
      },
    })),
  clearGroupHotspots: () =>
    set((state) => ({
      selectedGroupHotspots: [],
      simulationRequest: {
        ...state.simulationRequest,
        origins: undefined,
      },
    })),

  simulationRequest: {
    hours: 24,
    wind_speed_ms: 5,
    wind_direction_deg: 0,
    fuel_type: 'GRASS_SHORT',
  },
  setSimulationRequest: (updates) =>
    set((state) => ({ simulationRequest: { ...state.simulationRequest, ...updates } })),
  simulationResult: null,
  setSimulationResult: (r) => set({ simulationResult: r }),
  simulationLoading: false,
  setSimulationLoading: (v) => set({ simulationLoading: v }),
  simulationError: null,
  setSimulationError: (e) => set({ simulationError: e }),
  isPickingOrigin: false,
  setIsPickingOrigin: (v) => set({ isPickingOrigin: v }),

  playbackHour: 24,
  setPlaybackHour: (h) => set({ playbackHour: h }),
  isPlaying: false,
  setIsPlaying: (v) => set({ isPlaying: v }),
  playbackSpeed: 1,
  setPlaybackSpeed: (s) => set({ playbackSpeed: s }),

  alertZones: [],
  setAlertZones: (zones) => set({ alertZones: zones }),
  isDrawingZone: false,
  setIsDrawingZone: (v) => set({ isDrawingZone: v }),
  drawnZonePoints: [],
  addDrawnZonePoint: (point) =>
    set((state) => ({ drawnZonePoints: [...state.drawnZonePoints, point] })),
  undoDrawnZonePoint: () =>
    set((state) => ({ drawnZonePoints: state.drawnZonePoints.slice(0, -1) })),
  resetDrawnZonePoints: () => set({ drawnZonePoints: [] }),

  isDrawingArea: false,
  setIsDrawingArea: (v) => set({ isDrawingArea: v }),
  drawnAreaBounds: null,
  setDrawnAreaBounds: (b) => set({ drawnAreaBounds: b }),

  activeFireClasses: new Set<FireClass>(['verified', 'probable', 'possible', 'industrial']),
  setActiveFireClasses: (classes) => set({ activeFireClasses: classes }),
}));
