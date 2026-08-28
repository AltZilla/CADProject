import { useQuery } from '@tanstack/react-query';
import { fetchHotspots } from '@/api/hotspots';
import { useAppStore } from '@/store/appStore';

export function useHotspots() {
  const mapBbox = useAppStore(s => s.mapBbox);

  return useQuery({
    queryKey: ['hotspots', mapBbox],
    queryFn: () => {
      if (!mapBbox) return Promise.resolve({ type: 'FeatureCollection' as const, features: [] });
      const [min_lon, min_lat, max_lon, max_lat] = mapBbox;
      return fetchHotspots({ min_lon, min_lat, max_lon, max_lat });
    },
    enabled: mapBbox !== null,
    refetchInterval: 3 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}
