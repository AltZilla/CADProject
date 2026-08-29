import { create } from 'zustand';
import type { Hotspot } from '../types/hotspot';
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

  // Alert Zones
  alertZones: AlertZone[];
  setAlertZones: (zones: AlertZone[]) => void;
  isDrawingZone: boolean;
  setIsDrawingZone: (v: boolean) => void;
  drawnZonePoints: [number, number][]; // [lon, lat] pairs
  addDrawnZonePoint: (point: [number, number]) => void;
  undoDrawnZonePoint: () => void;
  resetDrawnZonePoints: () => void;
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
}));
