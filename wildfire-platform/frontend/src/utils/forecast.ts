import type { FuelType, SimulationMetadata } from '@/types/simulation';

const FUEL_LABELS: Record<FuelType, string> = {
  GRASS_SHORT: 'Short grass',
  GRASS_TALL: 'Tall grass',
  SHRUB_LOW: 'Low shrub',
  SHRUB_CHAPARRAL: 'Chaparral',
  TIMBER_LITTER: 'Timber litter',
  SLASH_HEAVY: 'Heavy slash',
};

export function formatFuelType(fuelType: FuelType | string): string {
  return FUEL_LABELS[fuelType as FuelType] ?? fuelType.replace(/_/g, ' ').toLowerCase();
}

export function formatAreaHa(value: number): string {
  if (!Number.isFinite(value)) return 'Unknown';
  if (value === 0) return '0 ha';
  if (value < 0.1) return '<0.1 ha';
  if (value < 10) return `${value.toFixed(1)} ha`;
  return `${Math.round(value).toLocaleString()} ha`;
}

export function getForecastInterpretation(metadata: SimulationMetadata): {
  tone: 'low' | 'moderate' | 'high';
  title: string;
  detail: string;
} {
  const maxArea = Math.max(
    metadata.burned_area_ha_6h,
    metadata.burned_area_ha_12h,
    metadata.burned_area_ha_24h,
  );

  if (maxArea < 1) {
    return {
      tone: 'low',
      title: 'Low spread in this model run',
      detail: 'The forecast reached less than 1 hectare under the current weather, fuel, and terrain assumptions.',
    };
  }

  if (maxArea >= 100) {
    return {
      tone: 'high',
      title: 'Significant spread forecast',
      detail: 'Use this as a planning estimate and compare it with field reports before acting on it.',
    };
  }

  return {
    tone: 'moderate',
    title: 'Contained spread forecast',
    detail: 'The model projects measurable growth, but conditions do not produce a large perimeter in this run.',
  };
}
