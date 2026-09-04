const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const HOTSPOTS_URL = (import.meta.env.VITE_HOTSPOTS_URL || '').replace(/\/+$/, '');
const SIMULATION_URL = (import.meta.env.VITE_SIMULATION_URL || '').replace(/\/+$/, '');
const ALERTS_URL = (import.meta.env.VITE_ALERTS_URL || '').replace(/\/+$/, '');

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let url = `${BASE_URL}${path}`;

  if (BASE_URL) {
    url = `${BASE_URL.replace(/\/+$/, '')}${path}`;
  } else if (path.startsWith('/hotspots') && HOTSPOTS_URL) {
    url = `${HOTSPOTS_URL}${path}`;
  } else if (path.startsWith('/simulate-spread') && SIMULATION_URL) {
    url = `${SIMULATION_URL}${path}`;
  } else if (path.startsWith('/alert-zones') && ALERTS_URL) {
    url = `${ALERTS_URL}${path}`;
  }

  const headers: Record<string, string> = {
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = 'API Error';
    try {
      const data = await response.json();
      message = data.detail || data.message || response.statusText;
    } catch {
      message = response.statusText;
    }
    throw new Error(message);
  }

  return response.json();
}

export const get = <T>(path: string, options?: RequestInit) => apiFetch<T>(path, { ...options, method: 'GET' });
export const post = <T>(path: string, data: any, options?: RequestInit) =>
  apiFetch<T>(path, { ...options, method: 'POST', body: JSON.stringify(data) });
export const del = <T>(path: string, options?: RequestInit) => apiFetch<T>(path, { ...options, method: 'DELETE' });
