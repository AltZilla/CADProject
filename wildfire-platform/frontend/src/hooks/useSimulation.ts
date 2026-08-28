import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { runSimulation as runSimulationApi } from '@/api/simulation';
import type { SimulationRequest } from '@/types/simulation';

export function useSimulation() {
  const setSimulationResult = useAppStore(s => s.setSimulationResult);
  const setSimulationLoading = useAppStore(s => s.setSimulationLoading);
  const setSimulationError = useAppStore(s => s.setSimulationError);

  const runSim = useCallback(async (request: SimulationRequest) => {
    setSimulationLoading(true);
    setSimulationError(null);
    try {
      const result = await runSimulationApi(request);
      setSimulationResult(result);
    } catch (e) {
      setSimulationError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setSimulationLoading(false);
    }
  }, [setSimulationResult, setSimulationLoading, setSimulationError]);

  return { runSim };
}
