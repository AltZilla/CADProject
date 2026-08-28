import { post } from './client';
import type { SimulationRequest, SimulationResult } from '../types/simulation';

export async function runSimulation(request: SimulationRequest): Promise<SimulationResult> {
  return post<SimulationResult>('/simulate-spread', request);
}
