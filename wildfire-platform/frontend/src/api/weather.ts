import type { FuelType } from '@/types/simulation';

export interface LiveWeather {
  wind_speed_ms: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  temperature_c: number;
  relative_humidity: number;
  surface_pressure_hpa: number;
  fuel_moisture_fraction: number;
  soil_moisture: number;
  source: string;
}

export async function fetchLiveWeather(lat: number, lon: number): Promise<LiveWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure&hourly=soil_moisture_0_to_1cm`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather API error');
    const data = await res.json();
    const curr = data.current || {};
    const hourly = data.hourly || {};

    const windKmh = Number(curr.wind_speed_10m ?? 12);
    const windDir = Number(curr.wind_direction_10m ?? 225);
    const tempC = Number(curr.temperature_2m ?? 25);
    const rh = Number(curr.relative_humidity_2m ?? 35);
    const press = Number(curr.surface_pressure ?? 1013.25);
    const soil_moisture = hourly.soil_moisture_0_to_1cm ? Number(hourly.soil_moisture_0_to_1cm[0]) : 0.15;

    const moistureFrac = Math.max(0.03, Math.min(0.30, 0.03 + 0.25 * (rh / 100) - 0.0006 * Math.max(0, tempC)));

    return {
      wind_speed_ms: Number((windKmh / 3.6).toFixed(2)),
      wind_speed_kmh: Number(windKmh.toFixed(1)),
      wind_direction_deg: Number(windDir.toFixed(1)),
      temperature_c: Number(tempC.toFixed(1)),
      relative_humidity: Number(rh.toFixed(1)),
      surface_pressure_hpa: Number(press.toFixed(1)),
      fuel_moisture_fraction: Number(moistureFrac.toFixed(3)),
      soil_moisture: Number(soil_moisture.toFixed(3)),
      source: 'Open-Meteo Live API',
    };
  } catch {
    return {
      wind_speed_ms: 5.0,
      wind_speed_kmh: 18.0,
      wind_direction_deg: 225.0,
      temperature_c: 28.0,
      relative_humidity: 25.0,
      surface_pressure_hpa: 1013.2,
      fuel_moisture_fraction: 0.08,
      soil_moisture: 0.15,
      source: 'Default Atmospheric Fallback',
    };
  }
}

export function detectFuelType(weather: LiveWeather): FuelType {
  const { soil_moisture, temperature_c: temp, relative_humidity: rh } = weather;
  if (soil_moisture > 0.30 && temp < 15) return 'TIMBER_LITTER';
  if (soil_moisture > 0.20 && temp < 25) return 'SHRUB_LOW';
  if (soil_moisture < 0.08 && temp > 30 && rh < 25) return 'SHRUB_CHAPARRAL';
  if (soil_moisture < 0.12 && temp > 20) return 'GRASS_SHORT';
  if (soil_moisture >= 0.12 && soil_moisture <= 0.20 && temp >= 15 && temp <= 30) return 'GRASS_TALL';
  return 'SHRUB_CHAPARRAL';
}
